# Phân loại đơn hàng theo Xưởng (HANOI/BACNINH)

Theo yêu cầu người dùng: xưởng thêu vận hành 2 địa điểm vật lý (HANOI, BACNINH). Cần (1) admin phân
loại mỗi đơn thuộc xưởng nào, (2) mỗi nhân viên (gán theo cột Xưởng ở tab NguoiDung) chỉ xem/thao tác
được đơn cùng Xưởng với mình; admin luôn xem/thao tác được mọi đơn.

## 1. Xác nhận trước khi code

Người dùng đã tự thêm cột `XUONG` vào `Don_Hang_ALL`. Trước khi code, xác nhận thêm 3 điểm qua hỏi đáp:

1. **Phạm vi chặn**: áp dụng cho CẢ xem (danh sách/báo cáo/dashboard/chatbot/tracking) LẪN thao tác
   (quét QR, chụp ảnh xác nhận, mua tracking, in label...) — không chỉ ẩn ở màn hình danh sách.
2. **Mặc định khi chưa gán** (giai đoạn chuyển đổi, ngay sau khi triển khai): đơn CHƯA gán Xưởng hoặc
   nhân viên CHƯA gán Xưởng đều bị ẩn với người thường (không phải admin) — ưu tiên an toàn dữ liệu
   hơn tiện lợi.
3. **Nơi admin gán Xưởng cho đơn**: CHỈ chọn hàng loạt ở trang Đơn hàng (không có điều khiển riêng ở
   trang chi tiết 1 đơn).

Phát hiện quan trọng trong lúc rà soát: tab `NguoiDung` ĐÃ có sẵn cột `Team` — nhưng đây là khái niệm
KHÁC (nhóm nhỏ trong xưởng, dùng riêng cho báo cáo tỷ lệ lỗi sản xuất theo nhóm — `routes/reports.js`),
không liên quan gì tới vị trí xưởng vật lý. Thêm cột MỚI `Xuong` (PascalCase, khớp quy ước
`Ten`/`VaiTro`/`Team`/`KichHoat` hiện có của tab này), không đụng vào `Team`.

## 2. Thiết kế dữ liệu

- `Don_Hang_ALL.XUONG` — giá trị `HANOI` / `BACNINH` / rỗng (chưa gán). Người dùng tự thêm.
- `NguoiDung.Xuong` — cùng miền giá trị, gán cho từng nhân viên. Cần người dùng tự thêm cột này (chưa
  có sẵn, khác `XUONG` bên đơn hàng).
- `services/orderService.js#DANH_SACH_XUONG = ['HANOI', 'BACNINH']` — hằng số cố định (cùng khuôn
  `TINH_TRANG_VALUES`), cần sửa code nếu sau này có thêm xưởng thứ 3.
- `req.session.user.xuong` — đọc từ `NguoiDung.Xuong` lúc đăng nhập (`routes/auth.js`), cùng cách
  `team` đã có. **Nhân viên đang đăng nhập cần đăng xuất/đăng nhập lại để phiên có `xuong` mới** nếu
  vừa được admin gán/đổi Xưởng trong lúc đang đăng nhập (session không tự làm mới, cùng đặc điểm sẵn có
  của `vaiTro`/`team`).

## 3. Lõi dùng chung — `services/orderService.js`

Ba hàm mới:

```js
function locTheoXuong(rows, user) {
  if (user.vaiTro === 'admin') return rows;
  if (!user.xuong) return [];
  return rows.filter(r => r.XUONG === user.xuong);
}

function coQuyenTheoXuong(user, row) {
  if (user.vaiTro === 'admin') return true;
  return !!user.xuong && !!row.XUONG && user.xuong === row.XUONG;
}
```

`filterForRole(rows, user)` (điểm chốt lọc SẴN CÓ, dùng bởi `routes/orders.js#GET /` và
`routes/chatbot.js`) gọi thêm `locTheoXuong()` sau bước lọc trạng thái riêng của `san_xuat` — 2 tầng
lọc độc lập, kết hợp lại. `kiemTraGiaTriHopLe()` (điểm ghi chung, trong `update()`) thêm kiểm tra
`XUONG` phải thuộc `DANH_SACH_XUONG` (hoặc rỗng — cho phép gỡ gán).

