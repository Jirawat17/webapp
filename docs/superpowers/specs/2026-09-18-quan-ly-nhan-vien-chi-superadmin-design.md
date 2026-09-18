# Thu hẹp "Quản lý nhân viên" — chỉ superadmin, admin không còn quyền

## 1. Yêu cầu

Sau khi xác nhận superadmin hoạt động đúng (xem
docs/superpowers/specs/2026-09-18-vai-tro-superadmin-design.md): "Chỉ có tài khoản vai trò superadmin
mới có thể xem/sửa thông tin tại menu Nhân viên, tài khoản admin cũng không thể thấy menu Nhân viên."

Đây là NGOẠI LỆ DUY NHẤT trong toàn app — mọi nơi khác admin/superadmin vẫn ngang quyền qua `laAdmin()`
(middleware/auth.js). Chỉ riêng "Quản lý nhân viên" (trang users.html + toàn bộ route routes/users.js)
thu hẹp xuống CHỈ superadmin.

## 2. Vấn đề phát sinh khi thu hẹp — `GET /api/users` dùng ở 5 trang KHÁC

`GET /api/users` (liệt kê đầy đủ, gồm cả MatKhau) không CHỈ phục vụ trang Quản lý nhân viên — nó còn
được 5 trang khác gọi để lấy danh sách nhân viên cho mục đích KHÁC hẳn (không phải "xem/sửa thông tin
nhân viên"):
- `orders.html`, `order.html`, `my-orders.html`, `my-orders-ve-file.html` — đổ ô chọn "Chỉ định người
  chạy máy"/"Chỉ định người vẽ file" (CHỈ cần Ten/VaiTro/KichHoat).
- `hoat-dong.html` — đổ ô chọn "Xem hoạt động của người khác" (CHỈ cần Ten/VaiTro/KichHoat).

Nếu chặn CẢ route `GET /api/users` xuống superadmin-only, 5 tính năng trên (đang hoạt động tốt, admin
vẫn cần dùng hằng ngày) sẽ gãy theo — ngoài phạm vi yêu cầu người dùng, không phải hệ quả mong muốn.

## 3. Giải pháp — tách theo MỤC ĐÍCH, không chỉ theo route

- **`middleware/auth.js`**: thêm `requireExactRole(...roles)` — KHÔNG tự cho admin/superadmin qua như
  `requireRole()` (hàm đó CỐ Ý giữ nguyên hành vi cũ cho MỌI route khác trong app — chỉ route Quản lý
  nhân viên cần hành vi khác).
- **`routes/users.js`**:
  - `GET /`, `POST /`, `PUT /:ten` (toàn bộ CRUD "Quản lý nhân viên", gồm cả MatKhau dạng chữ) — đổi
    từ `requireRole('admin')` sang `router.use(requireExactRole('superadmin'))` — admin bị chặn 403.
  - Thêm route MỚI `GET /tom-tat` — danh sách RÚT GỌN (chỉ Ten/VaiTro/KichHoat, KHÔNG có MatKhau/Team/
    Xuong), đặt TRƯỚC dòng `router.use(requireExactRole(...))` nên KHÔNG bị chặn bởi rào đó — vẫn dùng
    `requireRole()` (mở cho admin/superadmin như trước, đúng nhu cầu của 5 trang kia).
- **5 trang gọi `/users` cho mục đích khác** — đổi sang gọi `/users/tom-tat` (tên trường JSON giữ
  nguyên Ten/VaiTro/KichHoat nên code lọc/hiển thị ở các trang đó không cần đổi gì khác).
- **Frontend**: `public/js/api.js#renderNav()` — tách "Nhân viên" ra khỏi nhánh `if (laAdmin(...))`
  chung, đặt riêng `if (user.vaiTro === 'superadmin')`. `public/users.html` — đổi guard trang từ
  `!laAdmin(user.vaiTro)` sang `user.vaiTro !== 'superadmin'`.

## 4. Không làm trong lần này

- **Không đụng `routes/chatbot.js`'s công cụ `tra_cuu_nhan_vien`** — công cụ AI tra cứu tên/vai trò/
  team/kích hoạt (KHÔNG có MatKhau, vốn đã an toàn) — coi như 1 tính năng KHÁC "menu Nhân viên", giữ
  nguyên `laAdmin()` (admin+superadmin) như trước, cùng logic với 5 trang ở mục 2.
- **Không đổi cách GET /tom-tat lọc theo KichHoat/HienThiDangNhap** — trả về TẤT CẢ nhân viên (không
  lọc KichHoat) đúng như `GET /` gốc từng làm cho các trang đó — các trang tự lọc `KichHoat==='TRUE'`
  ở phía client như trước, không đổi hành vi đang chạy tốt.

## 5. Đã kiểm tra

- `test-quan-ly-nhan-vien-chi-superadmin.js` (mới, 12 assertion): admin bị 403 ở CẢ 3 route Quản lý
  nhân viên (GET/POST/PUT) nhưng VẪN gọi được `/tom-tat` (200, không lộ MatKhau); superadmin gọi được
  cả 3 route CRUD như admin trước đây (thấy cả MatKhau ở GET /); ve_file (vai trò không liên quan) vẫn
  bị chặn ở CẢ 2 nhóm route như trước.
- `test-an-tai-khoan-dang-nhap.js` (đã có từ trước, cập nhật session PUT /users/:ten từ vaiTro='admin'
  sang 'superadmin' cho khớp quyền mới) — toàn bộ 13 assertion pass lại.
- Chạy lại toàn bộ ~50 file test scratchpad — không phát sinh lỗi mới ngoài 21 lỗi đã biết từ trước
  (6 baseline không liên quan + 15 file đang chờ cập nhật theo kiến trúc SQLite từ lần sửa trước đó).
- CHƯA kiểm bằng tài khoản thật trên dữ liệu thật — người dùng cần tự xác nhận: admin không còn thấy
  menu "Nhân viên" VÀ vẫn dùng được "Chỉ định người chạy máy/vẽ file" + "Xem hoạt động của người khác"
  bình thường; superadmin vẫn vào được trang Quản lý nhân viên như trước.
