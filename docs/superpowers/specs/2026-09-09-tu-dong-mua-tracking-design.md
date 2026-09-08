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

## 6. Bổ sung 09/09/2026: cấu hình GKE lên giao diện + Logs xem ngay trên web

Sau khi dùng thử, người dùng nhận thấy nhiều thông số phục vụ việc mua tracking (tài khoản API,
thông tin người gửi, khai báo hải quan, cân nặng mặc định...) đang nằm cứng trong `.env` — muốn đổi
phải sửa code + build lại container. Cập nhật 2 điểm:

### 6.1. Cấu hình GKE chuyển lên tab `CauHinhTracking` (gộp chung, không tạo tab mới)

`services/gkeService.js` thêm `layCauHinhGke()`/`luuCauHinhGke()` — cùng khuôn với
`layCauHinh()`/`luuCauHinh()` ở mục 2 (đọc `readTabCached` TTL 60s, `luuCauHinhGke()` tự thêm dòng đầu
tiên nếu chưa có, ghi đè dòng đó các lần sau). Mọi hàm gọi GKE (`layToken`, `goiApi`, `taoDonGke`,
`layTemIn`, `thongTinNguoiGui`, `tinhCanNangKg`) đổi từ tự đọc `process.env.GKE_*` trực tiếp sang
NHẬN `cauHinh` làm tham số — gọi `layCauHinhGke()` đúng 1 lần ở nơi gọi (`routes/gke.js` cho quét tay,
`trackingAutoService.chayQuetTuDongMuaTracking()` cho job tự động) rồi truyền xuống, tránh gọi lặp lại
Sheet nhiều lần trong cùng 1 lượt xử lý nhiều đơn.

**14 cột mới cần thêm vào tab `CauHinhTracking`** (bên cạnh 2 cột `BatTuDongMuaTracking`, `SoPhutCho`
đã có) — thiếu cột nào thì `.env` cùng tên vẫn dùng làm giá trị ngầm định (không phá cấu hình đang
chạy khi mới nâng cấp), xem `layGiaTri()`:

| Cột Sheet | Ý nghĩa | .env tương ứng (ngầm định nếu ô Sheet trống) |
|---|---|---|
| `GkeUsername` | Tài khoản đăng nhập API GKE | `GKE_API_USERNAME` |
| `GkePassword` | Mật khẩu đăng nhập API GKE | `GKE_API_PASSWORD` |
| `GkeServiceCode` | Mã dịch vụ vận chuyển | `GKE_SERVICE_CODE` |
| `GkeShipperName` | Tên xưởng (người gửi) | `GKE_SHIPPER_NAME` (mặc định "Maxthread VN") |
| `GkeShipperPhone` | SĐT xưởng | `GKE_SHIPPER_PHONE` |
| `GkeShipperAddress` | Địa chỉ xưởng | `GKE_SHIPPER_ADDRESS` |
| `GkeShipperCity` | Thành phố xưởng | `GKE_SHIPPER_CITY` |
| `GkeShipperProvince` | Tỉnh/bang xưởng | `GKE_SHIPPER_PROVINCE` |
| `GkeShipperPostcode` | Mã bưu điện xưởng | `GKE_SHIPPER_POSTCODE` |
| `GkeCustomsItemName` | Tên hàng khai hải quan | `GKE_CUSTOMS_ITEM_NAME` (mặc định "Embroidered garment") |
| `GkeCustomsHsCode` | Mã HS khai hải quan | `GKE_CUSTOMS_HS_CODE` |
| `GkeCustomsDeclaredPrice` | Giá trị khai báo/kiện | `GKE_CUSTOMS_DECLARED_PRICE` |
| `GkeCustomsCurrency` | Đơn vị tiền tệ khai báo | `GKE_CUSTOMS_CURRENCY` (mặc định "USD") |
| `CanNangMoiAoKg` | Cân nặng mặc định/áo (kg) khi đơn thiếu `TRONG_LUONG` | *(không có, mặc định cứng 0.05)* |

**Quyết định bảo mật — người dùng CHỦ ĐỘNG chọn đưa cả `GkeUsername`/`GkePassword` lên giao diện**
(không giữ riêng trong `.env` như đề xuất ban đầu của trợ lý AI, vì lo ngại hiển thị dạng chữ thường
trên 1 trang chỉ admin mới vào được). Sau khi trình bày rủi ro, người dùng xác nhận muốn đưa lên giao
diện để dễ tự chỉnh — quyết định này được tôn trọng, cùng đánh đổi bảo mật đã chấp nhận từ trước với
mã PIN đăng nhập (lưu dạng chữ thường trong Sheet). `public/tracking.html` dùng `<input type="password">`
cho ô Password (ẩn mặc định trên màn hình, có nút hiện/ẩn riêng của trình duyệt) — chỉ là quy ước hiển
thị, KHÔNG phải lớp bảo mật thật (giá trị vẫn về dạng chữ thường qua API/Sheet như mọi trường khác).

