# Lưu người chạy máy trực tiếp (NGUOI_CHAY_MAY) + Admin chỉ định người chạy máy

## Bối cảnh

Trước đây hệ thống KHÔNG lưu trực tiếp ai đang vận hành máy — mỗi lần cần biết (badge "Đang vận
hành" ở `orders.html`/`my-orders.html`/`order.html`) phải dò ngược `LichSuHoatDong` tìm lần GẦN NHẤT
đơn chuyển sang "Đang chạy máy" (`layNguoiVanHanhTheoDon`, `routes/orders.js`). Cách này không lưu
được lý do/ghi chú, và không có khái niệm "admin chỉ định người khác chạy máy".

Người dùng đã tự thêm cột `NGUOI_CHAY_MAY` vào tab `Don_Hang_ALL` trên Sheet — cần thêm cột
**`GHI_CHU_CHAY_MAY`** nữa (dùng để ghi "Admin chỉ định" khi áp dụng) trước khi dùng đầy đủ tính
năng này.

Đã thống nhất với người dùng:
- `NGUOI_CHAY_MAY` THAY HẲN cơ chế dò lịch sử cũ (bỏ `layNguoiVanHanhTheoDon`).
- Cơ chế 1 (san_xuat tự chọn): dùng LUÔN cách đổi trạng thái có sẵn (đổi hàng loạt ở trang Đơn hàng,
  sửa tay 1 đơn, quét QR) — không cần giao diện mới, chỉ cần tự động ghi `NGUOI_CHAY_MAY` mỗi khi có
  ai đổi đúng `TRANG_THAI_XUONG` sang "Đang chạy máy".
- Cơ chế 2 (Admin chỉ định): admin chọn đơn ở trang Đơn hàng rồi chọn 1 người sản xuất từ danh sách,
  áp dụng cho toàn bộ đơn đã chọn.

## Thay đổi

### 1. `services/orderService.js` — điểm ghi TRUNG TÂM duy nhất (`update()`)

Ngay sau khối vô hiệu hoá `HASH_ANH_MAU` (đã có), thêm khối mới: nếu `updatesDaTinh.TRANG_THAI_XUONG
=== 'Đang chạy máy'` và giá trị TRƯỚC đó KHÁC "Đang chạy máy" (chuyển đổi THẬT, không phải gửi lại
đúng giá trị cũ):

- Nếu người gọi ĐÃ tự truyền `NGUOI_CHAY_MAY` trong `updates` (nhánh admin chỉ định) → giữ nguyên,
  không ghi đè.
- Ngược lại → tự set `NGUOI_CHAY_MAY = user.ten` (người đang thao tác) và xoá `GHI_CHU_CHAY_MAY = ''`
  (nếu cột tồn tại) — đảm bảo mỗi lượt CHẠY MỚI đều có ghi chú đúng, không giữ ghi chú cũ từ lượt
  chạy trước.

Guard bằng `headers.includes('NGUOI_CHAY_MAY')`/`headers.includes('GHI_CHU_CHAY_MAY')` — vô hại nếu
Sheet chưa có đủ cột. Vì đây là điểm ghi DUY NHẤT cho mọi thay đổi đơn hàng, áp dụng tự động cho quét
QR (đơn lẻ + hàng loạt), đổi trạng thái hàng loạt, và sửa tay 1 đơn — không cần sửa riêng từng route.

### 2. `routes/orders.js` — đọc `NGUOI_CHAY_MAY` thay cho dò lịch sử

- Xoá hàm `layNguoiVanHanhTheoDon()` và import `layLichSuChuyenSangTrangThai` nếu không còn dùng ở
  đâu khác trong file (vẫn giữ nguyên trong `services/logService.js` — `routes/reports.js` vẫn dùng
  cho báo cáo tỷ lệ lỗi, KHÔNG đụng gì ở đó).
- `lamGiauDon()`: `NguoiVanHanh: r.TRANG_THAI_XUONG === TRANG_THAI_DANG_CHAY_MAY ? (r.NGUOI_CHAY_MAY
  || null) : null` — đọc thẳng cột, không cần async chờ dò lịch sử nữa. **Giữ nguyên tên trường JSON
  trả về là `NguoiVanHanh`** (không đổi thành NguoiChayMay) để KHÔNG phải sửa gì ở 3 trang
  `orders.html`/`my-orders.html`/`order.html` đang đọc `o.NguoiVanHanh` — chỉ đổi NGUỒN dữ liệu phía
  sau, giao diện không đổi.
- `locDonDangChayMayTheoNguoiVanHanh()` không đổi gì (vẫn đọc `r.NguoiVanHanh` trên object đã làm
  giàu, không quan tâm nó được tính từ đâu).

### 3. `routes/orders.js` — route mới: Admin chỉ định người chạy máy

`POST /orders/chi-dinh-nguoi-chay-may` — chỉ admin (403 nếu không phải).

- Body: `{ sttKeys: string[], nguoiSanXuat: string }`.
- Validate: `sttKeys` không rỗng; `nguoiSanXuat` phải là tên 1 tài khoản đang hoạt động có
  `VaiTro = 'san_xuat'` (tra `NguoiDung`) — sai tên hoặc không phải san_xuat → 400 rõ ràng, tránh gõ
  nhầm.
- Với từng `sttKey` (mô hình try/catch từng đơn, gom thành công/lỗi, giống hệt
  `chuyen-trang-thai-hang-loat` đã có): gọi
  `orderService.update(sttKey, { TRANG_THAI_XUONG: 'Đang chạy máy', NGUOI_CHAY_MAY: nguoiSanXuat, GHI_CHU_CHAY_MAY: 'Admin chỉ định' }, user)`.
  Không ép buộc đơn phải đang ở "ĐÃ SẴN SÀNG CHẠY MÁY" trước đó — theo đúng triết lý "chọn tự do,
  không kiểm tra trạng thái hiện tại" đã áp dụng cho `chuyen-trang-thai-hang-loat` (admin tự chịu
  trách nhiệm quyết định, `kiemTraTinhHopLy()` trong `update()` vẫn chặn nếu phôi/vẽ file chưa xong).
