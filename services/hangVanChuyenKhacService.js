// Phần DÙNG CHUNG của các hãng mua tracking ngoài GKE (KL — trackingKlService.js, HPW — trackingHpwService.js; tách 22/10/2026): in label
// (tem lưu sẵn trên MinIO trước, không có mới gọi hãng) và "Mua Tracking <hãng> và In Label <hãng>". Phần MUA của từng hãng khác nhau
// (KL 1 bước, HPW 2 bước) nên vẫn nằm ở file của hãng đó.
const orderService = require('./orderService');
// trackingAutoService require ngược các file hãng -> nạp khi dùng.
const tas = () => require('./trackingAutoService')._dungChoHangKhac;

// Vai trò được MUA tracking hãng ngoài GKE (KL, HPW — 27/10/2026, người dùng chốt, giống GKE "MUA TRACKING và IN LABEL"): admin, superadmin,
// vẽ file. Hàm mua của từng hãng tự chặn (mọi lối gọi đều qua đó). "Mua … ngay" vẫn chỉ admin (routes/tracking.js).
const duocMuaHangKhac = vaiTro => require('../middleware/auth').laAdmin(vaiTro) || vaiTro === 've_file';

// hang = { ten: 'KL', maTem: 'kl', laDon(row), thieuDuLieu(don) -> lý do | null, layLabel(don, nhatKy) -> base64 PDF }
async function inLabelHangKhac(hang, sttKey, user) {
  const t = tas();
  const nhatKy = [];
  const nguon = `${hang.ten} - In label`;
  const { rows, banDoTheoKey } = await orderService.getManyByKeys([sttKey], { fresh: true });
  const row = banDoTheoKey.get(sttKey);
  if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
  try {
    t.kiemTraDieuKienInLabel(row);
    const nhom = t.kiemTraNhomKhiInLabel(row, rows);
    const donLayTem = nhom ? nhom.donMua : row;
    if (!donLayTem.TRACKING_ID || !hang.laDon(donLayTem)) throw new Error(`Đơn chưa có tracking ${hang.ten} — dùng nút "Mua Tracking ${hang.ten} và In Label ${hang.ten}".`);
    const thieu = hang.thieuDuLieu(donLayTem);
    if (thieu) throw new Error(thieu);
    let base64 = await t.docTemDaLuu(donLayTem.STT_Key, donLayTem.TRACKING_ID, hang.maTem);
    if (base64) nhatKy.push(`Dùng tem ${hang.ten} đã lưu sẵn (tracking ${donLayTem.TRACKING_ID}) — không gọi ${hang.ten}.`);
    else {
      base64 = await hang.layLabel(donLayTem, nhatKy);
      t.luuTemNen(donLayTem.STT_Key, donLayTem.TRACKING_ID, { label_base64: base64 }, hang.maTem);
    }
    const ketQuaTem = await t.ghiChuNhomLenTem({ label_base64: base64, tracking_num: donLayTem.TRACKING_ID, delivery_carrier: donLayTem.HANG_VAN_CHUYEN }, nhom);
    await t.ghiDaInLabel(sttKey, user);
    t.ghiLogTrackingVaoDb({ sttKey, nguon, nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công', trackingId: donLayTem.TRACKING_ID, hangVanChuyen: donLayTem.HANG_VAN_CHUYEN, chiTiet: nhatKy.join('\n') });
    return ketQuaTem;
  } catch (err) {
    t.ghiLogTrackingVaoDb({ sttKey, nguon, nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi', chiTiet: nhatKy.concat(`LỖI: ${err.message}`).join('\n') });
    throw err;
  }
}

// "Mua Tracking <hãng> và In Label <hãng>": cần "Đã sản xuất"/"ĐÃ DÁN TEM". Đã có tracking hãng này -> chỉ in; hãng khác -> lỗi. Mua được mà
// lấy label lỗi -> lỗi daMua (giao diện tải lại đơn) + lỗi ghi Sheet Seller của lượt mua vẫn báo; bấm lại chỉ lấy label, không mua lần 2.
// hang thêm: mua(sttKey, user) -> kết quả mua (null = đã có tracking), inLabel(sttKey, user).
async function muaVaInLabelHangKhac(hang, sttKey, user) {
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
    t.ghiLogTrackingVaoDb({ sttKey, nguon: `${hang.ten} - Mua + In label`, nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi', chiTiet: `LỖI: ${err.message}` });
    throw err;
  }
  const donMua = nhom ? nhom.donMua : row;
  if (donMua.TRACKING_ID) {
    if (hang.laDon(donMua)) return hang.inLabel(sttKey, user);
    throw new Error(`Đơn đã có tracking ${donMua.TRACKING_ID} (không phải ${hang.ten}) — in label ở khối của hãng đã mua.`);
  }
  const kq = await hang.mua(sttKey, user);
  if (!kq) throw new Error('Đơn vừa được mua tracking bởi người khác — thử lại thao tác này.');
  try {
    const tem = await hang.inLabel(sttKey, user);
    return { ...tem, dayCheKhachHang: kq.dayCheKhachHang, loiSheetCon: kq.loiSheetCon };
  } catch (err) {
    const loiDaySheetKh = [...(kq.loiSheetCon || []), ...(kq.dayCheKhachHang && !kq.dayCheKhachHang.ok ? [{ sttKey, lyDo: kq.dayCheKhachHang.lyDo }] : [])];
    throw Object.assign(new Error(`Đã mua tracking ${hang.ten} ${kq.tracking_num} (${kq.delivery_carrier || '?'}) nhưng CHƯA lấy được label: ${err.message} — bấm lại nút để chỉ lấy label (không mua lại).`),
      { daMua: true, loiDaySheetKh });
  }
}

module.exports = { inLabelHangKhac, muaVaInLabelHangKhac, duocMuaHangKhac };
