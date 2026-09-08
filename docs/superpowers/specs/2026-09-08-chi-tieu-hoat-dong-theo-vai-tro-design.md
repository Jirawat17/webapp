# Chỉ tiêu công việc theo vai trò ở "Hoạt động của tôi" — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Bổ sung vào "Hoạt động của tôi": san_xuat → số đơn đã chạy; ve_file → số file đã vẽ;
nguoi_lay_phoi → số phôi đã lấy + số đơn đã đóng gói. Đề xuất thêm chỉ tiêu khác nếu cần đánh giá hiệu
quả làm việc.

## Quyết định đã chốt với người dùng

1. **Có thêm chỉ tiêu theo SỐ LƯỢNG** (không chỉ đếm số đơn) — mỗi cặp đếm-đơn đều có thêm 1 chỉ tiêu
   số lượng đi kèm.
2. **Không thêm chỉ tiêu lỗi/chất lượng** (vd số đơn lỗi sản xuất cần làm lại) — trang này chỉ tập
   trung khối lượng công việc.

## Nguồn dữ liệu — tận dụng log có sẵn, không ghi thêm log mới

Toàn bộ chỉ tiêu tính được từ dữ liệu ĐÃ CÓ trong tab `LichSuHoatDong` (qua `layHoatDongCuaToi()`) +
đối chiếu SO_LUONG hiện tại của đơn — không cần sửa bất kỳ điểm ghi log nào:

- **San_xuat "đã chạy máy"** = số đơn hàng có log `UPLOAD_ANH` với `moc='da_san_xuat'` (mốc "Đang chạy
  máy → Đã sản xuất", đã có sẵn từ luồng chụp ảnh QR bắt buộc — routes/photos.js) trong khoảng thời
  gian đang xem, gắn tên người thao tác đúng là người đăng nhập. Hiểu là "đã chạy XONG" (hoàn thành),
  không tính đơn còn đang chạy dở.
- **Ve_file "đã vẽ file"** = số đơn có log đổi trạng thái (`CHUYEN_TRANG_THAI_HANG_LOAT`/`CAP_NHAT_DON`/
  quét QR) với cột `TRANG_THAI_VE_FILE` chuyển sang `'Đã vẽ file'`.
- **Nguoi_lay_phoi "đã lấy phôi"** = số đơn có log đổi cột `TRANG_THAI_PHOI` sang `'Đã lấy phôi'`.
- **Nguoi_lay_phoi "đã đóng gói"** = số đơn có log `UPLOAD_ANH` với `moc='dong_goi'`.

Cả 4 chỉ tiêu đếm-đơn trên đều ĐÃ nằm sẵn trong 2 mảng `doiTrangThai`/`uploadAnh` mà
`layHoatDongCuaToi()` đang trả về — chỉ cần lọc + đếm SỐ ĐƠN DUY NHẤT (Set theo STT_Key, tránh đếm
trùng nếu 1 đơn có nhiều lượt ghi log trong cùng khoảng, ví dụ vẽ lại file) ở `routes/hoatDong.js`,
không cần sửa `logService.js` cho phần này.

### Chỉ tiêu số lượng — 2 cách nguồn dữ liệu khác nhau

- **Số lượng phôi đã lấy**: rà `services/taiSanService.js` phát hiện log RIÊNG
  `TRU_KHO_PHOI_TU_DON` đã ghi sẵn ĐÚNG SỐ LƯỢNG phôi trừ kho cho từng đơn
  (`chiTiet: {loai, kichThuoc, mauSac, soLuong}`), gắn tên người thao tác — chính xác hơn hẳn so với
  suy ra từ SO_LUONG của đơn (phôi có thể tính theo đơn vị khác sản phẩm). `layHoatDongCuaToi()`
  (logService.js) được sửa để NHẬN DIỆN thêm hành động này, trả về mảng mới `truKhoPhoi` + tổng
  `tongSoLuongPhoiDaLay` — cùng cấu trúc với `quet`/`doiTrangThai`/`uploadAnh` đã có.
- **Số lượng sản phẩm đã chạy máy / đã vẽ file / đã đóng gói**: không có log số lượng riêng — lấy
  SO_LUONG hiện tại của chính đơn đó (đối chiếu qua `orderService.getAll()`, đọc cache — đủ dùng cho
  màn hình xem, không phải điểm ghi). Tính ở `routes/hoatDong.js` (không phải logService.js, để
  logService.js không phụ thuộc orderService — tránh nguy cơ vòng lặp import).

## Thay đổi

- `services/logService.js` — `layHoatDongCuaToi()`: nhận diện thêm `HanhDong === 'TRU_KHO_PHOI_TU_DON'`,
  trả thêm `truKhoPhoi` (mảng) + `tongSoLuongPhoiDaLay` (tổng).
- `routes/hoatDong.js` — sau khi gọi `layHoatDongCuaToi()`, đọc thêm `orderService.getAll()` (cache) để
  tra SO_LUONG theo STT_Key, tính 4 cặp chỉ tiêu (đếm đơn + số lượng) cho san_xuat/ve_file/
  nguoi_lay_phoi, trả về trong 1 object `chiTieu` MỚI — LUÔN tính đủ cả 4 cặp bất kể vai trò người xem
  (rẻ, không cần tối ưu), để frontend tự chọn hiển thị đúng phần liên quan tới `user.vaiTro`.
- `public/hoat-dong.html` — thêm 1 khối "Chỉ tiêu công việc" MỚI, đứng TRÊN khối "thống kê nhanh" hiện
  có (khối cũ giữ nguyên, vẫn hữu ích để xem chi tiết từng loại thao tác) — hiện đúng 2 hoặc 4 thẻ theo
  `user.vaiTro` (san_xuat: 2 thẻ; ve_file: 2 thẻ; nguoi_lay_phoi: 4 thẻ; admin: không hiện khối này,
  vì admin không thuộc riêng vai trò nào trong 3 vai trò trên — ngoài phạm vi yêu cầu lần này).
