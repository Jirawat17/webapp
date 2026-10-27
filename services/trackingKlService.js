// Mua tracking KL / in label KL (22/10/2026, theo yêu cầu người dùng — khối "Vận chuyển (KL)" ở Chi tiết đơn). Gọi API qua klService.js.
// Dùng lại hạ tầng của luồng GKE (trackingAutoService.js): hàng đợi theo đơn (CÙNG khoá với GKE -> 2 hãng không bao giờ chạy cùng lúc cho 1
// đơn), chặn đơn đã huỷ, điều kiện in label, DonNhieuAo, ghi Sheet Seller, log. KL CHỈ mua bằng tay (không có job tự mua — người dùng chốt).
// Dữ liệu: TRACKING_ID / HANG_VAN_CHUYEN dùng CHUNG với GKE + DON_VI_VAN_CHUYEN = 'KL' (trangThaiDbService.js) — 1 đơn chỉ 1 tracking: đơn đã
// có tracking (GKE / Seller / KL) thì không mua KL; đơn đang chờ tem GKE cũng không.
// Chống mua trùng (KL chưa rõ có tính phí khi tạo lỗi, không cho tạo trùng mã đơn):
//   1. Trước khi tạo LUÔN tra KL theo mã đơn (khớp đúng): có đơn thành công -> dùng lại, không tạo; có đơn lỗi -> báo, không tạo.
//   2. Ghi KL_DANG_TAO (lúc gửi) NGAY TRƯỚC lệnh tạo; mất phản hồi -> giữ dấu (lượt sau lại tra KL trước, bước 1).
//   3. Không bao giờ tự gửi lại lệnh tạo đơn.
const orderService = require('./orderService');
const gkeService = require('./gkeService');
const klService = require('./klService');
const donNhieuAoService = require('./donNhieuAoService');
const sheetSellerService = require('./sheetSellerService');
const { ghiLog } = require('./logService');
// trackingAutoService cũng require file này (lấy label / tra trạng thái đơn KL) -> nạp khi dùng, tránh vòng require.
const tas = () => require('./trackingAutoService')._dungChoHangKhac;
const hangChung = require('./hangVanChuyenKhacService');

const { DON_VI_KL } = klService;
const { thoiGianVNISOString } = require('./dateUtils');
const laDonKl = r => !!r && r.DON_VI_VAN_CHUYEN === DON_VI_KL;
const trangThaiKl = d => (klService.moTaTrangThaiKl(d) ? `, trạng thái "${klService.moTaTrangThaiKl(d)}"` : '');
// Superadmin xác nhận đơn KL "chưa đủ mã" là đơn đã huỷ / không dùng (Bỏ dấu, 27/10/2026) — lưu mã đơn KL đó (canh_bao_da_xu_ly, loại
// KL_DON_BO_QUA): lần mua KL sau gặp lại đúng đơn này thì KHÔNG đặt lại dấu "đang mua KL" (không khoá lại đơn), báo mua GKE.
// Đơn KL không có cả sid lẫn barcode: không có gì để nhận ra đúng đơn đó -> không ghi (maDonKl = '') — tránh coi nhầm 1 đơn KL mới cũng
// thiếu mã là "đã bỏ qua". Bản ghi bỏ khi mua được tracking KL / xoá dữ liệu đơn (xoaDuLieuDonService).
const LOAI_BO_QUA = 'KL_DON_BO_QUA';
const maDonKl = d => String(d.sid || d.barcode || '');
const daBoQuaDonKl = (sttKey, d) => {
  const ma = maDonKl(d);
  const ghi = ma && require('./nhatKyDbService').layDaXuLy(LOAI_BO_QUA).get(sttKey);
  return !!ghi && ghi.gia_tri === ma;
};

// Tem KL lưu sẵn trên MinIO (orders/<mã>/tem-kl_<tracking>.pdf) — dùng chung hàm lưu / đọc tem GKE (trackingAutoService, tham số 'kl').
// Cùng thư mục đơn: "Xoá dữ liệu đơn" xoá luôn; routes/photos.js /file/* chặn tem-kl_*.

function muaTrackingKlChoDon(sttKey, user) {
  return tas().xepHangMuaTracking(sttKey, () => _muaTrackingKl(sttKey, user));
}

