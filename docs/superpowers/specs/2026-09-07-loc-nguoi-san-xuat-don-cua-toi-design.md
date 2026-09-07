# Lọc "Đơn của tôi" theo người sản xuất (admin)

## Bối cảnh

`public/my-orders.html` hiện chỉ hiện 1 danh sách phẳng mọi đơn "Đang chạy máy" cho admin (san_xuat
đã bị lọc chỉ còn đơn của chính mình từ trước, qua `locDonDangChayMayTheoNguoiVanHanh` trong
`routes/orders.js`). Trang không hiện tên người đang vận hành trên từng thẻ (chỉ cảnh báo khi KHÔNG
rõ ai đang chạy) nên admin không có cách nào biết nhanh "ai đang chạy đơn nào" mà không mở từng đơn.

Yêu cầu: admin xem được "Đơn của tôi" theo TỪNG người sản xuất — lọc còn đúng 1 người.

## Thay đổi

### 1. Backend (`routes/orders.js`)

Thêm tham số lọc `nguoiVanHanh` vào `GET /` (route đang dùng chung cho cả `orders.html` lẫn
`my-orders.html`), đặt cùng nhóm với các filter khác — SAU bước `lamGiauDon(list)` (lúc này
`NguoiVanHanh` đã được tính, xem `lamGiauDon`/`layNguoiVanHanhTheoDon`):

```js
if (nguoiVanHanh) list = list.filter(r => r.NguoiVanHanh === nguoiVanHanh);
```

An toàn với vai trò `san_xuat` dù có truyền tham số này: `locDonDangChayMayTheoNguoiVanHanh(list,
user)` luôn chạy SAU CÙNG trong route, tiếp tục giới hạn san_xuat chỉ thấy đơn "Đang chạy máy" của
chính họ (hoặc đơn không rõ ai chạy) bất kể `nguoiVanHanh` truyền vào là gì.

### 2. Frontend (`public/my-orders.html`)

Chỉ hiện với `user.vaiTro === 'admin'`:

- Thêm 1 dòng lọc đơn giản phía trên danh sách: nhãn "Người sản xuất" + `<select id="loc-nguoi-van-hanh">`.
- Options đổ ĐỘNG từ danh sách đơn đang tải (distinct `NguoiVanHanh`, bỏ giá trị rỗng, sắp theo
  `localeCompare('vi')`) — giống đúng cách `domLaiOChon()` ở `orders.html` đang làm, CHỈ đổ lại khi
  chưa chọn filter nào (tránh mất lựa chọn khi đang lọc, xem `capNhatCacBoLocDong`).
- Mặc định "Tất cả người sản xuất" (value rỗng). Chọn 1 tên → gọi lại `/orders` kèm
  `nguoiVanHanh=<tên>`.
- Đổi filter → gọi lại `taiDon()` (không cần debounce, dùng `<select>` không phải ô nhập tay).
- Thêm badge "Đang vận hành: {NguoiVanHanh}" trên mỗi thẻ đơn (icon `users`, giống hệt cách
  `orders.html` đang hiện ở dòng `o.TRANG_THAI_XUONG === 'Đang chạy máy'`) — CHỈ hiện khi
  `user.vaiTro === 'admin'` VÀ `o.NguoiVanHanh` có giá trị (khi không rõ vẫn giữ nguyên badge cảnh
  báo `NHAN_NGUOI_VAN_HANH_KHONG_RO` đã có).

### Không đổi

- `san_xuat`: không có dropdown, không có badge tên người vận hành mới (họ chỉ thấy đơn của chính
  mình, biết sẵn là của mình, không cần hiện lại tên).
- Badge cảnh báo "không rõ ai đang chạy" (`NHAN_NGUOI_VAN_HANH_KHONG_RO`) — giữ nguyên logic/hiển thị
  cho MỌI vai trò như hiện tại.
- Không đổi gì ở `orders.html` (route `GET /orders` chỉ được MỞ RỘNG thêm 1 filter tùy chọn, không
  ảnh hưởng hành vi cũ khi không truyền `nguoiVanHanh`).
