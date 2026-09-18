# Ẩn thông tin Xưởng của đơn hàng với riêng vai trò admin

## 1. Bối cảnh

Tiếp nối `2026-09-18-quan-ly-nhan-vien-chi-superadmin-design.md`: người dùng yêu cầu thu hẹp thêm —
tài khoản admin không còn được thấy trường thông tin **Xưởng** (HN/BN — cột `XUONG` của đơn hàng, đổi
tên từ HANOI/BACNINH 13/09/2026) ở BẤT KỲ menu nào. Chỉ duy nhất superadmin còn thấy được.

**Lưu ý phân biệt quan trọng**: "Xưởng" ở đây là cột `XUONG` (đơn hàng thuộc xưởng vật lý nào — dùng
để phân chia quyền xem/thao tác giữa nhân viên 2 xưởng, xem `locTheoXuong`/`coQuyenTheoXuong`). **KHÁC
HẲN** cột `TRANG_THAI_XUONG` ("trạng thái xưởng" — tiến trình sản xuất chung: Chưa in mã/Đang chạy
máy/Đã sản xuất...), không nằm trong phạm vi thay đổi này.

## 2. Phạm vi — CHỈ ẨN HIỂN THỊ, KHÔNG đổi quyền truy cập đơn

`locTheoXuong()`/`coQuyenTheoXuong()` (quyết định admin/superadmin xem/thao tác được MỌI đơn bất kể
Xưởng, vai trò khác chỉ đúng 1 Xưởng của mình) **giữ nguyên không đổi** — admin vẫn xem/sửa được mọi
đơn như trước. Thay đổi lần này chỉ ẩn việc **hiển thị giá trị `XUONG`** và **thao tác gán Xưởng** với
riêng admin. Vai trò khác (ve_file, san_xuat...) không đổi gì.

## 3. Thay đổi

- **`middleware/auth.js`** — thêm `laSuperAdmin(vaiTro)` (== `'superadmin'`), điểm DUY NHẤT trong toàn
  app admin/superadmin không ngang quyền nhau (mọi nơi khác vẫn dùng `laAdmin()`).
- **`public/js/api.js`** — thêm bản tương ứng ở client.
- **`services/orderService.js`** — thêm `anXuongVoiAdmin(row, vaiTro)` /
  `anXuongNhieuDonVoiAdmin(rows, vaiTro)`: xoá field `XUONG` khỏi object trả về CHỈ khi `vaiTro ===
  'admin'` (trả về bản sao, không mutate). Áp dụng ở:
  - `routes/orders.js` GET `/` (danh sách) và GET `/:sttKey` (chi tiết) — trước `res.json(...)`.
  - `routes/donHangLoat.js` GET `/` — mỗi đơn trong `nhoms[].donHang[]` (route này trả kèm `XUONG` per
    đơn để hỗ trợ lọc; GET `/goi-y` KHÔNG cần vì response của route đó vốn không có field này).
- **`routes/orders.js` POST `/gan-xuong`** — quyền thu hẹp từ `laAdmin()` xuống `laSuperAdmin()`.
- **Frontend** (`public/orders.html`, `public/order.html`, `public/don-hang-loat.html`):
  - `orders.html`: badge "Xưởng" trên thẻ đơn, ô lọc "Xưởng", khối "Gán Xưởng" → điều kiện hiện đổi từ
    `laAdmin(user.vaiTro)` sang `laSuperAdmin(user.vaiTro)`. Tách riêng khỏi khối admin gốc (vẫn giữ
    "Chỉ định người chạy máy/vẽ file", "Mua tracking thủ công", "Đơn ưu tiên" — KHÔNG đổi, vẫn admin).
  - `order.html`: dòng "Xưởng" trong bảng chi tiết → ẩn khi `user.vaiTro === 'admin'` (KHÔNG dùng
    `laSuperAdmin()` làm điều kiện HIỆN vì ve_file cũng cần thấy — chỉ admin bị loại trừ riêng).
  - `don-hang-loat.html`: ô lọc "Xưởng" → `laAdmin()` → `laSuperAdmin()`.

## 4. Đã kiểm tra

- `test-an-xuong-voi-admin.js` (mới, 12 assertion): `laSuperAdmin()` đúng/sai cho từng vai trò;
  `anXuongVoiAdmin`/`anXuongNhieuDonVoiAdmin` xoá đúng field cho admin, giữ nguyên cho superadmin/
  ve_file, không mutate object gốc.
- `test-xuong-orders-routes.js` (đã có từ trước, cập nhật `testGanXuong()`): thêm assertion admin bị
  chặn 403, đổi 3 lượt gọi thành công sang session superadmin (khớp quyền mới).
- `test-giam-luot-doc-hang-loat.js` (đã có từ trước, cập nhật `testGanXuong()`): đổi session sang
  superadmin — test này đo hiệu năng đọc (1 lần/lô), không phải test phân quyền, nên chỉ cần tránh bị
  403 chặn trước khi đo.
- Sweep toàn bộ ~65 file test scratchpad: xác nhận danh sách file FAIL giữ đúng NGUYÊN baseline đã biết
  (23 file, cùng nhóm SQLite-migration debt + không liên quan webapp, xem
  `2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md` mục 6) — KHÔNG có lỗi mới nào ngoài đúng 1 lượt
  phát hiện sớm (`test-giam-luot-doc-hang-loat.js`, đã sửa ở trên).

## 5. Không làm trong lần sửa này

- Không đổi `locTheoXuong`/`coQuyenTheoXuong` (quyền truy cập đơn theo Xưởng) — chỉ ẩn hiển thị.
- Không dọn 23 file test-debt còn tồn đọng (không liên quan tính năng này, đã có task riêng theo dõi).
