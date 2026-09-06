# Quét "Đơn hàng loạt" chỉ trong phạm vi đơn đang chọn

## Bối cảnh

Nút "QUÉT TÌM ĐƠN HÀNG LOẠT" ở `public/orders.html` (xem
`docs/superpowers/specs/2026-09-06-don-hang-loat-design.md`) hiện quét TOÀN BỘ đơn trong Sheet:
tính hash cho mọi đơn thiếu `HASH_ANH_MAU`, rồi gộp nhóm lại trên toàn bộ đơn đã có hash. Với Sheet
lớn, việc này chậm và không cần thiết khi người dùng chỉ muốn kiểm tra 1 lô đơn cụ thể vừa chọn.

Yêu cầu: nút này chỉ quét/gộp nhóm trong phạm vi các đơn đang được tick chọn (`donDaChonSet`),
không đụng đến đơn khác.

## Thay đổi

### 1. Client (`public/orders.html`)

- `quetDonHangLoat(nut)` bắt buộc phải có ≥1 đơn đang chọn — nếu `donDaChonSet.size === 0`, báo
  `alert('Hãy chọn ít nhất 1 đơn muốn quét.')` và dừng (giống `inDonDangChon()`).
- Gửi `sttKeys: Array.from(donDaChonSet)` trong body JSON của `POST /orders/quet-hang-loat/bat-dau`.
- Đổi chữ trong hộp `confirm()`: "Quét N đơn đang chọn để tìm và gộp nhóm 'Đơn hàng loạt'? ..."
  (N = số đơn đang chọn), thay cho "Quét toàn bộ đơn...".
- Không đổi cơ chế thanh tiến độ/nút Dừng/alert tổng kết.

### 2. Backend (`routes/orders.js`)

- `POST /quet-hang-loat/bat-dau` đọc thêm `sttKeys` từ `req.body`. Validate: phải là mảng, không
  rỗng, mọi phần tử là string — sai thì trả 400. Dựng `sttKeySet = new Set(sttKeys)`.
- `donThieuHash` lọc thêm `sttKeySet.has(d.STT_Key)` — chỉ tính hash cho đơn thiếu hash **trong lô
  đang chọn**.
- `tinhLaiNhomHangLoat(sttKeySet)` nhận thêm tham số `sttKeySet`:
  - `coHash` = đơn có `HASH_ANH_MAU` **và nằm trong `sttKeySet`** (bỏ hoàn toàn đơn ngoài lựa chọn
    khỏi phép so sánh — không đọc để so, không có nguy cơ đụng dữ liệu người khác).
  - Union-Find như cũ, nhưng chỉ trên tập con này.
  - Với mỗi nhóm liên thông (component) trong tập con:
    - **≥2 đơn, có sẵn ≥1 mã `NHOM_HANG_LOAT` khác rỗng** trong nhóm → dùng lại mã nhỏ nhất
      (theo `localeCompare`) trong các mã đã có, gán cho cả nhóm (nhập vào nhóm cũ).
    - **≥2 đơn, chưa ai có mã nhóm** → tạo mã mới = STT_Key nhỏ nhất trong nhóm (như cũ).
    - **Chỉ 1 đơn** (không khớp ai khác trong lô đang chọn) → **giữ nguyên** `NHOM_HANG_LOAT` hiện
      tại của nó, không ghi đè, không xoá — vì có thể nó vẫn thực sự trùng với 1 đơn KHÔNG nằm
      trong lần chọn này mà ta không kiểm tra lại.
  - Chỉ `updateCells` cho đơn **nằm trong `sttKeySet`** và có mã nhóm mới khác mã hiện tại — không
    đụng bất kỳ dòng nào ngoài lựa chọn.
  - Vẫn đọc `headers`/`rows` tươi (`orderService.getAll()`) ngay trước khi tính/ghi, giữ đúng quy
    ước "đọc thật ngay trước khi ghi" đã dùng trong toàn bộ tính năng này.
- Không đổi: cơ chế job chạy nền/tiến độ/dừng, khoá chống 2 lượt quét chạy song song, response
  `job.ketQua` (`soDaQuet`, `soTinhDuocHash`, `soNhomTimThay`, `soDonTrongNhom` — các số này giờ chỉ
  tính trong phạm vi lô đã chọn).

## Không đổi

- Bộ lọc "Chỉ đơn hàng loạt" (`loc-hang-loat`) ở trang danh sách — chỉ hiển thị đơn đã có
  `NHOM_HANG_LOAT`, không liên quan đến cách nhóm được tính.
- Ngưỡng Hamming (`NGUONG_HAMMING = 8`), thuật toán perceptual hash (`services/perceptualHashService.js`).
- Route `GET /quet-hang-loat/tien-do/:jobId`, `POST /quet-hang-loat/huy/:jobId`.

## Rủi ro / lưu ý

- Nếu người dùng chọn đơn rồi bấm quét nhiều lần với các lô chọn khác nhau, nhóm sẽ dần được xây
  đắp qua từng lần quét (nhập dần vào nhóm cũ) — đúng ý đồ, không mất dữ liệu nhóm cũ.
- Trường hợp hiếm: 1 component trong tập con chứa ≥2 mã nhóm cũ KHÁC NHAU (ví dụ đơn A đang ở nhóm
  "A", đơn B đang ở nhóm "B", nay quét thấy A khớp B) — chọn mã nhỏ nhất theo `localeCompare`, chấp
  nhận là hành vi đơn giản hợp lý, không cần xử lý phức tạp hơn (gộp 2 nhóm cũ hoàn toàn đòi hỏi
  quét toàn bộ Sheet để tìm hết thành viên nhóm kia — ngoài phạm vi tính năng này).
