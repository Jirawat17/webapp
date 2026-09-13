# Ô quét nhanh "IN LABEL" ở trang Tracking

## 1. Mục tiêu

Thêm 1 ô nhập liệu to, rõ ràng ở đầu trang `public/tracking.html` — gõ/quét mã đơn (STT_Key, cùng mã QR
dùng xuyên suốt quy trình sản xuất) rồi nhấn Enter thì hệ thống gọi luôn API in label GKE cho đúng đơn
đó. Mục đích: trạm đóng gói dùng máy quét mã vạch/QR dạng bàn phím (gõ ký tự + Enter tự động) để in label
liên tục cho nhiều đơn, không cần vào Danh sách đơn hàng chọn từng đơn.

Đã chốt qua hỏi-đáp với người dùng trước khi thiết kế:
- Dữ liệu nhập: **STT_Key** (mã đơn), không phải mã tracking GKE.
- Hành vi khi đơn CHƯA mua tracking: **chỉ báo lỗi**, KHÔNG tự động mua tracking (tránh phát sinh chi phí
  thật ngoài ý muốn nếu quét nhầm mã).
- KHÔNG hỏi xác nhận (`confirm()`) trước mỗi lần in — quét xong in ngay, đúng nhịp trạm quét nhanh.

## 2. Thiết kế

- **Không cần API mới** — `POST /api/tracking/in-label` (đã có, dùng bởi nút "IN LABEL" theo hàng trong
  bảng "Danh sách đơn AUTO_TRACKING") làm chính xác việc cần: nhận `{sttKeys: [sttKey]}`, trả về
  `{loi: [{sttKey, lyDo}]}` nếu lỗi (VD chưa có tracking) hoặc `{labelBase64}` nếu thành công. Trang
  Tracking gọi lại ĐÚNG API này cho đơn bất kỳ (không giới hạn trong danh sách AUTO_TRACKING hiển thị bên
  dưới — khác nút theo hàng hiện có).
- **UI** (`public/tracking.html`): 1 khối mới ngay dưới tiêu đề `<h2>Tracking</h2>`, TRƯỚC cả phần "Tự
  động mua tracking" — vì đây là thao tác dùng thường xuyên nhất, không nên phải cuộn xuống mới thấy.
  Ô input cỡ chữ lớn (~1.4rem, cùng kiểu ô mật khẩu PIN ở `index.html`), có label rõ "Quét/nhập mã đơn để
  in label ngay", autofocus khi vào trang.
- **Luồng xử lý khi nhấn Enter**:
  1. Khoá input (giữ giá trị, disable) trong lúc chờ — chặn quét trùng/gửi đè nếu máy quét gửi ký tự quá
     nhanh hoặc gửi lặp.
  2. Gọi `POST /tracking/in-label` với `{sttKeys: [giá trị vừa nhập]}` (dùng đúng API/luồng đã có, không
     tạo route mới).
  3. Thành công (`labelBase64`): mở hộp thoại in PDF ngay (`moHopThoaiInPdf()` có sẵn trong `js/api.js`,
     y hệt các nút hiện có) + hiện thông báo dạng banner màu xanh, tự ẩn sau vài giây (KHÔNG dùng
     `alert()` — sẽ chặn thao tác quét tiếp theo, ngược với tinh thần "quét liên tục không dừng").
  4. Lỗi (đơn không tồn tại, chưa có tracking...): hiện banner màu đỏ với đúng `lyDo` trả về từ API, tự
     ẩn sau vài giây (cũng KHÔNG dùng `alert()`, cùng lý do).
  5. Dù thành công hay lỗi: xoá trắng + focus lại ô input ngay, sẵn sàng cho lượt quét kế tiếp; đồng thời
     tải lại bảng "Danh sách đơn AUTO_TRACKING" + Logs bên dưới nếu đơn vừa in nằm trong đó (dùng lại
     `taiDanhSach()`/`taiLogs()` có sẵn).
- **Không đổi** `routes/tracking.js` — tái dùng nguyên vẹn endpoint đã có.

## 3. Đã kiểm tra

- Kiểm cú pháp script trong `tracking.html` (trích xuất qua `new Function()`) — OK.
- Kiểm trực tiếp trên trình duyệt qua mock server (`/api/tracking/*`): ô hiện đúng vị trí đầu trang,
  to rõ, tự động focus khi vào trang. Nhập mã đơn ĐÃ có tracking + Enter → gọi đúng
  `POST /tracking/in-label`, hiện banner xanh đúng nội dung, tự mở hộp thoại in PDF (tạo đúng 1 iframe
  ẩn), tự xoá + focus lại ô ngay sau đó. Nhập mã đơn CHƯA có tracking + Enter → hiện banner đỏ đúng
  `lyDo` server trả về, KHÔNG mở hộp thoại in (không tạo iframe mới), input vẫn tự xoá + focus lại — sẵn
  sàng quét tiếp ngay cả khi lỗi.
- Không đụng route/service nào ở backend (tái dùng nguyên `/tracking/in-label` đã có sẵn) nên không cần
  chạy lại bộ test scratchpad phía server — không có gì để hồi quy.
- Ghi chú: công cụ giả lập phím bấm trong sandbox trình duyệt không gửi đúng sự kiện `keydown` như bàn
  phím/máy quét thật — đã xác minh logic bằng cách tự phát sự kiện `KeyboardEvent('keydown', {key:
  'Enter'})` trực tiếp, đúng cơ chế mà `index.html` (ô mật khẩu PIN) cũng đang dùng và đã chạy ổn định.
