# Thiết kế: Nút gộp "IN MÃ + IN DANH SÁCH PHÔI ĐƠN ĐANG CHỌN + IN ĐƠN ĐANG CHỌN"

Trang: `public/orders.html` (Danh sách đơn hàng).

## 1. Bối cảnh

Trang Đơn hàng hiện đã có sẵn, tách rời:
- Nút "Đã in mã" (thanh hành động hàng loạt, `#btn-xac-nhan`) — đổi `TRANG_THAI_XUONG` sang `'Đã in mã'` cho các đơn đã chọn.
- Nút "IN ĐƠN ĐANG CHỌN" (`#btn-in-don-dang-chon`) — in PDF thẻ đơn (ảnh + QR + ghi chú) cho các đơn đã chọn, chạy nền + tiến độ (job).
- Nút "IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN" (`#btn-in-phoi-ao`) — in PDF bảng tổng hợp phôi áo cần chuẩn bị, gộp theo Loại+Kích thước+Màu sắc.

Người dùng (admin, người vẽ file) muốn 1 nút duy nhất gộp cả 3 thao tác trên để làm 1 lần thay vì bấm 3 nút riêng.

Trạng thái đích ở bước đổi trạng thái là **"Đã in mã"** (trạng thái có sẵn trong pipeline — hệ thống không có trạng thái "Đã in đơn" riêng; đã xác nhận với người dùng).

## 2. Vị trí & hiển thị

- Thêm 1 nút mới vào thanh công cụ trên cùng `.thanh-cong-cu-danh-sach` (`public/orders.html`, cạnh 2 nút in hiện có), luôn hiển thị trong thanh này (không phụ thuộc đã chọn đơn hay chưa — giống 2 nút in kia).
- Nhãn nút: **"IN MÃ + IN DANH SÁCH PHÔI ĐƠN ĐANG CHỌN + IN ĐƠN ĐANG CHỌN"**, icon `printer` (giống 2 nút in hiện có).
- Chỉ hiển thị với vai trò `admin` và `ve_file` — ẩn hẳn (không render) với `san_xuat` và `nguoi_lay_phoi`. Dùng `user.vaiTro` lấy từ `requireLoginOrRedirect()` trong IIFE khởi tạo của trang (nơi đang gán nhãn/icon cho các nút khác, ~dòng 154-196).
- 2 nút in riêng lẻ hiện có **giữ nguyên**, không đổi hành vi — dùng khi chỉ cần in lại (reprint) mà không muốn đổi trạng thái.

## 3. Hành vi khi bấm

1. Nếu `donDaChonSet.size === 0` → `alert('Hãy chọn ít nhất 1 đơn muốn in.')`, dừng (giống 2 nút in hiện có).
2. `confirm()`: `Đánh dấu {N} đơn đã chọn thành "Đã in mã", đồng thời in file PDF đơn và file PDF danh sách phôi. Tiếp tục?` — hủy thì dừng.
3. Chụp lại `danhSach = Array.from(donDaChonSet)` ngay tại thời điểm bấm — dùng xuyên suốt cả 3 bước sau, không phụ thuộc `donDaChonSet` bị đổi (bị xoá/replace) giữa chừng khi các bước sau đang chạy.
4. Khoá nút trong suốt quá trình 3 bước, đổi nhãn tạm thời theo từng giai đoạn (dùng lại cơ chế icon `spinner`/`taoThanhTienDo` đã có ở `apDungNhanh`/`inDonHangLoatCoTienDo`):
   - **Bước 1 — Đổi trạng thái**: gọi tuần tự `POST /orders/chuyen-trang-thai-hang-loat` (`cot: 'TRANG_THAI_XUONG'`, `trangThaiMoi: 'Đã in mã'`) cho từng `sttKey` trong `danhSach`, tái dùng nguyên `chayHangLoatCoTienDo` + thanh tiến độ như hàm `apDungNhanh` đang làm. Ghi lại kết quả `{ thanhCong: [...], loi: [{sttKey, lyDo}, ...] }`.
   - **Bước 2 — In PDF đơn**: tái dùng nguyên `inDonHangLoatCoTienDo(nut, nhanGoc, { sttKeys: danhSach })` (job nền + polling tiến độ + tải file `don-can-in.pdf`) cho **toàn bộ** `danhSach` — chạy **không phụ thuộc** kết quả bước 1 (kể cả khi bước 1 có đơn lỗi, vẫn in PDF cho toàn bộ đơn đã chọn ban đầu). Ghi lại kết quả thành công/thất bại (và thông báo lỗi nếu có) của bước này — đây là 1 job xử lý theo lô, không có khái niệm "từng đơn OK/không OK" (ảnh lỗi tải thì tự vẽ ô "Không tải được ảnh..." ngay trong PDF, không làm hỏng cả job — xem `veTheDonPdf`).
   - **Bước 3 — In PDF phôi**: gọi `GET /api/reports/pdf?mau=phoi_ao_gop&sttKeys=...` (như `inPhoiDangChon`) cho **toàn bộ** `danhSach` — cũng chạy không phụ thuộc kết quả bước 1/2. Đây là 1 bảng tổng hợp (gộp theo Loại+Kích thước+Màu sắc), không có khái niệm "từng đơn" trong file kết quả, nên chỉ ghi nhận thành công/thất bại của cả bước.