**Quy ước "coi như không tồn tại"**: mọi nơi đọc/thao tác 1 đơn cụ thể mà `coQuyenTheoXuong()` trả về
`false` đều trả lỗi/nhóm GIỐNG HỆT trường hợp "không tìm thấy đơn" thật — không có thông báo "sai
xưởng" riêng, tránh lộ việc 1 mã đơn CÓ tồn tại ở xưởng khác (cùng triết lý đã áp dụng cho san_xuat
khác người vận hành đơn "Đang chạy máy").

## 4. Nơi admin gán Xưởng — `POST /orders/gan-xuong` (MỚI)

Cùng khuôn `/chi-dinh-nguoi-chay-may`/`/chi-dinh-nguoi-ve-file` (chỉ admin, nhận mảng `sttKeys`, trả
`{thanhCong, loi}`). `xuong` rỗng hợp lệ (gỡ gán). Route sửa 1 đơn dùng chung (`PUT /orders/:sttKey`)
CẤM sửa `XUONG` (thêm vào `TRUONG_CAM_SUA`) — bắt buộc đi qua đúng 1 đường này, không lách qua form sửa
chi tiết kể cả admin/ve_file. `public/orders.html` thêm khối "Gán Xưởng" trong thanh hành động hàng
loạt (giống hệt 2 khối "Chỉ định" đã có) + badge "Xưởng: ..." trên mỗi thẻ đơn (chỉ admin thấy).
`public/order.html` thêm dòng "Xưởng" (đọc, không sửa) vào bảng thông tin đầy đủ (admin/ve_file).

## 5. Toàn bộ điểm chặn/lọc đã rà soát và sửa

**Xem/danh sách** (qua `locTheoXuong`/`filterForRole`):
- `routes/orders.js GET /` (qua `filterForRole`, tự động).
- `routes/chatbot.js POST /hoi` (qua `filterForRole`, tự động).
- `routes/dashboard.js GET /thong-ke`.
- `routes/reports.js`: `layDonDaLoc()` (dùng chung bởi `/xem-truoc`, `/excel`, `/pdf`,
  `/don-can-in/bat-dau`), `/trang-thai-theo-loc`, `/thong-ke-loi`, `/thong-ke-hoan-don`,
  `/thoi-gian-chay-may`. KHÔNG sửa `/khach-hang` (danh mục khách hàng dùng chung, không gắn 1 xưởng cụ
  thể) và `/hieu-suat-theo-nguoi` (đã admin-only sẵn, không cần thêm).
- `services/trackingAutoService.js#layDanhSachDonAutoTracking(user)` — thêm tham số `user`, CHỈ dùng
  cho route hiển thị (`routes/tracking.js GET /danh-sach`), KHÔNG dùng bởi job tự động
  `chayQuetTuDongMuaTracking()` (job phải xử lý mọi xưởng).

**Thao tác trên 1 đơn cụ thể** (qua `coQuyenTheoXuong`, coi như không tìm thấy nếu sai):
- `routes/orders.js`: `GET /:sttKey`, `PUT /:sttKey`, vòng lặp trong
  `POST /chuyen-trang-thai-hang-loat`, lọc `sttKeySet` trong `POST /quet-hang-loat/bat-dau`.
- `routes/qr.js`: `GET /tra-cuu/:sttKey`, `POST /kich-ban/:id/quet`, `POST /kich-ban/:id/kiem-tra`,
  vòng lặp trong `POST /kich-ban/:id/xac-nhan-hang-loat`.
- `routes/photos.js`: `POST /kiem-tra`, `POST /upload`.
- `routes/tracking.js`: vòng lặp trong `POST /mua-thu-cong` và `xuLyInLabelHangLoat()` (dùng chung bởi
  `/in-label`, `/mua-va-in-label`) — đọc thêm 1 lượt `getByKey` qua cache TRƯỚC khi gọi vào
  `services/trackingAutoService.js` (không sửa các hàm đó — vẫn nhận `user` chỉ để ghi log, không tự
  kiểm tra quyền, tránh đá nhầm cơ chế chặn vào nhánh job tự động dùng chung code).
