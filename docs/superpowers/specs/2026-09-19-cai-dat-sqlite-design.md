# Chuyển 2 tab cấu hình (CaiDatHangLoat, CauHinhTracking) sang SQLite

## 1. Bối cảnh

Giai đoạn 2/3 của việc chuyển 6 tab Sheets sang SQLite (tiếp nối Giai đoạn 1 —
`2026-09-19-nhat-ky-sqlite-design.md`). 2 tab này đều là **cấu hình đúng 1 dòng duy nhất**, KHÔNG
tăng trưởng theo thời gian — nhưng KHÁC Giai đoạn 1: đây là dữ liệu **ĐANG SỐNG** (ngưỡng gộp ảnh đang
dùng cho "Đơn hàng loạt", tài khoản/cấu hình GKE đang chạy tracking thật), nên **bắt buộc phải migrate
giá trị hiện có** — bắt đầu trắng sẽ làm hỏng tính năng ngay khi deploy (ngưỡng về mặc định, mất tài
khoản GKE).

## 2. Kiến trúc

**`services/caiDatDbService.js`** (mới) — 1 file `data/cai_dat.db`, 2 bảng, mỗi bảng ép CHỈ ĐÚNG 1
DÒNG bằng `PRIMARY KEY CHECK (id = 1)`, ghi qua UPSERT (`INSERT ... ON CONFLICT DO UPDATE`) thay vì
logic "tìm dòng, update hoặc append" của Sheets cũ:

- `cai_dat_hang_loat` (NGUONG_HAMMING).
- `cau_hinh_tracking` (BatTuDongMuaTracking, SoPhutCho + 14 cột Gke*) — gộp chung 1 bảng đúng như
  Sheets cũ gộp chung 1 tab/1 dòng. **2 nơi ghi ĐỘC LẬP lên CÙNG dòng này** (trackingAutoService.js chỉ
  đụng 2 cột đầu, gkeService.js chỉ đụng 14 cột Gke*) — `datCauHinhTracking()` ghi 1 PHẦN (chỉ cột có
  trong tham số), không đụng cột bên kia đang giữ, giống hệt cách `trangThaiDbService.js#ghiDe()` đã
  làm cho Don_Hang_ALL.

**Nơi gọi đổi (giữ nguyên chữ ký hàm)**:
- `services/donHangLoatService.js` — `layNguong`/`datNguong`. Bỏ try/catch "chưa tạo tab" (không còn
  xảy ra được — SQLite tự tạo schema) và guard `readTab(...).catch(() => throw ...)` ở `datNguong`.
- `services/trackingAutoService.js` — `layCauHinh`/`luuCauHinh`.
- `services/gkeService.js` — `layCauHinhGke`/`luuCauHinhGke`. `khoaBiBoQua` (trường báo "cột nào không
  lưu được" do Sheets có thể thiếu cột) LUÔN trả về `[]` từ nay — SQLite có schema cố định, đủ mọi cột
  ngay từ đầu. Giữ NGUYÊN field này trong kết quả trả về (routes/tracking.js + tracking.html vẫn đọc)
  để không phải sửa gì ở 2 nơi đó.

## 3. Migrate dữ liệu hiện có — bắt buộc, khác Giai đoạn 1

**`scripts/migrate-cai-dat-tu-sheets.js`** (mới) — đọc cả 2 tab thật từ Sheets, copy dòng đầu tiên của
mỗi tab vào SQLite. **Idempotent, MẶC ĐỊNH không ghi đè** — bảng nào SQLite đã có dữ liệu thì bỏ qua
(tránh mất giá trị đã đổi qua giao diện sau lần migrate đầu); dùng `--force` nếu thật sự muốn đồng bộ
lại từ Sheets. Dry-run mặc định, `--apply` mới ghi thật.

### Trình tự deploy (người dùng cần làm)

1. Deploy code có tính năng này.
2. Chạy `node scripts/migrate-cai-dat-tu-sheets.js` (không `--apply`) để xem trước.
3. Chạy lại với `--apply` để ghi thật — làm TRƯỚC khi cần dùng "Đơn hàng loạt" hoặc tự động mua
   tracking GKE (thiếu bước này: ngưỡng gộp ảnh về mặc định 32, tài khoản/cấu hình GKE trống — tracking
   thủ công/tự động sẽ lỗi do thiếu thông tin đăng nhập GKE).

## 4. Không làm trong lần sửa này

- Không đụng `DonHangLoat` (Giai đoạn 3 — phức tạp nhất, tái thiết kế 2 bảng + DELETE thật).
- Không xoá 2 tab Sheets cũ — giữ nguyên, app chỉ ngừng đọc/ghi.

## 5. Đã kiểm tra

- `test-cai-dat-sqlite.js` (mới, 9 assertion): CRUD cả 2 bảng, xác nhận UPSERT ghi 1 phần trên
  `cau_hinh_tracking` không xoá mất field bên kia đã ghi trước đó, lọc field lạ an toàn.
- `test-migrate-cai-dat.js` (mới, 10 assertion, spawn tiến trình con thật): dry-run không ghi gì,
  `--apply` ghi đúng, chạy lại lần 2 KHÔNG `--force` giữ nguyên dữ liệu cũ (idempotent), `--force` ghi
  đè đúng theo yêu cầu.
- `test-don-hang-loat-service.js`, `test-gke-fixes.js` (đã có từ trước, viết lại): bỏ các kịch bản
  Sheets-specific nay bất khả thi ("tab chưa tồn tại" ném lỗi, "thiếu cột" báo `khoaBiBoQua`), thay
  bằng kịch bản tương đương dùng SQLite thật (`:memory:`) — giữ nguyên ý nghĩa kiểm thử (validate input,
  ghi/đọc lại đúng, không mất dữ liệu cột khác).
- Sweep toàn bộ ~72 file test scratchpad: đúng nguyên baseline 23 file đã biết trước đó — không phát
  sinh lỗi mới.
