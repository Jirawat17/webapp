# Thiết kế: Tự động nhận diện "ĐƠN HÀNG LOẠT" bằng perceptual hash ảnh mẫu

Trang: `public/orders.html` (Danh sách đơn hàng). Backend: `routes/orders.js`.

## 1. Bối cảnh & mục tiêu

Một số đơn dùng chung 1 thiết kế thêu (ảnh mẫu giống hệt hoặc gần giống nhau — chỉ khác định dạng/độ
nén/kích thước do được export lại) — gọi là "đơn hàng loạt". Người vận hành muốn hệ thống tự nhận ra
các đơn này và xếp vào 1 nhóm để dễ chạy máy liên tục cùng 1 thiết kế.

Đã khảo sát và loại các phương án khác:
- Không có cột định danh thiết kế nào có sẵn (`MA_THIET_KE` không tồn tại).
- So khớp URL y hệt nhau (`DUONG_DAN_URL`) chỉ bắt được khi nhân viên dùng chung đúng 1 link — vô
  dụng với ảnh upload qua MinIO (mỗi lần upload luôn sinh UUID mới dù đúng file).
- Dùng AI (CLIP embeddings / hỏi mô hình vision so 2 ảnh) khả quan nhưng tốn phí, cần gửi ảnh khách
  hàng ra ngoài, và thiên về so khớp "ý nghĩa/phong cách" hơn là "có phải cùng 1 file hay không" —
  không phù hợp bằng 1 công cụ chuyên so khớp ảnh gần-giống-hệt.
- **Đã chọn: perceptual hash (dHash)** — nhẹ, chạy local, miễn phí, đúng đối tượng bài toán (bắt được
  cả ảnh bị resize/đổi định dạng/nén lại mà vẫn là cùng 1 thiết kế).

## 2. Thay đổi dữ liệu (Google Sheet — cần người dùng tự thêm cột trước)

Thêm 2 cột mới vào tab `Don_Hang_ALL` (theo đúng quy ước hiện có — vd `Anh_Dong_Goi_URL` cũng phải tự
thêm trước khi dùng, xem `routes/photos.js`):
- **`HASH_ANH_MAU`** — mã vân tay ảnh mẫu (`DUONG_DAN_URL`), chuỗi hex 16 ký tự (64 bit). Tính 1 lần,
  giữ nguyên trừ khi đang trống (chưa tính được).
- **`NHOM_HANG_LOAT`** — mã nhóm hàng loạt, hệ thống tự tính lại mỗi lần quét. Giá trị = `STT_Key` nhỏ
  nhất (so sánh chuỗi) trong nhóm — dễ nhận biết, không cần sinh UUID riêng. Trống = đơn không thuộc
  nhóm nào (đơn lẻ, không có đơn nào khác cùng thiết kế).

Nếu 1 trong 2 cột chưa tồn tại trong Sheet, API quét trả lỗi rõ ràng (giống cách `routes/photos.js:55-57`
đang làm), không âm thầm bỏ qua.

**Tự xoá hash cũ khi ảnh mẫu đổi** (phát hiện khi tự rà soát thiết kế, không phải yêu cầu ban đầu
nhưng cần thiết để tránh dữ liệu sai lặng lẽ): nếu 1 đơn được sửa `DUONG_DAN_URL` sang giá trị khác
(qua bất kỳ đường nào — sửa tay ở trang chi tiết đơn, upload ảnh mới qua `routes/photos.js`...), hash
cũ (`HASH_ANH_MAU`) đang trỏ tới ảnh CŨ sẽ sai lệch nếu không xoá. Thêm 4 dòng vào
`services/orderService.js` hàm `update()` (ngay trước khi ghi Sheet): nếu Sheet đã có cột
`HASH_ANH_MAU` VÀ `DUONG_DAN_URL` đang đổi sang giá trị khác (và bên gọi không tự set thẳng
`HASH_ANH_MAU` trong `updates`) thì tự đặt `HASH_ANH_MAU = ''` (và `NHOM_HANG_LOAT = ''` nếu cột này
cũng đã có) — đơn sẽ được tính hash lại ở lượt quét kế tiếp. Có guard theo `headers.includes(...)` nên
hoàn toàn vô hại với các bản cài đặt chưa thêm 2 cột mới.

## 3. Thuật toán

- **Thư viện**: thêm `sharp` vào `package.json` (đọc/resize ảnh). Cân nhắc rủi ro: Docker build dùng
  `node:20-alpine` (musl libc) — dự án từng gặp vấn đề tương tự với Puppeteer/Chromium trên Alpine
  (xem `Dockerfile:5-9`). `sharp` có bản dựng sẵn cho `linuxmusl-x64` nên `npm ci` trên Alpine sẽ tự
  chọn đúng bản — nhưng PHẢI build thử Docker image sau khi thêm để xác nhận, không giả định suông.
