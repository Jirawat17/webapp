# Sửa lỗi "Quét hàng loạt" (Đơn hàng loạt) dừng giữa chừng do treo kết nối tải ảnh

## 1. Triệu chứng

Người dùng bấm "Quét tìm DHL" (quét hash ảnh cho Đơn hàng loạt) trên 1 lô 708 đơn — cả 3 lần thử đều
dừng giữa chừng (vd 570/708), thanh tiến độ đứng yên, nút "Hủy" vẫn còn đó nhưng job không bao giờ tự
xong hay báo lỗi.

## 2. Root cause

`routes/orders.js` (`POST /quet-hang-loat/bat-dau`) chạy 1 vòng lặp nền, mỗi đơn:

```
taiDsAnh() -> anhNguonService.taiAnh() -> (MinIO | Google Drive | Gemini | URL thường)
```

Toàn bộ vòng lặp nằm trong 1 `try/catch` DUY NHẤT (bắt lỗi rồi set `job.trangThai = 'loi'`) — nhưng
`try/catch` chỉ bắt được khi có gì đó THẬT SỰ `throw`. Rà lại từng nguồn ảnh:

| Nguồn ảnh | Có timeout? |
|---|---|
| URL thường (`anhNguonService.js#taiUrlTho`) | Có — 15s, tự `destroy()` socket khi hết giờ |
| Trang Gemini (`trangWebService.js`, Puppeteer) | Có — `goto()` 20s, `waitForFunction` 8s (tự bắt lỗi) |
| **MinIO (`storageService.js#getObjectStream`)** | **KHÔNG có** |
| **Google Drive (`driveService.js`)** | **KHÔNG có** |

`@aws-sdk/client-s3` và `googleapis` đều KHÔNG tự áp timeout nào cho `send()`/`files.get()`/
`files.list()` trừ khi tự truyền vào. Nếu kết nối tới MinIO (tự host trên NAS) hoặc Google Drive treo
giữa chừng (không lỗi, không phản hồi — khác hẳn 1 lỗi mạng bình thường sẽ tự `throw`), `await` trong
vòng lặp treo VÔ THỜI HẠN: không `throw` nên `try/catch` bên ngoài không bao giờ chạy, `job.trangThai`
kẹt mãi ở `'dang_chay'`, `job.daXong` đứng yên đúng tại đơn đang treo — khớp chính xác với hiện tượng
"570/708, đứng yên, không báo lỗi".

Vì đây là treo tại ĐÚNG 1 ảnh cụ thể (không phải giới hạn theo thời gian), thứ tự xử lý đơn ổn định
giữa các lần chạy lại (cùng danh sách, cùng thứ tự lọc) giải thích vì sao cả 3 lần đều dừng gần cùng 1
vị trí thay vì dừng ngẫu nhiên.

Đáng chú ý: thông báo lỗi có sẵn cho đơn không tính được hash đã ghi "quá thời gian chờ" như 1 lý do
khả dĩ (`routes/orders.js`, biến `donLoiHash`) — nghĩa là timeout vốn đã được tính tới về mặt thiết kế,
chỉ chưa được THỰC SỰ enforce cho 2 trong 3 nguồn ảnh.

## 3. Hướng sửa

Thêm timeout + trả `null` (nuốt lỗi, log ra console) cho cả 2 nguồn còn thiếu — cùng kiểu graceful-
fallback đã dùng sẵn cho URL thường, để phần còn lại của pipeline (đã có sẵn, không đổi) tự coi đây là
"không tải được ảnh" và tiếp tục đơn kế tiếp, thay vì cả lô bị treo vì 1 đơn.

- **`storageService.js`**: thêm hàm MỚI `getObjectBuffer(objectKey, {timeoutMs=20000})` — dùng
  `AbortController` hủy thật sau `timeoutMs`, bọc CẢ 2 giai đoạn (gửi yêu cầu + đọc xong body stream)
  trong cùng 1 hạn chót. KHÔNG sửa `getObjectStream` (vẫn dùng nguyên cho `routes/photos.js` — route đó
  `pipe()` thẳng cho response HTTP, khác hẳn nhu cầu "cần Buffer đầy đủ" của vòng lặp quét hàng loạt;
  sửa chung có thể ảnh hưởng luồng xem ảnh đang chạy tốt).
- **`driveService.js`**: thêm tùy chọn `timeoutMs` (mặc định 20000ms) cho `taiFileDriveTheoId()`, truyền
  xuống như tùy chọn `timeout` GỐC của gaxios/googleapis cho cả `drive.files.get()` lẫn
  `drive.files.list()` (trong `layDsAnhTrongThuMucDrive()`).
