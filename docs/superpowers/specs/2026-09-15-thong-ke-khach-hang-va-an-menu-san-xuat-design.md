# Bảng thống kê theo khách hàng + ẩn menu Setting/Tracking cho san_xuat

Người dùng vừa thêm cột `KHACH_HANG` trực tiếp trên `Don_Hang_ALL` (Google Sheets đọc header động —
xem `services/sheetsService.js#readTab` — nên cột mới tự có mặt trên mọi `row.KHACH_HANG` mà không cần
đổi gì ở tầng đọc dữ liệu). Yêu cầu 2 việc độc lập:

1. Đổi biểu đồ cột "Theo khách hàng" ở trang Thống kê (`dashboard.html`) thành 1 bảng chi tiết theo
   từng nhóm khách hàng.
2. Ẩn 2 menu "Setting"/"Tracking" khỏi nav của vai trò `san_xuat` ("người chạy máy").

Đã xác nhận với người dùng: nhóm theo **cột `KHACH_HANG` mới, trực tiếp** — KHÔNG qua cơ chế mã
`MA_KHACH_HANG` + tra tên ở tab `Khach_Hang` (`services/khachHangService.js`) đang dùng cho biểu đồ cũ.

## 1. Bảng thống kê theo khách hàng

### Định nghĩa từng cột

Dùng lại `chiSoTinhTrang()`/`THU_TU_TINH_TRANG` có sẵn ở `data/pipelineTinhTrang.js` (thứ tự tiến
trình chính: Chưa in mã → Đã in mã → ĐÃ SẴN SÀNG CHẠY MÁY → Đang chạy máy → Đã sản xuất → ĐÃ DÁN TEM →
DELIVERED) thay vì tự chế thêm logic so sánh mới.

| Cột | Định nghĩa |
|---|---|
| Khách hàng | Giá trị `KHACH_HANG`, hoặc `(Trống)` nếu đơn không có giá trị |
| Tổng đơn | Tất cả đơn thuộc nhóm (kể cả LỖI SẢN XUẤT/CANCELLED/REFUNDED) |
| Đã DÁN TEM | `TRANG_THAI_XUONG` đã tới mốc "ĐÃ DÁN TEM" trở đi (gồm DELIVERED) |
| Chưa DÁN TEM | = Tổng đơn − Đã DÁN TEM |
| Đã vẽ file | `TRANG_THAI_VE_FILE === 'Đã vẽ file'` |
| Đã chạy máy | `TRANG_THAI_XUONG` đã tới mốc "Đã sản xuất" trở đi (gồm ĐÃ DÁN TEM, DELIVERED) |
| Có file, chưa chạy máy | Đã vẽ file **VÀ** chưa tới mốc "Đã sản xuất" — tính join per-order, không suy
  ra từ hiệu 2 cột trên, vì dữ liệu Sheet có thể bị sửa tay lệch khỏi luồng app (đơn "đã chạy máy" mà
  chưa chắc "đã vẽ file" nếu ai đó sửa thẳng trên Sheet) |
| Chưa có file vẽ | = Tổng đơn − Đã vẽ file |

Đơn "LỖI SẢN XUẤT CẦN LÀM LẠI" không tính vào "đã chạy máy"/"đã dán tem" — `chiSoTinhTrang()` trả `null`
cho trạng thái rẽ nhánh này (cùng cách các nơi khác trong code đang xử lý), hợp lý vì làm lại nghĩa là
mốc đó chưa xong.

Sắp xếp: Tổng đơn giảm dần; nhóm `(Trống)` luôn ở cuối bảng bất kể số lượng.

### Backend — `routes/dashboard.js`

Thêm field mới `theoKhachHangChiTiet` (mảng) vào response `GET /thong-ke`, tính trên cùng biến `rows`
đã lọc theo Xưởng + khoảng ngày sẵn có (không đổi hành vi lọc hiện tại). Bỏ luôn
`theoKhachHang`/`ganTenKhachHang` khỏi route này (chỉ route này — không đụng hàm `ganTenKhachHang`
dùng chung ở `orderService.js`, hàm đó vẫn phục vụ nơi khác) vì bảng mới thay thế hẳn, không còn nơi
nào trong route này dùng tới field cũ.

### Frontend — `public/dashboard.html`

Bảng cần đủ rộng (8 cột) nên tách RA KHỎI `.chart-grid` (lưới 2 cột ở ≥768px, quá chật cho bảng này) —
đặt thành 1 khối riêng, full-width, ngay trên lưới 3 biểu đồ còn lại (Theo trạng thái/Theo loại sản
phẩm/Đơn theo tuần). Dùng lại đúng class bảng có sẵn (`bang-cuon-ngang` + `bang-xem-truoc`, xem
`reports.html`) để đồng bộ giao diện, không viết CSS mới.

## 2. Ẩn menu Setting/Tracking cho san_xuat

Bỏ 2 dòng chèn `{ href: '/settings.html', ... }` và `{ href: '/tracking.html', ... }` khỏi nhánh
`san_xuat` trong `renderNav()` (`public/js/api.js`). Còn lại 4 menu: Chạy máy, Đơn hàng, Quét QR, Lịch
sử.

Đã kiểm tra trước khi làm: `settings.html` chỉ có cài đặt giao diện (chế độ tối/màu chủ đạo), không có
gì san_xuat cần hằng ngày. Việc in label ("IN LABEL"/"MUA TRACKING và IN LABEL") san_xuat đang dùng nằm
trên `order.html` (nút riêng), không phụ thuộc menu Tracking. `routes/tracking.js` hiện không giới hạn
vai trò nào (chỉ `requireLogin`) — đây CHỈ là ẩn menu điều hướng, giống cách `nguoi_lay_phoi` đang bị ẩn
bớt menu, không phải khoá route backend.

## Đã kiểm tra

- Chưa code — spec này viết trước khi implement, theo đúng quy trình brainstorming.
