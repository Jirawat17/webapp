# Ẩn tài khoản khỏi màn hình đăng nhập công khai

## 1. Mục tiêu

Màn hình đăng nhập (`public/index.html`) hiện hiện MỌI nhân viên đang kích hoạt (`KichHoat=TRUE`) thành
1 nút bấm công khai (`GET /auth/danh-sach`, không cần đăng nhập). Người dùng muốn 1 vài tài khoản đặc
biệt (VD admin) KHÔNG hiện thành nút ở đây nữa — nhưng chủ tài khoản đó vẫn đăng nhập được bình thường
qua 1 cách khác, không công khai.

Đã xác nhận với người dùng qua hỏi-đáp trước khi thiết kế:
- Ẩn CỐ ĐỊNH khỏi TOÀN BỘ danh sách công khai (không phải ẩn khác nhau theo từng máy/nhóm xem).
- Cách vào tài khoản ẩn: 1 trang đăng nhập RIÊNG, không có bất kỳ liên kết/dấu vết nào từ trang chính —
  người dùng tự lưu bookmark trang riêng đó trên máy của mình.
- Chấp nhận được nếu tài khoản ẩn đó không đặt mật khẩu (gõ đúng tên là vào) — nhưng KHÔNG bắt buộc,
  vẫn có thể đặt mật khẩu như bình thường nếu muốn thêm 1 lớp bảo vệ.

**Giới hạn đã nói rõ với người dùng:** đây là "không hiện công khai", không phải "không thể vào được" —
ai biết đúng URL trang riêng + đúng tên tài khoản (+ mật khẩu nếu có đặt) vẫn đăng nhập được, khớp đúng
mức bảo mật hiện tại của app (mật khẩu PIN 4 số, lưu thô trong Sheet — xem
`docs/superpowers/specs/2026-09-07-mat-khau-dang-nhap-design.md`).

## 2. Thiết kế

- **Dữ liệu**: thêm cột mới `HienThiDangNhap` vào tab `NguoiDung` (Google Sheet, người dùng tự thêm cột
  này — sandbox không có quyền sửa Sheet thật). Để TRỐNG = vẫn hiện như hiện tại (không ảnh hưởng tài
  khoản cũ); admin đặt `FALSE` cho tài khoản muốn ẩn.
- **`routes/auth.js` — `GET /danh-sach`**: lọc bỏ user có `HienThiDangNhap` đúng bằng `'FALSE'` (so sánh
  không phân biệt hoa/thường, giống `KichHoat`) khỏi mảng trả về. CHỈ ảnh hưởng danh sách hiển thị nút —
  không đụng gì tới `POST /dang-nhap` (vẫn nhận MỌI tài khoản `KichHoat=TRUE`, không quan tâm cột mới).
- **`routes/users.js` — `PUT /:ten`**: thêm `HienThiDangNhap` vào danh sách field admin được phép cập
  nhật (hiện có `VaiTro, Team, Xuong, KichHoat, MatKhau`). Thêm guard kiểm tra cột đã tồn tại trong
  Sheet chưa (giống guard `MatKhau` ở `POST /` hiện có) — báo lỗi rõ ràng thay vì để `updateCells()` ném
  lỗi chung chung, vì cột này người dùng phải tự thêm tay.
- **`public/users.html`**: thêm 1 cột "Đăng nhập" + nút "Ẩn khỏi đăng nhập"/"Hiện lại" cho từng dòng,
  giống hệt khuôn nút "Khoá"/"Mở lại" của `KichHoat` đã có (`doiHienThi()` cạnh `doiKichHoat()`).
- **Trang đăng nhập riêng mới `public/dang-nhap-phu.html`** (tên file có thể đổi tuỳ ý sau, không ảnh
  hưởng logic): không có liên kết từ BẤT KỲ trang nào trong app trỏ tới (kể cả `index.html`) — chỉ có ô
  nhập Tên (text tự do) + ô nhập Mật khẩu (hiện luôn, để trống nếu tài khoản không đặt mật khẩu) + nút
  Đăng nhập, gọi thẳng `POST /auth/dang-nhap` (API có sẵn, không đổi gì). Không gọi `GET /auth/danh-sach`
  (không cần danh sách tên ở đây).
- **`public/index.html`**: không đổi gì — không thêm bất kỳ liên kết/gợi ý nào tới trang riêng ở trên.

## 3. Đã kiểm tra

- Viết test mới (`test-an-tai-khoan-dang-nhap.js`, 13 test, gọi thẳng `routes/auth.js`/`routes/users.js`
  thật qua HTTP, mock `sheetsService`): `GET /danh-sach` lọc đúng (ẩn tài khoản `HienThiDangNhap=FALSE`,
  giữ nguyên tài khoản để trống/`TRUE`, không đụng logic `KichHoat` sẵn có); `POST /dang-nhap` vẫn đăng
  nhập được cả 2 tài khoản ẨN (1 không mật khẩu, 1 có mật khẩu — đúng/sai mật khẩu đều đúng kỳ vọng);
  `PUT /:ten` đổi được `HienThiDangNhap` khi Sheet đã có cột, báo lỗi 400 rõ ràng khi Sheet CHƯA có cột
  (và KHÔNG chặn nhầm việc đổi field khác như `KichHoat` khi thiếu cột này).
- Chạy lại toàn bộ ~30 file test scratchpad — 25 pass, 5 fail sẵn có từ trước (không liên quan, đã xác
  nhận qua session trước).
- Kiểm trực tiếp trên trình duyệt qua mock server: trang `users.html` hiện đúng cột "Đăng nhập" +
  nút Ẩn/Hiện, bấm đổi trạng thái đúng; `index.html` (công khai) KHÔNG còn hiện tài khoản đã ẩn, không
  còn dấu vết/liên kết nào tới trang riêng; `dang-nhap-phu.html` đăng nhập thành công vào tài khoản ẩn
  (cả trường hợp đúng tên+không mật khẩu, và đúng tên+đúng mật khẩu), báo lỗi rõ ràng khi sai mật khẩu.
- Chưa kiểm được với Google Sheet thật (sandbox không có quyền) — người dùng cần tự thêm cột
  `HienThiDangNhap` vào tab `NguoiDung` trước khi dùng; để trống cho tài khoản hiện có sẽ không ảnh
  hưởng gì (vẫn hiện như cũ).