- **`anhNguonService.js`**: nhánh MinIO của `taiAnh()` đổi sang gọi `storageService.getObjectBuffer()`
  thay vì tự đọc stream tay — vẫn `try/catch` trả `null` như cũ, không đổi hợp đồng trả về.

20 giây — cao hơn 1 chút so với mức 15s đã dùng cho URL thường (ảnh thiết kế thêu có thể nặng hơn ảnh
web thường), áp dụng đồng nhất cho cả MinIO lẫn Drive.

## 4. Không làm trong lần sửa này

- **Không sửa `perceptualHashService.js` (sharp)** — đã tự xác nhận an toàn cho tính năng này ở 1 lần
  làm việc trước (khác hẳn sự cố sharp cũ ở tính năng viền QR, đã bỏ). sharp chạy CPU-bound (giải mã
  ảnh), không phải I/O mạng — không cùng cơ chế "await không bao giờ tự kết thúc" đã tìm thấy ở
  MinIO/Drive. Nếu quét lại vẫn treo sau bản sửa này, đây là nghi phạm tiếp theo cần điều tra — lúc đó
  sẽ có bằng chứng rõ ràng hơn (treo ở ĐÚNG bước tải ảnh hay bước tính hash) để quyết định hướng sửa.
- **Không gắn việc kiểm tra `job.daHuy` vào giữa lúc đang tải 1 ảnh** — cờ hủy vẫn chỉ được đọc ở ĐẦU
  mỗi vòng lặp (đơn kế tiếp), nghĩa là bấm "Hủy" trong lúc đúng 1 ảnh đang treo có thể chậm tới ~20s mới
  dừng hẳn. Lỗi người dùng báo là "dừng vĩnh viễn", không phải "nút Hủy chậm" — coi đây là vấn đề khác,
  chưa cần sửa cùng lúc.
- **Không sửa `routes/photos.js` (`getObjectStream`, route xem ảnh trực tiếp)** — treo ở đây có dạng
  khác hẳn: người dùng THẤY NGAY (trang không load ảnh), có thể tự tải lại — không phải kiểu "job nền
  kẹt vĩnh viễn, không ai biết" đang sửa ở đây.
- **Không thêm cơ chế tự phục hồi job kẹt (watchdog/heartbeat)** — đã có sẵn `donDepJobHangLoatCu()` dọn
  job cũ sau 15 phút, đủ ngăn hệ quả nặng nhất (kẹt cứng mọi lượt quét sau đó); thêm lớp phục hồi sâu
  hơn là suy đoán cho 1 rủi ro đã được xử lý ở gốc (không còn treo vô thời hạn nữa) thay vì đã xác nhận.

## 5. Đã kiểm tra

- `test-timeout-treo-tai-anh.js` (mới, 7 assertion): mô phỏng ĐÚNG kịch bản treo (promise không bao giờ
  tự resolve/reject, chỉ phản ứng khi bị hủy) cho cả `S3Client.send()` lẫn `drive.files.get()` — xác
  nhận `getObjectBuffer()`/`taiFileDriveTheoId()` kết thúc GẦN với `timeoutMs` đã đặt thay vì treo mãi;
  xác nhận đường thành công (không treo) vẫn trả đúng dữ liệu, không delay thừa; xác nhận `timeoutMs`
  truyền vào được dùng ĐÚNG cho cả file lẻ lẫn danh sách file trong 1 thư mục (không bị bỏ quên/hardcode
  ở 1 trong 2 nhánh).
- Chạy lại toàn bộ ~50 file test scratchpad — không phát sinh lỗi mới, chỉ còn đúng 5 lỗi sẵn có từ
  trước (`test-in-label.js`, `test-quet-bi-tu-choi.js`, `test-rasoat-hang-loat.js`, `test-tam-thoi.js`,
  `test-tracking-auto.js` — không liên quan, đã xác nhận nhiều lần trong phiên làm việc trước) + 1 lỗi
  của `test-cascading-type-size-v3.js` (test cho 1 file Apps Script Google Sheet KHÁC, không liên quan
  webapp này).
- CHƯA kiểm trên hạ tầng MinIO/Google Drive thật (không có quyền truy cập từ môi trường này) — đặc biệt
  CHƯA có bằng chứng trực tiếp (vd log server đúng lúc treo) xác nhận ĐÂY chính xác là nguyên nhân duy
  nhất. Người dùng cần thử quét lại và báo kết quả; nếu vẫn dừng giữa chừng, xem `docker logs` ngay lúc
  đó sẽ cho bằng chứng trực tiếp thay vì tiếp tục suy đoán từ xa.
