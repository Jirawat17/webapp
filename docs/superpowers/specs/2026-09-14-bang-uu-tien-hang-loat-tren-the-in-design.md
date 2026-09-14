# Băng "ĐƠN ƯU TIÊN" / "ĐƠN HÀNG LOẠT" trên thẻ in mã đơn

## 1. Mục tiêu

Theo yêu cầu người dùng: khi in thẻ mã đơn (dán lên sản phẩm) cho 1 đơn đang đánh dấu **Đơn ưu tiên**
(`DON_UU_TIEN`) hoặc thuộc 1 **nhóm đơn hàng loạt** (`NHOM_HANG_LOAT`), thẻ in phải có thêm chữ
"ĐƠN ƯU TIÊN" / "ĐƠN HÀNG LOẠT" cỡ lớn, dễ thấy ngay khi cầm thẻ lên — không chỉ biết qua giao diện
web như hiện tại.

## 2. Rà soát trước khi code

- Chỉ có ĐÚNG 1 hàm vẽ thẻ in: `veTheDonPdf()` ở `routes/reports.js` — dùng chung cho CẢ 2 điểm in
  (nút "IN ĐƠN" ở `order.html`, in hàng loạt ở `orders.html`), nên sửa 1 chỗ là đủ cho cả 2.
- `DON_UU_TIEN`/`NHOM_HANG_LOAT` đã có sẵn nguyên trên `don` truyền vào hàm này (`list` tới từ
  `orderService.getAll()` — dữ liệu Sheet thô, đủ mọi cột) — không cần sửa gì ở tầng lấy dữ liệu.
- Đã hỏi người dùng vị trí đặt băng do thẻ 100x150mm hiện đã khá đầy (2 ảnh to + QR + Ghi chú tự giãn
  chiếm hết chỗ còn lại) — chốt: **băng đen full chiều ngang thẻ, ngay dưới mã đơn, TRƯỚC 2 ảnh** (chữ
  trắng nền đen — cùng kỹ thuật hình chữ nhật PDFKit đã dùng cho khung đen quanh QR, không qua raster
  nên luôn nhanh). Không cạnh tranh chỗ với khối Ghi chú ở dưới.
- Đơn VỪA ưu tiên VỪA thuộc hàng loạt: xếp CHỒNG 2 băng (Ưu tiên trước, Hàng loạt sau) — đơn giản nhất,
  không cần gộp chữ vào 1 dòng.

## 3. Thiết kế

`routes/reports.js#veTheDonPdf()` — thêm hàm phụ `veBangDenNoiBat(doc, chu, x0, y, rongTrong)`: vẽ 1
hình chữ nhật đen full-width, đo chiều cao THẬT của chữ qua `doc.heightOfString()` (cùng kỹ thuật đã
dùng cho khối "ảnh dư" ngay trong file này) + đệm cố định trên/dưới, chữ trắng đậm cỡ 18 căn giữa, trả
về chiều cao đã dùng để hàm gọi biết cộng dồn `y` tiếp.

Gọi ngay sau dòng `LOẠI · KÍCH_THƯỚC · MÀU_SẮC`, TRƯỚC khối ảnh — `laUuTien` dùng lại
`orderService.laUuTien(don)` (đã có, cùng logic tính "Đơn ưu tiên" ở mọi nơi khác trong app);
`laHangLoat` là `!!don.NHOM_HANG_LOAT`. Mỗi băng áp dụng thì cộng thêm chiều cao (+ khoảng cách nhỏ)
vào `y` trước khi khối ảnh bắt đầu — thẻ không có băng nào thì layout giữ NGUYÊN như trước (không đổi
hành vi đơn thường).

## 4. Rủi ro đã cân nhắc

Đơn vừa ưu tiên, vừa hàng loạt, vừa có Ghi chú dài — cả 2 băng (~25-30pt mỗi băng) cộng dồn đẩy khối
ảnh xuống, làm khối Ghi chú ở cuối thẻ còn ÍT chỗ hơn. Khối Ghi chú đã có sẵn cơ chế tự giới hạn chiều
cao + `ellipsis: true` (cắt bớt, không đè chữ) nên không vỡ layout — chỉ có thể bị cắt ngắn hơn bình
thường trong trường hợp hiếm này. Chấp nhận được, không cần xử lý thêm.

## 5. Đã kiểm tra

- `test-bang-uu-tien-hang-loat-the-in.js`: sinh PDF THẬT qua `GET /api/reports/pdf?mau=don_can_in` (4
  đơn: thường / chỉ ưu tiên / chỉ hàng loạt / cả 2 + Ghi chú dài) — status 200, đúng
  `Content-Type: application/pdf`, không throw.
- Xem trực quan cả 4 trang qua trình duyệt (PDF.js, render thật, không đoán): đơn thường layout
  NGUYÊN như cũ, không có băng nào; đơn chỉ ưu tiên/chỉ hàng loạt hiện đúng 1 băng đen, chữ trắng đậm
  căn giữa, không đè/tràn; đơn cả 2 xếp chồng đúng 2 băng, phần Ghi chú bên dưới bị cắt ngắn hơn bình
  thường (do ít chỗ còn lại hơn) nhưng vẫn gọn gàng nhờ `ellipsis: true` có sẵn — đúng rủi ro đã lường
  trước ở mục 4, chấp nhận được, không vỡ layout.
- Chạy lại toàn bộ 35 file test scratchpad (gồm file mới) — không phát sinh lỗi mới, chỉ còn đúng 5 lỗi
  sẵn có từ trước, đã xác nhận nhiều lần trong phiên làm việc này là không liên quan.