- `routes/chatbot.js`: 2 tool đọc thẳng theo mã (`tra_cuu_don_hang`, `tra_cuu_lich_su_don`) — phát hiện
  khi rà soát kỹ: cả 2 CỐ Ý bỏ qua `ctx.duLieuTheoQuyen` (đã lọc) để tự đọc theo mã người dùng cung
  cấp, nên phải tự kiểm tra lại, nếu không sẽ lộ đơn xưởng khác qua chatbot dù mọi nơi khác đã chặn.

**Không sửa (đã rà, xác nhận không cần)**: `routes/hoatDong.js` (chỉ đọc SO_LUONG theo STT_Key đã biết
từ chính lịch sử hoạt động của người xem, không duyệt danh sách đơn); `routes/kiem-tra-tinh-hop-le.js`
(script CLI chạy tay bởi admin, không phải endpoint web); `routes/orders_old.js` (không được mount
trong `server.js`, code chết).

## 6. Đã kiểm tra

48 kịch bản test (module thật, mock service phụ thuộc qua `require.cache`, gọi thẳng handler qua
`router.stack` — không mock lại `orderService.js`/`trackingAutoService.js` khi test route khác, để xác
nhận cả phần lõi lẫn cách nối dây):

- `services/orderService.js` (17 kịch bản) — `locTheoXuong`/`coQuyenTheoXuong` cho đủ tổ hợp admin/
  cùng xưởng/khác xưởng/chưa gán 1 hoặc cả 2 bên; `filterForRole` kết hợp đúng lọc trạng thái
  (san_xuat) + lọc xưởng; `kiemTraGiaTriHopLe` từ chối giá trị sai, chấp nhận giá trị đúng và rỗng
  (gỡ gán).
- `routes/orders.js` (16 kịch bản) — `GET`/`PUT /:sttKey` chặn đúng theo xưởng; `POST /gan-xuong` chặn
  non-admin, từ chối giá trị sai, gán/gỡ gán đúng; `PUT /:sttKey` không cho lách sửa `XUONG`; vòng lặp
  `chuyen-trang-thai-hang-loat` bỏ qua đúng đơn khác xưởng, không đụng dữ liệu thật của đơn đó.
- `routes/qr.js`/`routes/chatbot.js`/`routes/reports.js` (5 kịch bản) — quét đúng xưởng thành công,
  khác xưởng trả về y hệt "không tìm thấy"; xác nhận tĩnh 2 tool chatbot có gọi đúng
  `coQuyenTheoXuong(ctx.user, row)`; báo cáo trạng thái lọc đúng theo xưởng người xem.
- `routes/tracking.js`/`routes/users.js`/`routes/dashboard.js` (10 kịch bản) — mua tracking CHỈ gọi
  cho đơn cùng xưởng (không gọi service thật cho đơn khác xưởng); validate `Xuong` khi tạo/sửa nhân
  viên; thống kê dashboard lọc đúng theo xưởng.

Giao diện — test tương tác qua trang mock (script trích NGUYÊN VĂN từ file thật, tải kèm
`js/icons.js`/`js/api.js` thật) qua Browser pane:
- `public/users.html` — form thêm mới có đủ 3 lựa chọn Xưởng; bảng nhân viên hiện đúng cột Xưởng, đổi
  qua dropdown trong bảng gọi đúng `PUT /users/:ten`.
- `public/orders.html` — khối "Gán Xưởng" chỉ hiện với admin (đúng options, đúng lời gọi
  `POST /orders/gan-xuong`), ẩn hẳn với ve_file; badge "Xưởng: ..." trên thẻ đơn chỉ admin thấy.

Không có Sheet/server thật trong sandbox — chưa xác nhận được: (1) cột `Xuong` đã thực sự tồn tại
trong tab `NguoiDung` (người dùng cần tự thêm, khác `XUONG` bên đơn hàng đã có sẵn); (2) hành vi thật
khi nhân viên đang đăng nhập được gán Xưởng giữa chừng (cần đăng xuất/vào lại mới có hiệu lực, như đã
nêu ở mục 2).
