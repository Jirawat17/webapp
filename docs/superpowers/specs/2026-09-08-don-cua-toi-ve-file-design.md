# "Đơn của tôi (Vẽ file)" — menu mới cho ve_file — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Tạo 1 menu mới "Đơn của tôi_Vẽ File" cho ve_file, tính năng tương tự "Đơn của tôi"
của san_xuat nhưng hướng tới người vẽ file. Admin cũng xem/thao tác được.

## Quyết định đã chốt với người dùng

1. **Đầy đủ như san_xuat** — thêm cột Sheet mới `NGUOI_VE_FILE` (+ `GHI_CHU_VE_FILE`) để theo dõi ai
   đang/đã nhận vẽ file, có tự nhận + admin chỉ định người vẽ + mục riêng "đơn tôi đã nhận".
2. **Tên menu:** "Đơn của tôi (Vẽ file)".

## Khác biệt cấu trúc dữ liệu so với san_xuat — vì sao KHÔNG chép y nguyên thiết kế cũ

San_xuat có 1 trạng thái RIÊNG kéo dài "Đang chạy máy" ngay trong cột pipeline chính
(TRANG_THAI_XUONG) — tự nhận = CHUYỂN trạng thái đó, và chính việc chuyển trạng thái này kích hoạt
sẵn hook tự stamp NGUOI_CHAY_MAY trong `orderService.update()`.