- **dHash 64-bit**: resize ảnh về 9×8 pixel, chuyển xám, so sánh độ sáng từng cặp pixel liền kề theo
  hàng → 64 bit → lưu dạng hex (16 ký tự).
- **So khớp**: khoảng cách Hamming (đếm số bit khác nhau) giữa 2 hash. Ngưỡng **≤ 5/64 bit** coi là
  cùng thiết kế — hằng số dễ chỉnh (`NGUONG_HAMMING` trong code), ưu tiên chặt để tránh gộp nhầm 2
  thiết kế khác nhau; có thể nới lỏng sau khi thấy dữ liệu thật.
- **Gom nhóm**: coi mỗi đơn có hash là 1 đỉnh đồ thị, nối cạnh giữa 2 đơn có khoảng cách Hamming ≤
  ngưỡng, tìm các thành phần liên thông (union-find). Thành phần có ≥ 2 đơn → gán `NHOM_HANG_LOAT`
  (mã = STT_Key nhỏ nhất trong thành phần); thành phần chỉ có 1 đơn → để trống. Đây là phép so khớp
  O(n²) giữa mọi cặp đơn có hash — chấp nhận được ở quy mô hiện tại (hàng trăm–vài nghìn đơn), CHƯA
  cần tối ưu bằng chỉ mục (LSH/bucket) — ghi rõ giới hạn này để biết khi nào cần quay lại tối ưu.

## 4. Cơ chế chạy: thao tác thủ công (không dùng cron)

Thêm nút **"QUÉT TÌM ĐƠN HÀNG LOẠT"** vào thanh công cụ trên cùng của `public/orders.html` (cạnh các
nút Lọc/Sắp xếp/In hiện có), hiển thị cho mọi vai trò xem được trang này (không giới hạn theo vai trò).

Dùng lại đúng mô hình "chạy nền + hỏi tiến độ định kỳ + có nút Dừng" đã có cho "IN ĐƠN ĐANG CHỌN"
(`routes/reports.js` `_congViecInDon` Map + `bat-dau`/`tien-do`/`huy`) — thêm 3 route tương tự trong
`routes/orders.js`:

- `POST /orders/quet-hang-loat/bat-dau` — tạo job, trả về `{jobId, tongSo}` (`tongSo` = số đơn đang
  thiếu `HASH_ANH_MAU` và có `DUONG_DAN_URL`). Job chạy nền (không await trước khi trả response):
  1. Với từng đơn thiếu hash (xử lý **tuần tự**, không xử lý song song — tránh dồn tải MinIO/Drive
     cùng lúc, đúng quy ước hiện có của `veTrangDonCanInPdf`/`chayHangLoatCoTienDo`): tải ảnh mẫu qua
     service dùng chung (mục 5), tính dHash, ghi ngay vào Sheet (không đợi xong hết mới ghi hàng loạt
     — để dừng giữa chừng vẫn giữ được phần đã làm). Lỗi tải ảnh (link chết, định dạng lạ) → bỏ qua,
     để trống, KHÔNG chặn các đơn còn lại.
  2. Sau khi xử lý xong (hoặc bị dừng giữa chừng), đọc lại TOÀN BỘ đơn đã có hash (kể cả hash cũ từ
     trước, không chỉ vừa tính), chạy lại thuật toán gom nhóm ở mục 3, ghi `NHOM_HANG_LOAT` cho mọi
     đơn (kể cả xoá mã nhóm cũ nếu đơn không còn thuộc nhóm nào — đơn khác trong nhóm cũ đã bị xoá/sửa
     ảnh chẳng hạn).
  3. Đóng job, lưu kết quả tóm tắt: `soDaQuet`, `soTinhDuocHash`, `soNhomTimThay`, `soDonTrongNhom`.
- `GET /orders/quet-hang-loat/tien-do/:jobId` — poll tiến độ, giống hệt cấu trúc job đã có.
- `POST /orders/quet-hang-loat/huy/:jobId` — đặt cờ dừng, đơn đang xử lý dở vẫn hoàn tất, các đơn còn
  lại không xử lý tiếp — SAU ĐÓ vẫn chạy bước gom nhóm (mục 3, bước 2 ở trên) dựa trên các hash đã có,
  không bỏ qua bước này dù bị hủy giữa chừng (tận dụng công đã làm).

