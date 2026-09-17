# Sửa lỗi ghi lệch dòng do Don_Hang_ALL được ghép bằng công thức QUERY/VSTACK sống

## 1. Triệu chứng ban đầu

Người dùng phát hiện 2 đơn **hoàn toàn khác nhau** (9LH466, 9LH467 — đã tự kiểm tra ảnh trong Drive)
lại mang **cùng 1 mã hash 256-bit** — với hash 256 bit, đây gần như không thể là trùng ngẫu nhiên.
Người dùng cũng thấy "1 số đơn tự động được bổ sung vào danh sách Đơn hàng loạt" không rõ lý do.

## 2. Root cause — đã xác nhận với người dùng

`Don_Hang_ALL` (tab chính mọi thao tác của app đọc/ghi, xem `services/orderService.js`) **không phải
sheet tĩnh** — cột "gốc" (STT_Key, tên khách, link ảnh...) là công thức **QUERY(VSTACK(...))** ghép từ
~19 sheet con theo mã khách/lô (K_RAW, LH_RAW, COM_RAW, U_RAW...), lọc + `ORDER BY` 1 cột ngày. Cột
app tự ghi (TRANG_THAI_XUONG, HASH_ANH_MAU, NHOM_HANG_LOAT, TRACKING...) là cột tĩnh, tách biệt.

Hệ quả: **vị trí dòng vật lý của 1 đơn có thể đổi bất cứ lúc nào công thức tính lại** — tức là bất cứ
lúc nào có 1 thay đổi ở BẤT KỲ ĐÂU trong 19 sheet con, hoàn toàn không liên quan tới thao tác của app.

Trong khi đó, MỌI đường ghi trong app đều theo khuôn: đọc 1 lần → nhớ số dòng vật lý (`_row`) → ghi
thẳng vào `${tab}!${cột}${_row}` (xem `services/sheetsService.js#updateCells`) — **không tra lại theo
STT_Key ngay trước khi ghi**. Nếu Don_Hang_ALL xáo trộn dòng giữa lúc đọc và lúc ghi, kết quả tính
ĐÚNG cho đơn A lại bị ghi NHẦM vào dòng đang thuộc đơn B tại đúng thời điểm ghi.

Đã rà toàn bộ code, xếp theo mức rủi ro (khoảng cách thời gian đọc↔ghi):

| Chỗ | Khoảng cách đọc↔ghi | Đã có "đọc lại gần lúc ghi" chưa |
|---|---|---|
| Vòng lặp tính hash Đơn hàng loạt (`routes/orders.js` `POST /quet-hang-loat/bat-dau`) | Vài phút (tải ảnh + tính hash từng đơn) | Có gọi `getAll()` mỗi đơn (cache 10s) nhưng CHỈ lấy `headers`, KHÔNG lấy lại `_row` |
| `tinhLaiNhomHangLoat()` | Ngắn hơn (chạy sau vòng lặp trên, thuần logic + ghi) | Có — tự đọc `getAll()` (cache 10s) ở đầu hàm |
| `canhBaoJob.js` (cron 30 phút) | Tuỳ số cảnh báo cần gửi (mỗi cảnh báo gọi Telegram thật) | Có — tự đọc `getAll()` (cache 10s) ở đầu hàm |
| 5 route hàng loạt `routes/orders.js` (đổi trạng thái, chỉ định người chạy máy/vẽ file, gán Xưởng, đánh dấu ưu tiên) + 1 route `routes/qr.js` (xác nhận kịch bản hàng loạt) | Vài giây — vài chục giây (tuỳ cỡ lô) | KHÔNG — dùng `getManyByKeys()` đọc 1 lần rồi lặp `update(..., {donDaDoc})`, `_row` không đổi suốt vòng lặp |
| `orderService.update()` gọi đơn lẻ (không qua `donDaDoc`) | Cực ngắn (đọc rồi ghi trong cùng 1 lần gọi hàm) | Có — vốn đã tự `getByKey({fresh:true})` |

Không đổi cấu trúc dữ liệu: chỉ `Don_Hang_ALL` bị ảnh hưởng (đã xác nhận với người dùng — các tab khác
app ghi vào — `CaiDatHangLoat`, `DonHangLoat`, `NguoiDung`, `Ton_Kho_Phoi` — là sheet bình thường).

## 3. Hướng sửa

**Nguyên tắc chung:** ngay TRƯỚC khi 1 lượt ghi (hoặc 1 loạt ghi) bắt đầu, phải biết số dòng vật lý
**MỚI NHẤT** của đúng STT_Key cần ghi — không tin số dòng đã "nhớ" từ 1 lượt đọc cũ hơn.

- **Thêm hàm dùng chung** `orderService.layLaiSoDongMoiNhat(sttKeys)` — đọc thật 1 lần
  (`getAll({fresh:true})`), trả về `Map<STT_Key, soDongVatLy>`. STT_Key nào không còn thấy (hiếm — đơn
  vừa bị lọc khỏi công thức) đơn giản là không có mặt trong Map.
