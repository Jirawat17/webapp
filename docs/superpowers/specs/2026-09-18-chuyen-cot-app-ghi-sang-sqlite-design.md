# Chuyển các cột app tự ghi của Don_Hang_ALL sang SQLite

## 1. Bối cảnh

Tiếp nối `docs/superpowers/specs/2026-09-17-sua-loi-ghi-lech-dong-vstack-design.md`: bản sửa 17/09/2026
chỉ đóng lỗ hổng ghi SAI dòng TẠI THỜI ĐIỂM app ghi. Rà sâu hơn thì phát hiện lỗ hổng LỚN HƠN, không
sửa được bằng cách ghi thông minh hơn: cột app tự ghi (TRANG_THAI_XUONG, HASH_ANH_MAU...) là Ô TĨNH
nằm CHUNG Don_Hang_ALL với cột công thức QUERY/VSTACK SỐNG — Sheets không biết "ô này thuộc đơn nào",
chỉ biết "dòng N". Nếu RAW sheet đổi làm công thức tính lại VÀ xếp lại thứ tự (thêm/xoá dòng, hoặc chỉ
cần đổi giá trị cột dùng `ORDER BY`), dữ liệu app ĐÃ ghi đúng trước đó có thể bị "lạc chủ" — hoàn toàn
độc lập với bất kỳ hành động ghi nào của app, kể cả khi không ai dùng webapp.

Người dùng chọn hướng B/C (tách cột app-ghi ra khỏi Don_Hang_ALL, gắn lại theo STT_Key) ở "mức vừa",
dùng **SQLite** làm nơi lưu (thay vì 1 sheet phụ) — đã đánh giá tốc độ/quy mô phù hợp (~30.000 dòng/
tháng, dư sức so với khả năng SQLite).

## 2. Phạm vi

Người dùng đã tự tái cấu trúc Google Sheet, xác nhận rõ ranh giới:

- **A:AM của Don_Hang_ALL (và các sheet RAW)** — 39 cột, vùng công thức QUERY/VSTACK sống, app CHỈ ĐỌC,
  không bao giờ ghi (giữ nguyên, không đổi gì).
- **AN:BR của Don_Hang_ALL** — 31 cột app tự ghi, chuyển hẳn sang SQLite: TRANG_THAI_PHOI,
  TRANG_THAI_VE_FILE, QUOC_GIA, MA_CODE_STT, MA_KHACH_HANG, NGUOI_VAN_HANH, Anh_File_Theu_URL,
  Anh_Da_San_Xuat_URL, TRONG_LUONG, TRANG_THAI_XUONG, Anh_Da_Dan_Tem_URL, NGUOI_VE_FILE,
  GHI_CHU_VE_FILE, NGUOI_CHAY_MAY, GHI_CHU_CHAY_MAY, HASH_ANH_MAU, NHOM_HANG_LOAT, AUTO_TRACKING,
  THOI_GIAN_IN_MA, IN_LABEL, THOI_GIAN_IN_LABEL, DON_UU_TIEN, TAM_THOI, HANG_VAN_CHUYEN, TRACKING_ID,
  TRANG_THAI_TRACKING, THOI_GIAN_CAP_NHAT_TRACKING, KHACH_HANG, XUONG, NguoiCapNhatCuoi,
  ThoiGianCapNhatCuoi.
- **CanhBaoDaGui** — phát hiện thêm khi rà code (`services/canhBaoJob.js`, cờ chống spam Telegram):
  không nằm trong danh sách 31 cột người dùng liệt kê (nhiều khả năng chỉ sót khi liệt kê tay) nhưng
  đúng tiêu chí "app tự ghi" — xếp chung vào SQLite (32 cột tổng).
- **Không migrate dữ liệu cũ** — người dùng chấp nhận đơn cũ "trắng trạng thái" (theo yêu cầu rõ ràng),
  bắt đầu với dữ liệu mới.

### Phát hiện phát sinh trong lúc rà soát — đã hỏi và chốt với người dùng

`DUONG_DAN_URL`/`MOCKUP` nằm trong vùng A:AM (RAW, app không ghi được nữa) nhưng code cũ (`routes/
photos.js`, mốc `mau`/`mockup`) VẪN đang ghi 2 cột này — xung đột trực tiếp với cấu trúc Sheet mới,
không liên quan gì tới SQLite. Người dùng chọn: **xoá hẳn 2 mốc ảnh này** — từ giờ `DUONG_DAN_URL`/
`MOCKUP` chỉ nhập tay ở sheet RAW lúc lên đơn, app chỉ đọc không ghi (rà thêm xác nhận: chưa từng có nút
UI nào thật sự gọi 2 mốc này ở `order.html`/`scan.html` — chỉ tồn tại ở tầng API, xoá an toàn).

## 3. Kiến trúc

