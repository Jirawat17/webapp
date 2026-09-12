# Hiện đầy đủ tên đơn + ghi lại Lịch sử cho lượt quét kịch bản bị từ chối

Theo yêu cầu người dùng (nêu ra sau khi dùng kịch bản "Chưa lấy phôi → Đã lấy phôi", nhưng lỗi mang
tính hệ thống, áp dụng cho MỌI kịch bản quét).

## 1. Vấn đề

**Kết quả quét thiếu tên đơn cho nhóm "Sai trạng thái":** `noiDungDongQuet()` (`public/scan.html`) —
dùng chung cho "Danh sách đang quét" và "Xem lại" — trước đây CHỈ hiện `item.lyDo` cho nhóm
`SAI_TRANG_THAI`, bỏ hẳn dòng `<strong>{tieuDe}</strong>` (loại/kích thước/màu sắc) để tránh lặp mã đơn
2 lần trên cùng 1 thẻ (`lyDo` do server dựng sẵn đã tự chứa mã đơn, vd `Đơn 9U6.2 lỗi do đơn đang "Đã
lấy phôi"`). Hệ quả: người quét chỉ thấy mã đơn trần trong câu lý do, không thấy tên/loại sản phẩm thật.

**Lượt quét bị từ chối biến mất khỏi tab "Lịch sử":** `routes/qr.js#POST /kich-ban/:id/kiem-tra` ĐÃ ghi
log đầy đủ cho cả 3 nhóm (OK/SAI_TRANG_THAI/KHONG_TIM_THAY, kể cả nhánh "đơn đã kết thúc") qua `ghiLog()`
— nhưng `services/logService.js#layHoatDongCuaToi()` (nguồn dữ liệu cho `public/hoat-dong.html`) chỉ
thu thập đúng 2 `hanhDong` thành công (`QUET_KICH_BAN`/`QUET_KICH_BAN_HANG_LOAT`, ghi ở bước XÁC NHẬN
hàng loạt, sau khi đã áp dụng thật). 3 loại log "kiểm tra" bị từ chối
(`QUET_KIEM_TRA_SAI_TRANG_THAI`/`QUET_KIEM_TRA_CHAN_DON_KET_THUC`/`QUET_KIEM_TRA_KHONG_TIM_THAY`) hoàn
toàn không có nhánh xử lý nào — bị bỏ qua lặng lẽ, không xuất hiện ở đâu trong tab Lịch sử.

## 2. Thiết kế

### 2.1. `public/scan.html` — luôn hiện tên đơn

`noiDungDongQuet()` bỏ nhánh đặc biệt cho `SAI_TRANG_THAI` — LUÔN hiện `<strong>{tieuDe || sttKey}</strong>`
cho MỌI nhóm (giống hệt nhóm OK/KHONG_TIM_THAY từ trước), kèm dòng `lyDo` ngay dưới. Chấp nhận mã đơn có
thể xuất hiện 2 lần trên 1 thẻ (1 lần trong `tieuDe`, 1 lần trong câu `lyDo`) — người dùng xác nhận ưu
tiên thấy rõ tên đơn hơn là tránh lặp đúng mã 1 lần. Dùng chung cho "Danh sách đang quét" LẪN "Xem lại"
(`dongXemLaiCanBaoLoi`) nên sửa đúng 1 chỗ là đủ. Khối "Kết quả vừa quét" (`renderKetQuaVuaQuet()`,
hiện đúng 1 đơn vừa quét gần nhất) đã hiện `tieuDe` đúng cho mọi nhóm từ trước — không cần sửa.

### 2.2. `routes/qr.js` — ghi kèm `lyDo` vào `chiTiet`

