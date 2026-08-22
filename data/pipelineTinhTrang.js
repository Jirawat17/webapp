// Thứ tự thật của các giai đoạn TINH_TRANG trong Don_Hang_ALL — tổng hợp từ:
//   (1) các giá trị TINH_TRANG thực tế đang có trong dữ liệu, và
//   (2) mô tả vai trò trong tab Nhan_Vien (liệt kê thứ tự nút Action mỗi vai trò được thấy).
//
// LƯU Ý: tab CauHinhKichBan hiện có 2 chỗ đặt tên LỆCH với dữ liệu thật:
//   - CauHinhKichBan ghi "B0_HOLD_Chờ xác nhận"       nhưng dữ liệu thật dùng "B0_Chờ xác nhận"
//   - CauHinhKichBan ghi "B4_IN PRODUCTION_Đang sản xuất" nhưng dữ liệu thật dùng "B4_Đang sản xuất"
// Nếu sửa lại CauHinhKichBan cho khớp, kịch bản quét QR tương ứng sẽ hoạt động đúng ngay
// (xem services/scenarioService.js — kịch bản đọc trực tiếp từ tab này, không hardcode trong code).
//
// Mảng dưới đây CHỈ dùng để tính cảnh báo và lọc đơn theo vai trò — sửa tại đây nếu quy trình đổi.
const THU_TU_TINH_TRANG = [
  'B0_Chờ xác nhận',
  'B1_Đã in',
  'B2_Đã lấy phôi',
  'B3_Đã đủ Phôi và File Vẽ',
  'B4_Đang sản xuất',
  'B5_Đã sản xuất',
  'SHIPPED_Đã gửi vận chuyển',
  'IN TRAINSIT_Tracking đã hoạt động',
  'DELIVERED_Đã giao hàng đến khách',
];

// Các trạng thái coi như "xong việc" — không tính cảnh báo trễ hạn nữa
const TRANG_THAI_KET_THUC = [
  'DELIVERED_Đã giao hàng đến khách',
  'CANCELLED_Đã hủy đơn',
  'REFUNDED_Hoàn đơn',
];

// Vị trí của 1 trạng thái trong pipeline — null nếu không nằm trong danh sách đã biết
// (ví dụ trạng thái lạ mới thêm mà chưa cập nhật mảng trên)
function chiSoGiaiDoan(tinhTrang) {
  const idx = THU_TU_TINH_TRANG.indexOf(tinhTrang);
  return idx === -1 ? null : idx;
}

module.exports = { THU_TU_TINH_TRANG, TRANG_THAI_KET_THUC, chiSoGiaiDoan };