### 6.2. Logs ngắn gọn — xem ngay trên trang "Tracking"

Thêm bộ đệm mảng trong bộ nhớ (`services/trackingAutoService.js`, hàm `ghiLogTracking()`/
`layLogTracking()`, tối đa 300 dòng, mới nhất trước) — cùng đánh đổi "mất khi khởi động lại server" đã
chấp nhận với `presenceService.js`. Ghi 1 dòng mỗi khi: mua tracking thành công (mã đơn + mã tracking +
hãng vận chuyển), hoặc lỗi khi mua cho 1 đơn (mã đơn + thông báo lỗi) — mức độ "ngắn gọn, mỗi việc 1
dòng" theo lựa chọn của người dùng (không phải log kỹ thuật chi tiết từng bước gọi GKE — mức đó vẫn chỉ
xem qua console server như `services/gkeService.js` đã làm từ trước).

`routes/tracking.js` thêm `GET /logs` (trả mảng, chỉ admin — cùng `chiAdmin` middleware). Trang
`tracking.html` thêm khối "Logs", cỡ chữ nhỏ (0.72rem) + font đơn cách để hiện nhiều dòng mà ít chiếm
diện tích (theo đúng yêu cầu), tự tải lại mỗi 60 giây (cùng chu kỳ "hiển thị động" với Bảng điều khiển).

### 6.3. Giao diện cấu hình GKE

`tracking.html` thêm khối "Cấu hình GKE" — tái dùng khung `.bao-cao-form` sẵn có, nhóm theo 4 phần:
tài khoản API, dịch vụ & khai báo hải quan, thông tin người gửi, cân nặng mặc định. Có nút Lưu + thông
báo riêng, gọi `GET/POST /tracking/cau-hinh-gke` (mới, `routes/tracking.js`, delegate thẳng tới
`gkeService.layCauHinhGke()`/`luuCauHinhGke()`).

## 7. Bổ sung 09/09/2026: nút "Mua tracking thủ công"

Yêu cầu người dùng: thêm 1 nút mua tracking thủ công, không cần đợi job tự động hay quét QR. Hỏi
người dùng nên đặt ở đâu — trả lời "cả hai": bảng danh sách ở trang "Tracking" (cho đơn đã bật
`AUTO_TRACKING`) VÀ trang chi tiết đơn `order.html` (cho đơn bất kỳ).

**Lõi dùng chung**: `trackingAutoService.muaTrackingChoDon(sttKey, cauHinhGke, user = NGUOI_HE_THONG)`
— thêm tham số `user` (mặc định vẫn là "người dùng hệ thống" cho job tự động, không đổi hành vi cũ).
Khi gọi thủ công, `user` là người admin đang đăng nhập thật — dùng để attribute đúng trong
`orderService.update()`/`ghiLog()` (hanhDong đổi thành `MUA_TRACKING_THU_CONG` thay vì
`TU_DONG_MUA_TRACKING`) và dòng log ngắn gọn có thêm hậu tố "— thủ công bởi {tên}". Không đổi
`TRANG_THAI_XUONG`, không yêu cầu `AUTO_TRACKING="YES"`, không yêu cầu đủ x phút hay đúng trạng thái sản
xuất — hoàn toàn tách biệt khỏi các điều kiện của job tự động và của luồng quét QR
(`routes/gke.js`), chỉ tái dùng đúng phần lõi chống tạo vận đơn trùng.

**Endpoint dùng chung**: `POST /tracking/mua-thu-cong` (`routes/tracking.js`, cùng `chiAdmin` middleware
như các route khác trong file — tính năng có thể phát sinh chi phí thật, giữ nguyên triết lý chỉ admin
của cả trang "Tracking" lẫn nút mới này). *(Hình dạng request/response ban đầu ở đây — nhận `sttKey`
đơn lẻ, trả lỗi qua mã HTTP 404/400/502 — đã đổi sang nhận `sttKeys` mảng + trả `{thanhCong, loi}` ở
mục 8.1 bên dưới, để dùng chung được với nút "Mua tracking" hàng loạt mới thêm.)*

**`tracking.html`**: thêm cột "Hành động" vào bảng danh sách — nút "Mua ngay" cho MỌI đơn chưa ở trạng
thái `DA_MUA` (kể cả đang chờ tem hoặc đến hạn), có `confirm()` cảnh báo chi phí thật trước khi gọi.
Thành công thì tải lại cả danh sách lẫn Logs; lỗi thì `alert()` và khôi phục nút.

