# Chuyển 3 tab nhật ký (LichSuHoatDong, NhatKyQuetHangLoat, LogsTracking) sang SQLite

## 1. Bối cảnh

Người dùng yêu cầu chuyển 6 tab Google Sheets sang SQLite. Sau khi rà soát cách dùng thật của cả 6,
quyết định chia thành 3 giai đoạn theo độ phức tạp — đây là **Giai đoạn 1**: 3 tab dạng nhật ký
(CHỈ thêm dòng, không bao giờ sửa/xoá dòng cũ). Xem 2 giai đoạn còn lại (CaiDatHangLoat/CauHinhTracking,
DonHangLoat) trong các spec riêng sẽ viết sau.

**Khác Don_Hang_ALL**: 3 tab này KHÔNG bị rủi ro "lệch dòng" (app là người ghi DUY NHẤT, không có công
thức QUERY/VSTACK tính lại thứ tự dòng) — migrate lần này thuần tuý là đổi kho lưu, không phải sửa lỗi.

**Không migrate dữ liệu cũ** (theo yêu cầu người dùng, khác accounts/DonHangLoat sắp tới) — 3 bảng bắt
đầu TRẮNG, chỉ ghi dữ liệu MỚI từ thời điểm deploy. Dữ liệu cũ vẫn còn nguyên trong Sheet, chỉ là app
ngừng đọc/ghi vào đó.

## 2. Kiến trúc

**`services/nhatKyDbService.js`** (mới) — 1 file `data/nhat_ky.db`, 3 bảng độc lập (gộp chung file vì
cùng LOẠI dữ liệu — log chỉ thêm dòng — không có quan hệ chéo nào giữa 3 bảng):

- `lich_su_hoat_dong` (ThoiGian, NguoiDung, VaiTro, HanhDong, STT_Key, ChiTiet) — index trên
  STT_Key/NguoiDung/HanhDong (đúng các cột `logService.js` đang lọc theo).
- `nhat_ky_quet_hang_loat` (Thoi_Gian, Nguoi_Quet, Ten_Kich_Ban, STT_Key, Trang_Thai_Cu, Trang_Thai_Moi,
  Ket_Qua, Ghi_Chu) — chỉ ghi, hiện KHÔNG có nơi nào trong app đọc lại tab này.
- `logs_tracking` (ThoiGian, STT_Key, Nguon, NguoiDung, VaiTro, KetQua, TRACKING_ID, HANG_VAN_CHUYEN,
  ChiTiet).

Mọi hàm đọc trả về TOÀN BỘ bảng (`layTatCa...`) — giữ NGUYÊN cách lọc/sắp/parse JSON phức tạp đang có
sẵn trong `logService.js`/`actionCenterService.js` bằng JS sau khi lấy dữ liệu (y hệt cách
`readTabCached` trả về trước đây), không viết lại thành SQL — giảm tối đa rủi ro đổi hành vi.

**Nơi gọi đổi (chỉ đổi nguồn dữ liệu, KHÔNG đổi chữ ký hàm)**:
- `services/logService.js` — `ghiLog`, `layLichSuTheoDon`, `layHoatDongGanDay`,
  `layLichSuChuyenSangTrangThai`, `layHoatDongCuaToi`, `ghiNhatKyQuetHangLoat`. 37+10 nơi gọi các hàm
  này trên toàn repo (`routes/auth.js`, `chatbot.js`, `orders.js`, `photos.js`, `qr.js`,
  `donHangLoatService.js`, `taiSanService.js`, `trackingAutoService.js`) **không đổi gì** — chữ ký hàm
  giữ nguyên 100%.
- `services/trackingAutoService.js` — hàm `ghiLogTrackingVaoSheet` đổi tên thành `ghiLogTrackingVaoDb`
  (tên cũ nay sai — không còn ghi vào Sheet nữa; 7 nơi gọi đều nằm trong CHÍNH file này, đổi tên an
  toàn). CauHinhTracking (đọc/ghi cấu hình GKE) **CHƯA đổi** trong giai đoạn này — thuộc Giai đoạn 2.
- `services/actionCenterService.js` — `layLoiTrackingGanDay` đọc `nhatKyDbService.layTatCaLogsTracking()`.
- `routes/reports.js` — `/hieu-suat-theo-nguoi` đọc `nhatKyDbService.layTatCaLichSuHoatDong()` thay vì
  `readTabCached('LichSuHoatDong', ...)` (bỏ `Promise.all` không cần thiết nữa vì đọc SQLite đồng bộ).

## 3. Phát hiện phụ — bug có sẵn, KHÔNG sửa trong lần này

`services/trackingAutoService.js#ghiLogTrackingVaoDb` (trước đây là `ghiLogTrackingVaoSheet`) ghi cột
`ThoiGian` bằng `dinhDangNgayGioNgan()` — định dạng `"19-09 05:25:19"` (DD-MM HH:mm:ss, KHÔNG có năm).
`services/actionCenterService.js#trongVongGio()` gọi `new Date(chuoiNay)` để lọc cửa sổ 48 giờ — đã
xác nhận bằng thực nghiệm: `new Date('19-09 05:25:19')` → `Invalid Date`. Hệ quả: mục "Lỗi tự động mua
tracking GKE (48 giờ gần đây)" ở Trung tâm hành động **LUÔN rỗng trong thực tế**, kể cả khi có lỗi thật
xảy ra — bug này tồn tại từ khi định dạng này được áp dụng (09/09/2026), **hoàn toàn không liên quan**
tới việc chuyển kho lưu lần này. Giữ NGUYÊN hành vi hiện tại (đúng tinh thần "chỉ đổi kho lưu, không
sửa gì khác") — đã báo lại người dùng, sẽ sửa riêng nếu được yêu cầu.

## 4. Không làm trong lần sửa này

- Không migrate dữ liệu lịch sử của cả 3 tab (theo đúng lựa chọn người dùng).
- Không tối ưu hoá truy vấn bằng SQL WHERE/ORDER BY — giữ nguyên lọc/sắp bằng JS như code cũ.
- Không sửa bug định dạng `ThoiGian` của LogsTracking (mục 3).
- Không đụng CauHinhTracking/CaiDatHangLoat/DonHangLoat — để dành Giai đoạn 2/3.

## 5. Đã kiểm tra

- `test-nhat-ky-sqlite.js` (mới, 13 assertion): CRUD trực tiếp cả 3 bảng; `logService.js` (ghiLog,
  layLichSuTheoDon, layHoatDongGanDay, layLichSuChuyenSangTrangThai, layHoatDongCuaToi,
  ghiNhatKyQuetHangLoat) hoạt động đúng qua SQLite thật (`:memory:`); xác nhận + tài liệu hoá bug ở
  mục 3 bằng thực nghiệm (`muaTrackingChoDon` lỗi thật → `layTrungTamHanhDong().loiTrackingGke` rỗng).
- `test-trung-tam-hanh-dong-service.js` (đã có từ trước, cập nhật): seed `logs_tracking` qua
  `nhatKyDbService.ghiLogsTracking()` thay vì mock `sheetsService.readTabCached('LogsTracking')`; đổi
  kịch bản "chưa tạo tab" (không còn khả thi — SQLite tự tạo schema) thành "bảng rỗng, chưa có log
  nào" — 12 assertion, giữ nguyên ý nghĩa kiểm thử.
- Sweep toàn bộ ~70 file test scratchpad: đúng nguyên baseline 23 file đã biết trước đó — không phát
  sinh lỗi mới.
