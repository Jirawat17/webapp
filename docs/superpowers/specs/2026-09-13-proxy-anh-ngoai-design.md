# Proxy hiển thị ảnh NGOÀI (Drive/Gemini/link công khai cũ)

Sau khi đổi ưu tiên ảnh đại diện sang PNG (`DUONG_DAN_URL`, xem commit trước), người dùng phát hiện 1
đơn cụ thể (`9SON78,1`) có link PNG nhưng KHÔNG hiện ảnh đại diện dù link vẫn mở được bình thường khi
bấm trực tiếp.

## 1. Nguyên nhân

Link đó là link chia sẻ Google Drive kiểu cũ (`drive.google.com/file/d/{id}/view`). Trình duyệt KHÔNG
tải được link này trực tiếp làm `<img src>` — nó trả về 1 trang xem trước HTML, không phải file ảnh
thật — nên `<img onerror="this.remove()">` tự xoá thẻ ảnh, hiện ra như "không có ảnh nào" dù dữ liệu
Sheet hoàn toàn hợp lệ. Vấn đề này áp dụng cho MỌI đơn có ảnh dạng link Drive cũ (và tương tự với link
chia sẻ Gemini — trang dựng bằng JS, càng không thể tải trực tiếp).

Phát hiện quan trọng: hệ thống **đã có sẵn** toàn bộ logic đọc đúng các loại link này —
`services/anhNguonService.js#taiAnh()` (dùng `driveService.js`/`trangWebService.js`) — nhưng CHỈ dùng
cho tính năng "IN ĐƠN" (tạo PDF ở server qua `routes/reports.js`), chưa từng phục vụ hiển thị trực tiếp
trên trình duyệt. Ảnh MỚI (tải qua nút Upload) không gặp vấn đề vì đã chuyển hẳn sang MinIO + có sẵn
route proxy riêng (`GET /api/photos/file/*`, xem `storageService.js`) để trình duyệt tải được.

## 2. Quyết định thiết kế