5. Hiện **1 alert tổng kết duy nhất** sau khi cả 3 bước xong (nội dung chi tiết ở mục 4).
6. Bỏ chọn toàn bộ đơn (`donDaChonSet.clear()`), gọi lại `taiDon()` (giống hành vi hiện có của `apDungNhanh`).
7. Mở khoá nút, trả lại nhãn gốc.

Thứ tự bước 2 trước bước 3 theo đúng thứ tự người dùng liệt kê trong yêu cầu (in đơn trước, in phôi sau).

## 4. Nội dung Alert tổng kết

Vì mỗi bước có mức độ chi tiết khác nhau (bước 1 xử lý từng đơn nên có danh sách OK/chưa OK theo `sttKey`; bước 2/3 là xử lý theo lô/bảng tổng hợp nên chỉ có thành công/thất bại của cả file), alert tổng kết trình bày rõ theo từng bước:

```
KẾT QUẢ:

1) Đổi trạng thái "Đã in mã" — {thanhCong.length}/{N} đơn OK:
   ✔ OK: <sttKey>, <sttKey>, ...
   ✘ Chưa OK ({loi.length} đơn):
     - <sttKey>: <lyDo>
     - <sttKey>: <lyDo>

2) File PDF đơn (IN ĐƠN ĐANG CHỌN):
   ✔ Đã tạo và tải về thành công
   (hoặc) ✘ Lỗi: <thông báo lỗi>

3) File PDF phôi (IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN):
   ✔ Đã tạo và tải về thành công
   (hoặc) ✘ Lỗi: <thông báo lỗi>
```

Nếu bước 1 không có đơn nào lỗi, bỏ dòng "Chưa OK". Giữ định dạng text thuần (`alert()`), theo đúng quy ước hiện có của các hàm `apDungNhanh`/`apDungChuyenTrangThai` trong file này (không cần dựng UI/modal mới).

## 5. Xử lý lỗi

- 3 bước **độc lập hoàn toàn** — lỗi (hoặc lỗi 1 phần) ở bước nào chỉ được ghi nhận trong phần tương ứng của alert tổng kết ở bước 4, **không chặn** các bước tiếp theo chạy.
- Nếu bước 2 hoặc bước 3 ném lỗi (network, server lỗi, v.v.), bắt lỗi tại chỗ (try/catch quanh từng bước), ghi nhận thông báo lỗi để đưa vào alert tổng kết, KHÔNG để lỗi văng ra ngoài làm dừng luôn bước sau.

## 6. Phạm vi thay đổi

- **Chỉ sửa `public/orders.html`**:
  - Thêm nút mới vào `.thanh-cong-cu-danh-sach`.
  - Thêm logic ẩn nút theo vai trò trong IIFE khởi tạo (dựa vào `user.vaiTro`).
  - Thêm 1 hàm xử lý mới (vd `inMaPhoiDonDangChon()`) điều phối tuần tự 3 bước ở trên, tái sử dụng tối đa các hàm/API đã có (`chayHangLoatCoTienDo`, `apiFetch`, `inDonHangLoatCoTienDo`, logic fetch của `inPhoiDangChon`, `taiFileTuBlob`).
- **Không sửa backend** (`routes/orders.js`, `routes/reports.js`) — dùng nguyên các API/endpoint đã có, không đổi hợp đồng dữ liệu nào.

## 7. Ngoài phạm vi

- Không thêm trạng thái pipeline mới ("Đã in đơn" không tồn tại, dùng "Đã in mã" có sẵn).
- Không thêm khả năng theo dõi lỗi theo từng đơn cho bước in PDF (2 API in hiện tại xử lý theo lô/bảng tổng hợp, không trả về kết quả theo từng `sttKey`) — nếu sau này cần, phải sửa backend (`routes/reports.js`) để trả thêm thông tin chi tiết, nằm ngoài phạm vi thay đổi lần này.
