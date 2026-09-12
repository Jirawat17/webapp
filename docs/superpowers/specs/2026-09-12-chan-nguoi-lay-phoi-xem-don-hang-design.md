# Chặn "Người lấy phôi" xem trang/API Đơn hàng đầy đủ

Theo 2 phát hiện người dùng đưa ra (dạng review), xác nhận cả 2 đều đúng qua đọc code trực tiếp trước
khi sửa.

## 1. Vấn đề

**Phát hiện 1 — redirect sau đăng nhập sai:** `public/index.html#dangNhap()` chuyển MỌI vai trò trừ
`san_xuat` về `/orders.html`, kể cả `nguoi_lay_phoi` — dù menu của vai trò này (`renderNav()` trong
`public/js/api.js`) không có mục "Đơn hàng" (chỉ có Quét QR/SL Phôi/Lịch sử) và trang chính thật sự của
họ là `/scan.html`. Sơ suất từ lúc thêm nhánh riêng cho `san_xuat` (08/09/2026) — quên xét luôn
`nguoi_lay_phoi`.

**Phát hiện 2 — API không lọc theo vai trò:** `GET /api/orders` và `GET /api/orders/:sttKey`
(`routes/orders.js`) không có kiểm tra vai trò nào — `orderService.filterForRole()` chỉ xử lý riêng
`san_xuat`, mọi vai trò khác (kể cả `nguoi_lay_phoi`) rơi vào `return rows` (xem tất cả). Việc ẩn mục
"Đơn hàng" khỏi menu chỉ là ẩn giao diện — biết đường dẫn hoặc bị đưa tới (phát hiện 1) vẫn xem được đầy
đủ danh sách/chi tiết. `nguoi_lay_phoi` trước giờ chỉ thực sự bị chặn ở bước GHI (field whitelist rỗng
trong `PUT /:sttKey`, kiểm tra riêng trong `POST /chuyen-trang-thai-hang-loat`).

## 2. Xác nhận trước khi code

Đã kiểm tra: cả 3 trang thật của `nguoi_lay_phoi` (`scan.html`, `tai-san.html`, `hoat-dong.html`) không
gọi bất kỳ API nào trong `routes/orders.js` — vai trò này không có nhu cầu thật với BẤT KỲ route nào
trong file, kể cả các route chưa bị nêu trong 2 phát hiện trên (`PUT /:sttKey`, `POST
/quet-hang-loat/*`). Người dùng chọn **chặn toàn bộ router** (khuyến nghị, thay vì chỉ vá đúng 2 API bị
nêu) — cùng khuôn `router.use(khongPhaiNguoiLayPhoi)` đã dùng cho `routes/tracking.js`.

## 3. Thiết kế

- **`routes/orders.js`**: thêm middleware `khongPhaiNguoiLayPhoi` ngay sau `router.use(requireLogin)`,
  áp dụng cho CẢ router — trả `403` với thông báo rõ ràng nếu vai trò là `nguoi_lay_phoi`, trước khi
  chạm tới bất kỳ route nào. Bỏ đoạn kiểm tra trùng lặp trong `POST /chuyen-trang-thai-hang-loat` (đã
  thành dead code vì middleware chặn từ trước rồi).
- **`public/js/api.js`**: gộp logic "trang chính theo vai trò" (trước đây có 2 bản gần giống nhau — 1
  trong `renderNav()` cho nút bấm brand/logo, ĐÃ đúng cho cả `nguoi_lay_phoi`; 1 trong `index.html` cho
  redirect sau đăng nhập, THIẾU nhánh `nguoi_lay_phoi`) thành đúng 1 hàm dùng chung
  `trangChuTheoVaiTro(vaiTro)`, tránh 2 nơi lệch nhau lần nữa về sau.
- **`public/index.html`**: `dangNhap()` gọi `trangChuTheoVaiTro(user.vaiTro)` thay vì tự lặp lại logic.

## 4. Đã kiểm tra

- `trangChuTheoVaiTro()` — xác nhận trực tiếp cả 4 vai trò trả đúng URL (`nguoi_lay_phoi` →
  `/scan.html`, `san_xuat` → `/my-orders.html`, `admin`/`ve_file` → `/orders.html`).
- `routes/orders.js` — require thẳng module thật (không mock), kiểm tra `router.stack`: middleware
  `khongPhaiNguoiLayPhoi` có mặt và đứng TRƯỚC toàn bộ 9 route thật trong file. Gọi trực tiếp hàm
  middleware với req/res giả lập: `nguoi_lay_phoi` bị chặn 403 và không gọi `next()`; `admin`/`ve_file`/
  `san_xuat` đều gọi được `next()`, không bị chặn nhầm. 12/12 kịch bản pass.
- `node --check` cho `routes/orders.js`, `public/js/api.js` + script inline trích từ `index.html`.
- Không có Sheet/server thật trong sandbox nên không kiểm tra được phản hồi HTTP thật đầy đủ (status
  code qua request thật) — đã bù bằng cách đọc `router.stack` (Express giữ đúng thứ tự đăng ký) và gọi
  trực tiếp middleware thật thay vì mock lại logic.
