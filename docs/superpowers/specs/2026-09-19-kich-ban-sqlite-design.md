# Chuyển "Kịch bản" quét QR (CauHinhKichBan) sang SQLite + trang quản lý mới

## 1. Bối cảnh

Tiếp nối việc rà soát các bảng còn lại (`NhatKyQuetHangLoat`, `LogsTracking` đã xác nhận đã migrate
đầy đủ ở Giai đoạn 1 — xem `2026-09-19-nhat-ky-sqlite-design.md`, không còn tham chiếu Sheets nào).
`CauHinhKichBan` là bảng CHƯA từng được chuyển — cấu hình các "kịch bản" hiện ra khi quét mã QR (đơn
cần trạng thái nào mới quét được, chuyển sang trạng thái nào sau khi quét, vai trò nào được dùng).

**Khác 6 tab đã chuyển trước đó**: bảng này KHÔNG có bất kỳ trang quản lý nào trong app — cách DUY
NHẤT để thêm/sửa kịch bản từ trước tới giờ là mở Google Sheet, sửa tay tab `CauHinhKichBan`. Vì vậy
trước khi migrate, đã hỏi và xác nhận với người dùng: **xây hẳn 1 trang quản lý mới trong web app**
(thay vì chỉ đọc từ SQLite, để trống việc chỉnh sửa cho DB Browser).

## 2. Kiến trúc

**`services/kichBanDbService.js`** (mới) — 1 file `data/kich_ban.db`, bảng `cau_hinh_kich_ban`
(id tự tăng, `Ten_Kich_Ban` UNIQUE — khớp đúng cách `slugHoa(Ten_Kich_Ban)` định danh 1 kịch bản trong
`scenarioService.js`, `Trang_Thai_Yeu_Cau`, `Trang_Thai_Sau`, `Cot`, `Nguoi_Thuc_Hien`). CRUD thật
(`layTatCa`, `layTheoId`, `layTheoTen`, `themMoi`, `capNhat`, `xoa`) — khác các bảng trước, đây LÀ bảng
được thiết kế để CRUD qua giao diện web ngay từ đầu.

**`services/scenarioService.js`** — `layDanhSachKichBan()`/`timKichBanTheoId()` đọc `kichBanDbService`
thay vì `readTabCached('CauHinhKichBan', 60000)`, **giữ nguyên 100% hình dạng trả về** (id=slug, label,
column, requireStatus, setStatus, allowedRoles) — mọi nơi tiêu thụ (`routes/qr.js`, `routes/orders.js`)
không cần sửa gì.

**`routes/kichBan.js`** (mới, mount tại `/api/kich-ban`) — CRUD, **CHỈ admin/superadmin**
(`requireRole()` không tham số — kịch bản ảnh hưởng TOÀN BỘ luồng quét QR hệ thống, không mở rộng cho
ve_file như "Đơn hàng loạt"/"Tracking"). Validate: bắt buộc `Ten_Kich_Ban`/`Trang_Thai_Sau`, `Cot` chỉ
nhận 1 trong 3 giá trị hợp lệ hoặc rỗng, trùng tên trả lỗi thân thiện (không lộ lỗi SQLite thô).

**`public/kich-ban.html`** (mới) — trang quản lý: form thêm/sửa (dùng chung 1 form, nút "Sửa" nạp lại
dữ liệu vào form + đổi thành "Cập nhật") + bảng liệt kê kèm nút Sửa/Xoá, theo đúng khuôn
`public/users.html`. Thêm nav link "Kịch bản quét" (CHỈ admin/superadmin, cạnh Tracking) trong
`public/js/api.js#renderNav()`.

## 3. Migrate dữ liệu hiện có — bắt buộc (dữ liệu đang sống)

**`scripts/migrate-kich-ban-tu-sheets.js`** (mới) — đọc Sheets, chỉ migrate dòng có đủ
`Ten_Kich_Ban`+`Trang_Thai_Sau` (đúng điều kiện lọc app đang dùng). Idempotent theo `Ten_Kich_Ban`,
MẶC ĐỊNH bỏ qua kịch bản SQLite đã có (không mất chỉnh sửa làm qua trang quản lý mới); `--force`: cập
nhật NỘI DUNG theo Sheets nhưng GIỮ NGUYÊN `id` cũ (không xoá-tạo-lại, tránh phá liên kết log/tham
chiếu nếu có).

### Trình tự deploy

1. Deploy code.
2. `node scripts/migrate-kich-ban-tu-sheets.js` (xem trước) → `--apply` (ghi thật) — làm TRƯỚC khi có
   ai cần quét QR (thiếu bước này: không còn kịch bản nào để chọn khi quét).
3. Từ đó quản lý kịch bản hoàn toàn qua trang "Kịch bản quét" mới — Sheet `CauHinhKichBan` có thể giữ
   lại làm lưu trữ, app không đọc/ghi vào đó nữa.

## 4. Không làm trong lần sửa này

- Không đụng `routes/orders_old.js` (file mồ côi, không mount ở `server.js`, đã xác nhận từ trước).
- Không thêm validate "Trạng thái yêu cầu/sau phải là 1 trong các giá trị pipeline hợp lệ" — giữ dạng
  text tự do như Sheets cũ, tránh phạm vi vượt quá yêu cầu migrate lần này.

## 5. Đã kiểm tra

- `test-kich-ban-sqlite.js` (mới, 16 assertion): CRUD, ràng buộc UNIQUE trên `Ten_Kich_Ban`,
  `scenarioService.js` qua SQLite thật (lọc đúng điều kiện, mặc định Cot/allowedRoles).
- `test-kich-ban-routes.js` (mới, 17 assertion): chỉ admin/superadmin dùng được, validate đầu vào,
  trùng tên → lỗi thân thiện, CRUD đầy đủ qua HTTP.
- `test-migrate-kich-ban.js` (mới, 9 assertion, spawn tiến trình con thật): dry-run, `--apply` bỏ dòng
  thiếu Trang_Thai_Sau, idempotent không ghi đè, `--force` ghi đè giữ nguyên id.
- Sweep toàn bộ ~78 file test scratchpad (21 file có tham chiếu `scenarioService`/kịch bản — đều mock
  trực tiếp `services/scenarioService.js` nên không bị ảnh hưởng bởi thay đổi tầng dưới): đúng nguyên
  baseline 23 file đã biết trước đó, không phát sinh lỗi mới.
