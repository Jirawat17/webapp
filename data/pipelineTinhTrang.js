// Pipeline SẢN XUẤT — bản 3 cột (24/08/2026, theo Prompt_Ver_24.docx) — thay thế hoàn toàn bản 1
// cột B1.1-B5.2 trước đó. Lấy phôi và vẽ file giờ là 2 việc ĐỘC LẬP, chạy song song, mỗi việc có
// cột trạng thái RIÊNG trong Sheet. Cột TINH_TRANG chỉ còn theo dõi tiến trình CHUNG (xác nhận ->
// sẵn sàng chạy máy -> sản xuất -> đóng gói -> vận chuyển).
//
// 3 CỘT TRONG SHEET Don_Hang_ALL:
//   TINH_TRANG         — tiến trình chung của đơn (xem TINH_TRANG_VALUES)
//   TRANG_THAI_PHOI     — 'Chưa lấy phôi' | 'Đã lấy phôi'
//   TRANG_THAI_VE_FILE  — 'Chưa vẽ file' | 'Đã vẽ file'
//
// "ĐÃ SẴN SÀNG CHẠY MÁY" là trạng thái TỰ ĐỘNG: hệ thống tự đặt TINH_TRANG sang giá trị này ngay khi
// TRANG_THAI_PHOI = 'Đã lấy phôi' VÀ TRANG_THAI_VE_FILE = 'Đã vẽ file' CÙNG LÚC — NHƯNG CHỈ áp dụng
// khi TINH_TRANG đang là 'Đã xác nhận' (lần đầu tiên). Sau khi đơn bị lỗi rồi làm lại từ phôi/file,
// việc quay lại "ĐÃ SẴN SÀNG CHẠY MÁY" lần 2 KHÔNG tự động nữa — phải set tay (đã xác nhận rõ với
// người dùng). Xem services/orderService.js (hàm update) để biết chỗ tính tự động này.
//
// ÁNH XẠ DỮ LIỆU CŨ (bản B1.1-B5.2) -> MỚI (dùng cho scripts/migrate-trang-thai-v2.js):
//   B1.2_HOLD_Chưa xác nhận          -> TINH_TRANG='Chưa xác nhận',  PHOI='Chưa lấy phôi', VE_FILE='Chưa vẽ file'
//   B1.1_Đơn đã xác nhận             -> TINH_TRANG='Đã xác nhận',    PHOI='Chưa lấy phôi', VE_FILE='Chưa vẽ file'
//   B2.2_Không có phôi               -> TINH_TRANG='Đã xác nhận',    PHOI='Chưa lấy phôi', VE_FILE='Chưa vẽ file'
//   B2.1_Đã có phôi                  -> TINH_TRANG='Đã xác nhận',    PHOI='Đã lấy phôi',   VE_FILE='Chưa vẽ file'
//   B3.2_Chưa vẽ file                -> TINH_TRANG='Đã xác nhận',    PHOI='Đã lấy phôi',   VE_FILE='Chưa vẽ file'
//   B3.1_Đã vẽ file                  -> TINH_TRANG='ĐÃ SẴN SÀNG CHẠY MÁY', PHOI='Đã lấy phôi', VE_FILE='Đã vẽ file'
//   B4.2_Đơn chưa sản xuất           -> TINH_TRANG='ĐÃ SẴN SÀNG CHẠY MÁY', PHOI='Đã lấy phôi', VE_FILE='Đã vẽ file'
//   B4.3_ĐƠN LỖI CẦN LÀM LẠI        -> TINH_TRANG='LỖI SẢN XUẤT CẦN LÀM LẠI', PHOI='Chưa lấy phôi', VE_FILE='Chưa vẽ file' (làm lại từ đầu)
//   B4.1_Đơn đã sản xuất             -> TINH_TRANG='Đã sản xuất',     PHOI='Đã lấy phôi',   VE_FILE='Đã vẽ file'
//   B5.2_Đơn chưa đóng gói           -> TINH_TRANG='Đã sản xuất',     PHOI='Đã lấy phôi',   VE_FILE='Đã vẽ file' ("Chưa đóng gói" không còn tồn tại, gộp lại thành "Đã sản xuất")
//   B5.1_Đơn đã đóng gói             -> TINH_TRANG='Đã đóng gói',     PHOI='Đã lấy phôi',   VE_FILE='Đã vẽ file'
//   SHIPPED_Đã gửi vận chuyển        -> TINH_TRANG='IN TRANSIT_Tracking đã hoạt động' (đã xác nhận với người dùng — SHIPPED không còn tồn tại, coi như đã bắt đầu vận chuyển)
//   IN TRAINSIT_Tracking đã hoạt động -> TINH_TRANG='IN TRANSIT_Tracking đã hoạt động' (sửa lại đúng chính tả TRANSIT, bỏ chữ I thừa)
//   DELIVERED_Đã giao hàng đến khách -> TINH_TRANG='DELIVERED_Đã giao đến khách'
//   CANCELLED_Đã hủy đơn             -> TINH_TRANG='CANCELLED_Đã hủy'
//   REFUNDED_Hoàn đơn                -> TINH_TRANG='REFUNDED_Hoàn đơn' (không đổi)

