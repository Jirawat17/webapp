const { chuaXongGiaiDoan, TRANG_THAI_KET_THUC, TRANG_THAI_DA_SHIP } = require('../data/pipelineTinhTrang');
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

// Mức cảnh báo hiện tại của 1 đơn — dùng chung cho badge trên web VÀ bot Telegram.
// LƯU Ý: Sheet không có cột deadline (Ngay_Giao_Du_Kien) nên mốc thời gian tính theo NGAY_LEN_DON
// (ngày lên đơn) — càng lâu mà càng ít tiến triển trong pipeline thì mức cảnh báo càng cao.
// Mốc theo giai đoạn mới (thay B2/B4/SHIPPED tuyến tính cũ): GĐ2 (có phôi), GĐ4 (sản xuất xong), đã ship.
function tinhMucCanhBao(don) {
  if (TRANG_THAI_KET_THUC.includes(don.TINH_TRANG)) return null;

  const soNgay = soNgayTu(don.NGAY_LEN_DON);
  if (soNgay === null) return null;

  const chuaShip = !TRANG_THAI_DA_SHIP.includes(don.TINH_TRANG);

  // Mọi mốc đều phải cộng thêm điều kiện "chưa ship" — nếu không, chuaXongGiaiDoan() sẽ coi trạng
  // thái SHIPPED/IN TRAINSIT (không nằm trong 5 giai đoạn sản xuất) là "chưa xong" theo mặc định an
  // toàn của nó, khiến đơn đã ship vẫn bị tính nhầm cảnh báo Vàng/Cam (lỗi thật đã xảy ra, đã kiểm
  // tra lại bằng cách chạy thử với đơn SHIPPED 10 ngày).
  if (soNgay >= 7 && chuaShip) return 'DO';
  if (soNgay >= 5 && chuaShip && chuaXongGiaiDoan(don.TINH_TRANG, 4)) return 'CAM';
  if (soNgay >= 3 && chuaShip && chuaXongGiaiDoan(don.TINH_TRANG, 2)) return 'VANG';
  return null;
}

module.exports = { soNgayTu, tinhMucCanhBao };