Client (`public/orders.html`): tái sử dụng nguyên `taoThanhTienDo()`/polling pattern đã dùng cho
`inDonHangLoatCoTienDo()`. Alert tổng kết cuối: "Đã quét N đơn, tính được hash cho M đơn, tìm thấy K
nhóm hàng loạt (tổng cộng X đơn)."

## 5. Tách logic tải ảnh dùng chung (refactor cần thiết, không phải tùy chọn)

`routes/reports.js:438-502` hiện có 4 hàm tải ảnh đa nguồn (`taiUrlTho`, `taiAnhTuUrlThuong`, `taiAnh`,
`taiDsAnh` — xử lý MinIO/Drive file/Drive folder/Gemini/URL thường) nhưng đang **private trong route
file**, không dùng lại được. Chuyển 4 hàm này sang **`services/anhNguonService.js`** (module mới), giữ
nguyên logic 100% — chỉ đổi chỗ ở, không đổi hành vi. `routes/reports.js` import lại từ service mới
thay vì định nghĩa tại chỗ. Job quét hàng loạt (mục 4) và `routes/reports.js` cùng dùng chung
`taiAnh(url)` để lấy Buffer ảnh mẫu chính (không cần `taiDsAnh` — chỉ cần 1 ảnh đại diện để tính hash,
không cần lấy hết ảnh trong thư mục Drive nếu `DUONG_DAN_URL` là link thư mục — dùng `taiDsAnh` rồi lấy
phần tử đầu tiên, đúng quy ước "ảnh đầu tiên là ảnh chính" đã áp dụng ở `taiAnhChoDon`).

**`services/perceptualHashService.js`** (module mới): 2 hàm thuần túy, dễ test độc lập:
- `tinhHashAnh(buffer)` — dùng `sharp` tính dHash 64-bit, trả về chuỗi hex hoặc `null` nếu ảnh lỗi/định
  dạng không đọc được.
- `khoangCachHamming(hexA, hexB)` — trả về số bit khác nhau giữa 2 chuỗi hex.

## 6. Bộ lọc trên trang Đơn hàng

Thêm 1 ô checkbox **"Chỉ đơn hàng loạt"** vào panel Lọc sẵn có (`#panel-loc`), cạnh các bộ lọc
phôi/vẽ file. Wiring theo đúng quy ước hiện có của `CAC_O_LOC`/`taiDon()`/`xoaTatCaLoc()` — vì đây là
checkbox (không phải `<select>`), `taiDon()` đọc `.checked` thay vì `.value`, gửi lên server dạng
`?hangLoat=1` khi được tick. `xoaTatCaLoc()` cần xử lý riêng (đặt `.checked = false`, không phải
`.value = ''`).

Backend `GET /orders` (`routes/orders.js:98-139`) thêm 1 dòng lọc theo đúng pattern các dòng lọc khác:
```js
if (hangLoat) list = list.filter(r => !!r.NHOM_HANG_LOAT);
```

## 7. Phạm vi thay đổi

- `package.json` — thêm dependency `sharp`.
- **Mới** `services/anhNguonService.js` — 4 hàm tải ảnh chuyển từ `routes/reports.js`.
- **Mới** `services/perceptualHashService.js` — tính hash + khoảng cách Hamming.
- `routes/reports.js` — xoá 4 hàm đã chuyển đi, import lại từ `services/anhNguonService.js` thay thế
  (không đổi hành vi in PDF hiện có).
- `routes/orders.js` — thêm 3 route job (bat-dau/tien-do/huy) + 1 dòng lọc `hangLoat` ở `GET /orders`.
- `services/orderService.js` — thêm logic tự xoá `HASH_ANH_MAU`/`NHOM_HANG_LOAT` cũ khi `DUONG_DAN_URL`
  đổi (mục 2), trong hàm `update()` đã có sẵn.
- `public/orders.html` — thêm nút toolbar, checkbox lọc, hàm JS gọi job + hiển thị tiến độ/kết quả
  (tái dùng `taoThanhTienDo`, `apiFetch`, mẫu polling đã có).

## 8. Ngoài phạm vi (không làm ở lần này)

- Không tự động chạy định kỳ (cron) — chỉ chạy khi bấm nút.
- Không giới hạn quyền bấm nút theo vai trò.
- Không tối ưu thuật toán gom nhóm vượt quá O(n²) (chỉ mục/LSH) — để dành khi thực tế cần.
- Không thêm badge/nhãn trên từng thẻ đơn hay nút "chọn nhanh cả nhóm" — chỉ có bộ lọc.
- Không xử lý ảnh trong `MOCKUP` (chỉ dùng `DUONG_DAN_URL` — ảnh mẫu/thiết kế gốc, đúng đối tượng cần
  so khớp "cùng thiết kế thêu").
