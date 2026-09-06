# Khối "Kết quả vừa quét" cho Quét kịch bản + thu gọn khung camera

## Bối cảnh

Ở `public/scan.html`, chế độ "Quét kịch bản" (dùng cho mọi kịch bản cấu hình trong tab
CauHinhKichBan, bao gồm "Chưa lấy phôi → Đã lấy phôi") hiện chỉ báo kết quả từng lượt quét qua
`toast-vua-quet` — 1 dòng ngắn, tự ẩn sau 3.5 giây, không đủ thời gian/chỗ để người quét (thường
đang thao tác tay + cầm máy quét ngoài kho) đọc kỹ tình trạng đơn vừa quét.

## Thay đổi

### 1. Khối "Kết quả vừa quét" — thay cho việc chỉ trông chờ vào toast

Thêm 1 khối mới `#ket-qua-vua-quet-kich-ban` (class `chi-che-do-kich-ban` — theo đúng quy ước ẩn/
hiện có sẵn của các phần tử chỉ dành riêng cho chế độ "Quét kịch bản"), đặt ngay dưới
`.khu-vuc-camera`, phía trên "Danh sách đang quét".

- **KHÔNG tự ẩn** — chỉ được ghi đè khi có lượt quét MỚI, hoặc reset về trạng thái rỗng khi chọn lại
  kịch bản/dừng quét.
- Nội dung hiển thị (đơn vừa quét gần nhất, `dsQuet[0]`):
  - Icon lớn + nhãn nhóm (Sẵn sàng / Sai trạng thái / Không tìm thấy).
  - Tiêu đề đơn ĐẦY ĐỦ, cho phép xuống dòng (không cắt bằng `nowrap`/ellipsis như dòng trong danh
    sách bên dưới).
  - Tên khách hàng (`item.tenKhachHang`, nếu có — trống với nhóm Không tìm thấy vì chưa xác định
    được đơn).
  - Dòng trạng thái: nhóm OK hiện `Trạng thái: {trangThaiHienTai} → {trangThaiSau}`; nhóm Sai trạng
    thái/Không tìm thấy hiện `lyDo` (câu đầy đủ do server dựng sẵn, đã có mã đơn).
  - Trước khi quét mã đầu tiên (mới chọn kịch bản): hiện "Chưa quét mã nào." giống trạng thái rỗng
    của danh sách.
- Màu nền theo nhóm (xanh/vàng/đỏ) — dùng lại đúng biến màu đang dùng cho `.toast-vua-quet`/
  `.dong-quet`, chỉ khác cỡ chữ/khoảng đệm lớn hơn hẳn để dễ đọc.
- **Giữ nguyên** `toast-vua-quet`, âm thanh (`phatAmThanhKetQua`), rung — vẫn là tín hiệu tức thời
  hữu ích (biết ngay lúc quét xong mà không cần nhìn kỹ), khối mới bổ sung phần đọc chi tiết, không
  thay thế.
- **KHÔNG đổi** "Danh sách đang quét" (`ds-dang-quet`) — vẫn là nhật ký đầy đủ như cũ, khối mới chỉ
  là phần nổi bật NGAY LẬP TỨC cho đúng 1 đơn vừa quét gần nhất.

### 2. Khung camera — giảm chiều cao, mở rộng chiều ngang (CHỈ áp dụng chế độ Quét kịch bản)

- Thêm class mới `che-do-rong` gắn lên `#camera-wrap` khi `mode === 'batch'` (song song với
  `che-do-to` sẵn có cho riêng tab Tracking — không đụng tab đó).
- CSS: `#camera-wrap.che-do-rong .camera-vien` và `#camera-wrap.che-do-rong #qr-reader` nới
  `max-width` từ 480px/300px (mặc định) lên 640px — vừa phải, không to bằng mức 960px/600px của
  Tracking (vốn dành riêng cho màn hình PC gắn máy in cố định).
- Truyền thêm `aspectRatio: 16 / 9` vào cấu hình `Html5Qrcode.start()` CHỈ cho luồng `batch` (qua
  tham số `tuyChon` đã có sẵn ở `batDauCamera`) — yêu cầu chính camera stream quay theo tỉ lệ
  rộng-thấp thật sự (không chỉ crop bằng CSS), khiến khung hình vừa rộng hơn vừa thấp hơn theo đúng
  yêu cầu, khung ngắm QR (`qrbox`, vẫn giữ 260) không đổi vì vẫn nhỏ hơn nhiều so với khung mới.

## Không đổi

- Luồng xử lý quét (`xuLyQuetKichBan`), API `/qr/kich-ban/:id/kiem-tra`.
- Chế độ Tra cứu (`lookup`) và Tracking (`gke_tracking`) — không đụng kích thước camera hay thêm khối
  mới ở 2 chế độ này.
- 3 ô đếm (`dem-nhom`).
