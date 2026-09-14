# Sửa lỗi: "Quét lại DHL" tính hash mới đúng nhưng KHÔNG BAO GIỜ xoá được nhóm cũ sai

Tiếp theo 2 spec ngày 14-15/09/2026 (`.trim()` và tăng lưới hash 256 bit). Người dùng xác nhận đã bấm
đúng nút "Quét lại DHL" (buộc tính lại hash cho toàn bộ đơn đang chọn, không chỉ đơn thiếu hash) — kết
quả gộp nhóm VẪN Y HỆT trước đó (cùng mã nhóm, cùng số lượng đơn, cùng thành viên) dù đã 2 lần sửa
thuật toán hash. Việc "vẫn y hệt sau khi đổi thuật toán 2 lần" là dấu hiệu KHÔNG PHẢI lỗi thuật toán
hash nữa — quay lại systematic-debugging Phase 1, rà lại toàn bộ luồng thay vì sửa tiếp hash.

## 1. Root cause — tìm thấy ở tầng LƯU TRỮ KẾT QUẢ, không phải tầng SO SÁNH ẢNH

Đọc lại `routes/orders.js#tinhLaiNhomHangLoat()` (hàm ghi `NHOM_HANG_LOAT` sau khi so hash) phát hiện:
đơn KHÔNG khớp ai khác TRONG LÔ đang quét lần này thì code **CHỈ giữ nguyên mã nhóm cũ, KHÔNG BAO GIỜ
xoá**, kể cả khi hash đã được tính lại THẬT SỰ với thuật toán mới và kết quả rõ ràng là "không còn
giống ai nữa". Đây là quyết định thiết kế CÓ CHỦ Ý từ tính năng gốc (xem
`docs/superpowers/specs/2026-09-06-quet-hang-loat-theo-lua-chon-design.md`) — lý do chính đáng: lô đang
quét có thể chỉ là 1 PHẦN nhỏ của 1 nhóm lớn hơn, đơn không khớp ai TRONG LÔ vẫn có thể thật sự khớp 1
đơn NGOÀI lô chưa được xét lại — xoá nhầm sẽ tách đơn ra khỏi nhóm nó vẫn đang thuộc về.

**Vấn đề**: khi người dùng chủ động chọn TOÀN BỘ 1 nhóm (hoặc phần lớn) rồi bấm "Quét lại DHL" — đúng
mục đích "muốn đánh giá lại nhóm này với thuật toán mới" — logic bảo vệ trên vẫn áp dụng y hệt, khiến
1 nhóm SAI do thuật toán CŨ tạo ra tồn tại VĨNH VIỄN: mỗi lần quét lại, thuật toán mới ĐÚNG khi kết
luận "đơn này không khớp ai trong lô nữa", nhưng ngay sau đó mã nhóm SAI lại được giữ nguyên vì đơn
"không khớp ai trong lô". Không có cách nào từ giao diện thoát khỏi vòng lặp này trước bản sửa này.

## 2. Hướng sửa — chỉ xoá khi đã xét lại ĐẦY ĐỦ toàn bộ nhóm cũ

Phân biệt 2 tình huống thay vì coi "không khớp ai trong lô" là 1 trường hợp duy nhất:

- **Lô chỉ là 1 phần của nhóm cũ** (còn thành viên khác của nhóm đó NẰM NGOÀI lô đang quét) → GIỮ
  NGUYÊN như thiết kế gốc — chưa đủ bằng chứng để kết luận.
- **Lô đã bao phủ ĐẦY ĐỦ toàn bộ thành viên hiện tại của nhóm cũ đó** (mọi đơn từng mang mã nhóm này
  đều nằm trong lô đang quét lại lần này) → ĐÃ xét lại toàn diện, an toàn để XOÁ mã nhóm cũ nếu đơn
  không còn khớp ai.

Cài đặt: trước khi ghi, dựng bản đồ "mã nhóm cũ -> toàn bộ STT_Key đang mang mã đó" (quét TOÀN BỘ
`tatCaDon`, không chỉ lô) — đơn không khớp ai trong lô thì kiểm tra: mọi STT_Key trong danh sách đó có
đều nằm trong `sttKeySet` không? Có thì xoá (`NHOM_HANG_LOAT: ''`), không thì giữ nguyên như cũ. Đơn
CHƯA từng tính được hash (`HASH_ANH_MAU` rỗng — ảnh lỗi/link chết) không đủ bằng chứng nên KHÔNG xoá dù
lô có bao phủ đủ hay không.

## 3. Vì sao không phát hiện sớm hơn (2 lần sửa hash trước)

Cả 2 lần sửa hash trước đều được kiểm bằng cách gọi TRỰC TIẾP `tinhHashAnh()`/`khoangCachHamming()`
qua ảnh giả lập — đúng đắn cho việc kiểm TỪNG PHÉP SO SÁNH ảnh, nhưng KHÔNG kiểm toàn bộ luồng
"quét lại rồi xem `NHOM_HANG_LOAT` trong Sheet có cập nhật đúng không" qua HTTP thật. Lỗi này nằm ở
bước SAU cùng (ghi kết quả), ngoài phạm vi 2 lần kiểm trước. Bài học: khi người dùng báo "kết quả
không đổi dù đã sửa thuật toán", cần nghi ngờ TẦNG LƯU/ĐỌC kết quả, không chỉ tầng TÍNH TOÁN — đặc biệt
sau khi đã xác nhận thuật toán tính toán tự nó đúng qua kiểm thử trực tiếp.

## 4. Đã kiểm tra

- `test-quet-hang-loat-scoped.js` (bản giả lập thuật toán, cập nhật thêm Case2b + Case6): nhóm cũ được
  xét lại ĐẦY ĐỦ và không còn khớp nhau -> xoá đúng cả 2; nhóm cũ CHỈ xét lại 1 phần (còn ai ngoài lô)
  -> vẫn giữ nguyên như thiết kế gốc; đơn không có hash -> không đủ bằng chứng, không xoá.
- `test-xoa-nhom-cu-sau-quet-lai.js` (MỚI, gọi THẬT qua HTTP `routes/orders.js`, không phải bản giả
  lập): kịch bản đúng như người dùng báo — 4 đơn cùng 1 mã nhóm SAI do thuật toán cũ, quét lại TOÀN BỘ
  bằng `buocLai:true`, hash MỚI (mock) cho biết chỉ 2/4 đơn thật sự giống nhau — xác nhận 2 đơn ngoại lệ
  được xoá đúng mã nhóm cũ, 2 đơn thật sự giống nhau vẫn được gộp đúng.
- Chạy lại toàn bộ 38 file test scratchpad (gồm 1 file mới + 1 file cập nhật) — không phát sinh lỗi
  mới, chỉ còn đúng 5 lỗi sẵn có từ trước, đã xác nhận nhiều lần trong phiên làm việc này là không
  liên quan.
- CHƯA kiểm trên dữ liệu Sheet thật — đây là lần thứ 3 liên tiếp cần người dùng quét lại DHL và xác
  nhận; do bản chất lỗi lần này (tầng lưu trữ, không phải tầng so sánh ảnh) khác hẳn 2 lần trước, có cơ
  sở tin tưởng cao hơn đây mới là nguyên nhân thật sự khiến kết quả "không đổi" suốt 2 lần sửa trước.
