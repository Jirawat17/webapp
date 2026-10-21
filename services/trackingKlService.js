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
const tas = () => require('./trackingAutoService')._dungChoKl;

const { DON_VI_KL } = klService;
const { thoiGianVNISOString } = require('./dateUtils');
const laDonKl = r => !!r && r.DON_VI_VAN_CHUYEN === DON_VI_KL;

// Tem KL lưu sẵn trên MinIO (orders/<mã>/tem-kl_<tracking>.pdf) — dùng chung hàm lưu / đọc tem GKE (trackingAutoService, tham số 'kl').
// Cùng thư mục đơn: "Xoá dữ liệu đơn" xoá luôn; routes/photos.js /file/* chặn tem-kl_*.

function muaTrackingKlChoDon(sttKey, user) {
  return tas().xepHangMuaTracking(sttKey, () => _muaTrackingKl(sttKey, user));
}

async function _muaTrackingKl(sttKey, user) {
  const t = tas();
  const nhatKy = [];
  const nhan = `[KL - ${user.ten}]`;
  try {
    const { rows } = await orderService.getAll({ docThat: true });
    const row = rows.find(r => r.STT_Key === sttKey);
    if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
    t.chanMuaDonDaHuy(row);
    if (row.TRACKING_ID) {
      t.ghiLogTrackingVaoDb({ sttKey, nguon: 'KL - Thủ công', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Bỏ qua', chiTiet: `Đơn đã có tracking ${row.TRACKING_ID} — không mua KL.` });
      return null;
    }
    if (row.TAM_THOI === gkeService.MA_DANG_CHO_TEM) {
      throw new Error('Đơn đã tạo vận đơn GKE (đang chờ tem GKE) — không mua KL. Lấy tem ở khối Vận chuyển (GKE).');
    }

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
    if (nhom) nhatKy.push(`[DonNhieuAo] Nhóm ${nhom.goc} (${dsDon.length} đơn) — 1 đơn KL cho cả nhóm, ${body.weight} g, ${body.items[0].quantity} áo.`);

    // Bước 1: tra KL theo mã đơn TRƯỚC khi tạo.
    let don = await klService.timDonTheoMa(sttKey, cauHinh, nhatKy);
    if (don && !klService.laDonThanhCong(don)) {
      throw new Error(`KL đã có đơn mã ${sttKey} (sid ${don.sid || '?'}) ở trạng thái "${[don.status, don.status_text].filter(v => v != null && v !== '').join(' – ') || '?'}"`
        + `${don.reason || don.Reason ? ` — ${don.reason || don.Reason}` : ''}${don.barcode ? ` (barcode ${don.barcode})` : ''}. `
        + 'App KHÔNG tự nhận đơn lỗi / cảnh báo và KL không cho tạo trùng mã đơn: kiểm tra / xoá đơn đó trên trang KL rồi bấm lại.');
    }
    if (don) {
      nhatKy.push(`KL đã có đơn thành công cho mã ${sttKey} (sid ${don.sid}) — dùng lại, KHÔNG tạo đơn mới.`);
    } else {
      // Bước 2: dấu "đang tạo" + tài khoản, rồi mới gửi lệnh tạo.
      await orderService.update(sttKey, { KL_DANG_TAO: thoiGianVNISOString(), TAI_KHOAN_KL: cauHinh.id, DON_VI_VAN_CHUYEN: DON_VI_KL }, user);
      try {
        don = await klService.taoDonKl(body, cauHinh, nhatKy);
      } catch (err) {
        if (err.khongRoKetQua) {
          throw new Error(`${err.message}. CHƯA BIẾT KL đã tạo đơn hay chưa — bấm lại: app tra KL theo mã đơn trước, KHÔNG tạo trùng.`);
        }
        await orderService.update(sttKey, { KL_DANG_TAO: '', DON_VI_VAN_CHUYEN: '' }, user); // KL từ chối rõ ràng -> bỏ dấu, sửa dữ liệu rồi mua lại
        throw err;
      }
    }

    const hang = klService.tenHangVanChuyen(don.shipping_partner);
    await orderService.update(sttKey, {
      TRACKING_ID: String(don.barcode), HANG_VAN_CHUYEN: hang, KL_DANG_TAO: '', DON_VI_VAN_CHUYEN: DON_VI_KL, TAI_KHOAN_KL: cauHinh.id,
      KL_ORDER_SID: String(don.sid), KL_PHI_USD: don.usd != null ? String(don.usd) : '', KL_PHI_VND: don.vnd != null ? String(don.vnd) : '',
    }, user);

    let loiSheetCon = [];
    if (nhom) {
      const { daSao, loiSheet } = await t.saoTrackingXuongNhom(nhom, { trackingId: String(don.barcode), hangVanChuyen: hang, donVi: DON_VI_KL, taiKhoanKl: cauHinh.id }, user);
      loiSheetCon = loiSheet;
      nhatKy.push(`[DonNhieuAo] Đã sao tracking xuống: ${daSao.join(', ') || '(không có đơn nào cần sao)'}.`);
    }
    const [kqDay] = await sheetSellerService.ghiHangLoat([{ sttKey, loai: 'TRACKING', giaTri: { TRACKING_ID2: String(don.barcode), HANG_VAN_CHUYEN2: hang } }], user);
    const dayCheKhachHang = kqDay.ok ? { ok: true } : { ok: false, lyDo: kqDay.lyDo };
    nhatKy.push(kqDay.ok ? `Đã ghi tracking vào Sheet Seller (tab "${kqDay.tab}", dòng ${kqDay.dong}).` : `LỖI ghi tracking vào Sheet Seller: ${kqDay.lyDo}`);
    t.baoLoiSheetSeller([kqDay], user, 'tracking KL');

    const phi = [don.usd != null ? `$${don.usd}` : '', don.vnd != null ? `${don.vnd}₫` : ''].filter(Boolean).join(' / ');
    t.ghiLogTracking(`${nhan} ${sttKey}: đã mua tracking KL ${don.barcode} (${hang})${phi ? ` · phí ${phi}` : ''}`, sttKey);
    ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'MUA_TRACKING_KL', sttKey, chiTiet: { trackingNum: String(don.barcode), hangVanChuyen: hang, klSid: String(don.sid), phiUsd: don.usd ?? null, phiVnd: don.vnd ?? null } })
      .catch(err => console.error('[TrackingKL] Lỗi ghi log nền:', err.message));
    t.ghiLogTrackingVaoDb({ sttKey, nguon: 'KL - Thủ công', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công', trackingId: String(don.barcode), hangVanChuyen: hang, chiTiet: nhatKy.join('\n') });
    return { tracking_num: String(don.barcode), delivery_carrier: hang, kl: { sid: String(don.sid), usd: don.usd ?? null, vnd: don.vnd ?? null }, dayCheKhachHang, loiSheetCon };
  } catch (err) {
    t.ghiLogTracking(`${nhan} ${sttKey}: LỖI — ${err.message}`, sttKey);
    t.ghiLogTrackingVaoDb({ sttKey, nguon: 'KL - Thủ công', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi', chiTiet: nhatKy.concat(`LỖI: ${err.message}`).join('\n') });
    throw err;
  }
}

// In label KL cho đơn ĐÃ mua tracking KL (cũng là đích của nút "IN LABEL" GKE / in hàng loạt khi đơn là đơn KL — trackingAutoService.inLabelChoDon).
async function inLabelKlChoDon(sttKey, user) {
  const t = tas();
  const nhatKy = [];
  const { rows, banDoTheoKey } = await orderService.getManyByKeys([sttKey], { fresh: true });
  const row = banDoTheoKey.get(sttKey);
  if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
  try {
    t.kiemTraDieuKienInLabel(row);
    const nhom = t.kiemTraNhomKhiInLabel(row, rows);
    const donLayTem = nhom ? nhom.donMua : row;
    if (!donLayTem.TRACKING_ID || !laDonKl(donLayTem)) throw new Error('Đơn chưa có tracking KL — dùng nút "Mua Tracking KL và In Label KL".');
    if (!donLayTem.KL_ORDER_SID) throw new Error(`Đơn ${donLayTem.STT_Key} thiếu mã đơn KL (sid) — không lấy được label.`);
    let base64 = await t.docTemDaLuu(donLayTem.STT_Key, donLayTem.TRACKING_ID, 'kl');
    if (base64) nhatKy.push(`Dùng tem KL đã lưu sẵn (tracking ${donLayTem.TRACKING_ID}) — không gọi KL.`);
    else {
      base64 = await klService.layLabelKl(donLayTem.KL_ORDER_SID, klService.layCauHinhKlChoDon(donLayTem), nhatKy);
      t.luuTemNen(donLayTem.STT_Key, donLayTem.TRACKING_ID, { label_base64: base64 }, 'kl');
    }
    const ketQuaTem = await t.ghiChuNhomLenTem({ label_base64: base64, tracking_num: donLayTem.TRACKING_ID, delivery_carrier: donLayTem.HANG_VAN_CHUYEN }, nhom);
    await t.ghiDaInLabel(sttKey, user);
    t.ghiLogTrackingVaoDb({ sttKey, nguon: 'KL - In label', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công', trackingId: donLayTem.TRACKING_ID, hangVanChuyen: donLayTem.HANG_VAN_CHUYEN, chiTiet: nhatKy.join('\n') });
    return ketQuaTem;
  } catch (err) {
    t.ghiLogTrackingVaoDb({ sttKey, nguon: 'KL - In label', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi', chiTiet: nhatKy.concat(`LỖI: ${err.message}`).join('\n') });
    throw err;
  }
}

// "Mua Tracking KL và In Label KL": cần "Đã sản xuất"/"ĐÃ DÁN TEM" (như nút GKE). Đã có tracking KL -> chỉ in; tracking hãng khác -> báo lỗi.
// Mua được mà lấy label lỗi -> báo rõ, tracking GIỮ NGUYÊN; bấm lại chỉ lấy label (đơn đã có tracking KL), không mua lần 2.
async function muaTrackingKlVaInLabelChoDon(sttKey, user) {
  const t = tas();
  const { rows, banDoTheoKey } = await orderService.getManyByKeys([sttKey], { fresh: true });
  const row = banDoTheoKey.get(sttKey);
  if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
  let nhom;
  try {
    t.chanMuaDonDaHuy(row);
    t.kiemTraDieuKienInLabel(row);
    nhom = t.kiemTraNhomKhiInLabel(row, rows);
  } catch (err) {
    t.ghiLogTrackingVaoDb({ sttKey, nguon: 'KL - Mua + In label', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi', chiTiet: `LỖI: ${err.message}` });
    throw err;
  }
  const donMua = nhom ? nhom.donMua : row;
  if (donMua.TRACKING_ID) {
    if (laDonKl(donMua)) return inLabelKlChoDon(sttKey, user);
    throw new Error(`Đơn đã có tracking ${donMua.TRACKING_ID} (không phải KL) — in label ở khối Vận chuyển (GKE).`);
  }
  const kq = await muaTrackingKlChoDon(sttKey, user);
  if (!kq) throw new Error('Đơn vừa được mua tracking bởi người khác — thử lại thao tác này.');
  try {
    const tem = await inLabelKlChoDon(sttKey, user);
    return { ...tem, dayCheKhachHang: kq.dayCheKhachHang, loiSheetCon: kq.loiSheetCon };
  } catch (err) {
    // daMua: giao diện tải lại đơn (hiện tracking vừa mua); loiDaySheetKh: lỗi ghi Sheet Seller của lượt mua này vẫn phải báo (hộp đỏ).
    const loiDaySheetKh = [...(kq.loiSheetCon || []), ...(kq.dayCheKhachHang && !kq.dayCheKhachHang.ok ? [{ sttKey, lyDo: kq.dayCheKhachHang.lyDo }] : [])];
    throw Object.assign(new Error(`Đã mua tracking KL ${kq.tracking_num} (${kq.delivery_carrier}) nhưng CHƯA lấy được label: ${err.message} — bấm lại nút để chỉ lấy label (không mua lại).`),
      { daMua: true, loiDaySheetKh });
  }
}

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

module.exports = { muaTrackingKlChoDon, inLabelKlChoDon, muaTrackingKlVaInLabelChoDon, traTrangThaiKl, laDonKl, daGiaoXongKl };
