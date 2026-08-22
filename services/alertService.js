// Tính số ngày đã trôi qua kể từ 1 ngày cho trước (so với hôm nay, bỏ qua giờ/phút/giây)
function soNgayTu(ngayStr) {
  if (!ngayStr) return null;
  const ngay = new Date(ngayStr);
  if (isNaN(ngay)) return null;
  const homNay = new Date();
  homNay.setHours(0, 0, 0, 0);
  ngay.setHours(0, 0, 0, 0);
  return Math.round((homNay - ngay) / 86400000);
}

// Mức cảnh báo hiện tại của 1 đơn — dùng chung cho badge trên web VÀ bot Telegram, đảm bảo nhất quán
// Quy tắc giữ nguyên như bản AppSheet cũ: Vàng (3 ngày, thiếu phôi/file) < Cam (5 ngày, chưa đóng gói) < Đỏ (7 ngày, chưa ship)
function tinhMucCanhBao(don) {
  if (['SHIPPED', 'DELIVERED', 'HUY'].includes(don.Trang_Thai)) return null;

  const soNgay = soNgayTu(don.Ngay_Dat);
  if (soNgay === null) return null;

  const coDuPhoiFile = String(don.Co_Phoi).toUpperCase() === 'TRUE' && String(don.Co_File_Ve).toUpperCase() === 'TRUE';

  if (soNgay >= 7) return 'DO';
  if (soNgay >= 5 && don.Trang_Thai !== 'DONG_GOI') return 'CAM';
  if (soNgay >= 3 && !coDuPhoiFile) return 'VANG';
  return null;
}

// Đơn sắp tới hạn giao (còn đúng 1 ngày) mà chưa ship — dùng để nhắc team đóng gói
function sapDenHanShip(don) {
  if (!don.Ngay_Giao_Du_Kien) return false;
  if (['SHIPPED', 'DELIVERED', 'HUY'].includes(don.Trang_Thai)) return false;

  const deadline = new Date(don.Ngay_Giao_Du_Kien);
  if (isNaN(deadline)) return false;
  const homNay = new Date();
  homNay.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);

  return Math.round((deadline - homNay) / 86400000) === 1;
}

module.exports = { soNgayTu, tinhMucCanhBao, sapDenHanShip };
