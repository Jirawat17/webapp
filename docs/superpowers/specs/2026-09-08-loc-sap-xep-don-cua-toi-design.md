# Lọc & Sắp xếp tại "Đơn của tôi" — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Bổ sung bộ Lọc (Trạng thái, Tìm theo tên đơn/mã KH, Từ ngày, Đến ngày) và Sắp xếp
(theo thời gian, theo tên đơn hàng) tại `my-orders.html` để người sản xuất tự lọc/sắp xếp danh sách
đơn đang hiển thị.

## Quyết định đã chốt với người dùng

1. **Phạm vi dữ liệu giữ nguyên khoá "Đang chạy máy"** — không mở rộng sang toàn bộ pipeline
   san_xuat. Bộ lọc "Trạng thái" vẫn được thêm theo đúng yêu cầu nhưng chỉ có 1 giá trị khả dụng
   ("Đang chạy máy"), coi như hiển thị cho đủ bộ chứ không có tác dụng lọc thực sự — vì trang này
   theo định nghĩa chỉ tải đơn "Đang chạy máy" (tham số `trangThai` gửi lên server không đổi).
2. **"Sắp xếp theo tên đơn hàng" = sắp theo Mã đơn (STT_Key), A → Z.**

## Thay đổi backend

`routes/orders.js` — `sapXepDon()` chưa có kiểu sắp xếp nào theo STT_Key. Thêm 1 case mới
`'ma_don'`, so sánh bằng `localeCompare('vi')`, tie-break bằng `soSanhNgayTang` giống các case khác
(dù STT_Key vốn là khoá duy nhất nên tie-break gần như không bao giờ xảy ra). Đây là hàm dùng chung
cho cả `/orders` (orders.html lẫn my-orders.html) nên chỉ cần sửa 1 chỗ; KHÔNG thêm option này vào
dropdown "Sắp xếp" của orders.html (không được yêu cầu, giữ thay đổi gọn).

Các tham số lọc còn lại (`kh`, `tuNgay`, `denNgay`, `trangThai`) đã được `GET /orders` hỗ trợ sẵn
(dùng chung bởi orders.html) — my-orders.html chỉ cần build đúng query string, không cần sửa gì thêm
ở backend.

## Thay đổi giao diện — `public/my-orders.html`

Trang này hiện chưa có panel Lọc/Sắp xếp kiểu thu gọn (nút bấm mở/đóng) như orders.html — chỉ có 1 ô
lọc "Người sản xuất" (admin) luôn hiển thị. Vì số trường mới ít (4 lọc + 1 sắp xếp) và để giữ trang
đơn giản đúng quy ước hiện tại của chính file này, KHÔNG import cơ chế panel thu gọn của orders.html
— thêm 1 thanh lọc/sắp xếp luôn hiển thị (`inline-form`), tái dùng đúng các class CSS đã có
(`.truong`, `.truong-rong`, `.truong-ngay`) và đúng hành vi debounce/auto-điền ngày đã có ở
orders.html:

- **Trạng thái**: `<select>` tĩnh, chỉ 1 option "Đang chạy máy" (đã chọn sẵn) — không có `onchange`
  (không có gì để đổi), không gửi riêng lên server (server luôn nhận `trangThai=Đang chạy máy` hardcode
  như hiện tại).
- **Tìm theo tên đơn/mã KH** (`loc-kh`): input text, debounce 400ms, gửi tham số `kh`.
- **Từ ngày** / **Đến ngày** (`loc-tu-ngay` / `loc-den-ngay`): input date, `onchange` tải lại; chọn
  "Từ ngày" mà "Đến ngày" đang trống thì tự điền hôm nay (giống orders.html).
- **Sắp xếp theo** (`sap-xep`): mặc định "Ngày lên đơn — mới nhất trước" (giữ đúng hành vi hiện tại,
  không đổi mặc định), thêm "Ngày lên đơn — cũ nhất trước" và "Mã đơn (STT_Key) — A đến Z".
- Nút **"Xoá bộ lọc"**: reset kh/từ ngày/đến ngày/sắp xếp (và Người sản xuất nếu là admin).
- Ô lọc "Người sản xuất" (admin-only, đã có) chuyển vào chung thanh này (từ `.inline-form` riêng
  thành 1 `.truong` trong thanh chung) — hành vi ẩn/hiện theo vai trò giữ nguyên y hệt.

Không cần cơ chế đổ lại danh sách lựa chọn động (`domLaiOChon`/`capNhatCacBoLocDong`) cho các trường
mới vì tất cả đều tĩnh hoặc tự do (text/date), không phải danh sách giá trị rút ra từ dữ liệu.

Thông báo "danh sách rỗng" mở rộng điều kiện kiểm tra "có đang lọc gì không" để bao gồm cả
kh/tuNgay/denNgay (trước đây chỉ kiểm tra `nguoiVanHanh`).
