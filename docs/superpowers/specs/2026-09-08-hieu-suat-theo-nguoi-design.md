# Hiệu suất theo người (Báo cáo, chỉ admin) — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Tại menu Báo cáo, riêng admin có quyền xem mọi thống kê hiệu suất của từng người.

## Phạm vi quyền — chặn THẬT ở server, không chỉ ẩn giao diện

Trang Báo cáo hiện tại (`router.use(requireLogin)` ở routes/reports.js) cho MỌI vai trò đăng nhập
dùng được — kể cả ve_file (menu "Báo cáo" hiện có trong nav của ve_file). Yêu cầu lần này nói rõ
"riêng admin có quyền xem" — đây là dữ liệu hiệu suất CÁ NHÂN của từng nhân viên, khác hẳn 3 báo cáo
hiện có (tỷ lệ lỗi/hoàn đơn/thời gian chạy máy — vốn không phải để đối chiếu ai làm việc thế nào).
Route mới `GET /reports/hieu-suat-theo-nguoi` CHẶN THẬT bằng kiểm tra `user.vaiTro !== 'admin'` trả về
403 — không chỉ ẩn khối giao diện (khác quy ước "chỉ ẩn UI" vẫn dùng cho nút in/xuất trong toàn app).

## Tái dùng chỉ tiêu đã có — không định nghĩa lại

Đúng 4 cặp chỉ tiêu (đếm đơn + số lượng) đã xây cho "Hoạt động của tôi"
(docs/superpowers/specs/2026-09-08-chi-tieu-hoat-dong-theo-vai-tro-design.md), giờ tính cho MỌI người
thay vì chỉ người đang đăng nhập. Để tránh chép lại logic đếm/dedupe, tách hàm dùng chung
`tinhChiTieuCongViec(hoatDong, slTheoStt)` ra `services/logService.js` (trước nằm riêng ở
routes/hoatDong.js) — nhận `hoatDong` đúng hình dạng `{doiTrangThai, uploadAnh, tongSoLuongPhoiDaLay}`
và `slTheoStt` (Map STT_Key -> SO_LUONG, bên gọi tự đọc `orderService.getAll()` rồi truyền vào, giữ
logService.js không phụ thuộc ngược orderService).

## Cách tính — 1 lượt quét log DUY NHẤT cho MỌI người, không lặp N lần

Nếu gọi lại `layHoatDongCuaToi()` cho TỪNG người sẽ đọc lại tab LichSuHoatDong N lần (N = số nhân
viên) — lãng phí. Route mới tự đọc tab LichSuHoatDong 1 lần (cache), rồi QUÉT MỘT LƯỢT, phân loại từng
dòng log vào đúng "giỏ" (bucket) của người ghi ra dòng đó — cùng cách nhận diện hành động như
`layHoatDongCuaToi()` (rút gọn, chỉ giữ đủ trường cho `tinhChiTieuCongViec()` dùng, không cần đủ chi
tiết hiển thị timeline). Khởi tạo SẴN 1 giỏ rỗng cho MỌI tài khoản đang hoạt động thuộc 3 vai trò liên
quan (kể cả người CHƯA có hoạt động nào trong kỳ — vẫn hiện đúng 0, không bị thiếu khỏi báo cáo, tránh
hiểu nhầm "không có trong danh sách" = "không tồn tại").

## Giao diện — 3 bảng riêng theo vai trò, thêm cuối trang Báo cáo

Chỉ admin thấy khối này (ẩn hẳn ở client CHO admin trải nghiệm gọn — nhưng an toàn thật sự nằm ở chặn
server nêu trên, không phải ở việc ẩn này). Mỗi bảng liệt kê người (đang hoạt động, đúng vai trò) +
2 cặp cột chỉ tiêu tương ứng, sắp theo chỉ tiêu đếm chính giảm dần (người làm nhiều nhất lên đầu) —
đúng tinh thần bảng "Theo người vận hành" đã có ở khối "Thống kê thời gian chạy máy" cùng trang.
