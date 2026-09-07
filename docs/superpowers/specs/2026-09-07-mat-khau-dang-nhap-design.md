# Mật khẩu (PIN 1-4 số) cho tài khoản đăng nhập

## Bối cảnh

Đăng nhập hiện tại (`routes/auth.js`, `public/index.html`) chỉ cần bấm chọn tên trong danh sách nhân
viên đang hoạt động — không có bước xác thực nào khác. Cần thêm mật khẩu dạng PIN (1-4 chữ số) để
giảm rủi ro ai đó bấm nhầm/cố ý chọn tên đồng nghiệp đăng nhập hộ.

Đã thống nhất với người dùng các quyết định quan trọng:
- **Không mã hoá** — lưu thẳng chuỗi số trong Sheet (đánh đổi có chủ ý: admin xem/nhắc lại được PIN
  cho nhân viên quên, đổi lại ai xem được Sheet cũng biết hết PIN).
- **Tài khoản cũ chưa đặt mật khẩu vẫn đăng nhập được bằng tên như hiện tại** (tạm thời, cho đến khi
  admin đặt mật khẩu cho từng người) — KHÔNG khoá đồng loạt ngay khi triển khai.
- **Tài khoản MỚI tạo từ nay bắt buộc phải có mật khẩu.**
- **Chống dò PIN:** sai quá 10 lần liên tục cho 1 tài khoản → khoá thử đăng nhập tài khoản đó 1 phút
  (tự mở lại).

## Thay đổi

### 1. Sheet — cột mới `MatKhau` (tab `NguoiDung`)

Người dùng tự thêm cột này trên Google Sheet trước khi dùng (đúng quy ước dự án — các cột mới đều do
người dùng tự thêm tay). Giá trị rỗng = chưa đặt mật khẩu (tài khoản cũ, đăng nhập bằng tên).

### 2. `routes/auth.js`

- `GET /danh-sach`: trả thêm `coMatKhau: !!r.MatKhau` cho mỗi nhân viên (KHÔNG bao giờ trả giá trị
  mật khẩu thật) — để `index.html` biết có cần hiện ô nhập PIN hay không trước khi thử đăng nhập.
- `POST /dang-nhap`: nhận thêm `matKhau` (tuỳ chọn).
  - Tìm tài khoản đang hoạt động theo `ten` như cũ — không thấy → 404 như cũ.
  - Kiểm tra khoá tạm (xem mục 3) — đang khoá → 429 kèm số giây còn lại.
  - Nếu tài khoản CÓ `MatKhau` (khác rỗng): bắt buộc `matKhau` gửi lên khớp CHÍNH XÁC (so sánh
    chuỗi). Sai → tăng bộ đếm sai, đủ 10 lần thì khoá 1 phút, trả lỗi 401 "Sai mật khẩu".
  - Nếu tài khoản KHÔNG có `MatKhau` (rỗng): đăng nhập ngay như hiện tại, bỏ qua `matKhau` dù có
    gửi lên hay không.
  - Đăng nhập thành công: xoá bộ đếm sai của tài khoản đó (nếu có).

### 3. Chống dò PIN — bộ đếm trong bộ nhớ (không cần bảng mới)

`Map` tương tự mô hình job hàng loạt đã có (`_congViecHangLoat` ở `routes/orders.js`): `ten -> {soLanSai, khoaDenLucNao}`. Mất khi restart server — chấp nhận được (không cần bền vững qua khởi động lại).

### 4. `routes/users.js` — quản lý mật khẩu

- `POST /` (tạo nhân viên): nhận thêm `matKhau`, **bắt buộc** — thiếu hoặc sai định dạng (không phải
  chuỗi 1-4 chữ số) → 400. Ghi vào cột `MatKhau` của dòng mới.
- `PUT /:ten`: thêm `MatKhau` vào danh sách cột được phép sửa (cùng `VaiTro`/`Team`/`KichHoat`) —
  dùng để admin ĐẶT/ĐẶT LẠI mật khẩu cho nhân viên (kể cả tài khoản cũ chưa từng có). Validate cùng
  định dạng 1-4 chữ số nếu có truyền.

### 5. `public/users.html` — giao diện quản lý

- Form "Thêm nhân viên": thêm ô "Mật khẩu (tối đa 4 số)" — `inputmode="numeric"`, `maxlength="4"`,
  `pattern="[0-9]{1,4}"`, bắt buộc.
- Bảng danh sách: thêm cột "Mật khẩu" hiện "Đã đặt"/"Chưa đặt" (không hiện giá trị thật) + nút "Đặt
  mật khẩu" mở `prompt()` nhập PIN mới, gọi `PUT /users/:ten`.

### 6. `public/index.html` — luồng đăng nhập

- `/auth/danh-sach` giờ trả thêm `coMatKhau` — vẫn hiện danh sách nút tên như cũ.
- Bấm 1 tên:
  - `coMatKhau === false` → đăng nhập ngay như hiện tại.
  - `coMatKhau === true` → hiện khối nhập PIN (input số, `maxlength="4"`) + nút "Đăng nhập" + nút
    "Quay lại" (về danh sách tên) — submit gửi `{ten, matKhau}`. Lỗi (sai PIN/tài khoản đang khoá) →
    `alert()`, giữ nguyên ô nhập để thử lại.

## Không đổi

- `middleware/auth.js`, phiên đăng nhập (`req.session.user`) — không đụng gì, chỉ đổi BƯỚC xác thực
  trước khi tạo phiên.
- Không thêm trang "quên mật khẩu" tự phục vụ — admin reset tay qua trang Quản lý nhân viên (đúng mô
  hình hiện tại, không có luồng tự đăng ký/tự phục vụ nào khác trong hệ thống).
