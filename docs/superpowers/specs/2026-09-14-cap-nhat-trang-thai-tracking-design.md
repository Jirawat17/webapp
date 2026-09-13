# Tự động cập nhật trạng thái tracking thật (GKE) vào TRANG_THAI_TRACKING

## 1. Mục tiêu

Với đơn ĐÃ có mã tracking thật (`TRACKING_ID`, mua qua GKE), tự động tra cứu trạng thái vận chuyển
THẬT (VD "In Transit", "Đã giao") theo định kỳ, ghi vào 2 cột MỚI trên tab `Don_Hang_ALL`:
- `TRANG_THAI_TRACKING` — mô tả trạng thái mới nhất (tiếng Việt, GKE tự dịch qua header
  `Accept-Language: vi`).
- `THOI_GIAN_CAP_NHAT_TRACKING` — mốc thời gian lần tra cứu thành công gần nhất (cùng định dạng
  `dinhDangNgayGioNgan()` đã dùng cho `THOI_GIAN_IN_LABEL`/`THOI_GIAN_IN_MA`).

Đã chốt qua hỏi-đáp với người dùng:
- HOÀN TOÀN TÁCH BIỆT khỏi `TRANG_THAI_XUONG` — chỉ là cột thông tin, KHÔNG tự động chuyển bất kỳ
  trạng thái sản xuất/pipeline nào theo trạng thái tracking thật.
- Chạy TỰ ĐỘNG theo lịch (cron), không cần bấm gì — không phải nút thủ công.

## 2. API GKE dùng cho tính năng này

Đọc trực tiếp tài liệu tại `openapi.gkelogistics.com` (mục "Query Order Track", cùng nhóm với 2
endpoint đã dùng sẵn `/order/create/`/`/label/print/` trong `services/gkeService.js`):

- `POST query/track/` (cùng `BASE_URL` + cùng cơ chế Bearer token đã có trong `goiApi()`).
- Request: `{ "num_type": 1, "num": "<STT_Key>" }` — TÁI DÙNG đúng quy ước `num_type=1` + STT_Key làm
  `customer_order_num` đã áp dụng cho `/label/print/` (xem comment đầu `gkeService.js`), không cần tra
  cứu/lưu thêm order_num hay waybill number nào của GKE.
- Header thêm `Accept-Language: vi` — GKE tự trả `track_name` bằng tiếng Việt, không cần tự xây bảng
  dịch. `goiApi()` hiện chưa hỗ trợ truyền thêm header tuỳ ý — bổ sung tham số `extraHeaders` (mặc định
  rỗng, không ảnh hưởng 2 chỗ gọi cũ).
- Response `data`: MẢNG các sự kiện tracking (cũ → mới dần theo ví dụ tài liệu), mỗi phần tử gồm
  `track_name` (mô tả theo ngôn ngữ header), `order_node`/`node_status` (mã trạng thái có cấu trúc),
  `actual_time`, `location`... — lấy PHẦN TỬ CUỐI làm trạng thái hiện tại.

## 3. Thiết kế

- **`services/gkeService.js`**:
  - `goiApi()` nhận thêm tuỳ chọn `extraHeaders` (gộp vào header request, giữ nguyên hành vi 2 chỗ gọi
    cũ vì mặc định `{}`).
  - Hàm mới `layLichSuTrackingGke(sttKey, cauHinh, nhatKy)` gọi `query/track/` với
    `Accept-Language: vi`, trả về mảng sự kiện (rỗng nếu chưa có sự kiện nào — KHÔNG coi là lỗi, đơn
    label mới tạo thường chưa có sự kiện ngay).
- **`services/trackingAutoService.js`** (cùng file đang giữ toàn bộ logic tracking tự động khác, tái
  dùng `dinhDangNgayGioNgan`, `orderService.update()`, `NGUOI_HE_THONG`):
  - `capNhatTrangThaiTrackingChoDon(sttKey, cauHinhGke)` — đọc đơn fresh, kiểm tra CHƯA có ÍT NHẤT 1
    trong 2 cột mới thì bỏ qua ngay (khỏi tốn 1 lượt gọi GKE vô ích), gọi
    `layLichSuTrackingGke()`, lấy sự kiện cuối, ghi qua `orderService.update()` (guard riêng từng cột
    theo `headers.includes(...)`, giống hệt khuôn `ghiDaInLabel()`).
  - `chayQuetCapNhatTrangThaiTracking()` — lọc `rows` có `TRACKING_ID`, gọi tuần tự từng đơn (giống
    `chayQuetTuDongMuaTracking()`), lỗi 1 đơn chỉ `console.error` + bỏ qua, không dừng cả lượt.
- **`services/trackingJob.js`**: thêm 1 lịch cron MỚI, tần suất THẤP hơn hẳn lịch mua tracking (2
  phút) — đề xuất mỗi 4 tiếng (`0 */4 * * *`), vì trạng thái vận chuyển đổi chậm hơn nhiều so với việc
  cần mua tracking đúng lúc. Không thêm cấu hình bật/tắt/đổi giờ trên giao diện (khác lịch mua tracking
  — tính năng này đơn giản hơn, chưa cần tuỳ chỉnh qua UI).
- **KHÔNG đổi** `routes/tracking.js`/`public/tracking.html` — không có yêu cầu hiển thị UI mới, chỉ cập
  nhật dữ liệu nền vào Sheet.

## 4. Đã cân nhắc nhưng KHÔNG làm ở bản này

- **Bỏ qua đơn đã ở trạng thái cuối** (giao thành công/trả hàng xong) để giảm số lượt gọi GKE về lâu
  dài: cần lưu THÊM mã `order_node`/`node_status` gốc (không thể suy ngược đáng tin cậy từ mỗi chuỗi
  `TRANG_THAI_TRACKING` tiếng Việt hiển thị) — tức thêm cột nữa ngoài 2 cột người dùng đã yêu cầu. Chưa
  có số liệu thật về khối lượng đơn/giới hạn gọi API của GKE để biết có thực sự cần thiết không (tài
  liệu không nêu rate limit) — để bản sau nếu phát sinh vấn đề thật, tránh làm phức tạp thêm mà chưa có
  bằng chứng cần thiết.

## 5. Đã kiểm tra

_(cập nhật sau khi code xong)_
