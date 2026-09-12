// Pipeline SẢN XUẤT — bản 3 cột (24/08/2026, theo Prompt_Ver_24.docx) — thay thế hoàn toàn bản 1
// cột B1.1-B5.2 trước đó. Lấy phôi và vẽ file giờ là 2 việc ĐỘC LẬP, chạy song song, mỗi việc có
// cột trạng thái RIÊNG trong Sheet. Cột TRANG_THAI_XUONG chỉ còn theo dõi tiến trình CHUNG (xác nhận ->
// sẵn sàng chạy máy -> sản xuất -> đóng gói -> vận chuyển).
//
// 3 CỘT TRONG SHEET Don_Hang_ALL:
//   TRANG_THAI_XUONG         — tiến trình chung của đơn (xem TINH_TRANG_VALUES)
//   TRANG_THAI_PHOI     — 'Chưa lấy phôi' | 'Đã lấy phôi'
//   TRANG_THAI_VE_FILE  — 'Chưa vẽ file' | 'Đã vẽ file'
//
// "ĐÃ SẴN SÀNG CHẠY MÁY" là trạng thái TỰ ĐỘNG: hệ thống tự đặt TRANG_THAI_XUONG sang giá trị này ngay khi
// TRANG_THAI_PHOI = 'Đã lấy phôi' VÀ TRANG_THAI_VE_FILE = 'Đã vẽ file' CÙNG LÚC — NHƯNG CHỈ áp dụng
// khi TRANG_THAI_XUONG đang là 'Đã in mã' (lần đầu tiên). Sau khi đơn bị lỗi rồi làm lại từ phôi/file,
// việc quay lại "ĐÃ SẴN SÀNG CHẠY MÁY" lần 2 KHÔNG tự động nữa — phải set tay (đã xác nhận rõ với
// người dùng). Xem services/orderService.js (hàm update) để biết chỗ tính tự động này.
//
// ÁNH XẠ DỮ LIỆU CŨ (bản B1.1-B5.2) -> MỚI (dùng cho scripts/migrate-trang-thai-v2.js):
//   B1.2_HOLD_Chưa xác nhận          -> TRANG_THAI_XUONG='Chưa xác nhận',  PHOI='Chưa lấy phôi', VE_FILE='Chưa vẽ file'
//   B1.1_Đơn đã xác nhận             -> TRANG_THAI_XUONG='Đã xác nhận',    PHOI='Chưa lấy phôi', VE_FILE='Chưa vẽ file'
//   B2.2_Không có phôi               -> TRANG_THAI_XUONG='Đã xác nhận',    PHOI='Chưa lấy phôi', VE_FILE='Chưa vẽ file'
//   B2.1_Đã có phôi                  -> TRANG_THAI_XUONG='Đã xác nhận',    PHOI='Đã lấy phôi',   VE_FILE='Chưa vẽ file'
//   B3.2_Chưa vẽ file                -> TRANG_THAI_XUONG='Đã xác nhận',    PHOI='Đã lấy phôi',   VE_FILE='Chưa vẽ file'
//   B3.1_Đã vẽ file                  -> TRANG_THAI_XUONG='ĐÃ SẴN SÀNG CHẠY MÁY', PHOI='Đã lấy phôi', VE_FILE='Đã vẽ file'
//   B4.2_Đơn chưa sản xuất           -> TRANG_THAI_XUONG='ĐÃ SẴN SÀNG CHẠY MÁY', PHOI='Đã lấy phôi', VE_FILE='Đã vẽ file'
//   B4.3_ĐƠN LỖI CẦN LÀM LẠI        -> TRANG_THAI_XUONG='LỖI SẢN XUẤT CẦN LÀM LẠI', PHOI='Chưa lấy phôi', VE_FILE='Chưa vẽ file' (làm lại từ đầu)
//   B4.1_Đơn đã sản xuất             -> TRANG_THAI_XUONG='Đã sản xuất',     PHOI='Đã lấy phôi',   VE_FILE='Đã vẽ file'
//   B5.2_Đơn chưa đóng gói           -> TRANG_THAI_XUONG='Đã sản xuất',     PHOI='Đã lấy phôi',   VE_FILE='Đã vẽ file' ("Chưa đóng gói" không còn tồn tại, gộp lại thành "Đã sản xuất")
//   B5.1_Đơn đã đóng gói             -> TRANG_THAI_XUONG='Đã đóng gói',     PHOI='Đã lấy phôi',   VE_FILE='Đã vẽ file'
//   SHIPPED_Đã gửi vận chuyển        -> TRANG_THAI_XUONG='IN TRANSIT_Tracking đã hoạt động' (đã xác nhận với người dùng — SHIPPED không còn tồn tại, coi như đã bắt đầu vận chuyển)
//   IN TRAINSIT_Tracking đã hoạt động -> TRANG_THAI_XUONG='IN TRANSIT_Tracking đã hoạt động' (sửa lại đúng chính tả TRANSIT, bỏ chữ I thừa)
//   DELIVERED_Đã giao hàng đến khách -> TRANG_THAI_XUONG='DELIVERED_Đã giao đến khách'
//   CANCELLED_Đã hủy đơn             -> TRANG_THAI_XUONG='CANCELLED_Đã hủy'
//   REFUNDED_Hoàn đơn                -> TRANG_THAI_XUONG='REFUNDED_Hoàn đơn' (không đổi)

