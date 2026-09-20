# Nút "Xoá dữ liệu đơn hàng" (superadmin, tại Danh sách đơn hàng)

## 1. Bối cảnh

Yêu cầu ban đầu: thêm nút cho superadmin xoá "tất cả dữ liệu liên quan" của các đơn đã chọn tại
`orders.html`. Rà soát trước khi code phát hiện: `Don_Hang_ALL` (cột "gốc" — STT_Key, tên khách...)
là công thức `QUERY(VSTACK(...))` SỐNG, ghép từ ~19 sheet RAW con (xem
`2026-09-17-sua-loi-ghi-lech-dong-vstack-design.md`) — **không có cách truy ngược 1 STT_Key về đúng
sheet RAW + dòng vật lý gốc**, và `services/sheetsService.js` cũng **chưa có chức năng xoá dòng nào**.
Xoá thật dòng gốc là việc chưa từng làm được, không chỉ thiếu 1 hàm.

Đã hỏi và thống nhất với người dùng (chọn phương án Recommended cho cả 4 điểm):
1. **Phạm vi xoá**: xoá sạch dữ liệu app tự theo dõi cho đơn đó + đặt cờ ẩn vĩnh viễn khỏi danh sách —
   KHÔNG cố xây thêm khả năng xoá tận gốc trên Sheets (rủi ro cao, Don_Hang_ALL là công thức sống).
2. **File ảnh**: xoá luôn cả ảnh đã tải lên MinIO (không chỉ xoá bản ghi, giữ ảnh).
3. **Xác nhận**: gõ lại đúng số lượng đơn đã chọn (không phải `confirm()` thường).
4. **Trạng thái**: cho phép xoá ở BẤT KỲ trạng thái nào (superadmin toàn quyền).

## 2. Cái gì bị xoá, cái gì không

Bị xoá SẠCH (hard delete) cho từng STT_Key:
- Trạng thái/tracking/hash/ảnh (`trang_thai_don`, `services/trangThaiDbService.js`) — reset toàn bộ.
- Lịch sử hoạt động + log quét hàng loạt + log tracking (`nhat_ky.db`, `services/nhatKyDbService.js`).
- Tư cách thành viên nhóm Đơn hàng loạt (`dhl_thanh_vien`, tự xoá luôn nhóm nếu đó là thành viên cuối).
- File ảnh trên MinIO dưới prefix `orders/{sttKey}/`.

KHÔNG xoá được (ngoài khả năng hiện tại):
- Dòng RAW gốc trên Sheets — vẫn còn nguyên, ngoài tầm với. Thay vào đó, cột mới **`DA_XOA`**
  (`trang_thai_don`, thuần app-nội-bộ, không bao giờ có trong Sheets) được đặt `'TRUE'`, và
  `orderService.js#getAll()` lọc bỏ mọi đơn có `DA_XOA==='TRUE'` khỏi kết quả trả về — áp dụng cho
  MỌI nơi gọi `getAll`/`getByKey`/`getManyByKeys` (danh sách, dashboard, báo cáo...), không chỉ trang
  Đơn hàng.

## 3. Kiến trúc

**`services/xoaDuLieuDonService.js`** (mới) — hàm `xoaDuLieuDon(sttKey)` duy nhất, gọi tuần tự:
1. Tìm + xoá khỏi nhóm Đơn hàng loạt (`donHangLoatDbService.layNhomCuaDon` + `xoaThanhVien`).
2. Xoá lịch sử/log 3 bảng trong `nhat_ky.db` theo STT_Key (3 hàm xoá mới, thêm vào
   `services/nhatKyDbService.js`: `xoaLichSuHoatDongTheoDon`, `xoaNhatKyQuetHangLoatTheoDon`,
   `xoaLogsTrackingTheoDon`).
3. Liệt kê + xoá ảnh MinIO (`storageService.listObjectKeys`/`deleteObject`, prefix `orders/{sttKey}/`).
4. Reset `trang_thai_don` + đặt `DA_XOA='TRUE'` (`trangThaiDbService.ghiDe(sttKey, {...RONG_MAC_DINH,
   DA_XOA: 'TRUE'})`).

