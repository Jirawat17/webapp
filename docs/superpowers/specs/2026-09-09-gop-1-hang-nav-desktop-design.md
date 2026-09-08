# Gộp thanh điều hướng thành 1 hàng ở desktop — thiết kế

**Ngày:** 2026-09-09
**Yêu cầu gốc:** Tham khảo layout 1 hàng của GKE Logistics — bỏ hẳn brand "Xưởng Thêu" + icon, chuyển
tên tài khoản/đăng xuất xuống cùng hàng với menu, tăng diện tích hiển thị.

## Chỉ áp dụng cho desktop — điện thoại giữ nguyên 100%

Nav hiện có 2 layout khác hẳn nhau theo breakpoint (`public/css/style.css`): desktop (≥768px) là hàng
brand/user riêng phía trên + hàng menu riêng phía dưới, đúng như 2 ảnh tham khảo người dùng gửi;
điện thoại (<768px) là thanh icon CỐ ĐỊNH DÍNH ĐÁY màn hình kiểu app di động (`position: fixed; bottom:
0`, xếp dọc icon-trên-chữ, chia đều `space-around`) — hàng brand/user vẫn nằm riêng phía trên, cuộn
theo trang.

Hỏi lại người dùng trước khi code: có nên đổi luôn layout di động sang kiểu 1 hàng giống desktop
không? Người dùng chọn **giữ nguyên di động** — chỉ gộp 1 hàng ở desktop, thanh icon dính đáy trên
điện thoại không đổi gì.

## Cách làm — 2 bản tên/đăng xuất, CSS chọn đúng 1 bản theo breakpoint

`renderNav()` (`public/js/api.js`) sinh RA HAI bản `<div class="header-right">...</div>` (tên · vai trò
+ nút đăng xuất) — không phải 1 bản dùng chung, vì mỗi bản cần ẩn/hiện ĐỘC LẬP theo breakpoint:
- Bản 1: trong `.app-header` như cũ — không thêm class gì khác, ẩn/hiện đi theo chính `.app-header`
  (đến lượt `.app-header` bị ẩn hẳn ở desktop, xem dưới).
- Bản 2: trong `.tab-links`, thêm class riêng `.tab-links-user` — mặc định `display:none` (điện
  thoại), chỉ `display:flex` từ 768px trở lên.

2 nút "Đăng xuất" trùng `onclick="dangXuat()"` tồn tại song song trong DOM nhưng vô hại — phần tử
`display:none` không thể bấm/focus được, luôn chỉ đúng 1 bản hiển thị tại 1 thời điểm.

CSS thay đổi (`public/css/style.css`):
- `.tab-links-menu` (wrapper mới bọc quanh các `<a>` menu, đặt bên trong `.tab-links`): mặc định
  `display: contents` — "biến mất" khỏi box model trên điện thoại, các `<a>` bên trong thành con flex
  TRỰC TIẾP của `.tab-links` y hệt trước khi có wrapper, giữ nguyên 100% cách chia đều `space-around`
  của thanh icon dính đáy. Selector `.tab-links a` (descendant, không phải direct-child) vẫn khớp bình
  thường qua wrapper này nên không phải sửa lại.
- Từ 768px: `.app-header { display: none; }` (bỏ hẳn hàng brand/user cũ), `.tab-links` đổi
  `justify-content: flex-start` → `space-between` (đẩy menu sang trái, user sang phải), `.tab-links-menu`
  thành `display: flex` thật + `overflow-x: auto` (menu admin tới 12 mục, phòng khi màn hình không đủ
  rộng thì cuộn ngang thay vì vỡ hàng — đã xác nhận qua test thật ở 1440px cần cuộn, 1920px gần đủ),
  `.tab-links-user { display: flex; flex-shrink: 0; }` (luôn hiện trọn vẹn, không bị co lại nhường chỗ
  menu).

## Đã kiểm tra

Dựng `renderNav()` thật qua Browser pane ở nhiều bề rộng (đúng viewport pane hẹp mô phỏng điện thoại,
1440px, 1920px) và 2 vai trò (admin — 12 mục, nguoi_lay_phoi — 3 mục): điện thoại giữ nguyên y hệt cũ
(brand + user hàng trên, thanh icon dính đáy không đổi); desktop không còn brand, menu bên trái + tên/
đăng xuất bên phải cùng 1 hàng, mục đang chọn vẫn có gạch chân đỏ đúng; cuộn ngang hoạt động đúng khi
menu không đủ chỗ (test 1440px, kéo tới "Thiết lập" — mục cuối cùng — vẫn bấm được); vai trò ít mục
(3 mục) không bị vỡ layout, khoảng trống giữa menu và user là bình thường (giống hệt cách layout tham
khảo GKE Logistics xử lý khi ít mục điều hướng).