// "Đang chạy máy" (thêm 26/08/2026): chèn ngay sau "ĐÃ SẴN SÀNG CHẠY MÁY" trong pipeline — do
// san_xuat SET TAY khi bắt đầu chạy máy, KHÔNG tự động như "ĐÃ SẴN SÀNG CHẠY MÁY". Cùng đứng từ
// "ĐÃ SẴN SÀNG CHẠY MÁY" trở đi nên vẫn bắt buộc phôi/file phải xong (xem kiemTraTinhHopLy trong
// services/orderService.js) và vẫn nằm trong phạm vi đơn mà san_xuat được thấy (filterForRole).
//
// "ĐÃ DÁN TEM" (thêm 01/09/2026) — trạng thái ngay sau "Đã sản xuất" trên đường chính. KHÔNG có
// automation nào tự chuyển tiếp "ĐÃ DÁN TEM" -> "DELIVERED" — vẫn set tay như trước.
//
// XOÁ "Đã đóng gói" (09/09/2026 lần 3, theo yêu cầu người dùng — xác nhận không cần trạng thái này
// nữa): trước đó nằm giữa "Đã sản xuất" và "ĐÃ DÁN TEM", đạt được qua chế độ "Chụp ảnh đóng gói"
// (routes/photos.js, mốc dong_goi — ĐÃ XOÁ luôn mốc này). Cột Anh_Dong_Goi_URL (ảnh chụp lúc đóng gói)
// không còn dùng trong code nữa (vẫn còn trên Sheet nếu người dùng muốn giữ dữ liệu ảnh cũ, không tự
// xoá cột).
//
// ĐỔI CƠ CHẾ đạt "ĐÃ DÁN TEM" (09/09/2026 lần 4, theo yêu cầu người dùng): trước đó chỉ đạt được qua
// "Quét mã QR Tracking" (routes/gke.js, gọi GKE Logistics thật tạo vận đơn + mã tracking) — ĐÃ XOÁ hẳn
// route này (routes/gke.js không còn tồn tại). Thay bằng chế độ "Chụp ảnh ĐÃ DÁN TEM" thuần ảnh
// (routes/photos.js, mốc da_dan_tem) — CÙNG khuôn "Chụp ảnh đã sản xuất": quét QR xác định đơn, chụp
// ảnh, tự chuyển trạng thái — bản thân bước chụp ảnh này KHÔNG gọi GKE, KHÔNG tự tạo mã tracking. Cơ
// chế GKE (Mua Tracking, IN LABEL, trang Tracking — xem mục 10 trong
// docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md) vẫn giữ nguyên, là 1 THAO TÁC
// RIÊNG (không tự động kèm theo chụp ảnh).
//
// BẮT BUỘC ĐÃ CÓ TRACKING TRƯỚC (09/09/2026 lần 5, theo yêu cầu người dùng — ĐẢO NGƯỢC lại phần "có
// thể không có mã tracking" ở lần 4 phía trên): dù việc chụp ảnh không TỰ gọi GKE, đơn vẫn BẮT BUỘC
// phải đã có TRACKING_ID thật (mua qua Mua Tracking/MUA TRACKING và IN LABEL trước đó) thì mới được
// chuyển sang "ĐÃ DÁN TEM" — kiểm tra ở services/orderService.js (TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM),
// áp dụng cho MỌI người gọi kể cả admin, không có ngoại lệ. Đơn đang chờ tem (cột TAM_THOI đang mang
// giá trị gkeService.MA_DANG_CHO_TEM, xem services/trackingAutoService.js) KHÔNG tính là đã có tracking
// — TRACKING_ID lúc đó vẫn rỗng.
// "ĐÃ DÁN TEM" giờ đạt được qua ĐÚNG 2 đường: (1) "Chụp ảnh ĐÃ DÁN TEM" (routes/photos.js, mốc
// da_dan_tem — điều kiện đơn phải đang đúng "Đã sản xuất" VÀ đã có tracking thật); (2) admin sửa tay
// (CŨNG bắt buộc đơn đang đúng "Đã sản xuất" VÀ đã có tracking thật, không có ngoại lệ nào — xem
// kiemTraCongAnhBatBuoc trong services/orderService.js).
//
// "IN TRANSIT_Tracking đã hoạt động" (XOÁ 04/09/2026, theo yêu cầu người dùng): từng nằm giữa "ĐÃ
// DÁN TEM" và "DELIVERED", nhưng thực tế không đơn nào dùng tới (đã xác nhận không có đơn nào đang ở
// trạng thái này trước khi xoá) — pipeline giờ đi thẳng ĐÃ DÁN TEM -> DELIVERED. Xoá đồng bộ khỏi
// TINH_TRANG_VALUES/THU_TU_TINH_TRANG/TRANG_THAI_DA_SHIP ở file này, MAU_TRANG_THAI (public/js/api.js),
// DANH_SACH_TINH_TRANG + CAC_TRANG_THAI_TU_SAN_SANG_TRO_DI (public/order.html),
// DANH_SACH_TRANG_THAI_DAY_DU (public/orders.html), và mô tả pipeline cho chatbot (routes/chatbot.js).
//
// ĐỔI TÊN (05/09/2026, theo yêu cầu người dùng) — 'Chưa xác nhận'/'Đã xác nhận' đổi tên thành 'Chưa in
// mã'/'Đã in mã' (giữ NGUYÊN vị trí trong pipeline và MỌI logic/quyền/tự động hoá liên quan — chỉ đổi
// tên gọi). Đơn cũ trong Sheet đang mang 2 giá trị cũ này cần chạy scripts/migrate-trang-thai-v3.js để
// đổi sang tên mới (xem hướng dẫn --apply trong chính file script đó). LƯU Ý 2 việc NẰM NGOÀI phạm vi
// code Node, phải tự làm: (1) Apps Script tạo đơn mới hiện đang set mặc định TRANG_THAI_XUONG='Chưa
// xác nhận' cho đơn vừa tạo — phải tự sửa lại thành 'Chưa in mã', không thì đơn mới tạo ra vẫn mang
// tên cũ; (2) tab CauHinhKichBan không cần sửa vì không có kịch bản quét QR nào dùng 2 giá trị này làm
// Trang_Thai_Yeu_Cau/Trang_Thai_Sau (đã rà lại, chỉ có 3 kịch bản thao tác TRANG_THAI_PHOI/TRANG_THAI_
// XUONG ở các mốc khác, không đụng 'Chưa xác nhận'/'Đã xác nhận' cũ).
const TINH_TRANG_VALUES = [
  'Chưa in mã',
  'Đã in mã',
  'ĐÃ SẴN SÀNG CHẠY MÁY',
  'Đang chạy máy',
  'Đã sản xuất',
  'LỖI SẢN XUẤT CẦN LÀM LẠI',
  'ĐÃ DÁN TEM',
  'DELIVERED_Đã giao đến khách',
  'CANCELLED_Đã hủy',
  'REFUNDED_Hoàn đơn',
];

