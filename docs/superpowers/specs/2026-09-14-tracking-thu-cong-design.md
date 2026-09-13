# Ô "Tracking thủ công" ở trang Tracking

## 1. Mục tiêu

Bổ sung cho tính năng tự động cập nhật trạng thái tracking (xem
`docs/superpowers/specs/2026-09-14-cap-nhat-trang-thai-tracking-design.md`, chạy nền mỗi 4 tiếng,
không hiện gì trên giao diện) — người dùng muốn thêm cách TRA CỨU THỦ CÔNG cho 1 đơn cụ thể, thấy kết
quả NGAY trên trang Tracking, đồng thời vẫn cập nhật Google Sheet như lượt tự động.

Đã chốt qua hỏi-đáp: 1 ô nhập (gõ/quét mã đơn) — giống hệt khuôn ô "Quét/nhập mã đơn để in label ngay"
đã có trên cùng trang — KHÔNG phải 1 nút chạy hàng loạt cho mọi đơn cùng lúc.

## 2. Thiết kế

- **`services/trackingAutoService.js`** — đổi return của `capNhatTrangThaiTrackingChoDon()` (hàm ĐÃ có
  từ tính năng tự động) từ `null`/sự kiện thô sang `{ok:false, lyDo}` / `{ok:true, suKien}` — để phân
  biệt được RÕ LÝ DO khi không có gì để ghi (thiếu cột / GKE chưa có sự kiện / không tìm thấy đơn) thay
  vì chỉ biết chung chung "không có gì mới". Cập nhật lại đúng 1 nơi gọi cũ (`chayQuetCapNhatTrangThaiTracking`,
  chỉ cần đổi `if (ketQua)` → `if (ketQua.ok)`) — hàm này mới thêm ở tính năng trước, chỉ có đúng 1
  nơi gọi nên đổi shape an toàn, không ảnh hưởng gì khác.
- **`routes/tracking.js`** — route mới `POST /cap-nhat-trang-thai-thu-cong`, CÙNG khuôn `/mua-thu-cong`
  đã có (nhận `sttKeys` mảng, chặn khác Xưởng qua `orderService.coQuyenTheoXuong`, lỗi 1 đơn rơi vào
  `loi[]` không dừng cả lượt) — khác ở chỗ trả THÊM `trangThai`/`thoiGian`/`diaDiem` cho mỗi đơn thành
  công (lấy từ `suKien.track_name`/`actual_time`/`location`) để giao diện hiện được ngay, không chỉ biết
  thành công/thất bại.
- **`public/tracking.html`** — khối mới `.tk-o-tracking-thu-cong` ngay dưới ô "IN LABEL": input + label,
  cỡ chữ VỪA PHẢI (1.1rem, không phóng to 4 lần như ô IN LABEL — đó là thao tác lặp liên tục ở trạm đóng
  gói, còn đây là tra cứu từng đơn khi cần). Khác ô IN LABEL:
  - CHỈ nhận Enter (không nhận thêm phím Space) — không phải thao tác quét mã vạch lặp lại.
  - Banner kết quả KHÔNG tự ẩn sau vài giây — người dùng cần đọc kỹ trạng thái/thời gian/địa điểm tra
    được, không chỉ liếc qua biết thành công/thất bại như ô IN LABEL.
  - KHÔNG autofocus khi vào trang — ô IN LABEL vẫn là thao tác dùng thường xuyên nhất, giữ nguyên vị trí
    autofocus duy nhất trên trang.
  - Thành công thì gọi lại `taiDanhSach()` để bảng "Danh sách đơn AUTO_TRACKING" bên dưới (nếu đơn vừa
    tra nằm trong đó) cũng cập nhật theo.

## 3. Đã kiểm tra

- Test route mới (`test-tracking-thu-cong-route.js`, 13 test, mock `trackingAutoService`/`orderService`
  — không gọi GKE/Sheet thật): trả đúng `trangThai`/`thoiGian`/`diaDiem` khi thành công; chặn đúng đơn
  khác Xưởng và đơn chưa có `TRACKING_ID`; chuyển tiếp đúng `lyDo` khi `capNhatTrangThaiTrackingChoDon`
  trả `{ok:false}`; bắt được lỗi throw (GKE từ chối) mà không sập route; nhiều đơn cùng lúc thì lỗi 1
  đơn không chặn các đơn còn lại; mảng rỗng báo đúng 400.
- Cập nhật lại `test-cap-nhat-trang-thai-tracking.js` (test cũ của tính năng tự động) khớp đúng shape
  `{ok, lyDo|suKien}` mới — 19/19 pass lại sau khi sửa.
- Kiểm cú pháp script trong `tracking.html` (trích qua `new Function()`) — OK.
- Kiểm trực tiếp trên trình duyệt qua mock server: nhập mã đơn có tracking + Enter → hiện đúng banner
  xanh với trạng thái/thời gian/địa điểm, banner KHÔNG tự ẩn sau 5 giây (khác ô IN LABEL); nhập mã đơn
  chưa có tracking + Enter → hiện đúng banner đỏ với lý do; gõ phím Space vào ô này KHÔNG kích hoạt gì
  (khác ô IN LABEL) — xác nhận đúng thiết kế.
- Chạy lại toàn bộ ~30 file test scratchpad — không phát sinh lỗi mới (5 lỗi sẵn có từ trước, đã xác
  nhận nhiều lần trong phiên làm việc này, không liên quan).