const TINH_TRANG_VALUES = [
  'Chưa xác nhận',
  'Đã xác nhận',
  'ĐÃ SẴN SÀNG CHẠY MÁY',
  'Đã sản xuất',
  'LỖI SẢN XUẤT CẦN LÀM LẠI',
  'Đã đóng gói',
  'IN TRANSIT_Tracking đã hoạt động',
  'DELIVERED_Đã giao đến khách',
  'CANCELLED_Đã hủy',
  'REFUNDED_Hoàn đơn',
];

const TRANG_THAI_PHOI_VALUES = ['Chưa lấy phôi', 'Đã lấy phôi'];
const TRANG_THAI_VE_FILE_VALUES = ['Chưa vẽ file', 'Đã vẽ file'];

// Thứ tự tiến trình CHÍNH (không gồm LỖI SẢN XUẤT CẦN LÀM LẠI / CANCELLED / REFUNDED — 3 trạng thái
// này là nhánh rẽ, không nằm trên đường chính). Dùng để biết "đơn đã qua mốc X hay chưa" — vd lọc
// đơn cho san_xuat (xem services/orderService.js).
const THU_TU_TINH_TRANG = [
  'Chưa xác nhận',
  'Đã xác nhận',
  'ĐÃ SẴN SÀNG CHẠY MÁY',
  'Đã sản xuất',
  'Đã đóng gói',
  'IN TRANSIT_Tracking đã hoạt động',
  'DELIVERED_Đã giao đến khách',
];

// Trạng thái coi như "xong việc" — không tính cảnh báo trễ hạn nữa
const TRANG_THAI_KET_THUC = [
  'DELIVERED_Đã giao đến khách',
  'CANCELLED_Đã hủy',
  'REFUNDED_Hoàn đơn',
];

// Đơn đã rời xưởng (đang/đã vận chuyển/đã giao) — dùng để tính cảnh báo mức Đỏ
const TRANG_THAI_DA_SHIP = [
  'IN TRANSIT_Tracking đã hoạt động',
  'DELIVERED_Đã giao đến khách',
];

// Vị trí trong THU_TU_TINH_TRANG, hoặc null nếu là trạng thái rẽ nhánh (lỗi/huỷ/hoàn) hoặc lạ
function chiSoTinhTrang(tinhTrang) {
  const idx = THU_TU_TINH_TRANG.indexOf(tinhTrang);
  return idx === -1 ? null : idx;
}

// Danh sách ĐẦY ĐỦ trạng thái TINH_TRANG — dùng cho dropdown lọc ở trang Báo cáo / nút "Chuyển đến
// trạng thái" ở trang Đơn hàng.
const DANH_SACH_TRANG_THAI_BAO_CAO = TINH_TRANG_VALUES;

module.exports = {
  TINH_TRANG_VALUES,
  TRANG_THAI_PHOI_VALUES,
  TRANG_THAI_VE_FILE_VALUES,
  THU_TU_TINH_TRANG,
  TRANG_THAI_KET_THUC,
  TRANG_THAI_DA_SHIP,
  DANH_SACH_TRANG_THAI_BAO_CAO,
  chiSoTinhTrang,
};