const TRANG_THAI_PHOI_VALUES = ['Chưa lấy phôi', 'Đã lấy phôi'];
// "Đang vẽ file" (thêm 08/09/2026, theo yêu cầu người dùng) — chèn giữa "Chưa"/"Đã vẽ file", đúng
// khuôn "Đang chạy máy" của san_xuat: người vẽ file TỰ NHẬN hoặc được admin CHỈ ĐỊNH thì chuyển sang
// giá trị này (tự stamp NGUOI_VE_FILE, xem services/orderService.js) thay vì chỉ ghi lặng lẽ vào cột
// phụ như bản đầu tiên của tính năng — xem docs/superpowers/specs/2026-09-08-trang-thai-dang-ve-file-design.md.
const TRANG_THAI_VE_FILE_VALUES = ['Chưa vẽ file', 'Đang vẽ file', 'Đã vẽ file'];

// Giá trị đặc biệt cho bộ lọc "(Trống)" ở trang Đơn hàng (TRANG_THAI_XUONG/TRANG_THAI_PHOI/
// TRANG_THAI_VE_FILE) — CHỈ dùng cho lọc/hiển thị, KHÔNG BAO GIỜ được ghi vào Sheet. Không dùng chuỗi
// rỗng '' vì cả client (public/orders.html) lẫn server (routes/orders.js, routes/reports.js) đều coi
// '' là "không lọc gì" — cần 1 giá trị khác hẳn để phân biệt "lọc đơn có đúng ô này đang trống" với
// "không lọc theo cột này". PHẢI khớp với hằng số cùng tên bên public/orders.html — sửa 1 chỗ thì
// nhớ sửa chỗ kia.
const GIA_TRI_LOC_TRONG = '__TRONG__';

