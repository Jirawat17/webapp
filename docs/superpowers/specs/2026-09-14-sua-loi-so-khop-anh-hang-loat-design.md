# Sửa lỗi so khớp ảnh "Đơn hàng loạt" gộp nhầm thiết kế khác nhau

## 1. Vấn đề người dùng báo

Đặt ngưỡng Hamming về 0 (chặt nhất có thể — lý thuyết chỉ gộp ảnh GIỐNG HỆT) rồi quét lại, vẫn ra 1
"Nhóm hệ thống đề xuất" gồm 232 đơn có thiết kế HOÀN TOÀN KHÁC NHAU (áo Halloween, tên riêng viền hoa,
chữ đội bóng, monogram, ảnh mockup sản phẩm...) — chất lượng gợi ý vô dụng.

## 2. Rà soát — tìm root cause (systematic-debugging, không đoán/vá triệu chứng)

Đọc lại 2 phần liên quan:
- `routes/orders.js#tinhLaiNhomHangLoat()` — dùng Union-Find (Disjoint Set Union) gộp mọi cặp đơn có
  `khoangCachHamming(hashA, hashB) <= nguong`. Cấu trúc ĐÚNG chuẩn thuật toán (đã xác minh không có lỗi
  logic transitive-closure kiểu "A giống B, B giống C thì gộp cả A-C dù A-C khác hẳn" — vì bản thân
  từng CẶP A-B và B-C ở đây thực sự đều ra khoảng cách 0 THẬT theo hash, không phải lỗi thuật toán gộp).
- `services/perceptualHashService.js#tinhHashAnh()` — dHash 64-bit, resize ảnh gốc thẳng về lưới 9x8
  rồi so độ sáng từng cặp pixel liền kề.

**Tự tái hiện bằng ảnh giả lập** (không đoán): tạo 3 ảnh PNG thiết kế khác hẳn nhau (khối màu đặc đỏ /
khối màu đặc xanh lá / hoạ tiết caro đen trắng), mỗi ảnh là 1 vùng nội dung 120x120px đặt GIỮA 1 canvas
TRONG SUỐT 800x800 — ĐÚNG khuôn file PNG thiết kế thêu thực tế (canvas rộng để đặt linh hoạt lên nhiều
loại sản phẩm, nội dung thật chỉ chiếm 1 phần nhỏ ở giữa). Hash cả 3 ảnh: **ra ĐÚNG 1 hash giống hệt
nhau cho cả 3** — khoảng cách Hamming = 0 dù nội dung khác hoàn toàn.

**Nguyên nhân**: resize thẳng canvas 800x800 xuống lưới 9x8 (72 điểm lấy mẫu) khiến GẦN NHƯ TOÀN BỘ
điểm lấy mẫu rơi vào vùng nền TRONG SUỐT (chiếm >97% diện tích canvas) — nền trong suốt bị sharp
premultiply về đen GIỐNG HỆT NHAU ở MỌI ảnh bất kể nội dung thật là gì. Hash cuối cùng gần như CHỈ phản
ánh hình dạng/tỉ lệ canvas (giống nhau ở mọi đơn dùng chung khuôn xuất file), KHÔNG phản ánh nội dung
thiết kế thật. Ngưỡng có đặt 0 hay bao nhiêu cũng vô nghĩa vì bản thân hash đã sai từ đầu — không phải
lỗi so sánh/ngưỡng.

## 3. Hướng sửa

`sharp(buffer).trim()` TRƯỚC bước resize — cắt bỏ viền đồng nhất/trong suốt quanh nội dung, đưa vùng
nội dung thật chiếm phần lớn 9x8 điểm lấy mẫu thay vì bị nền nuốt chửng. Đã tự kiểm chứng bằng ảnh giả
lập TRƯỚC khi áp dụng (cùng kỷ luật đã dùng khi chọn kernel 'nearest' trước đây):

- 3 thiết kế khác hẳn nhau (đặc đỏ/đặc xanh/caro) trên canvas 800x800 → SAU khi thêm `.trim()`: đặc vs
  caro ra khoảng cách 20/64 (khác hẳn, đúng) — so với 0/64 trước khi sửa.
- Ảnh JPEG mockup (không có viền đồng nhất để cắt — nền ảnh chụp sản phẩm thật) → `.trim()` giữ nguyên
  kích thước gốc, không cắt nhầm vào nội dung ảnh.