**`order.html`**: thêm mục "Mua tracking GKE thủ công" trong cùng khối chỉ-admin với "Chỉ định người
chạy máy"/"Chỉ định người vẽ file" — CHỈ hiện khi đơn chưa có tracking thật (`TRACKING_ID` rỗng, hoặc
đang là placeholder chờ tem — hằng số `DANG_CHO_GKE_TAO_TEM` lặp lại ở client, phải khớp
`gkeService.MA_DANG_CHO_TEM`, theo đúng cách dự án đang xử lý các chuỗi hằng dùng chung giữa
client/server — không có module hằng số dùng chung). Thành công thì gọi lại `taiChiTiet()` — bảng
thông tin đơn tự cập nhật Mã tracking/Hãng vận chuyển và nút tự ẩn.

## 8. Bổ sung 09/09/2026 (lần 3): nút hàng loạt ở "Đơn hàng", log chi tiết hơn, giao diện GKE gọn hơn, chờ theo giờ

Yêu cầu người dùng (4 điểm trong 1 lượt):

### 8.1. Nút "Mua tracking" hàng loạt ở `orders.html` (Danh sách đơn hàng) — chỉ admin

Đặt trong thanh hành động hàng loạt (`#thanh-hanh-dong`), cùng hàng với "Chỉ định người chạy máy"/"Chỉ
định người vẽ file" — bọc trong `<span id="khoi-mua-tracking-thu-cong" style="display:contents">` khi
admin, giống hệt khuôn 2 khối kia (không có `<select>` vì không có giá trị đích để chọn, chỉ là 1 hành
động). `apDungMuaTrackingThuCong()` tái dùng `chayHangLoatCoTienDo()`/`taoThanhTienDo()` (đã có sẵn
trong `public/js/api.js`, dùng chung với 2 nút "Chỉ định") — chạy tuần tự từng đơn (không phải 1 request
gộp) để có thanh tiến độ + nút Hủy giữa chừng, vì mỗi lượt gọi GKE có thể mất vài giây.

**Đổi hình dạng route `POST /tracking/mua-thu-cong`** để tái dùng được với `chayHangLoatCoTienDo()` —
đây là lý do chính khiến phải sửa route thay vì chỉ thêm nút mới: hàm này yêu cầu callback trả về
`{thanhCong: [...], loi: [...]}` (đúng hình dạng `routes/orders.js` `/chi-dinh-nguoi-chay-may` /
`/chi-dinh-nguoi-ve-file` đã dùng). Route đổi từ nhận `sttKey` đơn lẻ → nhận `sttKeys` MẢNG (kể cả gọi
cho 1 đơn), lỗi từng đơn (không tìm thấy, đã có tracking, GKE từ chối) rơi vào `loi[]` thay vì mã lỗi
HTTP riêng — luôn trả `200 {ok:true, thanhCong, loi}` trừ khi `sttKeys` trống/sai kiểu (400). Cả 2 nút
đơn lẻ có từ trước (`tracking.html`, `order.html`) đổi theo: gửi `sttKeys: [sttKey]`, kiểm tra
`ketQua.loi` thay vì bắt lỗi qua mã HTTP.

### 8.2. Log chi tiết hơn cho cả 2 luồng (thủ công + tự động)

Trước bản này, lỗi ở luồng THỦ CÔNG hoàn toàn không được ghi vào Logs xem trên web (chỉ hiện qua
`alert()` nhất thời cho đúng người bấm) — chỉ luồng tự động mới log lỗi. Chuyển việc ghi log (cả thành
công lẫn lỗi) vào NGAY BÊN TRONG `muaTrackingChoDon()` (bọc toàn bộ thân hàm trong try/catch, log lỗi
rồi `throw` lại) — nhờ vậy CẢ 3 nơi gọi hàm này (job tự động, route `/mua-thu-cong` cho cả nút đơn lẻ
lẫn nút hàng loạt mới) đều tự động được ghi log đầy đủ, không cần lặp lại try/catch+log ở từng nơi gọi.

Mỗi dòng log giờ gắn nhãn nguồn NGAY ĐẦU DÒNG — `[Tự động]` hoặc `[Thủ công - <tên người bấm>]` — thay
vì chỉ có hậu tố "— thủ công bởi..." cho riêng trường hợp thủ công như bản trước (khiến dòng tự động
trông "thiếu thông tin" hơn, phải suy luận ngầm "không có hậu tố = tự động"). Vẫn giữ đúng tinh thần
"ngắn gọn, mỗi việc 1 dòng" đã chọn trước đó — đây là làm cho mỗi dòng ĐẦY ĐỦ thông tin hơn (ai/việc
gì/thành công hay lỗi), không phải chuyển sang log kỹ thuật nhiều dòng/bước.