- **`orderService.update()`** nhận thêm `tuyChon.soDongMoiNhat` (số dòng đã biết chắc là mới) — dùng số
  này để ghi thay vì `row._row` khi được truyền vào; giữ nguyên hành vi cũ (`row._row`) khi không truyền
  — không phá vỡ các chỗ gọi đơn lẻ đã an toàn sẵn.
- **5+1 route hàng loạt**: gọi `layLaiSoDongMoiNhat(sttKeys)` thêm đúng 1 lần, ngay TRƯỚC vòng lặp ghi
  (không phải trước bước đọc dữ liệu quyết định — vốn đã đọc ở `getManyByKeys`) — tốn thêm ĐÚNG 1 lượt
  đọc cho CẢ LÔ, không phải 1 lượt/đơn (không đụng lại vấn đề quota `getManyByKeys` từng sửa). STT_Key
  nào không còn trong Map mới → báo lỗi rõ ràng cho đơn đó (mẫu `loi.push(...)` có sẵn), bỏ qua, KHÔNG
  đoán/ghi liều.
- **Vòng lặp tính hash**: đã sẵn 1 lượt gọi `getAll()` (cache 10s) mỗi đơn để lấy `headers` — tận dụng
  ĐÚNG lượt đọc đó để lấy luôn số dòng mới nhất (không tốn thêm request nào so với hiện tại). Không tìm
  thấy STT_Key → xếp vào `donLoiHash` với lý do rõ ràng, không ghi liều.
- **`tinhLaiNhomHangLoat()` / `canhBaoJob.js`**: đã tự đọc `getAll()` ở đầu hàm nhưng dùng bản CÓ cache
  (tối đa 10s cũ) — đổi thành `getAll({ fresh: true })`, bỏ hẳn khả năng dính đúng lúc cache chưa hết
  hạn dù đã cách xa lúc job trước đó chạy.

**Không làm trong lần sửa này** (cân nhắc nhưng thấy chưa cần thiết, tránh phức tạp hoá quá mức so với
lỗi thật đã xác nhận): thêm lớp "đọc lại xác nhận SAU khi ghi" để phát hiện xung đột còn sót — nguyên
tắc "đọc lại ngay trước khi ghi" ở trên đã thu hẹp cửa sổ rủi ro xuống mức tối thiểu thực tế đạt được
(Google Sheets không có giao dịch/transaction thật ở tầng cell), thêm lớp dò xung đột nữa là suy đoán
cho 1 rủi ro đã giảm rất nhiều, chưa có bằng chứng vẫn còn xảy ra sau khi sửa.

## 4. Đã kiểm tra

- `test-sua-loi-ghi-lech-dong.js` (mới, 5 assertion): `layLaiSoDongMoiNhat()` trả đúng Map STT_Key →
  số dòng hiện tại, bỏ qua STT_Key không còn thấy; `update()` không truyền `soDongMoiNhat` vẫn dùng
  `row._row` (hành vi cũ, không vỡ); có truyền `soDongMoiNhat` thì DÙNG ĐÚNG số đó, bỏ qua `row._row`
  dù khác nhau — kể cả kịch bản ĐẦY ĐỦ mô phỏng chính xác lỗi thật (đọc lô lúc đầu → "công thức tính
  lại" xáo trộn dòng → tra lại ngay trước khi ghi → ghi đúng dòng MỚI, không ghi nhầm dòng CŨ).
- `test-don-uu-tien.js` + `test-giam-luot-doc-hang-loat.js` (đã có từ trước, cập nhật lại kỳ vọng số
  lượt đọc 1 → 2 cho đúng đánh đổi mới, có ghi chú rõ lý do đổi): toàn bộ pass — xác nhận hành vi CHỨC
  NĂNG (thành công/báo lỗi từng đơn) không đổi, chỉ tăng đúng 1 lượt đọc/lô như thiết kế.
- Rà lại toàn bộ `_row` còn sót trong `routes/orders.js`, `routes/qr.js`, `services/canhBaoJob.js` —
  xác nhận mọi lượt ghi vào `Don_Hang_ALL` đều dùng số dòng từ 1 lượt đọc `{fresh:true}` đủ MỚI ngay
  trước khi ghi (không còn chỗ nào tin số dòng "nhớ" từ trước một khoảng thời gian đáng kể).
- Chạy lại toàn bộ ~50 file test scratchpad — không phát sinh lỗi mới, chỉ còn đúng 5 lỗi sẵn có từ
  trước (không liên quan, đã xác nhận nhiều lần trong phiên làm việc này) + 1 lỗi của
  `test-cascading-type-size-v3.js` (test cho 1 file Apps Script Google Sheet KHÁC, không liên quan gì
  tới webapp này — lỗi vì kiến trúc INDIRECT/named-range đã bị bỏ, quay lại bản onEdit ở phiên trước).
- CHƯA kiểm trên dữ liệu Sheet thật (không có quyền truy cập Google Sheets từ môi trường này) — đặc
  biệt CHƯA kiểm được việc công thức QUERY/VSTACK thật sự xáo trộn dòng đúng như mô phỏng trong test.