Toàn bộ điểm ghi vào Don_Hang_ALL trước đây ĐÃ chỉ đi qua đúng 1 hàm — `orderService.js#update()`
(xác nhận qua rà `orderService.update(` trên toàn repo) — nên chỉ cần sửa đúng module này, không đụng
route nào khác:

- **`services/trangThaiDbService.js`** (mới) — bảng SQLite `trang_thai_don(stt_key TEXT PRIMARY KEY,
  <32 cột> TEXT)`, tạo schema tự động lúc khởi động (`CREATE TABLE IF NOT EXISTS`). API: `layTheoKey`,
  `layTatCa` (đọc), `ghiDe` (UPSERT theo `stt_key`, CHỈ ghi đúng cột có trong `updates` — giữ đúng ngữ
  nghĩa ghi 1 phần của `updateCells` cũ). STT_Key luôn `.trim()` trước khi dùng làm khoá (đúng tiền lệ
  đã sửa 1 lần ở tính năng Đơn hàng loạt, tránh lặp lại lỗi khoảng trắng).
- **`services/orderService.js#getAll()`** — sau khi đọc Don_Hang_ALL (A:AM) từ Sheets, GỘP thêm dữ liệu
  từ `trangThaiDbService.layTatCa()` theo STT_Key vào cùng row object. Đơn chưa từng có dòng trong
  SQLite (đơn mới) nhận toàn bộ 32 cột giá trị rỗng — đúng hành vi cũ khi các cột này còn là ô Sheets
  trống. `getByKey()`/`getManyByKeys()` tự động thừa hưởng (đều xây trên `getAll()`).
- **`services/orderService.js#update()`** — toàn bộ ~300 dòng logic nghiệp vụ (tự động chuyển trạng
  thái, validate...) GIỮ NGUYÊN không đổi 1 dòng (chỉ đọc/ghi tên cột trên object, không quan tâm dữ
  liệu vật lý ở đâu) — chỉ đổi bước ghi CUỐI CÙNG: `updateCells(TAB, headers, row._row, ...)` →
  `trangThaiDbService.ghiDe(sttKey, ...)`. Ghi theo khoá — không còn khái niệm "số dòng vật lý", nên
  **xoá hẳn** `layLaiSoDongMoiNhat()`/`tuyChon.soDongMoiNhat` (bản sửa 17/09/2026) — cơ chế đó tồn tại
  CHỈ để phục vụ đúng kiểu ghi theo số dòng đã bị bỏ hẳn ở đây; theo yêu cầu người dùng, xoá cả code lẫn
  test liên quan thay vì giữ lại code chết.
- **`routes/orders.js`** — 5 route hàng loạt bỏ hẳn bước `layLaiSoDongMoiNhat()`; vòng lặp tính hash và
  `tinhLaiNhomHangLoat()` đổi từ tự đọc lại Sheet để tra `_row` trước khi ghi → gọi thẳng
  `trangThaiDbService.ghiDe(sttKey, ...)` (đơn giản hơn HẲN — không còn cần đọc lại gì trước khi ghi).
- **`routes/qr.js`** — route hàng loạt (`xac-nhan-hang-loat`) bỏ `layLaiSoDongMoiNhat()`; route đơn lẻ
  không đổi gì (vốn đã an toàn, không dùng cơ chế đó).
- **`services/canhBaoJob.js`** — ghi `CanhBaoDaGui` đổi từ `updateCells` trực tiếp sang
  `trangThaiDbService.ghiDe`.
- **`routes/photos.js`** — xoá mốc `mau`/`mockup` khỏi `COT_ANH_THEO_MOC`; xoá các guard
  `headers.includes(cotAnh)` (cả ở đây lẫn trong `orderService.update()`) cho các cột giờ LUÔN có sẵn
  trong schema SQLite — không còn ý nghĩa "cột có thể chưa được thêm vào Sheet" nữa.
- **Dọn dẹp phát sinh**: xoá `routes/orderService.js` — bản sao CŨ, MỒ CÔI của service này (không có
  `require()` nào trỏ tới, xác nhận qua rà toàn repo) phát hiện tình cờ khi tìm kiếm mọi chỗ còn dùng
  `_row`/`updateCells` cho Don_Hang_ALL.

## 4. Hạ tầng

- **Driver**: `better-sqlite3` — đồng bộ, nhanh, phổ biến nhất cho Node. Ảnh Docker hiện `node:20-alpine`
  KHÔNG có `node:sqlite` built-in (chỉ từ Node 22.5+), nên bắt buộc cần driver ngoài.
- **Dockerfile**: thêm `python3 make g++` làm `.build-deps` TẠM THỜI trước `npm ci`, gỡ ngay sau —
  đảm bảo LUÔN biên dịch được native module ngay trong Alpine (musl) dù có/không có bản dựng sẵn khớp
  đúng kiến trúc/Node/musl, tránh lặp lại đúng kiểu sự cố native-binary đã gặp với `sharp`.
