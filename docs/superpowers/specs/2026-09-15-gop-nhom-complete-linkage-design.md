# Sửa lỗi "chaining" — đổi Union-Find (single-linkage) sang complete-linkage

Tiếp theo 3 spec ngày 14-15/09/2026 (`.trim()`, tăng lưới hash 256 bit, xoá nhóm cũ sau khi quét lại).
Sau khi sửa cả 3, người dùng xác nhận kết quả CÓ tốt hơn hẳn (nhóm 232→107 đơn) nhưng nhóm còn lại vẫn
rõ ràng lẫn lộn nhiều thiết kế khác nhau.

## 1. Quan sát mấu chốt từ dữ liệu thật

Nhìn kỹ bên trong nhóm 107 đơn còn lại: KHÔNG phải toàn bộ 107 đơn giống nhau ngẫu nhiên — có THỂ THẤY
RÕ nhiều cụm nhỏ ĐÚNG bên trong (nhiều thẻ "Bridesmaid est. 2027" giống hệt, nhiều thẻ "Hocus Pocus"
giống hệt, nhiều thẻ mèo đen+bí ngô giống hệt, nhiều Mickey&Minnie phù thuỷ giống hệt...) nhưng TẤT CẢ
các cụm nhỏ đúng này lại nằm chung 1 mã nhóm duy nhất. Đây KHÔNG phải dấu hiệu hash vẫn còn kém — đây
là dấu hiệu kinh điển của **"chaining"** trong thuật toán gộp nhóm kiểu single-linkage.

## 2. Root cause — Union-Find là single-linkage, không phải lỗi hash

`routes/orders.js` dùng Union-Find: hễ 2 đơn BẤT KỲ có khoảng cách Hamming ≤ ngưỡng thì gộp chung 1
nhóm — kể cả khi việc gộp diễn ra qua 1 CHUỖI trung gian (A gần B, B gần C thì A-B-C chung 1 nhóm dù
A-C có thể khác hẳn nhau). Với hàng trăm thiết kế thật, chỉ cần VÀI cặp "gần đúng biên ngưỡng" tình cờ
xuất hiện GIỮA các cụm nhỏ đúng khác nhau là đủ để nối TẤT CẢ thành 1 nhóm khổng lồ — càng nhiều đơn,
xác suất có ít nhất 1 cặp bắc cầu như vậy càng cao. Đã sửa 2 lần thuật toán hash (`.trim()`, tăng lưới
256 bit) đều đúng hướng (giảm được số cặp "gần đúng biên" giả) nhưng KHÔNG THỂ giải quyết chaining vì
đây là vấn đề của THUẬT TOÁN GỘP (Union-Find/single-linkage), không phải của phép SO SÁNH từng cặp.

## 3. Hướng sửa — complete-linkage

Thay Union-Find bằng gộp nhóm kiểu **complete-linkage**: 1 đơn chỉ được thêm vào 1 nhóm đang xây nếu
nó nằm trong ngưỡng với **MỌI** thành viên đã có trong nhóm đó (không chỉ 1 người). Cài đặt tham lam
theo thứ tự mảng (`gomNhomCompleteLinkage()`, thay hẳn `taoDSU()`) — không đảm bảo tối ưu toàn cục
(kết quả có thể phụ thuộc thứ tự duyệt đơn) nhưng LOẠI HẲN chaining: không còn cách nào để 1 cặp bắc
cầu kéo 2 cụm không liên quan lại với nhau. Chấp nhận đánh đổi "không tối ưu tuyệt đối" vì tính năng
này vốn LUÔN là gợi ý sơ bộ, người dùng tự xác nhận lại trước khi đưa vào Đơn hàng loạt chính thức
("Nhóm hệ thống đề xuất" ở `don-hang-loat.html`) — ưu tiên không gộp nhầm hơn là gộp tối ưu.

Phần logic phía sau (tái dùng mã nhóm cũ, chỉ xoá khi đã xét lại đầy đủ — xem spec ngày 15/09 trước)
giữ NGUYÊN không đổi — chỉ thay ĐÚNG bước tạo `theoNhom` (Map mã nhóm tạm -> danh sách đơn), hình dạng
Map giữ y hệt nên không cần sửa gì thêm ở phần dùng lại mã nhóm cũ/xoá mã nhóm.

## 4. Đã kiểm tra

- `test-quet-hang-loat-scoped.js` (bản giả lập thuật toán, thêm Case 7): dựng đúng kịch bản "2 cụm mật
  thiết nối nhau qua đúng 1 cặp bắc cầu" — xác nhận complete-linkage tách đúng 2 nhóm riêng, không bị
  nối chuỗi. 6 case cũ (đều chỉ có cặp/đơn lẻ, không có cụm 3+ nối qua cầu) vẫn pass nguyên vẹn — xác
  nhận đổi thuật toán không ảnh hưởng các tình huống đơn giản trước đó.
- `test-gop-nhom-complete-linkage.js` (MỚI, gọi THẬT qua HTTP `routes/orders.js`, không phải bản giả
  lập): cùng kịch bản bắc cầu nhưng qua route thật — xác nhận cụm (A1,A2,A3) và cụm (B1,B2) tách đúng
  2 nhóm dù có cầu nối A3~B1.
- Chạy lại toàn bộ 39 file test scratchpad (gồm 1 file mới + 1 file cập nhật) — không phát sinh lỗi
  mới, chỉ còn đúng 5 lỗi sẵn có từ trước, đã xác nhận nhiều lần trong phiên làm việc này là không
  liên quan.
- CHƯA kiểm trên dữ liệu Sheet thật — cần người dùng quét lại DHL lần nữa. Đây là lần sửa thứ 4 liên
  tiếp cho tính năng này — khác 3 lần trước (đều là sửa PHÉP SO SÁNH ảnh hoặc tầng LƯU kết quả), lần
  này sửa THUẬT TOÁN GỘP — có cơ sở kỹ thuật vững để tin đây là nguyên nhân còn lại của hiện tượng
  "nhiều cụm nhỏ đúng bị gộp chung 1 nhóm lớn" quan sát được trên dữ liệu thật.
