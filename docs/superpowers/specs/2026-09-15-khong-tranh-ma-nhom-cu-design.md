# Sửa lỗi: nhiều cụm complete-linkage khác nhau tranh lại CHUNG 1 mã nhóm cũ

Tiếp theo spec complete-linkage (cùng ngày). Người dùng quét lại DHL (ngưỡng vẫn đặt 0) — kết quả gần
như không đổi (107→104 đơn trong nhóm lớn nhất), dù thuật toán gộp đã đổi sang complete-linkage.

## 1. Vì sao nghi ngờ đây KHÔNG phải lỗi thuật toán gộp/hash nữa

Ngưỡng = 0 nghĩa là 2 đơn chỉ được coi là giống nhau khi hash 256 bit GIỐNG HỆT TUYỆT ĐỐI. Với
complete-linkage, 1 nhóm ≥2 đơn chỉ hình thành khi MỌI cặp trong nhóm đó giống hệt nhau. Để 104 thiết
kế rõ ràng khác nhau (ảnh mockup, chữ thêu, hoạ tiết Halloween, vải patchwork, ảnh chó...) đều giống hệt
NHAU TỪNG ĐÔI MỘT là gần như không thể — nếu điều đó thật sự xảy ra ở tầng SO SÁNH/GỘP, thuật toán gộp
mới (complete-linkage) đã có lỗi cài đặt nghiêm trọng. Cần XÁC MINH TRỰC TIẾP trước khi đoán tiếp.

## 2. Root cause — tìm bằng cách tự tái hiện, không đoán

Viết thử kịch bản: 2 cụm THẬT SỰ khác nhau (`BRIDE1~BRIDE2` giống hệt nhau, `HOCUS1~HOCUS2` giống hệt
nhau, nhưng 2 cặp này KHÁC HẲN nhau) — cả 4 đơn hiện ĐANG mang chung 1 mã nhóm cũ SAI `OLD_MEGA` (đúng
hậu quả nhóm bị chaining từ trước khi sửa complete-linkage). Chạy qua `gomNhomCompleteLinkage()` xác
nhận: **tách ĐÚNG thành 2 cụm nội bộ** `[BRIDE1,BRIDE2]` và `[HOCUS1,HOCUS2]` — bản thân việc GỘP đã
đúng. Nhưng bước GÁN MÃ NHÓM ngay sau đó (`routes/orders.js#tinhLaiNhomHangLoat`, đoạn "nếu component
đã có mã nhóm cũ thì nhập vào mã đó") lại cho CẢ 2 cụm cùng tra ra 1 mã cũ `OLD_MEGA` — vì CẢ 2 cụm đều
có thành viên đang mang mã đó, và code không hề kiểm tra xem mã cũ này đã bị 1 cụm KHÁC "nhận" trong
CHÍNH lượt xử lý này chưa. Kết quả: 2 cụm thật sự khác nhau lại cùng được gán 1 mã, "Nhóm hệ thống đề
xuất" (nhóm theo giá trị `NHOM_HANG_LOAT`) hiển thị lại y hệt 1 nhóm khổng lồ như trước — dù tầng thuật
toán gộp bên dưới đã hoàn toàn đúng.

**Đây giải thích chính xác vì sao 232→107→104 dịch chuyển rất chậm**: mỗi lần quét lại, complete-
linkage đúng ra đã âm thầm tách nhóm lớn thành nhiều cụm nhỏ đúng ở bên trong, nhưng bước gán mã lại
dán ĐÈ tất cả về lại đúng 1 nhãn cũ, khiến người dùng (chỉ nhìn thấy kết quả cuối — nhãn hiển thị) thấy
như không có gì thay đổi.

## 3. Hướng sửa

Theo dõi tập mã nhóm cũ ĐÃ bị 1 cụm nhận trong CHÍNH lượt xử lý này (`Set`). Khi xét 1 cụm mới: chỉ
được nhận 1 mã cũ nếu mã đó (a) có mặt trong cụm và (b) CHƯA nằm trong tập đã nhận — cụm nào xử lý
TRƯỚC (theo thứ tự hình thành) được ưu tiên giữ mã cũ; cụm xử lý SAU nếu thấy mã cũ đã bị nhận thì tự
tạo mã MỚI (STT_Key nhỏ nhất trong cụm) thay vì tranh giành.

## 4. Đã kiểm tra

- `test-quet-hang-loat-scoped.js` (bản giả lập thuật toán, thêm Case 8): đúng kịch bản 2 cặp thật sự
  khác nhau cùng mang 1 mã cũ — xác nhận SAU KHI SỬA, 2 cụm nhận 2 mã KHÁC NHAU thay vì tranh lại cùng
  1 mã. 7 case cũ (kể cả Case 7 chaining) vẫn pass nguyên vẹn.
- `test-khong-tranh-ma-nhom-cu.js` (MỚI, gọi THẬT qua HTTP `routes/orders.js`, ngưỡng=0 đúng như người
  dùng đang dùng): cùng kịch bản qua route thật — xác nhận Bridesmaid và Hocus Pocus nhận đúng 2 mã
  khác nhau sau khi sửa.
- Chạy lại toàn bộ 40 file test scratchpad (gồm 1 file mới + 1 file cập nhật) — không phát sinh lỗi
  mới, chỉ còn đúng 5 lỗi sẵn có từ trước, đã xác nhận nhiều lần trong phiên làm việc này là không
  liên quan.
- CHƯA kiểm trên dữ liệu Sheet thật — lần sửa thứ 5 liên tiếp cho tính năng này. Khác các lần trước
  (đều dựa trên suy luận + kiểm bằng ảnh/dữ liệu giả lập gián tiếp), lần này lỗi được XÁC NHẬN TRỰC
  TIẾP bằng cách tái hiện đúng cơ chế nghi ngờ trước khi sửa — mức độ tin cậy cao hơn hẳn các lần trước.
