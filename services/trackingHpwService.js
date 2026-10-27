// Mua tracking HPW / in label HPW (22/10/2026, theo yêu cầu người dùng — khối "Vận chuyển (HPW)" ở Chi tiết đơn). Cùng khuôn KL
// (trackingKlService.js): hàng đợi theo đơn CHUNG với GKE / KL, chặn đơn huỷ, điều kiện in label, DonNhieuAo, Sheet Seller, log. Chỉ mua tay.
// Khác KL: HPW mua 2 bước và KHÔNG có API tìm lô theo mã đơn -> chống mua trùng bằng cách:
//   1. Ghi HPW_DANG_TAO TRƯỚC lệnh tạo lô; tạo xong lưu NGAY HPW_REFERENCE_ID (mã lô HPW) rồi mới mua label.
//   2. Đơn đã có HPW_REFERENCE_ID -> KHÔNG tạo lô mới; trước khi mua label XEM lô trên HPW: đã có tracking (lần trước mất phản hồi) -> nhận luôn.
//   3. Mất phản hồi lúc TẠO lô (chưa có mã lô): bấm lại -> gửi tạo lại với CÙNG mã đơn; HPW không cho trùng -> báo lỗi, KHÔNG tạo lô thứ 2.
//      Superadmin lấy mã lô trên trang HPW gắn vào đơn ("Gắn mã lô hàng HPW") hoặc "Bỏ dấu đang mua HPW".
//   4. Không bao giờ tự gửi lại lệnh tạo lô / mua label.
// Gợi ý sửa địa chỉ (address_suggestions) lúc tạo lô: DỪNG trước bước mua label (người dùng chốt). Bấm mua lại = mua label cho lô đã tạo
// (địa chỉ như lúc tạo); muốn đổi địa chỉ: superadmin "Huỷ lô hàng HPW" -> lần mua sau tạo lô MỚI với mã đơn có đuôi (-2, -3...).
const orderService = require('./orderService');
const gkeService = require('./gkeService');
const klService = require('./klService');
const hpwService = require('./hpwService');
const donNhieuAoService = require('./donNhieuAoService');
const sheetSellerService = require('./sheetSellerService');
const { ghiLog } = require('./logService');
const { thoiGianVNISOString } = require('./dateUtils');
const tas = () => require('./trackingAutoService')._dungChoHangKhac; // nạp khi dùng (trackingAutoService require ngược file này)
const hangChung = require('./hangVanChuyenKhacService');

const { DON_VI_HPW } = hpwService;
const laDonHpw = r => !!r && r.DON_VI_VAN_CHUYEN === DON_VI_HPW;
const BO_DAU_HPW = { HPW_DANG_TAO: '', HPW_REFERENCE_ID: '', HPW_GOI_Y_DIA_CHI: '', DON_VI_VAN_CHUYEN: '', TAI_KHOAN_HPW: '' };

function muaTrackingHpwChoDon(sttKey, user) {
  return tas().xepHangMuaTracking(sttKey, () => _muaHpw(sttKey, user));
}

