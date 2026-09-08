# Admin chỉ định người chạy máy tại mục "Đơn sẵn sàng chạy máy" — thiết kế

**Ngày:** 2026-09-08
**Yêu cầu gốc:** Tại "Đơn của tôi" → mục "Đơn sẵn sàng chạy máy", bổ sung cho admin khả năng chỉ định
người chạy máy cho các đơn đã chọn (thay vì chỉ có nút tự nhận vừa thêm).

## Vì sao không cần hỏi thêm

Đây là ĐÚNG tính năng "cơ chế 2 — Admin chỉ định" đã có sẵn từ trước (xem
docs/superpowers/specs/2026-09-07-nguoi-chay-may-design.md), hiện đã dùng ở `orders.html` (thanh hành
động hàng loạt) và `order.html` (trang chi tiết đơn) — lần này chỉ cần gắn thêm đúng UI đó vào 1 vị
trí thứ 3: thanh hành động của mục "Đơn sẵn sàng chạy máy" ở `my-orders.html`. Mọi phần phía sau (API,
validate, cách stamp NGUOI_CHAY_MAY/GHI_CHU_CHAY_MAY) đã có sẵn, dùng lại y hệt — không route mới,
không đổi backend:

- Backend: `POST /orders/chi-dinh-nguoi-chay-may` (đã có) — chỉ admin, validate người được chỉ định
  đúng là tài khoản san_xuat đang hoạt động, đọc thật + ghi qua `orderService.update()` (đã tự chặn
  phôi/file chưa xong, tự áp NGUOI_CHAY_MAY + GHI_CHU_CHAY_MAY='Admin chỉ định').
- Frontend: sao chép đúng mẫu `#khoi-chi-dinh-nguoi-chay-may` + `apDungChiDinhNguoiChayMay()` đang có
  ở `orders.html` — đổ danh sách san_xuat đang hoạt động từ `/users`, dùng lại
  `chayHangLoatCoTienDo()`/`taoThanhTienDo()` ở api.js.

## Quyết định thiết kế (suy ra trực tiếp từ yêu cầu + tiền lệ đã có, không phải điểm mơ hồ)

- **Thêm CẠNH nút tự nhận đã có** (không thay thế) — đúng nghĩa "bổ sung thêm" trong yêu cầu, và khớp
  hệt cách `orders.html` đang bày cả 2 lựa chọn (đổi trạng thái tự do + chỉ định người chạy máy) cùng
  1 thanh hành động cho admin.
- **Chỉ hiện với admin** — dùng lại đúng cơ chế ẩn/hiện `display:contents` (không phải `''`) như
  `orders.html` đã dùng, vì khối này nằm trong `.thanh-hanh-dong-hang-loat` (flex container) — bọc
  bằng `<span>` với `display:''` sẽ làm mất `flex:1`/`align-self:stretch` của các phần tử bên trong
  (lỗi thật đã gặp và sửa lần trước, xem docs/superpowers/specs/2026-09-07-nguoi-chay-may-design.md).
- Sau khi chỉ định xong, tải lại cả 2 danh sách của trang (sẵn sàng + đang chạy máy của tôi), giống
  hệt nút tự nhận.
