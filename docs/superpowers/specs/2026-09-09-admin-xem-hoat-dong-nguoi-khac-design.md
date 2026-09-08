# Admin xem "Hoạt động của tôi" của bất kỳ ai — thiết kế

**Ngày:** 2026-09-09
**Yêu cầu gốc:** Với vai trò admin, chọn tên 1 người và xem hoạt động của người đó đúng như người đó
tự xem ở "Hoạt động của tôi".

## Nới đúng 1 chỗ chặn bảo mật đã có, không đụng gì khác

`routes/hoatDong.js` trước đây có chủ đích KHÔNG nhận `nguoiDung` từ client — luôn dùng
`req.session.user.ten`, để 1 tài khoản không thể xem hoạt động tài khoản khác qua sửa query string.
Giữ nguyên chặn này cho MỌI vai trò không phải admin; chỉ khi `req.session.user.vaiTro === 'admin'`
VÀ có `nguoiDung` trong query mới cho phép đổi người xem — validate đúng 1 tài khoản có thật, đang
hoạt động (tra `NguoiDung`), trả lỗi rõ nếu gõ/chọn sai tên (tránh hiểu nhầm "người này chưa làm gì"
khi thực ra là gõ nhầm tên).

## Phạm vi chọn người — TẤT CẢ tài khoản đang hoạt động

Hỏi lại người dùng: chỉ 3 vai trò công nhân (san_xuat/ve_file/nguoi_lay_phoi, khớp phạm vi báo cáo
"Hiệu suất theo người" đã có) hay tất cả tài khoản? Người dùng chọn **tất cả tài khoản đang hoạt động**
(gồm cả admin khác) — đúng sát nghĩa "bất kỳ ai" trong yêu cầu gốc.

## "Chỉ tiêu công việc" phải theo vai trò NGƯỜI ĐƯỢC XEM, không phải vai trò admin

`renderChiTieuVaiTro()` ở `public/hoat-dong.html` trước đây đọc thẳng biến `user.vaiTro` (vai trò
người đăng nhập) để quyết định hiện nhóm chỉ tiêu nào — nếu giữ nguyên, khi admin xem người khác khối
này sẽ LUÔN ẩn (vì `admin` không thuộc 3 nhóm), sai hoàn toàn mục đích tính năng. Sửa thành nhận tham
số `vaiTroXem` truyền từ `data.nguoiXem.vaiTro` (server trả kèm, đã validate) thay vì đọc biến global —
khi xem chính mình, `nguoiXem.vaiTro` = `user.vaiTro` (hành vi cũ giữ nguyên).

## Giao diện — tái dùng nguyên trang, không tạo trang mới

Đúng ý người dùng ("xem như người đó xem tại Hoạt động của tôi") — thêm 1 dropdown "Xem hoạt động
của:" ngay trên bộ chọn kỳ, CHỈ hiện với admin, đổ từ `/users` (loại chính admin đang xem khỏi danh
sách, đã có sẵn ở đầu). Chọn 1 người → gọi lại `/hoat-dong/cua-toi?nguoiDung=X`, đổi tiêu đề trang
thành "Hoạt động của X" (đọc tên từ response server, không đọc thẳng lựa chọn client — tránh lệch nếu
server từ chối). Chưa chọn ai → giữ nguyên 100% hành vi cũ (xem hoạt động chính admin). Toàn bộ phần
hiển thị còn lại (3 thẻ nhanh, 3 timeline quét/đổi trạng thái/upload ảnh) không đổi 1 dòng, chỉ đổi
nguồn dữ liệu.