- Ảnh trong suốt hoàn toàn / ảnh JPEG 1 màu đồng nhất toàn bộ (không có gì để "cắt viền" phân biệt với
  nền) → `.trim()` không throw, không cắt về kích thước 0, giữ nguyên ảnh gốc.
- Cùng 1 thiết kế nhưng canvas gốc khác kích thước (300x300 vs 800x800) → sau `.trim()` vẫn ra ĐÚNG hash
  giống nhau (khoảng cách 0) — nhận diện đúng "cùng thiết kế" bất kể khuôn canvas xuất file khác nhau.
- Cùng 1 thiết kế, lệch màu rất nhẹ (mô phỏng nén/đổi định dạng) → vẫn ra khoảng cách 0 — KHÔNG làm mất
  khả năng nhận diện ảnh trùng nhau thật (không "sửa quá tay").

## 4. Giới hạn còn lại (đã biết, KHÔNG thuộc phạm vi sửa lần này)

- dHash vốn dựa vào GRADIENT sáng/tối, không "nhìn thấy" màu sắc — 2 thiết kế cùng hình dạng nhưng chỉ
  khác màu (không khác gradient nội bộ) có thể vẫn ra khoảng cách gần 0. Thực tế thiết kế thêu có chữ/
  hoạ tiết (luôn có biên sáng-tối) nên hiếm gặp, nhưng vẫn là giới hạn vốn có của thuật toán, không phải
  lỗi sinh ra từ lần sửa này.
- Nhiều thiết kế dùng CHUNG 1 khuôn mẫu (vd viền hoa trang trí + tên riêng khác nhau ở giữa — thấy
  trong ảnh chụp màn hình người dùng gửi: SAS/KWJ/LPH/LKB/EBD/MSA đều chung khuôn viền hoa hồng, chỉ
  khác tên) vẫn có thể bị gộp chung vì khuôn viền (chiếm phần lớn diện tích, quyết định phần lớn
  gradient) áp đảo phần chữ tên (nhỏ, ở giữa) trên lưới thô 9x8 — đây là giới hạn CỐ HỮU của hash thô
  cho mục đích "gợi ý sơ bộ", không phải lỗi. Nếu sau khi sửa lần này vẫn thấy nhóm kiểu này gộp sai
  nhiều, cần bàn hướng khác hẳn (vd so khớp riêng vùng chữ, hoặc ngưỡng khắt khe hơn nữa).

## 5. Vận hành sau khi sửa

Đổi thuật toán KHÔNG tự động tính lại `HASH_ANH_MAU` đã lưu trong Sheet — các đơn đã hash trước đó vẫn
mang hash tính theo thuật toán CŨ (sai) cho tới khi được quét gợi ý lại. Người dùng cần "Quét gợi ý Đơn
hàng loạt" lại cho các đơn liên quan để nhóm đề xuất phản ánh đúng thuật toán đã sửa.

## 6. Đã kiểm tra

- `test-sua-loi-so-khop-anh-hang-loat.js` (7 test, gọi THẬT `tinhHashAnh()`/`khoangCachHamming()`,
  không mock): tái hiện đúng lỗi gốc rồi xác nhận đã hết (2 thiết kế khác hẳn trên canvas trong suốt
  lớn → khoảng cách > 8, vượt hẳn ngưỡng mặc định); xác nhận KHÔNG "sửa quá tay" (ảnh gần giống/cùng
  thiết kế khác canvas vẫn nhận đúng là giống); 3 trường hợp biên (ảnh trong suốt hoàn toàn, JPEG 1 màu
  đồng nhất, buffer rỗng) không throw, không đổi hành vi lỗi đầu vào so với trước.
- Chạy lại toàn bộ 36 file test scratchpad (gồm file mới) — không phát sinh lỗi mới, chỉ còn đúng 5 lỗi
  sẵn có từ trước, đã xác nhận nhiều lần trong phiên làm việc này là không liên quan.
- CHƯA kiểm được trên ảnh thiết kế THẬT của người dùng (chỉ có ảnh giả lập tự dựng) — cần người dùng tự
  quét gợi ý lại trên dữ liệu thật để xác nhận cuối cùng.
