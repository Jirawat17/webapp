# Chuyển quản lý tài khoản (tab NguoiDung) sang SQLite

## 1. Bối cảnh

Người dùng yêu cầu không cần quản lý tài khoản qua Google Sheets nữa — mọi thông tin tài khoản (tên,
vai trò, team, Xưởng, mật khẩu PIN, trạng thái kích hoạt, ẩn/hiện khỏi màn hình đăng nhập) chuyển hẳn
sang SQLite, cùng tinh thần `2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md` (chuyển cột app-ghi
của đơn hàng sang SQLite) nhưng ở đây là CẮT HẲN phụ thuộc Sheets cho riêng tab `NguoiDung`, không chỉ
tách 1 phần cột.

**Khác biệt quan trọng so với lần chuyển trước**: lần trước người dùng chấp nhận "không migrate dữ
liệu cũ, đơn cũ trắng trạng thái" vì hậu quả chỉ là mất trạng thái hiển thị. Ở ĐÂY KHÔNG thể áp dụng
tương tự — bảng tài khoản trắng đồng nghĩa KHÔNG AI đăng nhập được. Vì vậy bắt buộc có bước migrate dữ
liệu cũ, và có cảnh báo rõ ràng nếu quên chạy.

## 2. Kiến trúc

- **`services/taiKhoanService.js`** (mới) — bảng SQLite `nguoi_dung(Ten TEXT PRIMARY KEY, VaiTro,
  Team, Xuong, KichHoat, MatKhau, HienThiDangNhap)`, file riêng `data/tai_khoan.db` (khác
  `trang_thai_don.db` — miền dữ liệu khác hẳn: tài khoản/đăng nhập so với trạng thái đơn hàng), cùng
  nằm trong `data/` đã có volume mount sẵn (docker-compose.yml), không cần đổi hạ tầng. API: `layTatCa`,
  `layTheoTen` (đọc), `themMoi` (throw nếu trùng Ten — nơi gọi tự kiểm tra trước), `capNhat` (ghi 1
  phần, CHỈ áp dụng cho tài khoản đã tồn tại — nơi gọi tự trả 404 nếu chưa có).
- **`routes/auth.js`** — `GET /danh-sach`, `POST /dang-nhap` đọc thẳng `taiKhoanService`, bỏ hẳn
  `readTabCached('NguoiDung', ...)`. Không cần cache nữa (SQLite đọc tại chỗ, không tốn round-trip
  Google Sheets API).
- **`routes/users.js`** — toàn bộ `GET /tom-tat`, `GET /`, `POST /`, `PUT /:ten` chuyển sang
  `taiKhoanService`. Bỏ 2 guard "Sheet chưa có cột MatKhau/HienThiDangNhap" — khái niệm "cột chưa tồn
  tại" chỉ có ý nghĩa với Sheets (schema tự do); SQLite có schema cố định, LUÔN đủ cột.
- **5 call site khác đọc `readTabCached('NguoiDung', ...)`** để validate/tra cứu nhân viên (không phải
  trang Quản lý nhân viên) — chuyển sang `taiKhoanService.layTatCa()`:
  - `routes/orders.js` — `/chi-dinh-nguoi-chay-may`, `/chi-dinh-nguoi-ve-file`.
  - `routes/hoatDong.js` — `/cua-toi` (validate tham số `nguoiDung` khi admin xem hoạt động người khác).
  - `routes/chatbot.js` — tool `tra_cuu_nhan_vien`.
  - `routes/reports.js` — `/loi-theo-nguoi-chuyen` (map Ten→Team) và `/hieu-suat-theo-nguoi`.

## 3. Migrate dữ liệu cũ — BẮT BUỘC, khác lần trước

- **`scripts/migrate-nguoi-dung-tu-sheets.js`** (mới) — đọc tab `NguoiDung` thật từ Sheets, copy từng
  tài khoản CHƯA có (theo Ten) vào SQLite. **Idempotent** — chạy lại nhiều lần an toàn, tài khoản đã có
  trong SQLite được BỎ QUA (không ghi đè dù Sheets đã đổi giá trị sau đó — SQLite là nguồn thật DUY
  NHẤT kể từ lần migrate đầu). Dry-run mặc định (chỉ liệt kê), `--apply` mới ghi thật — cùng khuôn
  `scripts/migrate-trang-thai-v*.js` đã có.
