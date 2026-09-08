# Trạng thái "Đang vẽ file" + chỉ định người vẽ file — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Thêm trạng thái "Đang vẽ file" cho cột Vẽ file; thêm nút cho admin chỉ định người vẽ
file cho tài khoản ve_file.

## Bối cảnh — vì sao đây là bản NÂNG CẤP, không phải làm lại từ đầu

Tính năng "Đơn của tôi (Vẽ file)" (2026-09-08, xem
docs/superpowers/specs/2026-09-08-don-cua-toi-ve-file-design.md) đã có sẵn nút tự nhận + nút admin chỉ
định người vẽ file — NHƯNG lúc đó `TRANG_THAI_VE_FILE` chỉ có 2 giá trị nên "tự nhận" chỉ ghi thẳng
cột `NGUOI_VE_FILE`, không đổi trạng thái (khác hẳn "Đang chạy máy" của san_xuat, vốn là 1 trạng thái
thật). Giờ người dùng thêm "Đang vẽ file" thành trạng thái thật thứ 3 — thiết kế được NÂNG CẤP để
"Nhận vẽ file"/"Chỉ định người vẽ file" giờ THỰC SỰ chuyển `TRANG_THAI_VE_FILE` sang "Đang vẽ file",
dùng lại NGUYÊN VẸN cơ chế đã có sẵn cho NGUOI_CHAY_MAY thay vì giữ route riêng — đơn giản hơn hẳn bản
trước.

## Thay đổi cốt lõi

- `data/pipelineTinhTrang.js`: `TRANG_THAI_VE_FILE_VALUES` = `['Chưa vẽ file', 'Đang vẽ file', 'Đã vẽ
  file']`.
- `services/orderService.js`:
  - `kiemTraTinhHopLy`: đơn "Chưa in mã" giờ bắt buộc vẽ file phải ĐÚNG "Chưa vẽ file" (trước chỉ chặn
    "Đã vẽ file") — không ai được "đang vẽ file" cho đơn còn chưa in mã.
  - Thêm hook tự stamp `NGUOI_VE_FILE` khi `TRANG_THAI_VE_FILE` chuyển sang "Đang vẽ file" từ 1 giá trị
    khác — sao chép Y HỆT hook `NGUOI_CHAY_MAY` đã có (giữ nguyên nếu người gọi đã tự truyền
    `NGUOI_VE_FILE`, xoá `GHI_CHU_VE_FILE` cũ nếu là lượt tự nhận mới).
- `routes/orders.js`:
  - XOÁ route `POST /orders/nhan-ve-file` (không cần nữa) — "Nhận vẽ file" giờ gọi thẳng route chung
    `/orders/chuyen-trang-thai-hang-loat` (cot='TRANG_THAI_VE_FILE', trangThaiMoi='Đang vẽ file'),
    đúng y hệt cách san_xuat tự nhận "Đang chạy máy".
  - `/orders/chi-dinh-nguoi-ve-file`: ghi thêm `TRANG_THAI_VE_FILE: 'Đang vẽ file'` (trước chỉ ghi
    NGUOI_VE_FILE/GHI_CHU_VE_FILE, không đổi trạng thái).
  - `lamGiauDon()`: `NguoiVeFile` giờ CHỈ trả về khi `TRANG_THAI_VE_FILE === 'Đang vẽ file'` (đúng
    khuôn `NguoiVanHanh`) — đơn đã "Đã vẽ file" hoặc reset về "Chưa vẽ file" (vd sau lỗi sản xuất) sẽ
    không còn hiện "ai đang vẽ" nữa, dù cột thật trong Sheet vẫn giữ giá trị cũ làm dấu vết.
  - Bỏ cờ lọc `chuaNhanVeFile` (nay dư thừa — "Chưa vẽ file" giờ CHỈ còn đúng nghĩa "chưa ai nhận", vì
    nhận việc đã chuyển hẳn sang "Đang vẽ file"). Giữ nguyên cờ `canVeFile` (vẫn cần, không so khớp
    được bằng bộ lọc so khớp chính xác có sẵn).
- `public/my-orders-ve-file.html`:
  - "Đơn cần vẽ file": bớt tham số `chuaNhanVeFile` khỏi query (đã dư thừa).
  - Nút "Nhận vẽ file": đổi sang gọi `/orders/chuyen-trang-thai-hang-loat`.
  - "Đơn vẽ file của tôi": đổi query từ `canVeFile=1&nguoiVeFile=X` sang
    `trangThaiVeFile=Đang vẽ file&nguoiVeFile=X` (dùng thẳng bộ lọc so khớp chính xác có sẵn, không cần
    cờ riêng nữa).
- `public/orders.html`, `public/order.html`, `public/js/api.js`: thêm "Đang vẽ file" vào các dropdown
  lọc/sửa tay hiện có (`loc-ve-file`, `sua-ve-file`) và bảng màu badge (`MAU_TRANG_THAI`, dùng chung
  màu "trang-thai-info" như "Đang chạy máy").

## Chỉ tiêu ở "Hoạt động của tôi"/Báo cáo — KHÔNG cần đổi

"Số file đã vẽ" đã tính theo lượt CHUYỂN SANG ĐÚNG "Đã vẽ file" (không quan tâm có đi qua "Đang vẽ
file" hay không) — không bị ảnh hưởng bởi trạng thái trung gian mới này.

## Việc người dùng cần làm thủ công

Không cần thêm cột Sheet nào (NGUOI_VE_FILE/GHI_CHU_VE_FILE đã có từ tính năng trước) — chỉ cần code.