Cả 3 nhánh từ chối (KHONG_TIM_THAY, đơn đã kết thúc, sai trạng thái) đã tự dựng sẵn biến `lyDo` để trả
về JSON cho client — thêm đúng biến này vào `chiTiet` khi gọi `ghiLog()`, để bước đọc lại (mục 2.3)
có sẵn câu lý do dựng sẵn, không phải suy luận/dựng lại câu chữ ở 1 nơi khác (tránh trùng lặp logic
giữa server và client). Tiện gộp luôn 2 chuỗi lý do hơi khác nhau cho cùng 1 tình huống KHONG_TIM_THAY
("Không tìm thấy mã trong Sheet" ở `ghiNhatKyQuetHangLoat`, "Không tìm thấy đơn hàng với mã này trong
Sheet" ở response JSON) thành đúng 1 biến `lyDo` dùng chung cho cả 2 nơi.

### 2.3. `services/logService.js` — nhóm mới `quetBiTuChoi`

Thêm hằng số `HANH_DONG_QUET_BI_TU_CHOI` (3 giá trị nêu trên) và nhánh thu thập tương ứng trong
`layHoatDongCuaToi()`, tách RIÊNG khỏi nhóm `quet` (thành công) — không tính vào `tongSoQuet` hay bất kỳ
chỉ tiêu công việc nào (`tinhChiTieuCongViec()` không đọc field này), vì đây là lượt quét KHÔNG đổi gì
thật, chỉ để đối soát. `QUET_KIEM_TRA_CHAN_DON_KET_THUC` gộp chung `nhom: 'SAI_TRANG_THAI'` — đúng khuôn
`routes/qr.js` đã dùng lại nhóm này cho tình huống "đơn đã kết thúc" ở client. Trả thêm
`tongSoQuetBiTuChoi` + mảng `quetBiTuChoi` trong kết quả — `routes/hoatDong.js` không cần sửa gì (chỉ
`res.json()` nguyên object trả về).

### 2.4. `public/hoat-dong.html` — mục mới "Lượt quét bị từ chối"

Thêm section mới (giữa "Lượt quét QR thành công" và "Đổi trạng thái đơn"), cùng khuôn `.timeline` với
3 mục sẵn có. Icon ⚠️/❌ theo `nhom`, nội dung chính là `lyDo` (đã tự chứa mã đơn, không cần
`<strong>{sttKey}</strong>` riêng như 3 khối kia), kèm dòng phụ tên kịch bản. Không gộp vào section
"thành công" — giữ 2 khái niệm tách biệt rõ ràng (đã đổi thật vs. chỉ thử mà không đổi được gì).

## 3. Đã kiểm tra

- `routes/qr.js` — gọi trực tiếp handler thật (mock `orderService`/`scenarioService`/`khachHangService`/
  `logService`/`alertService`) cho cả 3 nhánh từ chối: xác nhận `chiTiet.lyDo` ghi vào log khớp đúng
  `lyDo` trả về client.
- `services/logService.js#layHoatDongCuaToi()` — mock `sheetsService` với dữ liệu log giả lập đủ 5 loại
  `hanhDong` (3 loại bị từ chối + 2 loại thành công): xác nhận `quetBiTuChoi` có đúng 3 phần tử với
  `nhom`/`lyDo` đúng, `quet` (thành công) vẫn đúng 2 phần tử không bị lẫn, sắp xếp mới nhất trước.
- `noiDungDongQuet()` (module thật trích từ `scan.html`) — xác nhận nhóm SAI_TRANG_THAI giờ hiện đầy đủ
  `tieuDe` (trước đây bị ẩn) lẫn `lyDo`; nhóm OK/KHONG_TIM_THAY không bị ảnh hưởng.
- `renderDsQuetBiTuChoi()` — test tương tác qua trang mock (script trích nguyên văn từ `hoat-dong.html`)
  qua Browser pane: xác nhận đúng icon theo nhóm, đúng nội dung lý do, đúng dòng kịch bản, đúng trạng
  thái rỗng khi chưa có dữ liệu, không lỗi console.
- `node --check` mọi file sửa + script inline trích từ `scan.html`/`hoat-dong.html`. Tổng 14 + 5 = 19
  kịch bản test, toàn bộ pass.
- Không có Sheet thật trong sandbox nên không xác nhận được log thật ghi/đọc đúng qua Google Sheets —
  đã bù bằng mock đúng hình dạng dữ liệu (`ChiTiet` là chuỗi JSON, đúng cột `HanhDong`/`STT_Key`/
  `ThoiGian`/`NguoiDung`) khớp với cách `logService.js` đang đọc thật.