**Thứ tự có chủ đích**: đặt cờ `DA_XOA` SAU CÙNG. Nếu bước xoá MinIO (phụ thuộc mạng, dễ lỗi nhất) ném
lỗi, đơn VẪN hiện trong danh sách (chưa bị coi là đã xoá) — người dùng biết cần bấm lại, thay vì đơn
biến mất khỏi app trong khi vẫn còn ảnh rác trên MinIO không ai dọn. Mọi bước đều idempotent (DELETE
khớp 0 dòng / xoá thành viên không tồn tại / xoá object không tồn tại đều coi là thành công) nên gọi
lại nhiều lần trên cùng 1 đơn (retry sau lỗi) luôn an toàn.

**`routes/orders.js`** — `POST /orders/xoa-du-lieu-hang-loat`, kiểm tra `laSuperAdmin(user.vaiTro)`
NGAY ĐẦU handler (KHÁC mọi bulk route khác trong file dùng `laAdmin()` cho cả admin, cùng khuôn chặt
chẽ nhất đã dùng cho `POST /gan-xuong`) vì đây là thao tác phá huỷ vĩnh viễn. Kiểm tra INLINE trong
chính handler (không dùng middleware riêng ở tham số thứ 2 của `router.post()`) — đúng quy ước MỌI
route khác trong file này đang dùng. Validate đơn tồn tại (`orderService.getManyByKeys`) trước khi xoá, trả về
`{ thanhCong, loi }` theo đúng khuôn các bulk route khác. Ghi **ĐÚNG 1 dòng log audit cho cả lô**, với
`STT_Key` để TRỐNG (khác các route khác luôn ghi log riêng từng đơn) — vì ghi log riêng từng đơn với
STT_Key trùng đơn vừa xoá sẽ tự mâu thuẫn (log đó chính là "dữ liệu liên quan" chưa kịp xoá). Dòng audit
chung này liệt kê danh sách STT_Key đã xoá trong `ChiTiet`, sống sót vĩnh viễn trong Lịch sử hệ thống.

**`public/orders.html`** — khối nút mới trong thanh hành động hàng loạt, CHỈ hiện cho superadmin (cùng
khối hẹp nhất trang, như "Gán Xưởng"). Xác nhận bằng `prompt()` bắt gõ lại đúng số lượng đơn đã chọn
(không phải `confirm()`) — chặn bấm nhầm mạnh nhất khi chọn nhiều đơn. Gọi tuần tự từng STT_Key qua
`chayHangLoatCoTienDo()` (cùng khuôn mọi bulk action khác trong trang) để có thanh tiến độ + hỗ trợ huỷ
giữa chừng.

## 4. Không làm trong lần sửa này

- Không xây khả năng xoá dòng RAW gốc trên Sheets (người dùng đã chọn phương án không làm việc này).
- Không thêm màn hình "khôi phục đơn đã xoá" — `DA_XOA` là cờ 1 chiều, muốn khôi phục phải sửa tay
  SQLite (ngoài phạm vi yêu cầu, có thể làm thêm sau nếu cần).
- Không giới hạn theo trạng thái đơn (người dùng chọn cho phép mọi trạng thái).

## 5. Đã kiểm tra

- `test-xoa-du-lieu-don-service.js`: `xoaDuLieuDon()` xoá đúng lịch sử/log/thành viên nhóm/gọi MinIO,
  đặt `DA_XOA` sau cùng, idempotent khi gọi lại, không đụng dữ liệu của STT_Key khác.
- `test-xoa-du-lieu-don-routes.js`: chỉ superadmin dùng được (admin bị 403), validate đầu vào, đơn
  không tồn tại → lỗi thân thiện trong mảng `loi`, ghi đúng 1 dòng log audit cho cả lô.
- `orderService.js#getAll()` lọc đúng đơn có `DA_XOA==='TRUE'`.
- Sweep toàn bộ scratchpad: đúng baseline 23 file lỗi cũ đã biết trước đó, không phát sinh lỗi mới.