async function _muaHpw(sttKey, user) {
  const t = tas();
  const nhatKy = [];
  const nhan = `[HPW - ${user.ten}]`;
  const log = (ketQua, chiTiet, them = {}) => t.ghiLogTrackingVaoDb({ sttKey, nguon: user === t.NGUOI_HE_THONG ? 'HPW - Tự động' : 'HPW - Thủ công', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua, chiTiet, ...them });
  try {
    if (!hangChung.duocMuaHangKhac(user.vaiTro)) throw new Error('Chỉ admin / vẽ file được mua tracking HPW — đơn đã có tracking HPW thì vẫn in label được.');
    const { rows } = await orderService.getAll({ docThat: true });
    const row = rows.find(r => r.STT_Key === sttKey);
    if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
    t.chanMuaDonDaHuy(row);
    if (row.TRACKING_ID) { log('Bỏ qua', `Đơn đã có tracking ${row.TRACKING_ID} — không mua HPW.`); return null; }
    if (row.TAM_THOI === gkeService.MA_DANG_CHO_TEM) throw new Error('Đơn đã tạo vận đơn GKE (đang chờ tem GKE) — không mua HPW.');
    if (klService.dangTaoDonKl(row)) throw new Error('Đơn đang mua tracking KL (chưa rõ kết quả) — không mua HPW. Xem khối Vận chuyển (KL).');

    const nhom = donNhieuAoService.layNhomCuaDon(sttKey, rows);
    if (nhom && nhom.loiChan.length) throw new Error(`[DonNhieuAo ${nhom.goc}] ${nhom.loiChan.join(' ')} Sửa dữ liệu rồi thử lại.`);
    if (nhom && nhom.donMua.STT_Key !== sttKey) {
      if (!nhom.donMua.TRACKING_ID) throw new Error(`Đơn thuộc nhóm DonNhieuAo ${nhom.goc} — chỉ mua tracking ở đơn ${nhom.donMua.STT_Key}, các đơn còn lại dùng chung.`);
      const { loiSheet } = await t.saoTrackingXuongNhom(nhom, t.trackingCuaDon(nhom.donMua), user);
      return { dungChung: true, donMua: nhom.donMua.STT_Key, tracking_num: nhom.donMua.TRACKING_ID, loiSheetCon: loiSheet };
    }

    let cauHinh = hpwService.layCauHinhHpwChoDon(row);
    let referenceId = row.HPW_REFERENCE_ID;
    let ketQua = null; // { tracking, carrier, labelPath, total }

    if (referenceId) {
      // Đã có lô (lần trước dừng vì gợi ý địa chỉ / mua label mất phản hồi): xem lô trước — đã có tracking thì nhận, KHÔNG mua lại.
      const lh = await hpwService.xemLoHang(referenceId, cauHinh, nhatKy);
      if (lh.tracking) {
        nhatKy.push(`Lô ${referenceId} ĐÃ có tracking ${lh.tracking} trên HPW (lần trước mất phản hồi) — nhận luôn, KHÔNG mua label lại.`);
        ketQua = { tracking: lh.tracking, carrier: lh.carrier, labelPath: lh.labelPath, total: lh.total };
      } else if (hpwService.laLoDaHuy(lh)) {
        // Lô đã bị huỷ (trên trang HPW, hoặc huỷ trong app mà chưa kịp ghi) -> bỏ mã lô, tạo lô MỚI với mã đơn có đuôi (HPW không cho trùng mã).
        const maGuiMoi = hpwService.maGuiKeTiep(sttKey, row.HPW_MA_GUI || sttKey);
        nhatKy.push(`Lô ${referenceId} đã bị huỷ trên HPW (${lh.trangThai}) — tạo lô mới với mã đơn ${maGuiMoi}.`);
        await orderService.update(sttKey, { ...BO_DAU_HPW, HPW_MA_GUI: maGuiMoi, HPW_PHI_USD: '' }, user);
        Object.assign(row, BO_DAU_HPW, { HPW_MA_GUI: maGuiMoi });
        referenceId = '';
        cauHinh = hpwService.layCauHinhHpwChoDon(row); // lô MỚI dùng tài khoản ĐANG gán cho Xưởng (không phải tài khoản của lô đã huỷ)
      } else {
        nhatKy.push(`Dùng lại lô ${referenceId} đã tạo (chưa có label) — không tạo lô mới.`);
      }
    }
    if (!referenceId && !ketQua) {
      const maGui = row.HPW_MA_GUI || sttKey;
      const dsDon = nhom ? nhom.thanhVien.filter(r => r.TRANG_THAI_XUONG !== donNhieuAoService.TRANG_THAI_HUY) : [row];
      const body = hpwService.taoBodyHpw(row, dsDon, cauHinh, maGui, { maQuocGia: gkeService.maQuocGia, maBangMy: klService.maBangMy });
      if (nhom) nhatKy.push(`[DonNhieuAo] Nhóm ${nhom.goc} (${dsDon.length} đơn) — 1 lô HPW cho cả nhóm, ${body.DimensionWeight} g, ${body.ShipmentItems[0].Quantity} áo.`);
      const lanTruocMatPhanHoi = !!row.HPW_DANG_TAO;
      await orderService.update(sttKey, { HPW_DANG_TAO: thoiGianVNISOString(), TAI_KHOAN_HPW: cauHinh.id, DON_VI_VAN_CHUYEN: DON_VI_HPW, HPW_MA_GUI: maGui }, user);
      let lo;
      try {
        lo = await hpwService.taoLoHang(body, cauHinh, nhatKy);
      } catch (err) {
        if (err.khongRoKetQua) throw new Error(`${err.message}. CHƯA BIẾT HPW đã tạo lô hàng hay chưa — bấm lại: HPW không cho trùng mã đơn nên KHÔNG tạo được lô thứ 2.`);
        if (lanTruocMatPhanHoi && hpwService.laLoiTrungMa(err.message)) {
          // HPW báo TRÙNG mã sau lần mất phản hồi -> lô ĐÃ được tạo lần trước: GIỮ dấu, superadmin gắn mã lô / bỏ dấu.
          throw new Error(`${err.message}. Lần trước đã gửi tạo lô với mã "${maGui}" nhưng mất phản hồi và HPW báo trùng mã — lô đã có trên HPW. `
            + 'Superadmin tìm mã lô (HPW...) trên trang HPW rồi bấm "Gắn mã lô hàng HPW".');
        }
        // Lỗi khác (dữ liệu...) -> HPW chưa có lô với mã này: bỏ dấu như từ chối bình thường, sửa dữ liệu rồi mua lại.
        await orderService.update(sttKey, { ...BO_DAU_HPW, HPW_MA_GUI: row.HPW_MA_GUI || '' }, user); // từ chối rõ ràng -> sửa dữ liệu rồi mua lại
        throw err;
      }
      referenceId = lo.referenceId;
      await orderService.update(sttKey, { HPW_REFERENCE_ID: referenceId, HPW_PHI_USD: lo.total != null ? String(lo.total) : '', HPW_GOI_Y_DIA_CHI: lo.goiY.length ? JSON.stringify(lo.goiY) : '' }, user);
      nhatKy.push(`Đã tạo lô ${referenceId} (mã đơn gửi ${maGui}, dự tính $${lo.total ?? '?'}).`);
      if (lo.goiY.length) {
        await orderService.update(sttKey, { HPW_DANG_TAO: '' }, user); // lô đã có mã (dangMuaHpw vẫn đúng vì chưa có tracking)
        throw Object.assign(new Error(`HPW gợi ý sửa địa chỉ: ${lo.goiY.join(' | ')}. Lô ${referenceId} đã tạo nhưng CHƯA mua label. `
          + 'Bấm mua lại = mua label với địa chỉ hiện tại của lô; muốn đổi địa chỉ: superadmin "Huỷ lô hàng HPW", sửa dữ liệu đơn rồi mua lại.'), { goiYDiaChi: lo.goiY });
      }
    }

    if (!ketQua) {
      await orderService.update(sttKey, { HPW_DANG_TAO: thoiGianVNISOString() }, user);
      try {
        ketQua = await hpwService.muaLabel(referenceId, cauHinh, nhatKy);
      } catch (err) {
        if (err.khongRoKetQua) throw new Error(`${err.message}. CHƯA BIẾT đã mua label chưa — bấm lại: app xem lô ${referenceId} trên HPW trước, KHÔNG mua 2 lần.`);
        await orderService.update(sttKey, { HPW_DANG_TAO: '' }, user); // HPW từ chối mua label: lô vẫn còn (mã đã lưu), bấm lại sẽ mua tiếp lô đó
        throw err;
      }
    }

    const hang = ketQua.carrier || '';
    await orderService.update(sttKey, {
      TRACKING_ID: ketQua.tracking, HANG_VAN_CHUYEN: hang, DON_VI_VAN_CHUYEN: DON_VI_HPW, TAI_KHOAN_HPW: cauHinh.id, HPW_REFERENCE_ID: referenceId,
      HPW_DANG_TAO: '', HPW_GOI_Y_DIA_CHI: '', HPW_LABEL_PATH: ketQua.labelPath || '', ...(ketQua.total != null ? { HPW_PHI_USD: String(ketQua.total) } : {}),
    }, user);
    if (!hang) nhatKy.push('CẢNH BÁO: HPW không cho biết hãng giao (carrier) — cột hãng vận chuyển để trống.');

    let loiSheetCon = [];
    if (nhom) {
      const { daSao, loiSheet } = await t.saoTrackingXuongNhom(nhom, { trackingId: ketQua.tracking, hangVanChuyen: hang, donVi: DON_VI_HPW, taiKhoanHpw: cauHinh.id }, user);
      loiSheetCon = loiSheet;
      nhatKy.push(`[DonNhieuAo] Đã sao tracking xuống: ${daSao.join(', ') || '(không có đơn nào cần sao)'}.`);
    }
    const [kqDay] = await sheetSellerService.ghiHangLoat([{ sttKey, loai: 'TRACKING', giaTri: { TRACKING_ID2: ketQua.tracking, HANG_VAN_CHUYEN2: hang } }], user);
    const dayCheKhachHang = kqDay.ok ? { ok: true } : { ok: false, lyDo: kqDay.lyDo };
    nhatKy.push(kqDay.ok ? `Đã ghi tracking vào Sheet Seller (tab "${kqDay.tab}", dòng ${kqDay.dong}).` : `LỖI ghi tracking vào Sheet Seller: ${kqDay.lyDo}`);
    t.baoLoiSheetSeller([kqDay], user, 'tracking HPW');

    t.ghiLogTracking(`${nhan} ${sttKey}: đã mua tracking HPW ${ketQua.tracking} (${hang || '?'})${ketQua.total != null ? ` · phí $${ketQua.total}` : ''}`, sttKey);
    ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'MUA_TRACKING_HPW', sttKey, chiTiet: { trackingNum: ketQua.tracking, hangVanChuyen: hang, hpwRef: referenceId, phiUsd: ketQua.total ?? null } })
      .catch(err => console.error('[TrackingHPW] Lỗi ghi log nền:', err.message));
    log('Thành công', nhatKy.join('\n'), { trackingId: ketQua.tracking, hangVanChuyen: hang });
    return { tracking_num: ketQua.tracking, delivery_carrier: hang, hpw: { referenceId, usd: ketQua.total ?? null }, dayCheKhachHang, loiSheetCon };
  } catch (err) {
    t.ghiLogTracking(`${nhan} ${sttKey}: LỖI — ${err.message}`, sttKey);
    log('Lỗi', nhatKy.concat(`LỖI: ${err.message}`).join('\n'));
    throw err;
  }
}