Đã trao đổi 3 hướng khắc phục — người dùng chọn: **thêm route proxy dùng lại đúng
`anhNguonService.taiAnh()` + cache, KHÔNG ghi lại URL vào Sheet** (loại bỏ hướng "tự động chuyển ảnh
lên MinIO" vì người dùng không cho phép sửa URL trong Sheet qua đường này).

- Route MỚI `GET /api/photos/anh-ngoai?url=<link gốc>` (`routes/photos.js`, cùng `requireLogin` với
  các route ảnh khác trong file) — gọi `anhNguonService.taiAnh(url)` (ĐÚNG hàm IN ĐƠN đang dùng, xử lý
  cả Drive/Gemini/MinIO/HTTP thường trong 1 chỗ, không viết lại logic nhận diện nguồn ảnh), nhận diện
  Content-Type qua magic bytes, trả thẳng bytes ảnh.
- **Cache trong bộ nhớ tiến trình** (`Map`, KHÔNG phải Redis/disk — đủ dùng cho quy mô đội hiện tại,
  mất khi restart server, ảnh vẫn tải lại được bình thường): TTL 6 giờ, tối đa 100 ảnh, loại ảnh LÂU
  KHÔNG ĐƯỢC XEM LẠI NHẤT khi vượt ngưỡng (LRU dùng thứ tự chèn tự nhiên của `Map`) — tránh lặp lại vấn
  đề tốn quota như đã gặp với Google Sheets API trước đó, đồng thời không để bộ nhớ phình vô hạn.
  KHÔNG chia sẻ cache này với `routes/reports.js` (IN ĐƠN) — 2 tính năng độc lập, không cần ghép chung.
- Header `Cache-Control: private, max-age=3600` — trình duyệt tự cache thêm 1 lớp nữa, giảm cả request
  lặp lại tới chính server này trong 1 phiên xem của cùng 1 người.

## 3. Client — `public/js/api.js#urlAnhHienThi(rawUrl)`

Hàm dùng CHUNG cho mọi nơi hiển thị ảnh đại diện đơn:

```js
function urlAnhHienThi(rawUrl) {
  if (!rawUrl) return '';
  const duongDan = String(rawUrl).replace(/^https?:\/\/[^/]+/, '');
  if (duongDan.startsWith('/api/photos/file/')) return rawUrl;
  return '/api/photos/anh-ngoai?url=' + encodeURIComponent(rawUrl);
}
```

URL MinIO (`/api/photos/file/...`, đã tự tải trực tiếp được) giữ nguyên, KHÔNG vòng qua proxy — tránh 1
lượt qua server vô ích. MỌI url khác (Drive, Gemini, HTTP thường như Etsy...) đều vòng qua proxy —
CHỦ Ý không đoán riêng "URL này có phải Drive không" ở client (trùng lặp logic nhận diện đã có sẵn ở
server trong `taiAnh()`), chấp nhận việc ảnh HTTP thường (vốn có thể tải thẳng được) cũng đi qua 1 lượt
proxy — đơn giản hơn, nhất quán hơn, và vẫn được hưởng cache.

Áp dụng ở đúng những chỗ đã sửa ưu tiên PNG/Mockup trước đó — `public/orders.html`, `public/order.html`,
`public/my-orders.html`, `public/my-orders-ve-file.html` — chỉ đổi phần dựng `<img src>`, KHÔNG đổi các
link tải/xem ảnh dạng `<a href>` (những link đó vẫn mở được bình thường khi bấm trực tiếp, không cần
qua proxy).

## 4. Kiểm thử

- `routes/photos.js` (module thật, mock `anhNguonService.taiAnh()`): thiếu/sai tham số `url` -> 400;
  tải thành công (PNG/JPEG, nhận diện đúng Content-Type qua magic bytes) -> 200 kèm Cache-Control;
  `taiAnh()` trả `null`/ném lỗi -> 502, không crash; cache đúng — gọi lại CÙNG url không gọi lại
  `taiAnh()`, url KHÁC vẫn gọi bình thường; cache hết hạn đúng theo TTL 6 giờ (giả lập `Date.now()`);
  cache LRU đúng — nạp đủ 100 ảnh rồi thêm ảnh thứ 101 loại đúng ảnh cũ nhất, ảnh còn lại trong cache
  vẫn không bị tải lại. Tổng 22 kịch bản.
- `urlAnhHienThi()` (trích nguyên văn từ `public/js/api.js`, chạy thuần Node — hàm không phụ thuộc
  DOM): rỗng/null, URL MinIO tương đối/tuyệt đối giữ nguyên, URL Drive/HTTP thường qua proxy đúng định
  dạng, URL có `&`/`=` bên trong encode/decode khôi phục đúng nguyên bản. Tổng 7 kịch bản.
- Trình duyệt thật (mock dựng từ đúng `renderDanhSachDon()` thật, không gõ lại): xác nhận `<img src>`
  cuối cùng đúng — link Drive được viết lại thành `/api/photos/anh-ngoai?url=...` (encode đúng), link
  MinIO giữ nguyên không bị proxy chồng proxy.
- KHÔNG kiểm tra được (giới hạn sandbox — không có Google Drive/MinIO credentials thật ở đây): việc
  `driveService.js` thực sự tải được bytes ảnh thật từ Drive API. Logic gọi `taiAnh()` đã được tái sử
  dụng NGUYÊN VẸN từ tính năng IN ĐƠN đang chạy production, chỉ mock ở lớp test — rủi ro thấp nhưng cần
  người dùng tự xác nhận trên môi trường thật sau khi triển khai.

## 5. Cập nhật cùng ngày — hiển thị TỐI ĐA 2 ảnh/đơn (link THƯ MỤC Drive)

Sau khi `9SON78,1` (link file đơn lẻ) hiện đúng, người dùng phát hiện thêm 2 đơn (`9U115`, `9U121.2`)
vẫn KHÔNG hiện ảnh — 2 đơn này dán link **THƯ MỤC** Drive (`drive.google.com/drive/folders/{id}`),
không phải link file đơn lẻ (`/file/d/{id}/view`) như `9SON78,1`. `taiAnh()` (hàm lấy ĐÚNG 1 ảnh, dùng ở
mục 2) không nhận diện được link thư mục — chỉ `taiDsAnh()` (đã có sẵn, lấy TẤT CẢ ảnh trong thư mục,
dùng cho tính năng "hàng loạt") mới xử lý đúng. Nhân dịp này, người dùng yêu cầu thêm: đơn có NHIỀU hơn
1 ảnh trong thư mục thì hiển thị **TỐI ĐA 2 ảnh** làm ảnh đại diện (nhiều hơn 2 vẫn chỉ lấy 2 ảnh đầu).

**Thiết kế lại route** — đổi từ "trả 1 ảnh" sang "trả 1 ảnh theo `index` (0 hoặc 1) trong danh sách tối
đa 2 ảnh của 1 url":

- `services/driveService.js#layDsAnhTrongThuMucDrive(url, { gioiHan })` — thêm tuỳ chọn `gioiHan`, CẮT
  danh sách file CÒN TRƯỚC KHI TẢI (không phải sau) — nơi chỉ cần 2 ảnh đầu thì KHÔNG tải thừa cả thư
  mục (có thể tới 50 ảnh) rồi bỏ phần dư, tránh lãng phí lượt gọi Drive API + băng thông. Không truyền
  = giữ nguyên hành vi cũ (tải hết), các nơi gọi cũ (`routes/reports.js` IN ĐƠN, `routes/orders.js` quét
  hàng loạt) không đổi gì.
- `services/anhNguonService.js#taiDsAnh(url, { gioiHan })` — chỉ thêm việc truyền `gioiHan` xuống hàm
  trên, tương thích ngược hoàn toàn.
- `routes/photos.js GET /anh-ngoai?url=...&index=0|1` — gọi `taiDsAnh(url, {gioiHan:2})`, cache **CẢ
  MẢNG** (tối đa 2 ảnh) theo `url` (không phải theo từng `index` riêng) — 2 lượt gọi `index=0`/`index=1`
  của CÙNG 1 đơn dùng chung ĐÚNG 1 lượt tải thật. Thêm **gộp yêu cầu trùng lúc** (`_dangTaiAnhNgoai`,
  cùng kỹ thuật `gopYeuCauTrung()` đã có ở `sheetsService.js`) — vì `index=0` và `index=1` của CÙNG 1
  đơn LUÔN được trình duyệt gọi gần như đồng thời (2 thẻ `<img>` cùng lúc), nếu không gộp sẽ tải trùng
  y hệt vấn đề "cache stampede" đã gặp với Google Sheets. `index` không tồn tại (vd đơn chỉ có 1 ảnh
  thật) -> 404, để `<img onerror="this.remove()">` tự ẩn thẻ đó — client KHÔNG cần hỏi trước "có bao
  nhiêu ảnh".
- `public/js/api.js#urlAnhHienThi()` -> đổi tên **`urlAnhHienThiList()`**, trả về MẢNG (0-2 phần tử)
  thay vì 1 chuỗi: ảnh MinIO luôn mảng 1 phần tử (giữ nguyên, không có khái niệm nhiều ảnh); ảnh khác
  LUÔN trả 2 phần tử (`...&index=0`, `...&index=1`) — client không phân biệt trước "url này có phải
  thư mục không", cứ thử đủ 2 vị trí, vị trí thừa tự biến mất nếu không có ảnh thật.
- CSS: `.order-card .nhom-anh-dai-dien` (danh sách đơn) và `.nhom-anh-mau` (chi tiết đơn) — khung bọc
  1-2 `<img>`, mỗi ảnh `flex:1` tự chia đều bề rộng khung. 1 ảnh thì chiếm trọn (hệt bố cục cũ, KHÔNG
  đổi gì với đơn chỉ có 1 ảnh), 2 ảnh thì chia đôi — không cần biết trước là 1 hay 2 ảnh mới tính được
  kích thước, code JS/CSS dùng chung 1 khuôn cho cả 2 trường hợp.

**Kiểm thử bổ sung**: `layDsAnhTrongThuMucDrive` với `gioiHan` (không đổi hành vi cũ khi không truyền;
có `gioiHan` thì đúng số lượt tải file thật giảm theo, không tải thừa; thư mục ít hơn giới hạn vẫn đúng;
link file đơn lẻ vẫn trả `null` dù có `gioiHan`); route `/anh-ngoai` với `index` (mặc định 0; thư mục 2
ảnh trả đúng từng ảnh theo `index`; chỉ 1 ảnh thật thì `index=1` trả 404 không crash; lỗi nguồn hoàn
toàn trả 404 không crash; **2 yêu cầu đồng thời `index=0`/`index=1` cho CÙNG url chỉ gọi `taiDsAnh()`
ĐÚNG 1 LẦN** — kịch bản quan trọng nhất, xác nhận gộp yêu cầu hoạt động đúng); cache TTL/LRU theo `url`
(không đổi so với thiết kế cũ, chỉ đổi đơn vị cache từ "1 ảnh" sang "mảng ảnh"). `urlAnhHienThiList()`
(trích nguyên văn) cho cả 2 trường hợp MinIO/khác. Trình duyệt thật xác nhận: đơn link thư mục ra ĐÚNG
2 thẻ `<img>` với `src` đúng định dạng `?index=0`/`&index=1`; đơn MinIO vẫn ĐÚNG 1 thẻ như cũ; layout
CSS đúng — khung 72×72 (danh sách)/full-width (chi tiết) chia đều khi có 2 ảnh, giữ nguyên kích thước
khi chỉ có 1 ảnh (không có đơn nào bị đổi bố cục ngoài ý muốn).
