# Bảng điều khiển (dashboard admin-only, phong cách neon) — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Dashboard đẹp/long lanh, tham khảo tông màu ảnh mẫu (nền xanh navy đậm, viền/glow
cyan, điểm nhấn vàng gold — phong cách "HUD" khoa học viễn tưởng), chỉ admin truy cập được, dữ liệu
hiển thị động/sinh động.

## Ảnh mẫu là template chung, không áp dụng thẳng nội dung

Ảnh tham khảo (bán hàng/thế giới — "Sales Amount", bản đồ toàn cầu, "Market Analysis" doanh thu) không
khớp với xưởng thêu (không có dữ liệu doanh thu/toạ độ địa lý). Chỉ lấy TÔNG MÀU + PHONG CÁCH khung
viền/glow, thay nội dung bằng đúng dữ liệu THẬT đã có trong hệ thống — đã chốt với người dùng bộ
widget:

1. Số đơn theo từng giai đoạn pipeline (phễu).
2. Số đơn đang cảnh báo trễ hạn (Vàng/Cam/Đỏ).
3. Khối lượng công việc CẢ XƯỞNG trong kỳ đã chọn (chạy máy/vẽ file/lấy phôi/đóng gói).
4. Top người làm việc nhiều nhất (mọi vai trò, xếp chung 1 bảng).
5. Tỷ lệ lỗi sản xuất (%).
6. Phân bố theo loại sản phẩm.
7. Phân bố theo khách hàng.
8. Xu hướng đơn theo tuần.

## Trang mới, không đụng "Thống kê" hiện có

Trang mới `public/bang-dieu-khien.html` + menu riêng "Bảng điều khiển" — CHỈ admin (không phải ve_file
— khác "Thống kê" hiện tại đang mở cho cả 2). Không sửa/xoá gì ở `dashboard.html`/"Thống kê" — 2 trang
tồn tại song song, phục vụ 2 mục đích khác nhau (Thống kê = biểu đồ chi tiết theo mọi kỳ; Bảng điều
khiển = tổng quan nhanh, 1 màn hình, cho admin).

## KHÔNG thêm route backend mới — ghép 3 API đã có sẵn

Rà lại thấy đủ dữ liệu cần từ 3 endpoint ĐÃ CÓ, không cần viết thêm gì ở server:

- `GET /dashboard/thong-ke?tuNgay&denNgay` (đã có) — cho đúng mục 1 (`theoTrangThai`), 6
  (`theoLoaiSanPham`), 7 (`theoKhachHang`), 8 (`theoTuan`), và tổng số đơn (`tongSoDon`, mẫu số cho
  tỷ lệ lỗi ở mục 5).
- `GET /reports/thong-ke-loi?tuNgay&denNgay` (đã có) — `tongSoLoi`, chia cho `tongSoDon` ở trên ra tỷ
  lệ lỗi mục 5.
- `GET /reports/hieu-suat-theo-nguoi?tuNgay&denNgay` (đã có, admin-only — xem
  docs/superpowers/specs/2026-09-08-hieu-suat-theo-nguoi-design.md) — cộng dồn đúng field theo từng
  mảng vai trò ra khối lượng công việc CẢ XƯỞNG (mục 3: cộng `soDonDaChayMay` toàn bộ `san_xuat`,
  `soFileDaVe` toàn bộ `ve_file`, `soDonDaLayPhoi`/`soDonDaDongGoi` toàn bộ `nguoi_lay_phoi`); gộp cả
  3 mảng + sắp theo đúng chỉ tiêu chính của từng người ra bảng xếp hạng mục 4.
- `GET /orders` (đã có, admin xem toàn bộ không giới hạn) — đọc trường tính toán sẵn `CanhBao` từng
  đơn, đếm theo Vàng/Cam/Đỏ ra mục 2 (đây là ảnh chụp NGAY LÚC XEM — không lọc theo kỳ, vì "đơn nào
  đang trễ hạn" là tình trạng hiện tại, không phải việc xảy ra trong quá khứ).

Cùng 1 bộ chọn kỳ (Hôm nay/Tuần này/Tháng này/Toàn bộ/Tuỳ chọn — đúng mẫu đã dùng ở
dashboard.html/reports.html/hoat-dong.html) điều khiển CẢ 3 lệnh gọi (trừ mục 2 luôn là ảnh chụp hiện
tại, không đổi theo kỳ).

## Phong cách hình ảnh

CSS riêng trong chính file (không đụng `style.css` dùng chung toàn app, vì đây là giao diện đặc biệt
khác hẳn phần còn lại): nền gradient navy đậm, thẻ kính mờ (`backdrop-filter: blur`) viền cyan phát
sáng nhẹ (`box-shadow` glow), góc thẻ có chi tiết ngoặc vuông trang trí kiểu HUD, số liệu đếm chạy
(count-up) lúc tải, biểu đồ Chart.js (đã có sẵn, dùng lại — không thêm thư viện mới) phối màu
cyan/vàng gold/đỏ khớp tông ảnh mẫu. "Hiển thị động": tự tải lại dữ liệu mỗi 60 giây (đồng hồ
"Cập nhật lúc HH:MM:SS" hiển thị lần tải gần nhất) — không chỉ hiệu ứng thị giác mà dữ liệu thật sự
mới.
