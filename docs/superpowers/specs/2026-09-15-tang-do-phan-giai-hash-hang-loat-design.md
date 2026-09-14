# Tăng độ phân giải hash "Đơn hàng loạt" — vẫn gộp nhầm thiết kế chữ ngắn sau khi đã sửa .trim()

Tiếp theo [2026-09-14-sua-loi-so-khop-anh-hang-loat-design.md](2026-09-14-sua-loi-so-khop-anh-hang-loat-design.md)
(đã sửa lỗi canvas trong suốt lớn nuốt mất tín hiệu ảnh thật).

## 1. Bằng chứng thực tế người dùng gửi (sau khi đã quét lại với bản sửa .trim())

Ảnh chụp "Nhóm hệ thống đề xuất" thực tế cho thấy nhóm 9LH245 (54 đơn) vẫn gộp chung nhiều thiết kế
CHỮ NGẮN hoàn toàn khác nhau: tên trường/đội (CINCINNATI, OHIO STATE, NOTRE DAME, FLORIDA STATE,
INDIANA, WASHINGTON STATE, CLEVELAND Browns, PENN STATE, ALABAMA...), tên riêng (Clara, Nayeli, Talya,
Theodore John), hình con vịt, biểu tượng y tế, gấu bông, Minnie Mouse. Bản sửa .trim() đã đúng hướng
(không còn lỗi canvas nuốt tín hiệu) nhưng CHƯA đủ cho lớp thiết kế này.

## 2. Rà soát tiếp — vì sao .trim() chưa đủ

Khác lần trước (dựng ảnh khối màu/hoạ tiết đơn giản), lần này tự dựng chữ THẬT bằng SVG (đúng khuôn
"1-2 dòng chữ đậm, canh giữa, nền trắng" thấy trong ảnh chụp) rồi đo bằng `tinhHashAnh()` thật:

- Lưới hash HIỆN TẠI (9x8 = 64 bit): 6 thiết kế tên trường/đội hoàn toàn khác nhau (CINCINNATI, OHIO
  STATE, NOTRE DAME, ALABAMA, INDIANA, PENN STATE) có CẶP GẦN NHAU NHẤT chỉ cách nhau **8/64 bit** —
  ĐÚNG BẰNG ngưỡng mặc định (8). Tức hash không phải "gần đúng nhưng lệch ngưỡng" — nó THỰC SỰ không
  đủ độ phân giải để phân biệt 2 dòng chữ đậm khác nhau trên nền trắng khi ép về lưới 8x8 so sánh. Đây
  là giới hạn CỐ HỮU của lưới quá thô, không phải lỗi ngưỡng hay lỗi .trim().

## 3. Hướng sửa — tăng lưới hash 9x8 (64 bit) lên 17x16 (256 bit)

Đo lại CHÍNH 6 thiết kế trên ở nhiều lưới:

| Lưới | Tổng bit | Khoảng cách NHỎ NHẤT giữa 2 thiết kế khác nhau | Khoảng cách ảnh gần giống hệt (lệch màu nhẹ) |
|---|---|---|---|
| 9x8 (cũ) | 64 | 8 (12.5%) | 0 |
| **17x16 (mới)** | **256** | **49 (19.1%)** | **0** |
| 33x32 | 1024 | 177 (17.3%) | 0 |

17x16 cho biên an toàn TƯƠNG ĐỐI tốt nhất trong 3 mức đã thử (gần gấp đôi tỉ lệ % so với lưới cũ) mà
vẫn nhận đúng ảnh gần giống hệt là gần 0 — không "sửa quá tay" tới mức không nhận ra ảnh trùng nữa.

## 4. Đánh đổi đã phát hiện (minh bạch, không giấu)

Lưới càng mịn càng NHẠY hơn với việc ảnh bị resize qua 1 bước trung gian dùng kernel MƯỢT trước khi
tới đây (vd nếu 1 công cụ khác từng thu nhỏ ảnh bằng kernel mặc định trước khi lưu vào Drive) — đo
được: cùng 1 thiết kế, giả lập đã bị resize 1 lần bằng kernel mượt trước đó, khoảng cách với bản gốc
tăng từ ~9% (lưới cũ) lên ~26% (lưới mới) — có thể VƯỢT ngưỡng dù thực chất là cùng 1 thiết kế.

**Quyết định**: chấp nhận đánh đổi này. Vấn đề THỰC TẾ người dùng đang gặp (gộp nhầm hàng loạt thiết kế
khác hẳn nhau, tính năng gần như vô dụng) nghiêm trọng hơn hẳn nguy cơ LÝ THUYẾT này (chưa có bằng
chứng nó thực sự xảy ra trên dữ liệu thật — quy trình xuất file của người dùng có thể không hề đi qua
bước resize trung gian nào). Ghi lại rõ trong code để dễ tra cứu nếu sau này phát hiện vấn đề ngược lại
(ảnh THẬT SỰ giống nhau không được gộp).

## 5. Ngưỡng — đổi theo tỉ lệ, KHÔNG đổi ý nghĩa tương đối

`NGUONG_TOI_DA`: 32 → 128 (giữ nguyên ý nghĩa "tối đa 50% khác nhau" — 32/64 = 128/256 = 50%).
`NGUONG_MAC_DINH`: 8 → 32 (giữ nguyên ~12.5%). Cập nhật nhãn + `max` ở `don-hang-loat.html` từ "0–32"
thành "0–128" theo đúng thang mới.

**Lưu ý người dùng**: ngưỡng ĐANG LƯU trong tab `CaiDatHangLoat` (nếu khác 0/mặc định) sẽ bị hiểu SAI
theo thang mới — cùng 1 con số giờ chiếm tỉ lệ % NHỎ HƠN hẳn trong tổng 256 bit so với 64 bit cũ (chặt
hơn dự định ban đầu, không phải lỏng hơn — hướng an toàn, nhưng vẫn nên tự kiểm tra/đặt lại nếu trước
đó có chỉnh khác mặc định).

## 6. Đã kiểm tra

- `test-sua-loi-so-khop-anh-hang-loat.js` cập nhật thêm: 6 thiết kế chữ THẬT (SVG, tên trường/đội) —
  khoảng cách nhỏ nhất giữa 2 cái bất kỳ giờ > 32 (vượt ngưỡng mặc định mới), so với ngang bằng ngưỡng
  cũ trước khi sửa. Toàn bộ test cũ (canvas trong suốt, ảnh gần giống, trường hợp biên) vẫn pass với
  lưới mới — đo trực tiếp độ dài hash thật thay vì hardcode số bit.
- Cập nhật 2 test SẴN CÓ (`test-don-hang-loat-service.js`, `test-don-hang-loat-routes-dispatch.js`) có
  hardcode giá trị ngưỡng cũ (mặc định 8, biên 32) sang giá trị mới (32, 128) — đúng theo thay đổi có
  chủ đích, không phải sửa để "cho qua" lỗi.
- Chạy lại toàn bộ 36 file test scratchpad — không phát sinh lỗi mới, chỉ còn đúng 5 lỗi sẵn có từ
  trước, đã xác nhận nhiều lần trong phiên làm việc này là không liên quan.
- CHƯA kiểm được trên ảnh thiết kế THẬT của người dùng (chỉ có ảnh SVG tự dựng mô phỏng) — cần người
  dùng quét gợi ý lại lần nữa trên dữ liệu thật để xác nhận cuối cùng, đặc biệt chú ý đánh đổi ở mục 4.