- **Cảnh báo tự động khi quên chạy** — `taiKhoanService.js#canhBaoNeuChuaMigrate()` chạy lúc module
  khởi động VÀ mỗi lần `layTatCa()` thấy bảng vẫn trống, in cảnh báo TO ra console server kèm đúng lệnh
  cần chạy. KHÔNG tự động đọc lại Sheets làm fallback (giữ đơn giản, đúng tinh thần "tách hẳn khỏi
  Sheets" người dùng yêu cầu) — chỉ cảnh báo LOUD để không ai phải đoán "vì sao không đăng nhập được".

### Trình tự deploy (người dùng cần làm — KHÔNG tự động)

1. Deploy code có tính năng này.
2. Chạy `node scripts/migrate-nguoi-dung-tu-sheets.js` (không `--apply`) để xem trước danh sách.
3. Chạy lại với `--apply` để ghi thật vào SQLite — làm TRƯỚC khi có ai cần đăng nhập lại.
4. Từ đó quản lý tài khoản hoàn toàn qua trang Quản lý nhân viên (SQLite) — Sheets tab `NguoiDung` có
   thể giữ lại làm lưu trữ/tham khảo, app không đọc/ghi vào đó nữa.

## 4. Không làm trong lần sửa này

- Không mã hoá mật khẩu PIN — giữ đúng đánh đổi đã thống nhất trước đây (admin/superadmin xem/nhắc lại
  PIN quên cho nhân viên).
- Không tự động migrate lúc server khởi động (fallback đọc Sheets nếu bảng trống) — chọn cảnh báo rõ
  + script thủ công thay vì cơ chế tự động phức tạp hơn, giảm rủi ro migrate sai lặng lẽ.
- Không xoá tab `NguoiDung` khỏi Sheets thật — để nguyên, người dùng tự dọn sau nếu muốn.

## 5. Đã kiểm tra

- `test-tai-khoan-service.js` (mới, 12 assertion): CRUD cơ bản, cập nhật 1 phần không mất dữ liệu cũ,
  lọc field lạ, tên không tồn tại không tạo dòng rác, chuẩn hoá null/undefined → chuỗi rỗng.
- `test-dang-nhap-sqlite.js` (mới, 9 assertion): `GET /danh-sach` lọc đúng KichHoat/HienThiDangNhap,
  `POST /dang-nhap` — sai PIN/tài khoản khoá/chưa có PIN/ẩn khỏi danh sách vẫn đăng nhập trực tiếp được.
- `test-migrate-nguoi-dung.js` (mới, 9 assertion, spawn tiến trình con thật): dry-run không ghi gì,
  `--apply` ghi đúng, chạy lại lần 2 KHÔNG tạo trùng/KHÔNG ghi đè tài khoản đã migrate (idempotent).
- `test-quan-ly-nhan-vien-chi-superadmin.js` (đã có, viết lại để dùng SQLite thật `:memory:` thay vì
  mock Sheets): 16 assertion, thêm kiểm tra ghi/đọc thật (không chỉ status code).
- `test-an-tai-khoan-dang-nhap.js` (đã có, viết lại tương tự, BỎ phần test guard "Sheet chưa có cột" —
  không còn kịch bản nào kích hoạt được guard đó): 12 assertion.
- `test-giam-luot-doc-hang-loat.js`, `test-xuong-tracking-users-dashboard.js` (đã có, cập nhật mock từ
  `sheetsService`/`readTabCached('NguoiDung')` sang `taiKhoanService`): pass lại đầy đủ phần liên quan.
- Sweep toàn bộ ~68 file test scratchpad: đúng NGUYÊN baseline 23 file đã biết (SQLite-migration debt +
  không liên quan webapp) — KHÔNG có lỗi mới nào ngoài các lượt phát hiện sớm đã sửa ở trên.

## 6. Giới hạn đã xác nhận với người dùng

Môi trường phát triển này KHÔNG có kết nối Google Sheets/service-account thật — KHÔNG thể tự chạy
`scripts/migrate-nguoi-dung-tu-sheets.js --apply` với dữ liệu tài khoản THẬT để xác nhận trước khi
deploy. Người dùng cần tự chạy script này trên VPS (nơi có `.env`/`service-account.json` thật) theo
đúng trình tự ở mục 3, và xác nhận đăng nhập được cả admin/superadmin sau khi deploy.
