# Mở rộng log hoạt động: chi tiết hơn cho đổi trạng thái tay + thêm nhập kho/quét hàng loạt + giờ VN

## Bối cảnh

Rà soát `services/logService.js` và mọi nơi gọi `ghiLog()` cho thấy hệ thống đã ghi khá đầy đủ (đăng
nhập, quét QR, sửa hàng loạt, upload ảnh, GKE, chatbot) nhưng còn 3 khoảng trống, đã thống nhất với
người dùng tập trung đúng vào các hoạt động làm THAY ĐỔI TRẠNG THÁI đơn/phôi/vẽ file + nhập kho +
quét hàng loạt:

1. Sửa tay 1 đơn (`CAP_NHAT_DON`, `PUT /orders/:sttKey`) chỉ ghi giá trị MỚI, không có giá trị CŨ —
   kém chi tiết hơn hẳn so với quét QR/sửa hàng loạt (đã có sẵn `{tu, sang}`).
2. Nhập kho phôi thủ công (`POST /taiSan/nhap-kho`) có ghi vào tab riêng `LichSuNhapPhoi` nhưng
   KHÔNG ghi vào log trung tâm `LichSuHoatDong` — không hiện trong "Hoạt động của tôi"/công cụ tra
   cứu hoạt động chung.
3. Quét đơn hàng loạt (`POST /orders/quet-hang-loat/bat-dau`) hoàn toàn chưa có log nào.

Đồng thời: cột `ThoiGian` ở mọi tab lịch sử/nhật ký hiện lưu giờ UTC thô (`new Date().toISOString()`,
vd `...T10:30:00.000Z`) — ai mở thẳng Google Sheet ra xem sẽ thấy giờ lệch 7 tiếng so với giờ Việt
Nam thật, dễ hiểu nhầm. Cần đổi sang lưu đúng giờ Việt Nam (GMT+7).

## Thay đổi

### 1. `services/dateUtils.js` — hàm mới `thoiGianVNISOString()`

```js
function thoiGianVNISOString(d = new Date()) { ... }
```

Trả về chuỗi ISO NHƯNG theo giờ Việt Nam kèm hậu tố `+07:00` (không phải `Z`), dùng
`Intl.DateTimeFormat` với `timeZone: 'Asia/Ho_Chi_Minh'` (cùng kỹ thuật `dinhDangNgayGioNgan()` sẵn
có trong file, không phải cộng tay 7 tiếng). Giữ hậu tố offset `+07:00` (không bỏ trống/không ghi
sai timezone) để `new Date(...)` ở MỌI nơi khác (sắp xếp theo thời gian, lọc khoảng ngày trong
`layHoatDongCuaToi`, `layLichSuTheoDon`...) vẫn đọc ra ĐÚNG thời điểm tuyệt đối — chỉ đổi CÁCH HIỂN
THỊ trong chuỗi lưu trữ, không đổi giá trị thời gian thật.

### 2. Áp dụng `thoiGianVNISOString()` cho mọi cột `ThoiGian`/`Thoi_Gian` ghi log

- `services/logService.js`: `ghiLog()` và `ghiNhatKyQuetHangLoat()`.
- `services/taiSanService.js`: `nhapKho()` (cột `ThoiGian` trong `LichSuNhapPhoi`).

(Không đụng `NGAY_LEN_DON`/`ThoiGianCapNhatCuoi` trên chính đơn hàng — đó là dữ liệu nghiệp vụ, khác
khái niệm "log/nhật ký hoạt động".)

### 3. `CAP_NHAT_DON` — ghi thêm giá trị TRƯỚC khi sửa cho 3 cột trạng thái

`routes/orders.js`, `PUT /:sttKey`: đọc `{headers, row}` (fresh) TRƯỚC khi gọi `orderService.update()`,
truyền qua `tuyChon.donDaDoc` như `chuyen-trang-thai-hang-loat` đang làm (gộp thành đúng 1 lượt đọc
thật, không tốn thêm request). So `updates[cot]` với `row[cot]` cho `TRANG_THAI_XUONG`,
`TRANG_THAI_PHOI`, `TRANG_THAI_VE_FILE` — cột nào thực sự đổi thì thêm vào
`chiTiet._truocKhiSua = { [cot]: giá trị cũ }`.

`services/logService.js`, `layHoatDongCuaToi()`: nhánh `CAP_NHAT_DON` đọc
`chiTiet._truocKhiSua?.[cot]` làm `tu` thay vì luôn để trống — tương thích ngược hoàn toàn (log cũ
không có `_truocKhiSua` thì vẫn ra `tu: ''` như trước giờ).

### 4. Nhập kho phôi thủ công — ghi thêm vào log trung tâm

`services/taiSanService.js`, `nhapKho()`: nhận thêm tham số `vaiTro`, gọi thêm
`ghiLog({ nguoiDung: nguoiNhap, vaiTro, hanhDong: 'NHAP_KHO_PHOI', chiTiet: { loai, kichThuoc, mauSac, soLuong, ghiChu } })`
— giữ nguyên hoàn toàn việc ghi vào `LichSuNhapPhoi` như cũ.

`routes/taiSan.js`, `POST /nhap-kho`: truyền thêm `vaiTro: user.vaiTro` khi gọi `nhapKho()`.

### 5. Quét đơn hàng loạt — ghi log khi job kết thúc

`routes/orders.js`, trong IIFE nền của `POST /quet-hang-loat/bat-dau`:
- Kết thúc thành công/bị dừng: `ghiLog({ hanhDong: 'QUET_HANG_LOAT', chiTiet: { soDonDaChon: sttKeySet.size, ...job.ketQua, daHuy: job.daHuy } })`.
- Lỗi (catch): `ghiLog({ hanhDong: 'QUET_HANG_LOAT_LOI', chiTiet: { soDonDaChon: sttKeySet.size, loi: err.message } })`.

Không gắn `sttKey` đơn lẻ (thao tác trên cả lô, không phải 1 đơn) — để trống, giống cách các hành
động hàng loạt khác xử lý khi không có 1 đơn cụ thể.

## Không đổi

- Không thêm log cho các thao tác THUẦN XEM/LỌC/SẮP XẾP (đã thống nhất — chỉ log hành động có hậu quả
  thật, làm thay đổi dữ liệu).
- Không đổi cơ chế/route/format của 3 tab log hiện có (`LichSuHoatDong`, `NhatKyQuetHangLoat`,
  `LichSuNhapPhoi`) — chỉ thêm dòng, thêm chi tiết, đổi định dạng cột `ThoiGian`.
- Không tạo trang UI mới để xem log — dữ liệu vẫn truy cập qua các công cụ sẵn có ("Hoạt động của
  tôi", chatbot tra cứu hoạt động cho admin, mở thẳng Google Sheet).