- **docker-compose.yml**: thêm volume `./data:/app/data` — BẮT BUỘC, vì trước đó KHÔNG có volume nào
  cho dữ liệu ứng dụng; thiếu volume này, dữ liệu SQLite sẽ mất mỗi lần rebuild/redeploy.
- **Đường dẫn DB**: `process.env.SQLITE_DB_PATH` (mặc định `data/trang_thai_don.db`), `PRAGMA
  journal_mode = WAL` (cho phép đọc đồng thời trong lúc đang ghi).

## 5. Không làm trong lần sửa này

- **Không migrate dữ liệu cũ** — theo đúng yêu cầu người dùng, đơn cũ chấp nhận "trắng trạng thái".
- **Không dọn cột AN:BR khỏi Sheet thật** — để nguyên, vô hại (app không đọc/ghi nữa), tránh thao tác
  rủi ro không cần thiết trên Sheet đang sống; người dùng có thể tự dọn sau nếu muốn.
- **Không đổi `headers.includes(...)` guard ở `services/trackingAutoService.js`** — cùng loại guard đã
  dọn ở `orderService.js`/`routes/photos.js` nhưng chưa đụng tới ở file này (vẫn đúng chức năng vì Sheet
  thật còn giữ header cũ, chỉ là dư thừa) — có thể dọn sau, không ảnh hưởng đúng/sai.
- **Không sửa `scripts/migrate-trang-thai*.js`** (4 file) — script migrate 1 lần cho các lần đổi giá
  trị trạng thái trước đây, không nằm trong luồng chạy server, không ai chạy lại.

## 6. Đã kiểm tra

- `test-trang-thai-db-service.js` (mới, 19 assertion): UPSERT ghi đúng/ghi 1 phần không mất dữ liệu cũ,
  `.trim()` khoá, lọc cột lạ không thuộc bảng, không tạo dòng rác khi updates rỗng sau lọc, không lẫn
  field kỹ thuật `stt_key`, giá trị null/undefined thành chuỗi rỗng.
- `test-order-service-sqlite-merge.js` (mới, 12 assertion): `getAll()` gộp đúng SQLite vào row Sheets;
  `update()` ghi qua SQLite, KHÔNG còn gọi `updateCells`; toàn bộ hook tự động (auto-fill phôi/file khi
  in mã...) vẫn hoạt động đúng sau khi đổi kiến trúc; **tái hiện đúng kịch bản lỗi gốc** (Don_Hang_ALL
  xáo trộn dòng GIỮA lúc đọc và lúc ghi) và xác nhận SQLite ghi đúng đơn theo STT_Key, không còn khả
  năng lệch dòng — đúng mục tiêu gốc của toàn bộ 2 lần sửa (17/09 + 18/09/2026).
- `test-giam-luot-doc-hang-loat.js` + `test-don-uu-tien.js` (đã có từ trước, cập nhật lại để seed
  `trangThaiDbService` thay vì đặt trạng thái thẳng vào Sheet giả lập): toàn bộ pass (12 + 31 assertion)
  — xác nhận số lượt đọc Sheets cho thao tác hàng loạt quay VỀ ĐÚNG 1 (tốt hơn cả bản gốc 13/09/2026,
  vì không còn cần lượt đọc thêm để tra số dòng nữa).
- Chạy lại toàn bộ ~50 file test scratchpad — **CÒN NỢ**: 16 file test khác (đều thuộc nhóm route/
  service liên quan Đơn hàng/Đơn hàng loạt/Xưởng) hiện FAIL vì cùng 1 nguyên nhân cơ học: đặt sẵn giá
  trị trạng thái thẳng vào Sheet giả lập (kiến trúc CŨ) thay vì seed `trangThaiDbService` (kiến trúc
  MỚI) — không phải dấu hiệu lỗi chức năng thật, chỉ là test chưa cập nhật theo kiến trúc mới. Đã xác
  nhận qua đối chiếu: KHÔNG có lỗi mới nào ngoài đúng nhóm 16 file này + 6 lỗi baseline đã biết từ
  trước (5 không liên quan + 1 test Apps Script không liên quan webapp này). Việc cập nhật 16 file còn
  lại đã được đề xuất tách thành 1 phiên làm việc riêng (cùng 1 khuôn sửa cơ học, lặp lại cho từng
  file) — xem task đã tạo.
- CHƯA build/chạy thử trong Docker thật (không có Docker trong môi trường này) — đặc biệt CHƯA xác
  nhận `better-sqlite3` biên dịch thành công trong Alpine thật với thay đổi Dockerfile — chỉ xác nhận
  cài đặt/chạy được trên máy Windows đang phát triển. Cần build thử trước khi deploy.