// So khớp 1 giá trị lọc với giá trị thật trên đơn — hỗ trợ GIA_TRI_LOC_TRONG (lọc đúng các đơn có ô
// này đang TRỐNG trong Sheet), khớp CHÍNH XÁC cho mọi giá trị khác như trước giờ. Dùng chung cho
// routes/orders.js (danh sách) và routes/reports.js (in/xuất file) để 2 nơi luôn hiểu đúng như nhau.
function khopGiaTriLoc(giaTriThat, giaTriLoc) {
  return giaTriLoc === GIA_TRI_LOC_TRONG ? !giaTriThat : giaTriThat === giaTriLoc;
}

// Thứ tự tiến trình CHÍNH (không gồm LỖI SẢN XUẤT CẦN LÀM LẠI / CANCELLED / REFUNDED — 3 trạng thái
// này là nhánh rẽ, không nằm trên đường chính). Dùng để biết "đơn đã qua mốc X hay chưa" — vd lọc
// đơn cho san_xuat (xem services/orderService.js).
const THU_TU_TINH_TRANG = [
  'Chưa in mã',
  'Đã in mã',
  'ĐÃ SẴN SÀNG CHẠY MÁY',
  'Đang chạy máy',
  'Đã sản xuất',
  'ĐÃ DÁN TEM',
  'DELIVERED_Đã giao đến khách',
];

// Trạng thái coi như "xong việc" — không tính cảnh báo trễ hạn nữa
const TRANG_THAI_KET_THUC = [
  'DELIVERED_Đã giao đến khách',
  'CANCELLED_Đã hủy',
  'REFUNDED_Hoàn đơn',
];

// Đơn đã rời xưởng (đã giao) — dùng để tính cảnh báo mức Đỏ
const TRANG_THAI_DA_SHIP = [
  'DELIVERED_Đã giao đến khách',
];

// Vị trí trong THU_TU_TINH_TRANG, hoặc null nếu là trạng thái rẽ nhánh (lỗi/huỷ/hoàn) hoặc lạ
function chiSoTinhTrang(tinhTrang) {
  const idx = THU_TU_TINH_TRANG.indexOf(tinhTrang);
  return idx === -1 ? null : idx;
}

// Danh sách ĐẦY ĐỦ trạng thái TRANG_THAI_XUONG — dùng cho dropdown lọc ở trang Báo cáo / nút "Chuyển đến
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
  GIA_TRI_LOC_TRONG,
  khopGiaTriLoc,
  chiSoTinhTrang,
};
