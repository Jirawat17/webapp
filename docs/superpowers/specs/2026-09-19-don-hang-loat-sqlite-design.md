# Chuyển "Đơn hàng loạt" (DonHangLoat) sang SQLite — tái thiết kế

## 1. Bối cảnh

Giai đoạn 3/3 (cuối) của việc chuyển 6 tab Sheets sang SQLite, tiếp nối Giai đoạn 1 (`2026-09-19-nhat-ky-sqlite-design.md`) và Giai đoạn 2 (`2026-09-19-cai-dat-sqlite-design.md`). Đây là tab phức tạp
nhất trong 6 tab — không phải log thuần, cũng không phải cấu hình 1 dòng, mà có CRUD thật (thêm/xoá/
đổi tên nhóm) trên dữ liệu **đang sống** (các nhóm "Đơn hàng loạt" hiện tại người dùng đang quản lý).

Người dùng chọn **tái thiết kế sạch** thay vì copy nguyên schema cũ: tách 2 bảng (nhóm + thành viên)
và dùng DELETE thật thay cho cờ `DaXoa='TRUE'` — khác 2 Giai đoạn trước, vốn giữ nguyên cấu trúc cột cũ.

## 2. Kiến trúc

**`services/donHangLoatDbService.js`** (mới) — 1 file `data/don_hang_loat.db`, 3 bảng:

- `dhl_nhom` (MaDonHangLoat khoá chính, TenNhom, NgayXacNhan, NguoiXacNhan) — 1 dòng/nhóm, KHÔNG còn
  lặp lại trên mọi dòng thành viên như Sheets cũ.
- `dhl_thanh_vien` (STT_Key khoá chính, MaDonHangLoat) — 1 dòng/đơn. **STT_Key làm khoá chính** tự
  động ép đúng ràng buộc nghiệp vụ "1 đơn chỉ thuộc đúng 1 Đơn hàng loạt" ở tầng schema (trước đây
  `timNhomKhacDangGiu()` phải tự quét toàn bộ rows mỗi lần).
- `dhl_bo_dem` (1 dòng, số DHL lớn nhất đã dùng) — mã DHLXX vẫn phải tăng dần, KHÔNG BAO GIỜ tái sử
  dụng số cũ dù nhóm đó đã bị xoá thật. Sheets cũ giữ được bảo đảm này nhờ dòng `DaXoa` vẫn còn VẬT LÝ
  để quét `MAX()`; xoá thật thì không còn gì để quét — cần bộ đếm riêng, tăng độc lập với việc
  xoá/không xoá nhóm.

**Quyết định phát sinh khi thiết kế — nhóm rỗng tự dọn**: xoá thành viên CUỐI CÙNG của 1 nhóm sẽ XOÁ
LUÔN cả nhóm đó (`xoaThanhVien()`), khớp đúng hành vi ngầm định cũ (Sheets cũ: nhóm mà mọi dòng đã
`DaXoa` coi như "không tồn tại" nữa qua `layDongCuaNhom()`) — nếu không, `dhl_nhom` sẽ tích luỹ các
dòng nhóm rỗng vô thời hạn (khác Sheets cũ, nơi "nhóm" chỉ là khái niệm phái sinh từ các dòng thành
viên, không phải 1 bảng riêng có thể "tồn tại nhưng rỗng").

**Atomic qua transaction** (`db.transaction()`) — tạo nhóm mới (metadata + toàn bộ thành viên ban đầu)
và xoá nhóm (nhóm + mọi thành viên) đều ghi trong 1 giao dịch duy nhất, tránh trạng thái nửa vời nếu
lỗi giữa chừng (vd trùng STT_Key lọt qua kiểm tra ở tầng service do race hiếm gặp).

**`services/donHangLoatService.js`** (nghiệp vụ) — viết lại toàn bộ 9 hàm để gọi
`donHangLoatDbService.js` thay vì `sheetsService.js`, **giữ nguyên 100% chữ ký hàm** (tên hàm, tham số,
giá trị trả về, thông báo lỗi) — `routes/donHangLoat.js` và `routes/orders.js` (dùng `layNguong()`)
**không cần sửa gì cả**.