// ---- Thao tác superadmin (routes/tracking.js) ----
// Huỷ lô hàng HPW CHƯA mua label (để đổi địa chỉ): xem lô trước — đã có tracking thì không huỷ. Huỷ xong lần mua sau dùng mã đơn có đuôi.
function huyLoHangHpw(sttKey, user) {
  return tas().xepHangMuaTracking(sttKey, async () => {
    const nhatKy = [];
    const { row } = await orderService.getByKey(sttKey, { fresh: true });
    if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
    if (row.TRACKING_ID) throw new Error('Đơn đã có tracking — không huỷ lô hàng ở đây.');
    if (!row.HPW_REFERENCE_ID) throw new Error('Đơn chưa có lô hàng HPW.');
    const ch = hpwService.layCauHinhHpwChoDon(row);
    const lh = await hpwService.xemLoHang(row.HPW_REFERENCE_ID, ch, nhatKy);
    if (lh.tracking) throw new Error(`Lô ${row.HPW_REFERENCE_ID} ĐÃ mua label (tracking ${lh.tracking}) — không huỷ; bấm mua để nhận tracking này.`);
    if (hpwService.laLoDaHuy(lh)) nhatKy.push(`Lô ${row.HPW_REFERENCE_ID} đã bị huỷ trên HPW từ trước — chỉ dọn trong app.`);
    else await hpwService.huyLoHang(row.HPW_REFERENCE_ID, ch, nhatKy);
    const maGuiMoi = hpwService.maGuiKeTiep(sttKey, row.HPW_MA_GUI || sttKey);
    await orderService.update(sttKey, { ...BO_DAU_HPW, HPW_MA_GUI: maGuiMoi, HPW_PHI_USD: '' }, user);
    ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'HUY_LO_HANG_HPW', sttKey, chiTiet: { hpwRef: row.HPW_REFERENCE_ID, maGuiMoi } }).catch(() => {});
    tas().ghiLogTrackingVaoDb({ sttKey, nguon: 'HPW - Huỷ lô', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công', chiTiet: nhatKy.concat(`Đã huỷ lô ${row.HPW_REFERENCE_ID}; lần mua sau dùng mã đơn ${maGuiMoi}.`).join('\n') });
    return { ok: true, maGuiMoi };
  });
}
// Gắn mã lô tay (lần tạo lô mất phản hồi, HPW báo trùng mã): kiểm tra mã lô có trên HPW (tài khoản của đơn) rồi lưu; lần mua sau xem lô đó.
function ganMaLoHangHpw(sttKey, referenceId, user) {
  return tas().xepHangMuaTracking(sttKey, async () => {
    const ma = String(referenceId || '').trim();
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(ma)) throw new Error('Mã lô hàng HPW không hợp lệ');
    const { row } = await orderService.getByKey(sttKey, { fresh: true });
    if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
    if (row.TRACKING_ID) throw new Error('Đơn đã có tracking.');
    const { rows } = await orderService.getAll();
    const donKhac = rows.find(r => r.STT_Key !== sttKey && String(r.HPW_REFERENCE_ID || '') === ma);
    if (donKhac) throw new Error(`Lô ${ma} đang thuộc đơn ${donKhac.STT_Key} — không gắn cho đơn ${sttKey}.`);
    const ch = hpwService.layCauHinhHpwChoDon(row);
    const lh = await hpwService.xemLoHang(ma, ch, []);
    if (!lh.tonTai) throw new Error(`Không thấy lô ${ma} trên HPW (tài khoản "${ch.ten}").`);
    if (hpwService.laLoDaHuy(lh)) throw new Error(`Lô ${ma} đã bị huỷ trên HPW — không gắn.`);
    // Mã đơn của lô (nếu HPW trả về) phải là mã đơn này (STT_Key hoặc STT_Key-2, -3... sau khi huỷ lô).
    const laMaCuaDon = m => m === sttKey || new RegExp(`^${sttKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(m);
    if (lh.maGui && !laMaCuaDon(lh.maGui)) throw new Error(`Lô ${ma} là của mã đơn "${lh.maGui}", không phải đơn ${sttKey} — không gắn.`);
    await orderService.update(sttKey, { HPW_REFERENCE_ID: ma, HPW_DANG_TAO: '', DON_VI_VAN_CHUYEN: DON_VI_HPW, TAI_KHOAN_HPW: ch.id }, user);
    ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'GAN_MA_LO_HPW', sttKey, chiTiet: { hpwRef: ma } }).catch(() => {});
    tas().ghiLogTrackingVaoDb({ sttKey, nguon: 'HPW - Gắn mã lô', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công',
      chiTiet: `Gắn lô ${ma}${lh.tracking ? ` (đã có tracking ${lh.tracking})` : ''}${lh.maGui ? ` — mã đơn trên lô: ${lh.maGui}` : ' — HPW không trả mã đơn của lô, chưa đối chiếu được'}.` });
    return { ok: true, daCoTracking: !!lh.tracking, daDoiChieuMaDon: !!lh.maGui };
  });
}
// Bỏ dấu "đang mua HPW" khi CHƯA có mã lô (lần tạo lô mất phản hồi) — HPW không có API tìm theo mã đơn nên không tra được; superadmin xác
// nhận đã tự kiểm tra. Có mã lô rồi thì dùng "Huỷ lô hàng HPW" (bỏ dấu không huỷ lô sẽ để lại lô treo trên HPW).
function boDauDangMuaHpw(sttKey, user) {
  return tas().xepHangMuaTracking(sttKey, async () => {
    const { row } = await orderService.getByKey(sttKey, { fresh: true });
    if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
    if (row.HPW_REFERENCE_ID) throw new Error(`Đơn đã có lô HPW ${row.HPW_REFERENCE_ID} — dùng "Huỷ lô hàng HPW" thay vì bỏ dấu.`);
    if (!row.HPW_DANG_TAO) throw new Error('Đơn không ở trạng thái "đang mua HPW".');
    await orderService.update(sttKey, { ...BO_DAU_HPW, HPW_MA_GUI: row.HPW_MA_GUI || '' }, user);
    ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'BO_DAU_DANG_MUA_HPW', sttKey, chiTiet: {} }).catch(() => {});
    tas().ghiLogTrackingVaoDb({ sttKey, nguon: 'HPW - Bỏ dấu', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công', chiTiet: 'Bỏ dấu đang mua HPW (superadmin xác nhận đã kiểm tra trên trang HPW).' });
    return { ok: true };
  });
}

// ---- In label / mua + in — dùng chung với KL (hangVanChuyenKhacService.js) ----
const HANG_HPW = {
  ten: 'HPW', maTem: 'hpw', laDon: r => laDonHpw(r),
  thieuDuLieu: don => (don.HPW_REFERENCE_ID ? null : `Đơn ${don.STT_Key} thiếu mã lô hàng HPW — không lấy được label.`),
  layLabel: (don, nhatKy) => hpwService.layLabelHpw(don.HPW_REFERENCE_ID, don.HPW_LABEL_PATH, hpwService.layCauHinhHpwChoDon(don), nhatKy),
  mua: (sttKey, user) => muaTrackingHpwChoDon(sttKey, user),
  inLabel: (sttKey, user) => inLabelHpwChoDon(sttKey, user),
};
const inLabelHpwChoDon = (sttKey, user) => hangChung.inLabelHangKhac(HANG_HPW, sttKey, user);
const muaTrackingHpwVaInLabelChoDon = (sttKey, user) => hangChung.muaVaInLabelHangKhac(HANG_HPW, sttKey, user);

// Trạng thái vận chuyển đơn HPW — gọi từ trackingAutoService.capNhatTrangThaiTrackingChoDon. Đã giao -> MA_TRANG_THAI_NODE_TRACKING 'DONE'.
async function traTrangThaiHpw(donTra) {
  if (!donTra.HPW_REFERENCE_ID) return { lyDo: `Đơn ${donTra.STT_Key} thiếu mã lô hàng HPW — không tra được trạng thái.` };
  const ds = await hpwService.layTrackingHpw(donTra.HPW_REFERENCE_ID, hpwService.layCauHinhHpwChoDon(donTra), []);
  const moi = hpwService.suKienMoiNhat(ds);
  if (!moi) return { lyDo: 'HPW chưa có sự kiện tracking nào cho đơn này (có thể vừa mua label, chưa được quét nhận).' };
  return {
    suKien: moi,
    capNhat: { TRANG_THAI_TRACKING: String(moi.description || ''), MA_NODE_TRACKING: 'HPW', MA_TRANG_THAI_NODE_TRACKING: hpwService.laDaGiao(moi.description) ? 'DONE' : '' },
  };
}
const daGiaoXongHpw = r => laDonHpw(r) && r.MA_TRANG_THAI_NODE_TRACKING === 'DONE';

module.exports = {
  muaTrackingHpwChoDon, inLabelHpwChoDon, muaTrackingHpwVaInLabelChoDon, huyLoHangHpw, ganMaLoHangHpw, boDauDangMuaHpw,
  traTrangThaiHpw, laDonHpw, daGiaoXongHpw,
};
