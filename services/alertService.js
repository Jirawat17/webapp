const { chiSoGiaiDoan, TRANG_THAI_KET_THUC } = require('../data/pipelineTinhTrang');

// Số ngày đã trôi qua kể từ 1 ngày cho trước (so với hôm nay, bỏ qua giờ/phút/giây)
function soNgayTu(ngayStr) {
  if (!ngayStr) return null;
  const ngay = new Date(ngayStr);
  if (isNaN(ngay)) return null;
  const homNay = new Date();
  homNay.setHours(0, 0, 0, 0);
  ngay.setHours(0, 0, 0, 0);
  return Math.round((homNay - ngay) / 86400000);
}

// Mức cảnh báo hiện tại của 1 đơn — dùng chung cho badge trên web VÀ bot Telegram.
// LƯU Ý: Sheet không có cột deadline (Ngay_Giao_Du_Kien) nên mốc thời gian tính theo NGAY_LEN_DON
// (ngày lên đơn) — càng lâu mà càng ít tiến triển trong pipeline thì mức cảnh báo càng cao.
function tinhMucCanhBao(don) {
  if (TRANG_THAI_KET_THUC.includes(don.TINH_TRANG)) return null;

  const soNgay = soNgayTu(don.NGAY_LEN_DON);
  if (soNgay === null) return null;

  const idxHienTai = chiSoGiaiDoan(don.TINH_TRANG);
  const idxB2 = chiSoGiaiDoan('B2_Đã lấy phôi');
  const idxB4 = chiSoGiaiDoan('B4_Đang sản xuất');
  const idxShipped = chiSoGiaiDoan('SHIPPED_Đã gửi vận chuyển');

  const conNam = (idx) => idxHienTai === null || idx === null || idxHienTai < idx;

  if (soNgay >= 7 && conNam(idxShipped)) return 'DO';
  if (soNgay >= 5 && conNam(idxB4)) return 'CAM';
  if (soNgay >= 3 && conNam(idxB2)) return 'VANG';
  return null;
}

module.exports = { soNgayTu, tinhMucCanhBao };