Vẽ file KHÔNG có bước "đang làm dở" — `TRANG_THAI_VE_FILE` chỉ có 2 giá trị cố định ("Chưa vẽ
file"/"Đã vẽ file"), không đổi khi ai đó "nhận" việc. Vì vậy:
- "Nhận vẽ file" (tự nhận) = ghi `NGUOI_VE_FILE = tên người thao tác`, **KHÔNG đổi**
  `TRANG_THAI_VE_FILE` (vẫn "Chưa vẽ file" — chỉ đánh dấu ai đang phụ trách).
- Không cần thêm hook tự động nào trong `orderService.update()` — 2 route mới (bên dưới) tự ghi
  thẳng `NGUOI_VE_FILE` khi được gọi, không cần suy luận từ 1 chuyển đổi trạng thái nào.
- Đánh dấu XONG việc vẫn dùng lại nguyên route `chuyen-trang-thai-hang-loat` có sẵn
  (cot='TRANG_THAI_VE_FILE', trangThaiMoi='Đã vẽ file') — không đổi gì `NGUOI_VE_FILE` khi đánh dấu
  xong (giữ làm dấu vết lịch sử ai đã vẽ).

### Định nghĩa đúng "Đơn cần vẽ file" — có tính cả trường hợp LÀM LẠI

Rà `data/pipelineTinhTrang.js` phát hiện: khi 1 đơn bị "LỖI SẢN XUẤT CẦN LÀM LẠI", hệ thống reset
`TRANG_THAI_PHOI`/`TRANG_THAI_VE_FILE` về "chưa" NHƯNG **giữ nguyên** TRANG_THAI_XUONG ở chính giá
trị lỗi đó (không quay lại "Đã in mã"). Nếu lọc cứng theo đúng `TRANG_THAI_XUONG = 'Đã in mã'` sẽ BỎ
SÓT các đơn cần làm lại file! Theo `kiemTraTinhHopLy` (services/orderService.js), `TRANG_THAI_VE_FILE
= 'Chưa vẽ file'` chỉ có thể đi cùng 1 trong 3 giá trị TRANG_THAI_XUONG: "Chưa in mã" (chưa tới lượt,
chưa sẵn sàng), "Đã in mã" (trường hợp thường), hoặc "LỖI SẢN XUẤT CẦN LÀM LẠI" (làm lại). Vậy điều
kiện ĐÚNG và ĐỦ cho "cần vẽ file" là: `TRANG_THAI_VE_FILE = 'Chưa vẽ file' VÀ TRANG_THAI_XUONG !=
'Chưa in mã'` — không cần liệt kê cứng danh sách giá trị, tự đúng cả khi sau này có thêm nhánh lỗi
khác được miễn trừ khỏi `kiemTraTinhHopLy`.

Vì phép lọc này không map được vào các tham số lọc chung hiện có của `GET /orders` (chỉ hỗ trợ so
khớp CHÍNH XÁC 1 giá trị/cột, không hỗ trợ "khác giá trị X"), thêm 1 cờ lọc chuyên biệt mới
`canVeFile=1` ở server — đúng tiền lệ cờ `hangLoat=1` đã có (lọc theo điều kiện riêng, không phải so
khớp giá trị cột). Thêm cờ thứ 2 `chuaNhanVeFile=1` (lọc `!NGUOI_VE_FILE`) và tham số `nguoiVeFile`
(so khớp chính xác, đúng khuôn `nguoiVanHanh` đã có) dùng cho từng mục bên dưới.

### Không thêm giới hạn quyền riêng tư mới cho ve_file

San_xuat có quy tắc ẩn HOÀN TOÀN đơn "Đang chạy máy" của người khác (`locDonDangChayMayTheoNguoiVanHanh`)
— đây là quyết định RIÊNG, đã xác nhận rõ với người dùng khi làm tính năng đó. `filterForRole` hiện
tại cho ve_file (giống admin) xem TOÀN BỘ đơn, không lọc gì — đây là chính sách đã có từ trước, không
nằm trong yêu cầu lần này. KHÔNG thêm hạn chế ẩn đơn giữa các tài khoản ve_file với nhau — mục 2 chỉ
lọc theo `nguoiVeFile` ở phía CLIENT (tự gửi đúng tên mình), giống hệt cách `nguoiVanHanh` đã là 1
tham số lọc mở, chỉ admin mới có ô chọn trên giao diện.

### Trạng thái/Phôi KHÔNG cố định như bên san_xuat — vẫn để lọc động

Ở trang san_xuat, Trạng thái/Phôi/Vẽ file bị bỏ hoặc cố định vì luôn chỉ có đúng 1 giá trị. Ở đây
KHÁC: trong hàng đợi "cần vẽ file", Trạng thái có thể là "Đã in mã" HOẶC "LỖI SẢN XUẤT CẦN LÀM LẠI"
(lọc riêng được, hữu ích để ưu tiên xử lý đơn lỗi trước) — và Phôi có thể là "Chưa lấy phôi" HOẶC "Đã
lấy phôi" (2 việc phôi/vẽ file chạy song song, độc lập nhau) — hữu ích để biết đơn nào chỉ còn thiếu
vẽ file là xong. Vì vậy Trạng thái và Phôi ở đây là 2 ô lọc ĐỘNG (đổ theo dữ liệu thật, giống Loại/Kích
thước...), không cố định. Vẽ file KHÔNG đưa vào bộ lọc (luôn "Chưa vẽ file" ở cả 2 mục — theo đúng
định nghĩa của trang này).

## Route backend mới (routes/orders.js)

- `POST /orders/nhan-ve-file` — tự nhận (ve_file/admin), body `{sttKeys}`. Đọc thật từng đơn, CHỈ ghi
  `NGUOI_VE_FILE = user.ten` nếu đơn ĐANG CHƯA có ai nhận (`!row.NGUOI_VE_FILE`) — đã có người nhận
  thì báo lỗi riêng cho đơn đó (`loi`), không ghi đè.
- `POST /orders/chi-dinh-nguoi-ve-file` — admin chỉ định 1 người ve_file cho các đơn đã chọn, validate
  đúng là tài khoản ve_file đang hoạt động — ghi `NGUOI_VE_FILE = nguoiVeFile`, `GHI_CHU_VE_FILE =
  'Admin chỉ định'`. Sao chép đúng khuôn `/chi-dinh-nguoi-chay-may`.
- `GET /orders` (đã có) — thêm hỗ trợ `canVeFile=1`, `chuaNhanVeFile=1`, `nguoiVeFile=<tên>`; gắn thêm
  trường tính toán `NguoiVeFile` trong `lamGiauDon()`.

`orderService.js`/`orderService.update()` KHÔNG cần sửa gì (xem lý do ở trên).

## Giao diện — trang mới `public/my-orders-ve-file.html`

Sao chép cấu trúc `my-orders.html` (2 mục, mỗi mục có cặp nút Lọc/Sắp xếp độc lập kiểu thu gọn, cùng
bộ 7 kiểu sắp xếp) với 2 khác biệt nêu trên (Trạng thái/Phôi động thay vì cố định, bỏ Vẽ file):

1. **"Đơn cần vẽ file"** — `canVeFile=1&chuaNhanVeFile=1` + lọc/sắp xếp. Chọn nhiều + nút "Nhận vẽ
   file" (gọi `/orders/nhan-ve-file`) + (admin) ô chọn người + "Áp dụng" gọi
   `/orders/chi-dinh-nguoi-ve-file` — y hệt khuôn `apDungNhanChayMay()`/`apDungChiDinhNguoiChayMaySanSang()`.
2. **"Đơn vẽ file của tôi"** — `canVeFile=1&nguoiVeFile=<tôi>` (admin có thêm ô lọc "Người vẽ file",
   đổ động từ `/users`, mặc định "Tất cả") + lọc/sắp xếp riêng. Nút "Đánh dấu Đã vẽ file" gọi lại
   `/orders/chuyen-trang-thai-hang-loat` có sẵn (cot=TRANG_THAI_VE_FILE).

Dùng lại nguyên `chayHangLoatCoTienDo()`/`taoThanhTienDo()` ở api.js — không viết lại cơ chế tiến độ.

## Menu (public/js/api.js renderNav)

- ve_file: chèn "Đơn của tôi (Vẽ file) · {tên}" ngay sau "Đơn hàng" (vị trí 1) — KHÔNG ẩn menu nào
  khác của ve_file, KHÔNG đổi trang mặc định sau đăng nhập (ngoài phạm vi yêu cầu lần này, khác hẳn
  yêu cầu trước đó dành riêng cho san_xuat).
- admin: chèn thêm ngay sau "Đơn của tôi" hiện có (vị trí 2), giữ nguyên mọi thứ khác.

## Việc người dùng cần làm thủ công

Thêm 2 cột mới vào tab `Don_Hang_ALL` trong Google Sheet: `NGUOI_VE_FILE`, `GHI_CHU_VE_FILE` (đúng
tên, viết hoa, không dấu — khớp cách đặt tên NGUOI_CHAY_MAY/GHI_CHU_CHAY_MAY đã có).
