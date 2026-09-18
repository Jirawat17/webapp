# Thêm vai trò "superadmin" — có mọi quyền admin

## 1. Yêu cầu

Thêm vai trò tài khoản mới `superadmin`, có **mọi quyền admin đang có**. Yêu cầu cụ thể đã xác nhận:

1. Menu "Nhân viên" chỉ admin và superadmin thấy được (vai trò khác không thấy) — rà lại thì mục này
   ĐÃ chỉ dành cho admin từ trước (không vai trò nào khác có), nên chỉ cần đảm bảo superadmin cũng
   được tính vào cùng điều kiện đó.
2. Bất kỳ admin hiện có đều tạo được tài khoản superadmin mới qua "Quản lý nhân viên" — KHÔNG giới hạn
   việc này chỉ cho superadmin (đã hỏi và xác nhận với người dùng).

## 2. Kiến trúc — vì sao KHÔNG alias superadmin thành admin

Cách nhanh nhất để "superadmin có mọi quyền admin" là gán thẳng `req.session.user.vaiTro = 'admin'`
lúc đăng nhập cho tài khoản superadmin — mọi chỗ kiểm tra `vaiTro === 'admin'` tự động đúng, không cần
sửa gì thêm. NHƯNG cách này có 2 nhược điểm:
- Nhật ký hoạt động (`ghiLog`) sẽ ghi "admin" cho MỌI hành động của superadmin — mất khả năng phân
  biệt ai thật sự làm gì.
- Nếu sau này cần tách quyền riêng cho superadmin (tên "super" gợi ý sẽ có lúc cần), phải gỡ alias ra,
  đổi lại từ đầu.

Chọn hướng khác: **giữ `vaiTro: 'superadmin'` là giá trị THẬT trong session** (không alias), và rà +
sửa TOÀN BỘ nơi trong code đang so sánh thẳng chuỗi `'admin'` để dùng chung 1 điểm — hàm
`laAdmin(vaiTro)` (và hằng `VAI_TRO_ADMIN`) khai báo tại `middleware/auth.js` (phía server) và
`public/js/api.js` (phía giao diện, tải sẵn ở mọi trang). Có 1 điểm chung DUY NHẤT nghĩa là về sau
chỉ cần sửa đúng 1 chỗ nếu quy tắc "ai được coi là quản trị" đổi.

`middleware/auth.js#requireRole()` — điểm chốt xác thực dùng ở nhiều route — vốn đã có sẵn cơ chế
"admin luôn qua" (`if (vaiTro === 'admin') return next()`), đổi thành gọi `laAdmin()` là đủ để MỌI
route dùng `requireRole(...)` (`routes/users.js`, `routes/actionCenter.js`, `routes/canhBao.js`,
`routes/taiSan.js`, `routes/donHangLoat.js`) tự động nhận superadmin, không cần sửa từng route.

## 3. Phạm vi đã rà + sửa (toàn bộ chỗ so sánh thẳng `vaiTro === 'admin'` / `!== 'admin'` trong repo)

**Backend:**
- `middleware/auth.js` — thêm `laAdmin()`/`VAI_TRO_ADMIN`, `requireRole()` dùng lại.
- `services/orderService.js` — `locTheoXuong()`, `coQuyenTheoXuong()`, `kiemTraCongAnhBatBuoc()`.
- `services/donHangLoatService.js` — lọc nhóm Đơn hàng loạt theo Xưởng.
- `routes/orders.js` — 6 chỗ (chỉ định người chạy máy/vẽ file, gán Xưởng, đánh dấu ưu tiên, quét hàng
  loạt, danh sách kịch bản kế tiếp).
- `routes/qr.js` — `duocPhepDungKichBan()`.
- `routes/reports.js` — quyền xem log không rõ Xưởng, báo cáo hiệu suất theo người.
- `routes/auth.js` — danh sách "đang hoạt động".
- `routes/chatbot.js` — công cụ tra cứu nhân viên/lịch sử chung, bộ công cụ mở rộng cho quản lý.
- `routes/hoatDong.js` — xem hoạt động của người khác (tham số `nguoiDung`).

**Frontend** (thêm `laAdmin(vaiTro)` dùng chung trong `public/js/api.js`, tải sẵn mọi trang qua
`<script src="/js/api.js">`):
- `public/js/api.js` — `trangChuTheoVaiTro()`, `renderNav()` (chính là nơi quyết định hiện menu
  "Nhân viên" — yêu cầu 1 tự động đúng từ đây).
