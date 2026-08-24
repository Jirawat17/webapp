// Pipeline SẢN XUẤT theo sơ đồ logic mới (So_do_logic.pdf, áp dụng 24/08/2026) — thay thế hoàn
// toàn pipeline B0-B5 tuyến tính cũ. Mỗi giai đoạn (1-5) có 1 cặp trạng thái XONG/CHƯA XONG.
// Giai đoạn 4 (sản xuất) có thêm nhánh lỗi B4.3 — đơn đứng yên ở đây cho tới khi có người xác
// nhận đã làm lại (kịch bản QR chuyển thẳng B4.3 -> B1.1, mở cho MỌI vai trò, xem CauHinhKichBan).
//
// ÁNH XẠ DỮ LIỆU CŨ -> MỚI (đã dùng để chạy scripts/migrate-trang-thai.js 1 lần duy nhất):
//   B0_Chờ xác nhận                -> B1.2_HOLD_Chưa xác nhận
//   B1_Đã in                       -> B1.1_Đơn đã xác nhận
//   B2_Đã lấy phôi                  -> B2.1_Đã có phôi
//   B3_Đã đủ Phôi và File Vẽ        -> B3.1_Đã vẽ file
//   B4_Đang sản xuất                -> B4.1_Đơn đã sản xuất
//   B5_Đã sản xuất                  -> B5.1_Đơn đã đóng gói
//   ĐƠN LỖI CẦN LÀM LẠI            -> B4.3_ĐƠN LỖI CẦN LÀM LẠI
//   SHIPPED / IN TRAINSIT / DELIVERED / CANCELLED / REFUNDED -> giữ nguyên, không đổi

// Mỗi trạng thái thuộc đúng 1 giai đoạn (1-5). xong:true = đã hoàn thành giai đoạn đó.
const GIAI_DOAN_CUA_TRANG_THAI = {
  'B1.2_HOLD_Chưa xác nhận':  { giaiDoan: 1, xong: false },
  'B1.1_Đơn đã xác nhận':     { giaiDoan: 1, xong: true },
  'B2.2_Không có phôi':       { giaiDoan: 2, xong: false },
  'B2.1_Đã có phôi':          { giaiDoan: 2, xong: true },
  'B3.2_Chưa vẽ file':        { giaiDoan: 3, xong: false },
  'B3.1_Đã vẽ file':          { giaiDoan: 3, xong: true },
  'B4.2_Đơn chưa sản xuất':   { giaiDoan: 4, xong: false },
  'B4.3_ĐƠN LỖI CẦN LÀM LẠI': { giaiDoan: 4, xong: false },
  'B4.1_Đơn đã sản xuất':     { giaiDoan: 4, xong: true },
  'B5.2_Đơn chưa đóng gói':   { giaiDoan: 5, xong: false },
  'B5.1_Đơn đã đóng gói':     { giaiDoan: 5, xong: true },
};

// Trạng thái coi như "xong việc" — không tính cảnh báo trễ hạn nữa
const TRANG_THAI_KET_THUC = [
  'DELIVERED_Đã giao hàng đến khách',
  'CANCELLED_Đã hủy đơn',
  'REFUNDED_Hoàn đơn',
];

// Đơn đã rời xưởng (đang/đã vận chuyển/đã giao) — dùng để tính cảnh báo mức Đỏ và để lọc đơn cho
// dong_goi (dong_goi cần thấy tới lúc giao xong, nhưng KHÔNG cần thấy đơn đã huỷ/hoàn — xem thêm
// TRANG_THAI_KET_THUC ở dưới, 2 danh sách này khác mục đích nên KHÔNG gộp chung).
const TRANG_THAI_DA_SHIP = [
  'SHIPPED_Đã gửi vận chuyển',
  'IN TRAINSIT_Tracking đã hoạt động',
  'DELIVERED_Đã giao hàng đến khách',
];

// Danh sách ĐẦY ĐỦ trạng thái — dùng cho dropdown lọc ở trang Báo cáo / nút "Chuyển đến trạng thái"
// ở trang Đơn hàng. "B4.3_ĐƠN LỖI CẦN LÀM LẠI" là trạng thái phát sinh trong giai đoạn 4, không
// phải lựa chọn YES/yes bình thường.
const DANH_SACH_TRANG_THAI_BAO_CAO = [
  'B1.2_HOLD_Chưa xác nhận',
  'B1.1_Đơn đã xác nhận',
  'B2.2_Không có phôi',
  'B2.1_Đã có phôi',
  'B3.2_Chưa vẽ file',
  'B3.1_Đã vẽ file',
  'B4.2_Đơn chưa sản xuất',
  'B4.3_ĐƠN LỖI CẦN LÀM LẠI',
  'B4.1_Đơn đã sản xuất',
  'B5.2_Đơn chưa đóng gói',
  'B5.1_Đơn đã đóng gói',
  'SHIPPED_Đã gửi vận chuyển',
  'IN TRAINSIT_Tracking đã hoạt động',
  'DELIVERED_Đã giao hàng đến khách',
  'CANCELLED_Đã hủy đơn',
  'REFUNDED_Hoàn đơn',
];

// Thông tin giai đoạn của 1 trạng thái sản xuất — null nếu không thuộc 5 giai đoạn này
// (vd đã ship/đã giao/đã hủy, hoặc giá trị lạ chưa biết).
function giaiDoanCuaTrangThai(tinhTrang) {
  return GIAI_DOAN_CUA_TRANG_THAI[tinhTrang] || null;
}

// true nếu đơn CHƯA xong tới giai đoạn `moc` (1-5) — dùng để lọc đơn theo vai trò và tính cảnh báo.
// LƯU Ý: trạng thái lạ/rỗng HOẶC đã ship/đã giao/đã hủy (không nằm trong GIAI_DOAN_CUA_TRANG_THAI)
// đều trả về true ở đây — an toàn cho mục đích cảnh báo (không bỏ sót), nhưng nếu dùng để lọc
// "đơn đã đi QUA giai đoạn sản xuất" (như vai trò dong_goi) thì phải cộng thêm điều kiện riêng cho
// TRANG_THAI_DA_SHIP/TRANG_THAI_KET_THUC — xem services/orderService.js.
function chuaXongGiaiDoan(tinhTrang, moc) {
  const info = giaiDoanCuaTrangThai(tinhTrang);
  if (!info) return true;
  if (info.giaiDoan < moc) return true;
  if (info.giaiDoan === moc && !info.xong) return true;
  return false;
}

module.exports = {
  GIAI_DOAN_CUA_TRANG_THAI,
  TRANG_THAI_KET_THUC,
  TRANG_THAI_DA_SHIP,
  DANH_SACH_TRANG_THAI_BAO_CAO,
  giaiDoanCuaTrangThai,
  chuaXongGiaiDoan,
};
