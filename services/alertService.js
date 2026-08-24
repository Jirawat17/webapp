const { chiSoTinhTrang, TRANG_THAI_KET_THUC, TRANG_THAI_DA_SHIP } = require('../data/pipelineTinhTrang');
const { parseNgay } = require('./dateUtils');

// Số ngày đã trôi qua kể từ 1 ngày cho trước (so với hôm nay, bỏ qua giờ/phút/giây)
function soNgayTu(ngayStr) {
  const ngay = parseNgay(ngayStr);
  if (!ngay) return null;
  const homNay = new Date();
  homNay.setHours(0, 0, 0, 0);
  ngay.setHours(0, 0, 0, 0);
  return Math.round((homNay - ngay) / 86400000);
}

const idxSanSang = chiSoTinhTrang('ĐÃ SẴN SÀNG CHẠY MÁY');
const idxSanXuat = chiSoTinhTrang('Đã sản xuất');

// Mức cảnh báo hiện tại của 1 đơn — dùng chung cho badge trên web VÀ bot Telegram.
// LƯU Ý: Sheet không có cột deadline (Ngay_Giao_Du_Kien) nên mốc thời gian tính theo NGAY_LEN_DON
// (ngày lên đơn) — càng lâu mà càng ít tiến triển trong pipeline thì mức cảnh báo càng cao.
// Cập nhật 24/08/2026 (hệ trạng thái 3 cột mới, xem data/pipelineTinhTrang.js): mốc Vàng = chưa đạt
// "ĐÃ SẴN SÀNG CHẠY MÁY" (thay cho "chưa có phôi" cũ — giờ phôi là 1 cột riêng, không dùng để tính
// mốc cảnh báo trực tiếp nữa); mốc Cam = chưa đạt "Đã sản xuất". Trạng thái không nằm trong
// THU_TU_TINH_TRANG (vd LỖI SẢN XUẤT CẦN LÀM LẠI) coi như "chưa đạt mốc nào" — an toàn, không bỏ sót
// cảnh báo cho đơn đang bị lỗi.
function tinhMucCanhBao(don) {
  if (TRANG_THAI_KET_THUC.includes(don.TINH_TRANG)) return null;

  const soNgay = soNgayTu(don.NGAY_LEN_DON);
  if (soNgay === null) return null;

  const chuaShip = !TRANG_THAI_DA_SHIP.includes(don.TINH_TRANG);
  const idx = chiSoTinhTrang(don.TINH_TRANG);
  const chuaToiSanSang = idx === null || idx < idxSanSang;
  const chuaToiSanXuat = idx === null || idx < idxSanXuat;

  if (soNgay >= 7 && chuaShip) return 'DO';
  if (soNgay >= 5 && chuaShip && chuaToiSanXuat) return 'CAM';
  if (soNgay >= 3 && chuaShip && chuaToiSanSang) return 'VANG';
  return null;
}

module.exports = { soNgayTu, tinhMucCanhBao };