- Ghi log mỗi đơn thành công: `hanhDong: 'CHI_DINH_NGUOI_CHAY_MAY', chiTiet: { nguoiDuocChiDinh: nguoiSanXuat }`.
- Trả về `{ thanhCong: [...], loi: [...] }` giống `chuyen-trang-thai-hang-loat`.

### 4. `public/orders.html` — nút "Chỉ định người chạy máy" (chỉ admin)

Thêm 1 nút mới trong thanh hành động hàng loạt (`.thanh-hanh-dong-hang-loat`, cạnh các nút nhanh có
sẵn), CHỈ hiện khi `user.vaiTro === 'admin'`. Bấm → hiện danh sách chọn 1 người sản xuất (đổ động từ
`GET /users`, lọc `VaiTro === 'san_xuat'` và đang hoạt động) → xác nhận → gọi route ở mục 3 cho toàn
bộ `donDaChonSet` hiện tại → alert tổng kết thành công/lỗi (giống các nút hàng loạt khác đã có) →
`taiDon()` load lại danh sách.

## Không đổi

- `services/logService.js` (`layLichSuChuyenSangTrangThai`, `layHoatDongCuaToi`...) — không đụng gì,
  vẫn phục vụ báo cáo lỗi sản xuất ở `routes/reports.js` như cũ.
- Giao diện hiển thị "Đang vận hành: X" ở 3 trang — không đổi 1 dòng code nào (vẫn đọc
  `o.NguoiVanHanh`), chỉ nguồn dữ liệu phía backend đổi.
- Không thêm hiển thị `GHI_CHU_CHAY_MAY` lên bất kỳ trang nào — chỉ lưu vào Sheet để tra cứu trực
  tiếp khi cần, giống các cột nội bộ khác trong dự án.
