# Tự động mua tracking GKE theo AUTO_TRACKING + thời gian chờ — thiết kế

**Ngày:** 2026-09-09
**Yêu cầu gốc:** Đơn có `AUTO_TRACKING = "YES"`, sau `x` phút kể từ `THOI_GIAN_IN_MA` (thời điểm
chuyển "Đã in mã") thì tự động mua tracking qua GKE, điền `TRACKING_ID`, báo popup. Thêm menu
"Tracking" cho admin bật/tắt tính năng + chỉnh `x`.

## 1. Tự ghi `THOI_GIAN_IN_MA` — 1 hook mới trong `orderService.update()`

Y hệt khuôn `NGUOI_CHAY_MAY`/`NGUOI_VE_FILE` đã có: mỗi khi `TRANG_THAI_XUONG` chuyển SANG "Đã in mã"
từ 1 giá trị khác, tự ghi `THOI_GIAN_IN_MA = thoiGianVNISOString()`. Áp dụng cho MỌI đường ghi (sửa
tay, đổi hàng loạt, quét QR đơn/hàng loạt) vì cùng đi qua `update()`. Guard bằng
`headers.includes('THOI_GIAN_IN_MA')` — vô hại nếu Sheet chưa có cột (đã có, theo xác nhận người dùng).

## 2. Cấu hình bật/tắt + số phút chờ — tab Sheet mới `CauHinhTracking`

Không có sẵn cơ chế cấu hình dùng chung nào trong dự án (đã rà — chỉ có `CauHinhKichBan`, dùng cho
kịch bản quét QR, không phải nơi lưu cờ bật/tắt). Tạo tab mới `CauHinhTracking`, 2 cột:
`BatTuDongMuaTracking` (TRUE/FALSE, đúng quy ước `KichHoat` đã dùng ở tab `NguoiDung`), `SoPhutCho`
(số nguyên, phút). Đọc qua `readTabCached` với TTL 60s (bấm Lưu có hiệu lực trong ~1 phút, không cần
đọc thật mỗi lần) — cùng TTL với `CauHinhKichBan`.

**Cần người dùng tự tạo trước khi dùng**: tab `CauHinhTracking` với đúng 2 cột trên (dòng 1 = header).
KHÔNG cần tự điền sẵn dòng dữ liệu — lần đầu bấm Lưu ở trang "Tracking", hệ thống tự thêm dòng đầu
tiên (`appendRow`); các lần Lưu sau ghi đè đúng dòng đó (`updateCells`). Chưa tạo tab thì tính năng coi
như TẮT (đọc lỗi → mặc định an toàn `bat: false`), không chặn các phần khác của app.

## 3. Job quét ngầm — mỗi 2 phút (`services/trackingJob.js`, mẫu `node-cron` giống `canhBaoJob.js`)

Chọn 2 phút (không phải 30 phút như cảnh báo) vì `x` phút do người dùng tự nhập có thể khá ngắn — quét
dày hơn để độ trễ thực tế sát với `x` đã chọn hơn (lệch tối đa ~2 phút thay vì tối đa 30 phút).

Mỗi lượt quét (`services/trackingAutoService.js`):
1. Đọc cấu hình — TẮT thì dừng luôn, không đọc gì thêm.
2. Đọc `Don_Hang_ALL` (qua cache orderService.getAll() sẵn có, không thêm tải mới).
3. Lọc đơn: `AUTO_TRACKING === 'YES'` VÀ (`TRACKING_ID` rỗng HOẶC đang là placeholder chờ tem — xem mục
   4) VÀ có `THOI_GIAN_IN_MA` VÀ đã trôi qua ≥ `x` phút.
4. Với mỗi đơn đủ điều kiện: gọi lại ĐÚNG luồng `routes/gke.js` đã dùng cho quét tay (tạo vận đơn →
   ghi placeholder chống trùng → lấy tem → ghi `TRACKING_ID`/`HANG_VAN_CHUYEN` thật) — **di chuyển
   hằng số `MA_DANG_CHO_TEM` từ `routes/gke.js` sang `services/gkeService.js`** (export dùng chung,
   tránh định nghĩa trùng 2 nơi) — lỗi 1 đơn (thiếu địa chỉ, GKE từ chối...) chỉ log, KHÔNG dừng cả
   lượt quét, đơn đó tự thử lại ở lượt quét sau.
5. **KHÔNG đổi `TRANG_THAI_XUONG`** — khác luồng quét tay (vốn đổi sang "ĐÃ DÁN TEM" vì gắn liền với
   việc dán tem thật lên hộp đã đóng gói). Đơn tự động mua tracking đúng ý vẫn còn nguyên trạng thái
   sản xuất — khi sau này người vận hành quét tay lúc đóng gói xong, `TRACKING_ID` đã có sẵn nên hệ
   thống tự bỏ qua bước tạo vận đơn, chỉ lấy tem in + mới đổi trạng thái lúc đó (đúng ý nghĩa "đã dán
   tem" — lúc tem thật được dán lên hộp).
6. `user` truyền vào `orderService.update()`/`ghiLog()` dùng 1 "người dùng hệ thống" cố định
   `{ ten: 'Hệ thống (tự động)', vaiTro: 'admin' }` — chưa có tiền lệ nào trong dự án cho job chạy nền
   ghi qua `orderService.update()` (job cảnh báo hiện có ghi thẳng `updateCells`, không qua `update()`)
   nhưng ở đây CẦN đi qua `update()` để tái dùng đúng logic 2 bước chống trùng đã có, không viết lại.

## 4. Trang "Tracking" mới (`public/tracking.html`) — chỉ admin

- Công tắc bật/tắt (style giống "Chế độ tối" ở Thiết lập) + ô nhập số phút `x` + nút Lưu.
- 1 bảng danh sách MỌI đơn `AUTO_TRACKING = "YES"`, mỗi dòng: mã đơn, trạng thái (Đã mua / Đang chờ đủ
  giờ / Đến hạn — job sẽ xử lý lượt kế tiếp / Lỗi thiếu THOI_GIAN_IN_MA), mã tracking + hãng vận chuyển
  nếu đã có.
- **Popup**: so `ThoiGianCapNhatCuoi` của các đơn đã "Đã mua" với mốc "lần cuối xem trang này" (lưu
  `localStorage`, riêng theo máy — không có cơ chế đẩy tin thời gian thực nào trong dự án, đã trao đổi
  với người dùng). Có đơn mới hơn mốc đó → hiện popup liệt kê, rồi cập nhật lại mốc.

## 5. Vị trí menu

"Tracking" — chỉ admin, đặt cạnh các trang quản trị khác (sau "Nhân viên") trong `renderNav()`.