async function _muaTrackingKl(sttKey, user) {
  const t = tas();
  const nhatKy = [];
  const nhan = `[KL - ${user.ten}]`;
  const nguon = user === t.NGUOI_HE_THONG ? 'KL - Tự động' : 'KL - Thủ công';
  try {
    if (!hangChung.duocMuaHangKhac(user.vaiTro)) throw new Error('Chỉ admin / vẽ file được mua tracking KL — đơn đã có tracking KL thì vẫn in label được.');
    const { rows } = await orderService.getAll({ docThat: true });
    const row = rows.find(r => r.STT_Key === sttKey);
    if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
    t.chanMuaDonDaHuy(row);
    if (row.TRACKING_ID) {
      t.ghiLogTrackingVaoDb({ sttKey, nguon, nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Bỏ qua', chiTiet: `Đơn đã có tracking ${row.TRACKING_ID} — không mua KL.` });
      return null;
    }
    if (row.TAM_THOI === gkeService.MA_DANG_CHO_TEM) {
      throw new Error('Đơn đã tạo vận đơn GKE (đang chờ tem GKE) — không mua KL. Lấy tem ở khối Vận chuyển (GKE).');
    }
    if (require('./hpwService').dangMuaHpw(row)) throw new Error('Đơn đang mua tracking HPW (đã tạo lô / chưa rõ kết quả) — không mua KL. Xem khối Vận chuyển (HPW).');

    // DonNhieuAo: chỉ mua ở đơn ".1" cho cả nhóm; đơn con nhận bản sao tracking (cùng quy tắc GKE).
    const nhom = donNhieuAoService.layNhomCuaDon(sttKey, rows);
    if (nhom && nhom.loiChan.length) throw new Error(`[DonNhieuAo ${nhom.goc}] ${nhom.loiChan.join(' ')} Sửa dữ liệu rồi thử lại.`);
    if (nhom && nhom.donMua.STT_Key !== sttKey) {
      if (!nhom.donMua.TRACKING_ID) throw new Error(`Đơn thuộc nhóm DonNhieuAo ${nhom.goc} — chỉ mua tracking ở đơn ${nhom.donMua.STT_Key}, các đơn còn lại dùng chung.`);
      const { loiSheet } = await t.saoTrackingXuongNhom(nhom, t.trackingCuaDon(nhom.donMua), user);
      return { dungChung: true, donMua: nhom.donMua.STT_Key, tracking_num: nhom.donMua.TRACKING_ID, loiSheetCon: loiSheet };
    }

    const cauHinh = klService.layCauHinhKlChoDon(row);
    const dsDon = nhom ? nhom.thanhVien.filter(r => r.TRANG_THAI_XUONG !== donNhieuAoService.TRANG_THAI_HUY) : [row];
    const body = klService.taoBodyDonKl(row, dsDon, cauHinh, gkeService.maQuocGia);
    if (nhom) nhatKy.push(`[DonNhieuAo] Nhóm ${nhom.goc} (${dsDon.length} đơn) — 1 đơn KL cho cả nhóm, ${body.weight} g, `
      + `${body.items.map(i => `${i.skuNumber} × ${i.quantity}`).join(', ')}.`);

    // Bước 1: tra KL theo mã đơn TRƯỚC khi tạo.
    let don = await klService.timDonTheoMa(sttKey, cauHinh, nhatKy);
    if (don && klService.laDonChoCapMa(don) && daBoQuaDonKl(sttKey, don)) {
      throw new Error(`Đơn KL ${maDonKl(don)} của mã ${sttKey} đã được superadmin xác nhận là huỷ / không dùng — KL không cho tạo đơn mới cùng mã đơn. `
        + 'Mua tracking GKE cho đơn này (hoặc xoá hẳn đơn đó trên trang KL rồi mua KL lại).');
    }
    if (don && klService.laDonChoCapMa(don)) {
      // Giữ / đặt dấu đang mua KL: job GKE không chen vào trong lúc chờ KL cấp mã.
      if (!row.KL_DANG_TAO) await orderService.update(sttKey, { KL_DANG_TAO: thoiGianVNISOString(), TAI_KHOAN_KL: cauHinh.id, DON_VI_VAN_CHUYEN: DON_VI_KL }, user);
      // khongRoKetQua: KL đang cấp mã, không phải lỗi của đơn — job tự mua không đếm vào 10 lần thử (trackingAutoService#muaTuDongTheoHang).
      throw Object.assign(new Error(`KL đã có đơn mã ${sttKey} (sid ${don.sid || '?'}${don.barcode ? `, tracking ${don.barcode}` : ''}${trangThaiKl(don)}) nhưng CHƯA đủ `
        + `${don.barcode ? 'mã đơn KL (sid)' : 'mã tracking'} — KHÔNG xoá trên trang KL. Đợi vài phút rồi bấm mua lại: app nhận đơn này, không tạo đơn mới. `
        + 'Nếu trên trang KL đơn này đã bị huỷ: superadmin "Bỏ dấu đang mua KL" để MUA GKE thay (KL không cho tạo đơn thứ 2 cùng mã đơn).'), { khongRoKetQua: true });
    }
    if (don && !klService.laDonThanhCong(don)) { // còn lại: KL báo lỗi / cảnh báo / huỷ
      throw new Error(`KL đã có đơn mã ${sttKey} (sid ${don.sid || '?'}) ở trạng thái "${klService.moTaTrangThaiKl(don) || '?'}"`
        + `${don.reason || don.Reason ? ` — ${don.reason || don.Reason}` : ''}${don.barcode ? ` (barcode ${don.barcode})` : ''}. `
        + 'App KHÔNG tự nhận đơn lỗi / cảnh báo và KL không cho tạo trùng mã đơn: kiểm tra / xoá đơn đó trên trang KL rồi bấm lại.');
    }
    if (don) {
      nhatKy.push(`KL đã có đơn thành công cho mã ${sttKey} (sid ${don.sid || '?'}, tracking ${don.barcode}) — dùng lại, KHÔNG tạo đơn mới.`);
      // Danh sách có thể thiếu hãng giao / phí -> lấy chi tiết đơn (cần sid); lỗi thì dùng dữ liệu đang có (barcode là đủ để lưu tracking).
      if (don.sid && (!don.shipping_partner || don.usd == null)) {
        try {
          const ct = await klService.layDonKl(don.sid, cauHinh, nhatKy);
          don = { ...don, ...Object.fromEntries(['shipping_partner', 'usd', 'vnd'].filter(k => ct[k] != null && ct[k] !== '').map(k => [k, ct[k]])) };
        } catch (err) {
          nhatKy.push(`Không lấy được chi tiết đơn KL ${don.sid} (${err.message}) — hãng giao / phí có thể để trống.`);
        }
        if (!don.shipping_partner) nhatKy.push(`CẢNH BÁO: KL không cho biết hãng giao của đơn ${don.sid} — cột hãng vận chuyển để trống.`);
      }
    } else {
      // Bước 2: dấu "đang tạo" + tài khoản, rồi mới gửi lệnh tạo.
      await orderService.update(sttKey, { KL_DANG_TAO: thoiGianVNISOString(), TAI_KHOAN_KL: cauHinh.id, DON_VI_VAN_CHUYEN: DON_VI_KL }, user);
      try {
        don = await klService.taoDonKl(body, cauHinh, nhatKy);
        if (!don.sid) { // phản hồi tạo đơn không có sid -> tra KL theo mã đơn để lấy (cần cho label); không lấy được vẫn lưu tracking
          try {
            const tim = await klService.timDonTheoMa(sttKey, cauHinh, nhatKy);
            if (tim && tim.sid && String(tim.barcode) === String(don.barcode)) don = { ...tim, ...don, sid: tim.sid };
          } catch (err) { nhatKy.push(`Không tra được KL để lấy mã đơn KL (sid): ${err.message}`); }
        }
      } catch (err) {
        if (err.khongRoKetQua) {
          throw Object.assign(new Error(`${err.message}. CHƯA BIẾT KL đã tạo đơn hay chưa — bấm lại: app tra KL theo mã đơn trước, KHÔNG tạo trùng.`), { khongRoKetQua: true });
        }
        // KL từ chối rõ ràng -> bỏ dấu + tài khoản (lần sau lấy lại tài khoản ĐANG gán cho Xưởng), sửa dữ liệu rồi mua lại.
        await orderService.update(sttKey, { KL_DANG_TAO: '', DON_VI_VAN_CHUYEN: '', TAI_KHOAN_KL: '' }, user);
        throw err;
      }
    }

    // Thiếu sid: vẫn lưu tracking (đơn KL đã tạo — không để job GKE mua thêm), báo rõ chưa lấy được label KL.
    const canhBaoSid = don.sid ? '' : `KL không trả mã đơn KL (sid) — đã lưu tracking nhưng CHƯA lấy được label KL qua app${don.vendor_sid ? ` (vendor_sid ${don.vendor_sid})` : ''}; lấy label trên trang KL.`;
    if (canhBaoSid) nhatKy.push('CẢNH BÁO: ' + canhBaoSid);
    const hang = klService.tenHangVanChuyen(don.shipping_partner);
    const canhBaoHang = hang ? '' : (don.shipping_partner
      ? `KL trả hãng giao mã "${don.shipping_partner}" (app chưa biết tên) — cột hãng vận chuyển để trống, kể cả trên Sheet Seller.`
      : 'KL không cho biết hãng giao — cột hãng vận chuyển để trống, kể cả trên Sheet Seller.');
    if (canhBaoHang) nhatKy.push('CẢNH BÁO: ' + canhBaoHang);
    await orderService.update(sttKey, {
      TRACKING_ID: String(don.barcode), HANG_VAN_CHUYEN: hang, KL_DANG_TAO: '', DON_VI_VAN_CHUYEN: DON_VI_KL, TAI_KHOAN_KL: cauHinh.id,
      KL_ORDER_SID: don.sid ? String(don.sid) : '', KL_PHI_USD: don.usd != null ? String(don.usd) : '', KL_PHI_VND: don.vnd != null ? String(don.vnd) : '',
    }, user);

    let loiSheetCon = [];
    if (nhom) {
      const { daSao, loiSheet } = await t.saoTrackingXuongNhom(nhom, { trackingId: String(don.barcode), hangVanChuyen: hang, donVi: DON_VI_KL, taiKhoanKl: cauHinh.id }, user);
      loiSheetCon = loiSheet;
      nhatKy.push(`[DonNhieuAo] Đã sao tracking xuống: ${daSao.join(', ') || '(không có đơn nào cần sao)'}.`);
    }
    require('./nhatKyDbService').xoaDaXuLy(LOAI_BO_QUA, sttKey); // đã có tracking KL — bản ghi "đơn KL bị bỏ qua" (nếu có) hết tác dụng
    const [kqDay] = await sheetSellerService.ghiHangLoat([{ sttKey, loai: 'TRACKING', giaTri: { TRACKING_ID2: String(don.barcode), HANG_VAN_CHUYEN2: hang } }], user);
    const dayCheKhachHang = kqDay.ok ? { ok: true } : { ok: false, lyDo: kqDay.lyDo };
    nhatKy.push(kqDay.ok ? `Đã ghi tracking vào Sheet Seller (tab "${kqDay.tab}", dòng ${kqDay.dong}).` : `LỖI ghi tracking vào Sheet Seller: ${kqDay.lyDo}`);
    t.baoLoiSheetSeller([kqDay], user, 'tracking KL');

    const phi = [don.usd != null ? `$${don.usd}` : '', don.vnd != null ? `${don.vnd}₫` : ''].filter(Boolean).join(' / ');
    t.ghiLogTracking(`${nhan} ${sttKey}: đã mua tracking KL ${don.barcode} (${hang})${phi ? ` · phí ${phi}` : ''}`, sttKey);
    ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'MUA_TRACKING_KL', sttKey, chiTiet: { trackingNum: String(don.barcode), hangVanChuyen: hang, klSid: don.sid ? String(don.sid) : '', vendorSid: don.vendor_sid || '', phiUsd: don.usd ?? null, phiVnd: don.vnd ?? null } })
      .catch(err => console.error('[TrackingKL] Lỗi ghi log nền:', err.message));
    t.ghiLogTrackingVaoDb({ sttKey, nguon, nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công', trackingId: String(don.barcode), hangVanChuyen: hang, chiTiet: nhatKy.join('\n') });
    return { tracking_num: String(don.barcode), delivery_carrier: hang, kl: { sid: don.sid ? String(don.sid) : '', usd: don.usd ?? null, vnd: don.vnd ?? null }, dayCheKhachHang, loiSheetCon,
      canhBaoHang: [canhBaoHang, canhBaoSid].filter(Boolean).join(' ') };
  } catch (err) {
    t.ghiLogTracking(`${nhan} ${sttKey}: LỖI — ${err.message}`, sttKey);
    t.ghiLogTrackingVaoDb({ sttKey, nguon, nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi', chiTiet: nhatKy.concat(`LỖI: ${err.message}`).join('\n') });
    throw err;
  }
}

// "Bỏ dấu đang mua KL" (22/10/2026, CHỈ superadmin — routes/tracking.js): đơn kẹt KL_DANG_TAO (KL mất phản hồi, KL lỗi lâu / hết tiền) để mua
// GKE hoặc mua KL lại từ đầu. Tra KL theo mã đơn TRƯỚC: KL có đơn -> không bỏ (bấm Mua để nhận tracking, hoặc xoá đơn trên trang KL).
// Không tra được KL -> lỗi maLoi 'KHONG_TRA_DUOC_KL'; superadmin xác nhận đã tự kiểm tra trên trang KL thì gửi lại với boQuaKiemTra.
// KL có đơn "chưa đủ mã" -> maLoi 'KL_DON_CHUA_DU'; superadmin xác nhận đơn đó đã huỷ thì gửi lại với boQuaDonChuaDu: tra lại, ghi nhận đơn
// bị bỏ qua (daBoQuaDonKl) rồi bỏ dấu — lần mua KL sau không khoá lại đơn.
function boDauDangMuaKl(sttKey, user, { boQuaKiemTra = false, boQuaDonChuaDu = false } = {}) {
  return tas().xepHangMuaTracking(sttKey, async () => {
    const t = tas();
    const { row } = await orderService.getByKey(sttKey, { fresh: true });
    if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
    if (!row.KL_DANG_TAO) throw new Error('Đơn không ở trạng thái "đang mua KL".');
    const nhatKy = [];
    if (!boQuaKiemTra) {
      let don;
      try {
        don = await klService.timDonTheoMa(sttKey, klService.layCauHinhKlChoDon(row), nhatKy);
      } catch (err) {
        throw Object.assign(new Error(`Không tra được KL để kiểm tra (${err.message}).`), { maLoi: 'KHONG_TRA_DUOC_KL' });
      }
      if (don && klService.laDonThanhCong(don)) {
        throw new Error(`KL ĐÃ có đơn mã ${sttKey} (barcode ${don.barcode}) — không bỏ dấu; bấm "Mua Tracking KL" để nhận tracking này (không tạo đơn mới).`);
      }
      // Đơn KL chưa đủ mã mà không báo lỗi: có thể đang chờ cấp mã, có thể đã bị huỷ dưới tên trạng thái app chưa biết -> superadmin tự kiểm
      // tra trên trang KL rồi xác nhận (giao diện gửi lại với boQuaKiemTra), không từ chối hẳn (đơn kẹt mãi).
      if (don && klService.laDonChoCapMa(don)) {
        if (!boQuaDonChuaDu) {
          throw Object.assign(new Error(`KL có đơn mã ${sttKey}${trangThaiKl(don)} chưa có đủ mã tracking — có thể đang chờ KL cấp mã (KHÔNG xoá).`), { maLoi: 'KL_DON_CHUA_DU' });
        }
        if (maDonKl(don)) {
          require('./nhatKyDbService').danhDauDaXuLy({ loai: LOAI_BO_QUA, khoa: sttKey, giaTri: maDonKl(don), nguoi: user.ten, luc: thoiGianVNISOString(),
            ghiChu: `superadmin xác nhận đơn KL${trangThaiKl(don)} đã huỷ / không dùng` });
          nhatKy.push(`Superadmin xác nhận đơn KL ${maDonKl(don)}${trangThaiKl(don)} đã huỷ / không dùng — lần mua KL sau không khoá lại đơn.`);
        } else {
          nhatKy.push(`Superadmin xác nhận đơn KL${trangThaiKl(don)} đã huỷ — KL không cho mã đơn nên KHÔNG ghi nhớ được: bấm "Mua Tracking KL" lần sau có thể khoá lại đơn (mua GKE thay).`);
        }
      } else if (don) {
        throw new Error(`KL có đơn mã ${sttKey} ở trạng thái "${klService.moTaTrangThaiKl(don)}" — xoá đơn đó trên trang KL trước rồi bỏ dấu.`);
      }
    }
    await orderService.update(sttKey, { KL_DANG_TAO: '', DON_VI_VAN_CHUYEN: '', TAI_KHOAN_KL: '', TU_MUA_CHUA_RO_TU: '' }, user); // hết đợt "chưa rõ" của job tự mua
    const chiTiet = boQuaKiemTra ? 'Bỏ dấu KHÔNG tra KL (superadmin xác nhận đã tự kiểm tra trên trang KL).'
      : boQuaDonChuaDu ? 'Bỏ dấu (đơn KL chưa đủ mã được xác nhận đã huỷ).' : 'Đã tra KL: không có đơn mã này — bỏ dấu.';
    ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'BO_DAU_DANG_MUA_KL', sttKey, chiTiet: { boQuaKiemTra, boQuaDonChuaDu } })
      .catch(err => console.error('[TrackingKL] Lỗi ghi log nền:', err.message));
    t.ghiLogTrackingVaoDb({ sttKey, nguon: 'KL - Bỏ dấu', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công', chiTiet: nhatKy.concat(chiTiet).join('\n') });
    t.ghiLogTracking(`[KL - ${user.ten}] ${sttKey}: bỏ dấu đang mua KL${boQuaKiemTra ? ' (không tra KL)' : boQuaDonChuaDu ? ' (xác nhận đơn KL chưa đủ mã đã huỷ)' : ''}`, sttKey);
    return { ok: true };
  });
}

// In label / "Mua Tracking KL và In Label KL" — phần dùng chung với HPW (hangVanChuyenKhacService.js). In label KL cũng là đích của nút
// "IN LABEL" GKE / in hàng loạt khi đơn là đơn KL (trackingAutoService.inLabelChoDon).
const HANG_KL = {
  ten: 'KL', maTem: 'kl', laDon: r => laDonKl(r),
  thieuDuLieu: don => (don.KL_ORDER_SID ? null : `Đơn ${don.STT_Key} chưa có mã đơn KL (sid) — KL không trả khi mua; chưa lấy được label qua app, lấy label trên trang KL (tracking ${don.TRACKING_ID}).`),
  layLabel: (don, nhatKy) => klService.layLabelKl(don.KL_ORDER_SID, klService.layCauHinhKlChoDon(don), nhatKy),
  mua: (sttKey, user) => muaTrackingKlChoDon(sttKey, user),
  inLabel: (sttKey, user) => inLabelKlChoDon(sttKey, user),
};
const inLabelKlChoDon = (sttKey, user) => hangChung.inLabelHangKhac(HANG_KL, sttKey, user);
const muaTrackingKlVaInLabelChoDon = (sttKey, user) => hangChung.muaVaInLabelHangKhac(HANG_KL, sttKey, user);

// Trạng thái vận chuyển đơn KL — gọi từ trackingAutoService.capNhatTrangThaiTrackingChoDon (cùng job / nút tra thủ công với GKE).
// -> { capNhat } | { lyDo } (chưa có sự kiện). trackingComplete -> MA_TRANG_THAI_NODE_TRACKING 'DONE' (job thôi quét đơn đó).
async function traTrangThaiKl(donTra) {
  const ds = await klService.layTrackingKl(donTra.TRACKING_ID, klService.layCauHinhKlChoDon(donTra), []);
  const moi = klService.suKienMoiNhat(ds);
  if (!moi) return { lyDo: 'KL chưa có sự kiện tracking nào cho đơn này (có thể vừa tạo, chưa được quét nhận).' };
  return {
    suKien: moi,
    capNhat: {
      TRANG_THAI_TRACKING: String(moi.description || ''),
      MA_NODE_TRACKING: 'KL',
      MA_TRANG_THAI_NODE_TRACKING: ds.some(e => e.trackingComplete === true) ? 'DONE' : '',
    },
  };
}
const daGiaoXongKl = r => laDonKl(r) && r.MA_TRANG_THAI_NODE_TRACKING === 'DONE';

module.exports = { muaTrackingKlChoDon, inLabelKlChoDon, muaTrackingKlVaInLabelChoDon, boDauDangMuaKl, traTrangThaiKl, laDonKl, daGiaoXongKl };