### 8.3. Giao diện Cấu hình GKE — nhiều thông tin hơn mỗi hàng ngang

`tracking.html`: `.tk-cau-hinh-gke` nới từ 720px lên 1400px (trang `.page` cho phép tới 1800px — xem
`style.css`), `.tk-luoi-2` đổi từ 2 cột cố định sang `grid-template-columns: repeat(auto-fit,
minmax(170px, 1fr))` — mỗi nhóm trường tự xếp được nhiều cột nhất có thể trong bề rộng hiện có, KHÔNG
cần đoán trước số cột theo breakpoint. Kết quả: nhóm 5 trường "Dịch vụ & khai báo hải quan" và nhóm 6
trường "Thông tin người gửi" đều gói gọn trong ĐÚNG 1 hàng trên màn hình rộng (trước đó trải 3 hàng mỗi
nhóm) — giảm hẳn số lần cuộn chuột để thấy hết thông tin, đúng yêu cầu người dùng. Ở màn hình hẹp,
`auto-fit` tự co về 1 cột như CSS Grid tiêu chuẩn, không cần media query riêng.

### 8.4. Chọn số GIỜ chờ (không chỉ số phút)

Trước đó chỉ có 1 ô "số phút chờ" (`SoPhutCho`) — chờ hàng chục giờ phải tự quy đổi ra phút, dễ nhầm.
Thêm 1 ô "Số giờ" đứng CẠNH ô "Số phút" trên `tracking.html`, 2 ô CỘNG DỒN thành 1 tổng số phút duy nhất
khi bấm Lưu (`soGio*60 + soPhut`) — Sheet vẫn chỉ có đúng 1 cột `SoPhutCho` như cũ, KHÔNG đổi schema.
Khi tải lại cấu hình, tách tổng số phút ngược lại thành giờ + phút để hiện đúng lên 2 ô (vd 130 phút →
hiện "2 giờ", "10 phút"). Thuần là UX phía client — `trackingAutoService.layCauHinh()`/`luuCauHinh()`
và cột Sheet không đổi gì.

### 8.5. Đã kiểm tra

- `node --check` toàn bộ file sửa; tách riêng `<script>` từng trang `.html` để check cú pháp.
- Test HTTP thật (Express + `fetch()`, mount đúng `routes/tracking.js`) cho `POST /mua-thu-cong` xử lý
  ĐÚNG 1 request gồm cả đơn thành công, đơn đã có tracking, đơn GKE từ chối — `thanhCong`/`loi` đúng
  từng trường hợp, `GET /logs` sau đó có ĐÚNG 2 dòng (bỏ qua đơn "đã có tracking" — không log), cả 2
  dòng đúng nhãn `[Thủ công - <tên>]`; gọi thẳng `muaTrackingChoDon()` không qua route (mô phỏng job) ra
  đúng nhãn `[Tự động]`.
- Chạy lại toàn bộ 12 kịch bản hồi quy của `chayQuetTuDongMuaTracking()`/`layDanhSachDonAutoTracking()`
  — không hồi quy, cộng thêm assert nhãn log đúng cho các kịch bản thành công/lỗi/bỏ qua-vì-đã-có.
- Dựng lại nguyên trạng CẢ 3 trang thật (`orders.html`, `tracking.html`, `order.html`) qua Browser pane
  với `api.js`/`icons.js` thật, chỉ giả `requireLoginOrRedirect`/`renderNav`/`apiFetch`: nút hàng loạt ở
  `orders.html` hiện đúng cho admin, chạy đúng qua `chayHangLoatCoTienDo()` (3 đơn chọn, 1 đơn lỗi vì đã
  có tracking, tổng kết đúng "2/3", danh sách + lựa chọn tự làm mới); nút đơn lẻ ở `tracking.html`/
  `order.html` xử lý đúng cả nhánh thành công lẫn nhánh `loi` mới; layout GKE đúng nhiều cột trên màn
  rộng; ô giờ/phút tải/tách/gộp đúng, validate tổng = 0 bị chặn đúng.

*(Lưu ý: 1 lần test ban đầu trên `order.html` báo lỗi "Cannot read properties of undefined" — hoá ra do
dựng nhầm bản mock CŨ (trước khi sửa route), không phải lỗi thật; dựng lại mock từ đúng file hiện tại
thì qua hết.)*
