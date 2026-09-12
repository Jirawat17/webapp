# Rút gọn trang Chi tiết đơn hàng cho nguoi_san_xuat

Theo yêu cầu người dùng: khi `nguoi_san_xuat` xem chi tiết 1 đơn (từ "Đơn chạy máy của tôi" —
`my-orders.html`, luôn dẫn tới `order.html?stt=...`, trang chi tiết DÙNG CHUNG với mọi vai trò), chỉ
cần thấy Số lượng/Ngày lên đơn/Ghi chú (bôi đậm) để hạn chế thông tin dễ gây nhiễu/bỏ sót thông tin
quan trọng. `admin`/`ve_file` vẫn thấy đầy đủ như hiện tại.

## 1. Xác nhận phạm vi (2 vòng hỏi lại)

**Vòng 1** — trang có 4 phần tách biệt: header (tiêu đề + badge trạng thái), ảnh mẫu/link ảnh, bảng
"thông tin đơn hàng" (14 dòng), "Lịch sử thay đổi", và khu vực thao tác riêng (nút bấm). Câu người dùng
dùng để so sánh với admin/ve_file — "vẫn hiển thị đầy đủ các **trường thông tin**" — khớp đúng khái
niệm bảng thông tin (14 dòng), không phải toàn trang. Người dùng xác nhận: **ẩn khu vực thao tác + ẩn
Lịch sử thay đổi, GIỮ NGUYÊN ảnh/link ảnh** (khác 2 lựa chọn ban đầu tôi đề xuất — người dùng chọn tổ
hợp riêng qua trả lời tự do).

**Vòng 2** — phát hiện rủi ro: khu vực thao tác không chỉ có nút theo kịch bản, còn có khối "Sửa trạng
thái thủ công" — theo đúng comment sẵn có trong code, đây là cách DUY NHẤT để `nguoi_san_xuat` tự đánh
dấu "LỖI SẢN XUẤT CẦN LÀM LẠI" rồi set lại sau khi làm lại (quét QR không có kịch bản nào cho việc
này). Ẩn hẳn sẽ làm mất khả năng tự xử lý lỗi sản xuất. Người dùng xác nhận: **giữ riêng khối "Sửa
trạng thái thủ công", ẩn phần còn lại** của khu vực thao tác.

## 2. Kết quả cuối cùng cho `nguoi_san_xuat`

| Phần | Xử lý |
|---|---|
| Header (tiêu đề, badge trạng thái) | Giữ nguyên |
| Ảnh mẫu + link ảnh (PNG/Mockup/file thêu/đã sản xuất...) | Giữ nguyên |
| Bảng thông tin đơn hàng | Rút còn 3 dòng: **Số lượng**, **Ngày lên đơn**, **Ghi chú** (giá trị bôi đậm `<strong>`) |
| "Lịch sử thay đổi" | Ẩn hoàn toàn |
| Nút chuyển giai đoạn theo kịch bản | Ẩn |
| Ô "Ghi chú xưởng" (textarea sửa GHI_CHU) | Ẩn |
| **"Sửa trạng thái thủ công"** (3 dropdown + nút Lưu) | **Giữ nguyên** — duy nhất còn lại trong khu vực thao tác |
| "IN LABEL"/"MUA TRACKING và IN LABEL" | Ẩn (trước đây san_xuat cũng thấy được, nay bỏ luôn) |
| Các khối admin-only (chỉ định người chạy máy/vẽ file, mua tracking thủ công, ảnh upload) | Không đổi — vốn đã không hiện với san_xuat |

`admin`/`ve_file`: không đổi gì — toàn bộ 14 dòng + Lịch sử + khu vực thao tác đầy đủ như trước.

## 3. Thiết kế `public/order.html`

- Thêm hàm `renderBangThongTin(don, viTri)` — tách nguyên bảng 14 dòng cũ ra khỏi `taiChiTiet()`, rẽ
  nhánh theo `user.vaiTro === 'san_xuat'` trả về đúng 3 dòng (Ghi chú bọc `<strong>`) hoặc đủ 14 dòng.
- `taiChiTiet()`: bỏ class `chi-tiet-layout` (grid 2 cột `1.1fr 0.9fr`) khi là san_xuat — còn đúng 1
  cột con (không còn "Lịch sử thay đổi") nên để plain `<div>` (block, full-width) thay vì grid 2 cột
  còn 1 ô (sẽ để trống nửa bên phải, nhìn lệch). Khối "Lịch sử thay đổi" bọc trong ternary theo vai trò.
- `renderKhuVucThaoTac()`: bọc khối "nút chuyển giai đoạn" + "Ghi chú xưởng" trong
  `if (user.vaiTro !== 'san_xuat')`. Khối "Sửa trạng thái thủ công" giữ NGUYÊN VỊ TRÍ, không nằm trong
  nhánh này. Khối "IN LABEL"/"MUA TRACKING và IN LABEL" thêm điều kiện loại `san_xuat` (trước đó chỉ
  loại `nguoi_lay_phoi`).

## 4. Đã kiểm tra

Test tương tác qua trang mock (script trích NGUYÊN VĂN từ `order.html`, tải kèm `js/icons.js`/`js/api.js`
thật, chỉ override `apiFetch`/`requireLoginOrRedirect`/`renderNav`) qua Browser pane, dựng 1 đơn giả lập
đầy đủ trường, kiểm tra cả 3 vai trò:
- `san_xuat`: bảng thông tin đúng 3 dòng (Số lượng/Ngày lên đơn/Ghi chú), giá trị Ghi chú nằm trong
  `<strong>`; không có heading "Lịch sử thay đổi"; khu vực thao tác KHÔNG có nút chuyển giai đoạn/ô ghi
  chú xưởng/khối IN LABEL nhưng CÓ khối "Sửa trạng thái thủ công"; vẫn có link danh sách ảnh; layout
  container không còn class `chi-tiet-layout` (full width, không để trống nửa trang).
- `admin`: đủ 14 dòng, có "Lịch sử thay đổi", có đủ mọi khối thao tác (kể cả admin-only), layout vẫn
  giữ `chi-tiet-layout`.
- `ve_file`: đủ 14 dòng, có "Lịch sử thay đổi", có nút chuyển giai đoạn/ghi chú xưởng/IN LABEL/ảnh file
  thêu — không bị ảnh hưởng bởi thay đổi dành riêng cho san_xuat.
- Không lỗi console ở cả 3 kịch bản. `node --check` script inline trích từ `order.html`.
- Không có server/Sheet thật trong sandbox — dữ liệu đơn dùng trong test là giả lập tự dựng, không
  phải đơn thật từ Google Sheets.