- `public/orders.html`, `public/order.html`, `public/my-orders.html`, `public/my-orders-ve-file.html`,
  `public/don-hang-loat.html`, `public/reports.html`, `public/hoat-dong.html`, `public/users.html`.
- 2 chỗ (`my-orders.html`, `my-orders-ve-file.html` ×2) có biến cục bộ tên trùng `laAdmin` (kiểu
  `const laAdmin = user.vaiTro === 'admin'`) — đổi tên biến cục bộ thành `dangLaAdmin` để không đè lên
  hàm `laAdmin()` dùng chung mới thêm (nếu không đổi tên, `const laAdmin = laAdmin(...)` sẽ lỗi
  runtime `Cannot access 'laAdmin' before initialization` do quy tắc `const`/TDZ của JS).

**Nhãn hiển thị vai trò** — thêm `superadmin` vào 2 map nhãn có sẵn: `NHAN_VAI_TRO` (api.js, dùng ở
trang Quản lý nhân viên) và `NHAN_VAI_TRO_BDK` (bang-dieu-khien.html, dùng cho danh sách "đang hoạt
động"). Thêm `<option value="superadmin">Superadmin</option>` vào dropdown tạo tài khoản mới
(`public/users.html`).

## 4. Không làm trong lần này

- **Không thêm UI đổi vai trò cho tài khoản ĐÃ tồn tại** — trang Quản lý nhân viên hiện tại KHÔNG có
  chức năng đổi vai trò sau khi tạo (áp dụng cho MỌI vai trò, không riêng superadmin) — muốn "nâng cấp"
  1 admin hiện có lên superadmin, cần tự sửa trực tiếp cột `VaiTro` trong tab `NguoiDung` trên Google
  Sheets. Không phải hạn chế mới do lần sửa này, không mở rộng thêm.
- **Không giới hạn ai được TẠO superadmin** — theo đúng xác nhận của người dùng, bất kỳ admin nào cũng
  tạo được tài khoản superadmin ngang hàng qua Quản lý nhân viên, không thêm rào cản.
- **Không dọn `services/trackingAutoService.js`'s `headers.includes(...)` guard cũ** (không liên quan
  tới superadmin) — ngoài phạm vi lần sửa này.

## 5. Đã kiểm tra

- `test-vai-tro-superadmin.js` (mới, 15 assertion): `laAdmin()` đúng cho mọi vai trò (kể cả
  `undefined`, không throw); `requireRole()` cho superadmin qua giống admin dù không liệt kê trong
  danh sách role; `orderService.locTheoXuong()`/`coQuyenTheoXuong()` cho superadmin thấy/thao tác mọi
  đơn bất kể Xưởng (đối chiếu với ve_file vẫn bị lọc đúng Xưởng như cũ — xác nhận KHÔNG làm rộng quyền
  ngoài ý muốn cho vai trò khác); gọi thật route `POST /orders/gan-xuong` (vốn admin-only) bằng session
  superadmin — không bị 403, thao tác thành công.
- Rà lại toàn bộ repo (grep `vaiTro === 'admin'` / `!== 'admin'`) sau khi sửa — xác nhận CHỈ còn đúng 1
  kết quả duy nhất: định nghĩa hàm `laAdmin()` chính nó, không còn nơi nào so sánh thẳng chuỗi nữa.
- Chạy lại toàn bộ ~50 file test scratchpad — không phát sinh lỗi mới ngoài đúng 21 lỗi đã biết từ
  trước (6 baseline không liên quan + 15 file test đang chờ cập nhật theo kiến trúc SQLite của lần sửa
  18/09/2026 trước đó — xem docs/superpowers/specs/2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md,
  đã có task riêng theo dõi việc này, không liên quan gì tới superadmin).
- CHƯA kiểm được bằng tài khoản superadmin thật trên dữ liệu thật (không có quyền truy cập Sheet/server
  thật từ môi trường này) — người dùng cần tự tạo 1 tài khoản superadmin qua Quản lý nhân viên và thử
  đăng nhập thật để xác nhận toàn bộ menu/thao tác admin đều dùng được, đặc biệt là menu "Nhân viên".