## 3. Migrate dữ liệu hiện có — bắt buộc

**`scripts/migrate-don-hang-loat-tu-sheets.js`** (mới):
- Đọc toàn bộ Sheets, tính số DHL lớn nhất từng dùng (quét CẢ dòng `DaXoa`) để seed `dhl_bo_dem`.
- Chỉ migrate nhóm/thành viên **ĐANG hoạt động** (bỏ `DaXoa='TRUE'`) — đúng ngữ nghĩa "đã xoá thật".
- **Phòng hờ dữ liệu Sheets không nhất quán**: nếu 1 STT_Key active ở NHIỀU nhóm cùng lúc (vi phạm
  ràng buộc mới, có thể xảy ra nếu Sheets từng bị sửa tay ngoài luồng app) — giữ ở nhóm xuất hiện
  TRƯỚC, báo rõ và bỏ qua ở nhóm sau, KHÔNG crash.
- Idempotent, MẶC ĐỊNH bỏ qua nhóm SQLite đã có (tránh mất thay đổi làm qua giao diện sau lần migrate
  đầu). `--force`: xoá sạch nhóm đó rồi nạp lại nguyên từ Sheets — **giới hạn đã biết**: nếu nhóm bị
  force nạp lại có 1 STT_Key hiện đang thuộc 1 nhóm KHÁC (không bị force trong cùng lượt chạy), lệnh
  sẽ ném lỗi ràng buộc SQLite thô (không có xử lý mềm riêng cho trường hợp hiếm này).

### Trình tự deploy (người dùng cần làm)

1. Deploy code có tính năng này.
2. Chạy `node scripts/migrate-don-hang-loat-tu-sheets.js` (không `--apply`) để xem trước.
3. Chạy lại với `--apply` — làm TRƯỚC khi cần dùng lại menu "Đơn hàng loạt" (thiếu bước này: mọi nhóm
   hiện tại "biến mất" khỏi giao diện, dữ liệu gốc vẫn còn nguyên trong Sheets, migrate lại được).

## 4. Không làm trong lần sửa này

- Không đụng `NHOM_HANG_LOAT` (gợi ý tự động theo ảnh, cột riêng trên `Don_Hang_ALL`) — khái niệm
  hoàn toàn khác, tách biệt từ đầu.
- Không xoá tab `DonHangLoat` khỏi Sheets thật.

## 5. Đã kiểm tra

- `test-don-hang-loat-db-service.js` (mới, 18 assertion): sinh mã tăng dần, **atomic rollback đầy đủ**
  khi lỗi giữa chừng (không để lại nhóm mồ côi), tự dọn nhóm rỗng, `napNhomTuMigrate`/`datSoLonNhatBoDem`
  (kể cả gọi với số NHỎ HƠN không làm lùi bộ đếm).
- `test-don-hang-loat-service.js` (đã có từ trước, viết lại Nhóm 2-6 dùng SQLite thật `:memory:`):
  49 assertion — mọi hành vi nghiệp vụ cũ (chặn khác Xưởng, chặn 1 đơn thuộc nhiều nhóm, lọc Xưởng ở
  `layDanhSachNhom`, tìm theo tên nhóm) đều giữ nguyên, chỉ đổi cách seed/xác nhận dữ liệu.
- `test-migrate-don-hang-loat.js` (mới, 14 assertion, spawn tiến trình con thật): dry-run, `--apply`
  bỏ nhóm đã xoá hết, idempotent không ghi đè, `--force` ghi đè đúng, dữ liệu trùng lặp không nhất
  quán được xử lý an toàn không crash.
- Sweep toàn bộ ~75 file test scratchpad: đúng nguyên baseline 23 file đã biết trước đó (đối chiếu kỹ
  `test-gop-nhom-complete-linkage.js`, `test-khong-tranh-ma-nhom-cu.js` — xác nhận lỗi vẫn CÙNG nguyên
  nhân cũ, không liên quan thay đổi lần này) — không phát sinh lỗi mới.
