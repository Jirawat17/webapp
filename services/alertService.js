const { chiSoTinhTrang, TRANG_THAI_KET_THUC } = require('../data/pipelineTinhTrang');
const { parseNgay } = require('./dateUtils');
const { layCaiDatCanhBao } = require('./caiDatDbService');

// Số ngày đã trôi qua kể từ 1 ngày cho trước (so với hôm nay, bỏ qua giờ/phút/giây)
function soNgayTu(ngayStr) {
  const ngay = parseNgay(ngayStr);
  if (!ngay) return null;
  const homNay = new Date();
  homNay.setHours(0, 0, 0, 0);
  ngay.setHours(0, 0, 0, 0);
  return Math.round((homNay - ngay) / 86400000);
}

// Mức cảnh báo hiện tại của 1 đơn — dùng chung cho badge trên web VÀ bot Telegram.
// LƯU Ý: Sheet không có cột deadline (Ngay_Giao_Du_Kien) nên mốc thời gian tính theo NGAY_LEN_DON
// (ngày lên đơn) — càng lâu mà càng ít tiến triển trong pipeline thì mức cảnh báo càng cao.
// Cập nhật 24/08/2026 (hệ trạng thái 3 cột mới, xem data/pipelineTinhTrang.js): mốc Vàng = chưa đạt
// "ĐÃ SẴN SÀNG CHẠY MÁY" (thay cho "chưa có phôi" cũ — giờ phôi là 1 cột riêng, không dùng để tính
// mốc cảnh báo trực tiếp nữa); mốc Cam = chưa đạt "Đã sản xuất". Trạng thái không nằm trong
// THU_TU_TINH_TRANG (vd LỖI SẢN XUẤT CẦN LÀM LẠI) coi như "chưa đạt mốc nào" — an toàn, không bỏ sót
// cảnh báo cho đơn đang bị lỗi.
// Ngưỡng mặc định 3/5/7 ngày — GIỮ NGUYÊN như hard-code cũ, dùng khi superadmin chưa cấu hình gì ở
// settings.html (xem services/caiDatDbService.js#layCaiDatCanhBao — cột rỗng '' nghĩa là chưa cấu hình).
//
// Cập nhật 07/10/2026 (theo yêu cầu người dùng, Settings > Thời gian cảnh báo tự động): mỗi mức có trạng thái ĐẦU VÀO (đồng hồ tính
// từ lúc đơn vào trạng thái này; '' = từ ngày lên đơn như cũ), trạng thái ĐẦU RA (đạt hoặc vượt = hết cảnh báo), số ngày, bật/tắt.
// Đơn trúng nhiều mức -> mức cao nhất (Đỏ > Cam > Vàng). Mặc định = đúng hành vi cũ (3/5/7 ngày từ ngày lên đơn, đầu ra Sẵn sàng
// chạy máy / Đã sản xuất / Đã giao — "chưa ship" cũ chỉ gồm DELIVERED, cùng điều kiện).
const CAC_MUC = ['VANG', 'CAM', 'DO'];
const CAU_HINH_MAC_DINH = {
  VANG: { soNgay: 3, vao: '', ra: 'ĐÃ SẴN SÀNG CHẠY MÁY', bat: true },
  CAM: { soNgay: 5, vao: '', ra: 'Đã sản xuất', bat: true },
  DO: { soNgay: 7, vao: '', ra: 'DELIVERED_Đã giao đến khách', bat: true },
};

function layCauHinhCanhBao() {
  const luu = layCaiDatCanhBao();
  return Object.fromEntries(CAC_MUC.map(m => [m, {
    soNgay: Number(luu[`NGUONG_${m}`]) || CAU_HINH_MAC_DINH[m].soNgay,
    vao: luu[`VAO_${m}`] || CAU_HINH_MAC_DINH[m].vao,
    ra: luu[`RA_${m}`] || CAU_HINH_MAC_DINH[m].ra,
    bat: luu[`BAT_${m}`] !== '0',
  }]));
}

// Lúc bắt đầu tính giờ cho trạng thái đầu vào `vao`; undefined = đơn CHƯA tới đầu vào. Đơn ở trạng thái ngoài pipeline (LỖI SẢN XUẤT
// CẦN LÀM LẠI) coi như đã qua mọi đầu vào — không mất cảnh báo của đơn đang lỗi. Mốc = lúc vào trạng thái SỚM nhất trong khoảng
// [đầu vào .. trạng thái hiện tại] (MOC_VAO_TRANG_THAI — ghi khi đổi + dựng lại từ nhật ký đổi trạng thái). Tính từ NGÀY LÊN ĐƠN khi:
// đầu vào trống/"Chưa in mã" (mọi đơn vào "Chưa in mã" lúc lên đơn), hoặc đơn đã ở trong khoảng từ trước khi có nhật ký (mốc '' /
// không có mốc) — người dùng chốt 07/10/2026; KHÔNG dùng THOI_GIAN_DOI_TRANG_THAI (đổi cả khi chỉ phôi/vẽ file đổi).
function mocBatDau(don, vao, idx) {
  const idxVao = vao ? chiSoTinhTrang(vao) : 0;
  if (idxVao === null || (idx !== null && idx < idxVao)) return undefined;
  if (idxVao === 0) return don.NGAY_LEN_DON;
  let moc = {};
  try { moc = JSON.parse(don.MOC_VAO_TRANG_THAI || '{}') || {}; } catch (e) { /* hỏng -> ngày lên đơn */ }
  const cacMoc = Object.entries(moc)
    .filter(([tt]) => { const i = chiSoTinhTrang(tt); return i !== null && i >= idxVao && (idx === null || i <= idx); })
    .map(([, luc]) => luc);
  if (!cacMoc.length || cacMoc.includes('')) return don.NGAY_LEN_DON;
  return cacMoc.sort()[0];
}

function tinhMucCanhBao(don, cauHinh = layCauHinhCanhBao()) {
  if (TRANG_THAI_KET_THUC.includes(don.TRANG_THAI_XUONG)) return null;
  const idx = chiSoTinhTrang(don.TRANG_THAI_XUONG || 'Chưa in mã');
  for (const muc of ['DO', 'CAM', 'VANG']) {
    const ch = cauHinh[muc];
    if (!ch.bat) continue;
    if (idx !== null && idx >= chiSoTinhTrang(ch.ra)) continue; // đã tới đầu ra
    const moc = mocBatDau(don, ch.vao, idx);
    if (moc === undefined) continue;
    const soNgay = soNgayTu(moc);
    if (soNgay !== null && soNgay >= ch.soNgay) return muc;
  }
  return null;
}

module.exports = { soNgayTu, tinhMucCanhBao, layCauHinhCanhBao, CAU_HINH_MAC_DINH };
