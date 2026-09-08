# Ai đang hoạt động + khối lượng đang xử lý (Bảng điều khiển) — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Bổ sung vào Bảng điều khiển để biết ai đang đăng nhập vào hệ thống, và số lượng
công việc đang xử lý (vd: ve_file đang phải vẽ bao nhiêu file, san_xuat đang phải chạy máy bao nhiêu
đơn).

## "Đang đăng nhập" nghĩa là gì — không đọc thẳng session store

Session dùng `express-session` với store mặc định (MemoryStore) và cookie sống 30 ngày
(server.js) — nếu đọc thẳng session store để liệt kê "ai đang đăng nhập", danh sách sẽ đầy "ma": ai
đó đăng nhập cả tháng trước, đóng tab, không đăng xuất, vẫn nằm trong store cho tới khi server restart
hoặc cookie hết hạn thật sự. Ngoài ra `routes/auth.js` cũng không có endpoint nào liệt kê TOÀN BỘ
session (`/hien-tai` chỉ trả session của chính người gọi).

Thay vào đó, thêm `services/presenceService.js` — một Map trong bộ nhớ (`ten -> {vaiTro, luc}`), ghi đè
mỗi khi người đó có 1 request bất kỳ tới server (middleware đặt ngay sau session trong server.js, áp
dụng cho mọi route). "Đang hoạt động" = có request trong 5 phút gần nhất — lọc tại lúc đọc
(`layDangHoatDong(nguongPhut=5)`), không cần dọn Map theo lịch riêng. Mất dữ liệu khi restart server —
chấp nhận được, cùng đánh đổi với `_lanSaiMatKhau` (chống dò PIN) đã có sẵn trong chính file
routes/auth.js.

Route mới `GET /auth/dang-hoat-dong` — chặn thật ở server (401 chưa đăng nhập, 403 không phải admin,
cùng khuôn với `/reports/hieu-suat-theo-nguoi`), vì danh sách ai đang online cũng là thông tin nhân sự
nhạy cảm, không chỉ ẩn ở giao diện.

## Khối lượng đang xử lý — không cần route mới, dữ liệu đã có sẵn trên trang

"Đang phải chạy máy/vẽ file bao nhiêu đơn" là đếm theo TRẠNG THÁI hiện tại của đơn (Đang chạy máy /
Đang vẽ file), KHÁC với khối "Khối lượng công việc cả xưởng" đã có (đếm việc ĐÃ XONG trong 1 kỳ) — 2
chỉ số bổ sung cho nhau chứ không trùng. `bang-dieu-khien.html` đã tải `/orders` (dùng đếm cảnh báo
Vàng/Cam/Đỏ) và mỗi đơn đã có sẵn field tính toán `NguoiVanHanh`/`NguoiVeFile` (routes/orders.js —
chỉ khác rỗng khi đơn đúng đang ở trạng thái "Đang chạy máy"/"Đang vẽ file") — nên chỉ cần đếm nhóm
theo 2 field này ở client, KHÔNG thêm lệnh gọi API nào.

Cố tình KHÔNG gắn với danh sách "đang hoạt động": máy có thể vẫn đang chạy dù người vận hành rời màn
hình (không đăng nhập/thao tác gì thêm) — 2 khái niệm độc lập, hiển thị thành 2 khối riêng.

## Giao diện — 2 thẻ mới, ngay dưới hàng KPI cảnh báo

- **"Đang hoạt động ngay bây giờ"**: danh sách người (chấm xanh nhấp nháy nhẹ) + vai trò + giờ hoạt
  động cuối; với san_xuat/ve_file kèm luôn số việc đang xử lý ngay trong dòng phụ (vd "Sản xuất · đang
  chạy máy 3 đơn") — trả lời cả 2 vế câu hỏi gốc trong 1 chỗ nhìn.
- **"Khối lượng đang xử lý"**: danh sách xếp hạng theo số lượng giảm dần, gộp cả 2 loại việc (Đang
  chạy máy / Đang vẽ file), tái dùng nguyên style `.bdk-xep-hang-item` đã có ở khối "Top người làm
  việc nhiều nhất" — không tạo class mới ngoài 1 chấm trạng thái (`.bdk-dot-xanh`) và dòng giờ nhỏ
  (`.bdk-lan-cuoi`).

Cả 2 thẻ đều là ảnh chụp NGAY LÚC XEM, không theo bộ chọn kỳ (Hôm nay/Tuần này/...) — cùng nguyên tắc
đã áp dụng cho khối cảnh báo trễ hạn.
