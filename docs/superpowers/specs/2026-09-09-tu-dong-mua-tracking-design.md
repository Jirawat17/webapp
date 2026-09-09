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

**Bổ sung 09/09/2026 (lần 5)**: vẫn còn tốn quá nhiều hàng — hoá ra vì 4 nhóm trường ("Tài khoản",
"Dịch vụ & hải quan", "Người gửi", "Cân nặng") mỗi nhóm là 1 LƯỚI RIÊNG kèm tiêu đề `<h4>` riêng, ép
xuống hàng mới ở MỌI ranh giới nhóm dù hàng ngang vẫn còn dư chỗ (rõ nhất ở nhóm "Cân nặng mặc định" —
chiếm nguyên 1 hàng + 1 tiêu đề chỉ cho ĐÚNG 1 trường). Bỏ hẳn 4 tiêu đề `<h4>` + gộp CHUNG cả 14 trường
vào ĐÚNG 1 lưới `auto-fit` duy nhất — trường của nhóm này giờ xếp cùng hàng với nhóm kia luôn, không bị
chặn ở ranh giới nhóm nữa (nhãn từng ô input, vd "Tên xưởng"/"Số điện thoại", đã đủ rõ nghĩa mà không
cần tiêu đề nhóm). Kết quả: cả 14 trường gói gọn trong ĐÚNG 2 hàng trên màn hình rộng (~1450px), so với
~4-5 hàng-nhóm trước đó. Rút gọn nhãn trường cân nặng ("Cân nặng mỗi áo (kg) — dùng khi đơn KHÔNG có sẵn
TRONG_LUONG" → "Cân nặng mỗi áo (kg)") — phần giải thích dài chuyển hẳn xuống dòng ghi chú bên dưới lưới
để tránh 1 nhãn quá dài kéo cao cả hàng chứa nó.

**Bổ sung 09/09/2026 (lần 6)**: phần "Tự động mua tracking" + thiết lập thời gian chờ vẫn tốn 4 khối
riêng (hàng công tắc bật/tắt, hàng chữ giải thích, hàng 2 label "Số giờ"/"Số phút", hàng 2 ô input +
nút Lưu) chỉ để bật/tắt + chỉnh 1 con số. Gộp CHUNG vào lại đúng 1 hàng `.cong-tac-hang` duy nhất: nhét
cả `<span class="cong-tac">` (công tắc) vào TRONG `.cong-tac-nhan` (vốn đã là flex-row có sẵn, xem
`style.css`) để "nhãn + công tắc" vẫn dính liền nhau như thiết kế gốc; nhóm giờ/phút/Lưu là 1 `<span>`
flex thứ 2, được `.cong-tac-hang`'s `justify-content:space-between` sẵn có đẩy sang phải — CHỈ thêm
`flex-wrap:wrap` (inline style, không sửa class `.cong-tac-hang` dùng chung với trang Settings) để
không vỡ ở màn hẹp. Bỏ hẳn đoạn chữ giải thích dài (đã nói ở mô tả đầu trang rồi) + 2 `<label>` riêng
"Số giờ"/"Số phút" (thay bằng chữ đơn vị "giờ"/"phút" ngắn gọn ngay sau mỗi ô, giữ nguyên đầy đủ câu
giải thích qua thuộc tính `title` — hiện khi rê chuột, không chiếm chỗ). Không đổi `id` nào, JS
(`taiCauHinh`/`luuCauHinh`) không cần sửa. Kết quả: từ ~4-5 hàng xuống còn ĐÚNG 1 hàng.

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

## 9. Bổ sung 09/09/2026 (lần 4): tab Sheet "LogsTracking" — log chi tiết lâu dài

Yêu cầu người dùng: ghi TOÀN BỘ log chi tiết cho cả 2 luồng (thủ công + tự động) vào 1 tab Sheet MỚI
"LogsTracking" — khác với `_logs` (mảng trong bộ nhớ, mục 6.2) vốn mất khi restart server và chỉ có 1
dòng tóm tắt ngắn gọn mỗi việc. Sau khi hỏi cột/tên cột, người dùng bổ sung thêm yêu cầu: cột `ChiTiet`
phải ghi lại **đầy đủ mọi bước gọi GKE, y hệt log server** (kèm ảnh chụp console: từng dòng "Gọi POST
...", "Phản hồi: HTTP ...", body request, xử lý code 301 "đã tồn tại"...), không chỉ mỗi thông báo lỗi
cuối cùng.

### 9.1. Cột tab `LogsTracking` (người dùng tự tạo trước, dòng 1 = header, đúng 9 cột)

| Cột | Nội dung |
|---|---|
| `ThoiGian` | Thời gian ngắn gọn giờ VN, vd `09-09 06:59:25` (DD-MM HH:mm:ss, không có năm — xem mục 9.5) |
| `STT_Key` | Mã đơn hàng |
| `Nguon` | `Tự động` hoặc `Thủ công` |
| `NguoiDung` | Tên người bấm (thủ công) hoặc `Hệ thống (tự động)` |
| `VaiTro` | Vai trò của người đó |
| `KetQua` | `Thành công` / `Lỗi` / `Bỏ qua` (đơn đã có tracking thật, không mua lại — trước đây KHÔNG được ghi ở đâu cả, kể cả `_logs`) |
| `TRACKING_ID` | Mã tracking (khi thành công) |
| `HANG_VAN_CHUYEN` | Hãng vận chuyển (khi thành công) |
| `ChiTiet` | TOÀN BỘ log kỹ thuật từng bước (khi thành công/lỗi) hoặc lý do tĩnh (khi bỏ qua) |

### 9.2. Cơ chế thu thập log chi tiết — tham số `nhatKy` xuyên suốt `gkeService.js`

Trước đây mọi bước gọi GKE (`fetchJson`, `layToken`, `goiApi`, `taoDonGke`, `layTemIn`) chỉ
`console.log`/`console.error` trực tiếp — không có cách nào lấy lại đúng những dòng đó để lưu vào
Sheet. Thêm 2 hàm nhỏ `ghi(nhatKy, ...)`/`ghiLoi(nhatKy, ...)` — LUÔN in console y hệt cũ (không đổi
cách debug qua terminal/`docker logs` hiện có), ĐỒNG THỜI gộp cùng nội dung vào mảng `nhatKy` nếu được
truyền vào. Tham số `nhatKy` (tuỳ chọn, thêm ở CUỐI mỗi chữ ký hàm) truyền xuyên suốt:
`taoDonGke`/`layTemIn` → `goiApi` → `layToken`/`fetchJson`.

**Chỉ `trackingAutoService.js#muaTrackingChoDon()` tạo và truyền `nhatKy`** (mảng rỗng mỗi lần gọi,
gộp lại sau khi xong bằng `nhatKy.join('\n')` cho cột ChiTiet). `routes/gke.js` (luồng quét QR thủ công
tại bàn đóng gói) KHÔNG truyền `nhatKy` — giữ nguyên hành vi cũ, KHÔNG ghi vào LogsTracking — vì yêu
cầu chỉ nói "thủ công và tự động" (2 nhánh `muaTrackingChoDon()` đã phân biệt qua `laThuCong`), quét QR
là luồng thứ 3, tách biệt, ngoài phạm vi lần này.

### 9.3. Ghi vào Sheet — không chặn luồng mua tracking thật

`ghiLogTrackingVaoSheet()` (mới, `trackingAutoService.js`) — dùng `getHeadersCached`/`appendRow` (CÙNG
khuôn tối ưu với `logService.js#ghiLog()` — chỉ đọc dòng 1 lấy header, không đọc cả tab). Bọc trong
try/catch KHÔNG BAO GIỜ throw — tab chưa tạo/lỗi mạng chỉ `console.error`, không được làm hỏng việc mua
tracking THẬT đang chạy. Gọi ở ĐÚNG 3 điểm trong `muaTrackingChoDon()`: bỏ qua (đã có tracking), thành
công (sau khi ghi `TRACKING_ID`/`HANG_VAN_CHUYEN` thật), lỗi (trong catch, nối thêm dòng `LỖI: <thông
báo>` vào cuối `nhatKy` đã thu thập được TRƯỚC KHI lỗi xảy ra).

**Không đổi gì khác**: `_logs` (bộ nhớ, xem Logs ngắn gọn trên trang Tracking) vẫn y nguyên như mục
6.2/8.2 — tab Sheet mới là bản ghi lâu dài SONG SONG, không thay thế.

### 9.4. Đã kiểm tra

Test mock `global.fetch` (không mock `taoDonGke`/`layTemIn` như các test trước — lần này cần xác nhận
ĐÚNG nội dung kỹ thuật `ghi`/`ghiLoi` thu thập được) qua 4 kịch bản: (1) thành công, tự động — `ChiTiet`
có đủ 3 bước đăng nhập/tạo đơn/in tem, đúng thứ tự, có dòng body request lẫn dòng phản hồi, ≥5 dòng;
(2) thành công, thủ công — `Nguon`/`NguoiDung` đúng người bấm; (3) lỗi thật ở bước "tạo đơn" — `ChiTiet`
có đủ bước đăng nhập (chạy trước khi lỗi) + dòng "GKE từ chối" + dòng "LỖI: ..." cuối cùng, KHÔNG có
bước "in tem" (chưa chạy tới); (4) đã có tracking thật — `KetQua = "Bỏ qua"`, xác nhận **0 lần gọi
`fetch()`** (không tốn lượt gọi GKE nào). Phát hiện + tự sửa 1 lỗi TRONG TEST (không phải lỗi thật):
`layToken()` có cache token 12h ở cấp module, test đầu không reset cache module giữa các kịch bản nên
kịch bản 2/3 "thiếu" dòng đăng nhập — do token vẫn còn hiệu lực từ kịch bản 1 trước đó (đúng hành vi có
sẵn), không phải bug; sửa test bằng cách xoá cache require + nạp lại module trước mỗi kịch bản. Chạy lại
bộ hồi quy rút gọn (cấu hình, quét tự động, chống trùng, retry, phân loại danh sách) — không hồi quy.

### 9.5. Bổ sung 09/09/2026 (lần 7): định dạng cột `ThoiGian` ngắn gọn

Cột `ThoiGian` ban đầu dùng `thoiGianVNISOString()` — đúng giờ Việt Nam nhưng dạng chuỗi ISO đầy đủ
(vd `2026-09-09T06:59:25.709+07:00`) khó theo dõi khi mở trực tiếp trong Google Sheet. Đổi sang
`dinhDangNgayGioNgan(new Date())` — hàm NGẮN GỌN đã có sẵn từ trước trong `dateUtils.js` (dùng chung
với timeline lịch sử thay đổi/cột "Thời gian" báo cáo), cho ra đúng dạng `09-09 06:59:25` (DD-MM
HH:mm:ss, giờ VN, KHÔNG có năm) — tái dùng nguyên, không viết hàm mới. CHỈ áp dụng cho `LogsTracking`
— tab `LichSuHoatDong` (dùng `ghiLog()` trong `logService.js`) vẫn giữ nguyên ISO đầy đủ như cũ, vì
cột đó CÓ được đọc lại để sắp xếp theo thời gian (`layLichSuTheoDon()`), còn `LogsTracking` hiện chưa
có consumer nào đọc lại cột này trong code — chỉ để người dùng xem trực tiếp trên Sheet, nên bỏ năm là
an toàn. Đã kiểm tra: `dinhDangNgayGioNgan()` cho ra đúng chuỗi khớp ví dụ người dùng đưa ra; test ghi
1 dòng qua `muaTrackingChoDon()` xác nhận cột `ThoiGian` thật sự ghi đúng định dạng `DD-MM HH:mm:ss`
(regex `^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$`).

## 10. Bổ sung 09/09/2026 (lần 2): "IN LABEL" / "MUA TRACKING và IN LABEL"

Theo yêu cầu người dùng: 2 nút mới tại menu Đơn hàng, Đơn hàng chi tiết, và Tracking, cho phép
admin/ve_file/san_xuat (KHÔNG nguoi_lay_phoi) in nhãn vận chuyển GKE mà không cần quét QR sống. "IN
LABEL" chỉ in lại tem cho đơn ĐÃ có tracking thật. "MUA TRACKING và IN LABEL" làm cả 2 việc trong 1
nút, tự bỏ qua bước mua nếu đơn đã có tracking rồi.

### 10.1. Cột Sheet mới

- `IN_LABEL` (`Don_Hang_ALL`, YES/NO) — người dùng đã tự thêm trước khi code.
- `THOI_GIAN_IN_LABEL` (`Don_Hang_ALL`) — đề xuất thêm, CÙNG khuôn `THOI_GIAN_IN_MA` (mục 9.5's anh em):
  mốc thời gian lần in gần nhất, tách khỏi `ThoiGianCapNhatCuoi` (bị mọi lượt sửa khác ghi đè). Người
  dùng đã đồng ý thêm. Cả 2 cột đều TUỲ CHỌN — code guard `headers.includes(...)` trước khi ghi (xem
  `trackingAutoService.js#ghiDaInLabel`), thiếu cột nào thì chỉ bỏ qua việc ghi cờ đó, KHÔNG chặn việc
  in label thật.

### 10.2. Điều kiện — khác hẳn nút "Mua Tracking" gốc

Nút "Mua Tracking" gốc (`muaTrackingChoDon()`) KHÔNG kiểm tra `TRANG_THAI_XUONG` — thiết kế có chủ đích
để lấy mã tracking sớm bất kỳ lúc nào. 2 nút MỚI thì NGƯỢC LẠI: bắt buộc đơn đang `"Đã đóng gói"` hoặc
`"ĐÃ DÁN TEM"` (`kiemTraDieuKienInLabel()`, giống hệt điều kiện quét QR Tracking ở `routes/gke.js`) —
đã xác nhận với người dùng, in ra 1 tem giấy thật tốn kém hơn hẳn việc chỉ lấy mã vào hệ thống, nên cần
chắc đơn đã đóng gói xong mới cho in.

"IN LABEL" (không phải bản gộp) còn đòi thêm: đơn phải ĐÃ có tracking thật — không thì báo lỗi gợi ý
dùng nút gộp thay vì tự ý mua hộ.

### 10.3. `services/trackingAutoService.js` — 2 hàm mới, tái dùng tối đa

- `inLabelChoDon(sttKey, cauHinhGke, user)` — gọi thẳng `gkeService.layTemIn()` (KHÔNG gọi `taoDonGke`),
  y hệt nhánh "in lại tem" đã có ở `routes/gke.js`. Ghi log riêng, `Nguon: 'In label'`.
- `muaTrackingVaInLabelChoDon(sttKey, cauHinhGke, user)` — kiểm tra điều kiện trạng thái 1 lần, rồi:
  đơn ĐÃ có tracking → **uỷ quyền thẳng cho `inLabelChoDon()`** (không tự làm lại, tránh ghi log trùng
  lặp 2 lần cho cùng 1 lần in); đơn CHƯA có tracking → gọi `muaTrackingChoDon()` (đã tự lấy tem trong
  lúc mua — `label_base64` có sẵn trong kết quả trả về, KHÔNG cần gọi GKE thêm lần nào cho bước in),
  rồi ghi thêm 1 dòng log phụ `Nguon: 'Mua tracking + In label'` bên cạnh dòng `Nguon: 'Thủ công'` mà
  `muaTrackingChoDon()` đã tự ghi.
- Đã cân nhắc kỹ để KHÔNG double-log: mỗi lần in chỉ sinh đúng 1 hoặc 2 dòng LogsTracking có chủ đích
  (2 dòng CHỈ khi vừa mua vừa in — 1 dòng cho bước mua, 1 dòng xác nhận đã in), không bao giờ ghi trùng
  cùng 1 sự kiện 2 lần.

### 10.4. Ghép nhiều tem thành 1 file PDF khi in hàng loạt

Tại menu Đơn hàng, có thể chọn NHIỀU đơn cùng lúc — theo lựa chọn người dùng (ưu tiên trải nghiệm hơn
chi phí code), server GHÉP tất cả tem lấy được thành công thành 1 file PDF nhiều trang duy nhất
(`gkeService.js#gopCacTemPdf()`, dùng thư viện mới `pdf-lib`) trước khi trả về — trình duyệt chỉ mở
ĐÚNG 1 hộp thoại in, không phải mở lần lượt N hộp thoại. Đơn nào lỗi (chưa có tracking, sai trạng
thái...) rơi vào `loi[]` riêng, không chặn cả lượt — cùng triết lý "lỗi 1 đơn không dừng cả lượt" đã áp
dụng cho "Mua tracking" hàng loạt.

Khác nút "Mua tracking" (chạy tuần tự CLIENT-SIDE qua `chayHangLoatCoTienDo()` để có thanh tiến độ +
nút Hủy giữa chừng): 2 nút mới gửi CẢ MẢNG `sttKeys` trong 1 lượt gọi API duy nhất (server tự lặp +
ghép PDF) — chỉ 1 vòng xoay chung, KHÔNG có thanh tiến độ từng đơn một. Đơn giản hơn cho lần đầu triển
khai; có thể nâng cấp sau nếu số lượng đơn chọn nhiều khiến thời gian chờ khó chịu.

### 10.5. Routes — đặt trong `routes/tracking.js`, KHÔNG phải `routes/gke.js`

`POST /api/tracking/in-label` và `POST /api/tracking/mua-va-in-label` — đặt CÙNG file với
`/mua-thu-cong` (cùng vai trò được phép, cùng "họ" tính năng), KHÔNG đặt trong `routes/gke.js` (file đó
dành cho luồng quét QR mở cho CẢ 4 vai trò, khác hẳn 2 nút mới chặn `nguoi_lay_phoi` — nếu đặt chung sẽ
phải thêm middleware riêng cho từng route thay vì áp dụng chung `router.use()`).

### 10.6. Mở toàn bộ trang Tracking cho ve_file/san_xuat — thay đổi phân quyền quan trọng

Phát sinh xung đột khi thiết kế: trang Tracking trước đó **admin-only** (menu ẩn với vai trò khác +
MỌI route trong `routes/tracking.js` chặn qua `chiAdmin`), vì có tài khoản API GKE thật + bật/tắt tính
năng phát sinh phí — nhưng yêu cầu "mọi vai trò trừ nguoi_lay_phoi dùng được 2 nút mới tại menu
Tracking" cần ve_file/san_xuat vào được trang này.

Đã hỏi người dùng 3 lựa chọn (giữ admin-only + dùng 2 nút qua Đơn hàng/chi tiết là đủ / chỉ mở riêng
danh sách+2 nút / mở toàn bộ trang) — **người dùng CHỌN mở toàn bộ trang** (đơn giản nhất về code,
chấp nhận đánh đổi ve_file/san_xuat cũng xem/sửa được cấu hình tài khoản API GKE + bật/tắt tự động mua
tracking). Đổi `chiAdmin` → `khongPhaiNguoiLayPhoi` trong `routes/tracking.js` (áp dụng cho MỌI route
trong file, không chỉ 2 route mới). Thêm mục "Tracking" vào `renderNav()` cho nhánh `san_xuat` (chèn
sau "Quét QR") và nhánh `ve_file` (chèn sau "Quét QR", trước "TK") — `nguoi_lay_phoi` vẫn không có mục
này (nhánh riêng, không đụng tới).

### 10.7. Frontend — helper in dùng chung, KHÔNG đụng scan.html

Thêm `base64ThanhBlob()`/`moHopThoaiInPdf()` vào `public/js/api.js` (dùng chung cho orders.html/
order.html/tracking.html) — CỐ Ý KHÔNG sửa `scan.html` (đã có `base64ThanhBlob`/`inTemTuDong` riêng,
gắn chặt với luồng camera/khởi động lại quét, nhiều chỉnh sửa tinh vi theo thời gian) dù trùng lặp nhỏ,
để không rủi ro ảnh hưởng luồng quét QR Tracking đang chạy ổn định. `moHopThoaiInPdf()` trả về hàm
`goiIn()` để có thể gắn thêm vào nút bấm thật — phòng khi trình duyệt (đặc biệt điện thoại) chặn gọi
`print()` tự động vì đã mất "user activation" sau khi chờ API (có thể mất vài giây tới gần 1 phút cho
GKE), dù trang order.html/orders.html/tracking.html hiện chưa có nút "In lại" riêng như scan.html (chưa
thấy cần thiết ở lần đầu triển khai — bấm lại đúng nút "IN LABEL"/"MUA TRACKING và IN LABEL" gốc vẫn in
lại được vì đơn đã có tracking, chỉ tốn thêm 1 lượt gọi GKE).

### 10.8. `IN LABEL` khi đơn CHƯA có tracking — khác nhau giữa 3 nơi

Theo lựa chọn người dùng: tại Đơn hàng chi tiết/Tracking (luôn đúng 1 đơn), nút "IN LABEL" ẨN HẲN khi
đơn chưa có tracking (chỉ hiện "MUA TRACKING và IN LABEL"). Tại menu Đơn hàng (chọn NHIỀU đơn, có thể
trộn lẫn đơn có/chưa tracking), việc ẩn theo điều kiện hỗn hợp không rõ ràng — quyết định LUÔN hiện cả
2 nút, đơn nào chưa có tracking mà lỡ bấm "IN LABEL" sẽ rơi vào `loi[]` riêng với thông báo rõ ràng,
không chặn cả lượt (nhất quán với cách xử lý lỗi từng đơn khác).

### 10.9. Đã kiểm tra

- Test độc lập `gkeService.js#gopCacTemPdf()` (dùng `pdfkit` tạo 3 PDF nhỏ thật) — gộp 1 phần tử trả về
  nguyên văn (không qua `pdf-lib`); gộp 3 phần tử ra đúng file 3 trang.
- Test độc lập (module-mock `orderService`/`gkeService`/`sheetsService`/`logService` qua
  `require.cache`, không đụng Sheet/GKE thật) 7 kịch bản cho `inLabelChoDon()`/
  `muaTrackingVaInLabelChoDon()`: chặn đúng khi sai trạng thái; chặn đúng khi chưa có tracking (gợi ý
  dùng nút gộp); in thành công cho đơn đã có tracking (chỉ gọi `layTemIn`, không gọi `taoDonGke`, ghi
  đúng `IN_LABEL`/`THOI_GIAN_IN_LABEL`); mua+in cho đơn chưa có tracking (chỉ 1 lần gọi `layTemIn` dù
  vừa mua vừa in, đúng 2 dòng log); mua+in cho đơn đã có tracking (uỷ quyền đúng, KHÔNG double-log);
  lỗi GKE giữa chừng (đúng 1 dòng log Lỗi); Sheet thiếu cột `IN_LABEL`/`THOI_GIAN_IN_LABEL` (vẫn in
  được, chỉ bỏ qua ghi cờ) — cả 26 assertion pass.
- `node --check` cho mọi file `.js` sửa/thêm + script inline trích xuất từ `orders.html`/`order.html`/
  `tracking.html`.
- Test tương tác qua trang mock (thật `/js/api.js`/`/js/icons.js`, mock `apiFetch`/`moHopThoaiInPdf`
  qua `require.cache`-style override ở tầng JS trình duyệt) trên `order.html`: nút "IN LABEL" ẩn đúng
  khi chưa có tracking, hiện đúng khi đã có; bấm nút gọi đúng API, in đúng label trả về, tải lại trang
  thành công; đường lỗi hiện đúng thông báo, khôi phục đúng trạng thái nút. Trên `orders.html`: khối 2
  nút ẩn đúng cho `nguoi_lay_phoi`, hiện đúng cho vai trò khác; bấm "IN LABEL" với 3 đơn chọn (2 thành
  công + 1 lỗi) gửi đúng `sttKeys` cả 3, in đúng label gộp, báo đúng "Thành công: 2/3" kèm chi tiết lỗi.

## 11. Bổ sung 09/09/2026 (lần 3): XOÁ trạng thái "Đã đóng gói"

Theo yêu cầu người dùng, xác nhận không cần trạng thái "Đã đóng gói" nữa. "Đã sản xuất" giờ đi THẲNG
sang "ĐÃ DÁN TEM" — pipeline chính còn 7 bước (trước đó 8): Chưa in mã → Đã in mã → ĐÃ SẴN SÀNG CHẠY
MÁY → Đang chạy máy → Đã sản xuất → ĐÃ DÁN TEM → DELIVERED_Đã giao đến khách.

### 11.1. Chế độ "Chụp ảnh đóng gói" — XOÁ hẳn (đã hỏi người dùng, chọn phương án này)

Trước đó có 2 cơ chế độc lập cùng dẫn ra khỏi "Đã sản xuất": "Chụp ảnh đóng gói" (thuần ảnh, KHÔNG gọi
GKE, KHÔNG tạo mã tracking — Đã sản xuất → Đã đóng gói) và "Quét mã QR Tracking" (gọi GKE thật, tạo mã
tracking — Đã đóng gói → ĐÃ DÁN TEM). Xoá "Đã đóng gói" khiến 2 cơ chế này trỏ chung 1 đích — đã hỏi
người dùng 3 lựa chọn (xoá hẳn / giữ lại chỉ để lưu ảnh, bỏ đổi trạng thái / vẫn cho chuyển thẳng sang
"ĐÃ DÁN TEM" không qua GKE). **Người dùng chọn xoá hẳn** — tránh triệt để trường hợp đơn mang trạng
thái "ĐÃ DÁN TEM" mà KHÔNG có mã tracking thật. Từ giờ, con đường DUY NHẤT rời khỏi "Đã sản xuất" là:
(1) "Quét mã QR Tracking" (routes/gke.js, tạo vận đơn GKE thật); (2) admin sửa tay (vẫn bắt buộc đơn
đang đúng "Đã sản xuất", xem mục 11.2).

Đã xoá: mốc `dong_goi` trong `routes/photos.js` (`COT_ANH_THEO_MOC`, `MOC_TU_DONG_CHUYEN_TRANG_THAI`)
— cột `Anh_Dong_Goi_URL` không còn dùng trong code (vẫn còn trên Sheet nếu người dùng muốn giữ ảnh cũ,
không tự xoá cột); mode `photo_dong_goi` trong `public/scan.html` (nút ẩn trong DOM, entry trong
`MODE_OPTIONS`/`CAU_HINH_ANH`/`dsDaChupTheoMoc`, mọi wiring onclick/classList.toggle liên quan); khối
"Ảnh đóng gói" (upload tay, admin-only) trong `public/order.html`.

### 11.2. Điều kiện MỚI cho "ĐÃ DÁN TEM" — admin sửa tay KHÔNG được miễn trừ trạng thái nguồn

Khác hẳn cơ chế cũ (admin bypass hoàn toàn cho "Đã sản xuất"/"Đã đóng gói", không kiểm tra gì thêm):
theo yêu cầu người dùng, admin sửa tay "ĐÃ DÁN TEM" CŨNG phải tuân theo điều kiện đơn đang đúng "Đã
sản xuất" — không có ngoại lệ nào miễn trừ được điều kiện này, kể cả admin.

`services/orderService.js#kiemTraCongAnhBatBuoc()`: thêm `TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM = ['Đã
sản xuất', 'ĐÃ DÁN TEM']` (cho giữ nguyên "ĐÃ DÁN TEM" để không chặn lượt lưu lại đúng giá trị cũ/quét
lại in tem), kiểm tra TRƯỚC cả nhánh `quaAnh`/admin-bypass — áp dụng cho MỌI người gọi, không có lối
tắt. `TRANG_THAI_BAT_BUOC_CHUP_ANH` đổi từ `['Đã sản xuất', 'Đã đóng gói']` thành `['Đã sản xuất', 'ĐÃ
DÁN TEM']`.

Hệ quả: `routes/gke.js` (luồng quét QR Tracking, mở cho cả `nguoi_lay_phoi`/`ve_file`/`san_xuat`, không
chỉ admin) giờ PHẢI truyền `{ quaAnh: true }` khi gọi `orderService.update()` để ghi `TRANG_THAI_XUONG:
'ĐÃ DÁN TEM'` — thiếu cờ này sẽ bị chặn ngay ở `kiemTraCongAnhBatBuoc` cho 3 vai trò không phải admin.
Tên tham số `quaAnh` giữ nguyên dù không phải ảnh (tránh đổi chữ ký hàm ở nhiều nơi) — ý nghĩa hiểu
rộng thành "đã qua đúng luồng xác nhận hợp lệ".

### 11.3. Các chỗ khác đã cập nhật đồng bộ

- `data/pipelineTinhTrang.js`: `TINH_TRANG_VALUES` (11→10 giá trị), `THU_TU_TINH_TRANG` (8→7).
- `routes/gke.js`: điều kiện quét đổi `'Đã đóng gói'` → `'Đã sản xuất'` (giữ nguyên cho phép `'ĐÃ DÁN
  TEM'` để in lại tem).
- `routes/reports.js`: `TRANG_THAI_TRACKING` (suy mẫu báo cáo "tracking" khi không truyền `mau`) đổi
  `'Đã đóng gói'` → `'Đã sản xuất'`.
- `routes/chatbot.js`: mô tả pipeline cho chatbot cập nhật lại (nhân tiện sửa luôn 2 chỗ lỗi thời có
  sẵn từ trước, không liên quan trực tiếp: thiếu "Đang chạy máy" trong mô tả, và
  `TRANG_THAI_VE_FILE` thiếu giá trị "Đang vẽ file").
- `public/order.html`, `public/orders.html`: bỏ `'Đã đóng gói'` khỏi danh sách trạng thái cho dropdown
  tự do. `order.html#CAC_TRANG_THAI_TU_SAN_SANG_TRO_DI` (cảnh báo phía client, mirror
  `THU_TU_TINH_TRANG`) — nhân tiện sửa luôn 1 lỗ hổng có sẵn từ trước: thiếu hẳn `'ĐÃ DÁN TEM'` trong
  danh sách này.
- `public/js/api.js#MAU_TRANG_THAI`: bỏ màu badge cho `'Đã đóng gói'`.
- `public/index.html`: cập nhật bước 7 trong khối "Xem quy trình xử lý đơn hàng" (minh hoạ tĩnh ở
  trang đăng nhập) từ "Đã đóng gói" sang "ĐÃ DÁN TEM" (quét mã QR Tracking).
- `services/trackingAutoService.js`: điều kiện "IN LABEL"/"MUA TRACKING và IN LABEL" (mục 10) đổi theo
  — `TRANG_THAI_DU_DIEU_KIEN_IN_LABEL` từ `['Đã đóng gói', 'ĐÃ DÁN TEM']` thành `['Đã sản xuất', 'ĐÃ
  DÁN TEM']`.

### 11.4. Dữ liệu đơn hàng CŨ đang ở "Đã đóng gói" trên Sheet thật

Không có quyền truy cập Sheet thật để kiểm tra trực tiếp — viết sẵn `scripts/migrate-trang-thai-v4.js`
(CHẠY THỬ mặc định, cần `--apply` mới ghi thật, cùng khuôn `migrate-trang-thai-v2.js`/`v3.js`) để người
dùng tự chạy: liệt kê mọi đơn đang `TRANG_THAI_XUONG="Đã đóng gói"`, chuyển VỀ `"Đã sản xuất"` (TRACKING_ID
nếu có vẫn giữ nguyên, chỉ đổi TRANG_THAI_XUONG) — các đơn này cần dùng lại 1 trong các cơ chế ở mục 12
(chụp ảnh xác nhận và/hoặc mua tracking) sau khi migrate để lên "ĐÃ DÁN TEM" đúng luồng hiện tại. *(Ghi
chú 09/09/2026 lần 4: script này viết TRƯỚC khi "Quét mã QR Tracking" bị xoá — vẫn đúng, chỉ đổi tên cơ
chế đích.)*

### 11.5. Đã kiểm tra

- Test độc lập (`data/pipelineTinhTrang.js` + `services/orderService.js` thật, mock `sheetsService`/
  `taiSanService`/`khachHangService` qua `require.cache`) — 12 assertion: `TINH_TRANG_VALUES` đúng 10
  giá trị, không còn "Đã đóng gói"; `THU_TU_TINH_TRANG` không còn "Đã đóng gói", "ĐÃ DÁN TEM" đứng ngay
  sau "Đã sản xuất"; ghi "Đã đóng gói" bị từ chối (giá trị không hợp lệ); admin sửa tay ĐÃ DÁN TEM từ
  đúng "Đã sản xuất" → thành công; admin sửa tay từ SAI nguồn ("Đang chạy máy") → BỊ CHẶN dù là admin;
  vai trò khác không `quaAnh` → bị chặn; vai trò khác CÓ `quaAnh:true` từ đúng nguồn → thành công;
  `quaAnh:true` từ SAI nguồn → VẪN bị chặn (xác nhận điều kiện nguồn không bị cờ `quaAnh` bỏ qua); lưu
  lại đúng giá trị cũ (ĐÃ DÁN TEM → ĐÃ DÁN TEM) → không bị chặn; "Đã sản xuất" không bị áp điều kiện
  nguồn mới; `chiSoTinhTrang("Đã đóng gói")` trả `null`.
- Chạy lại 2 bộ test đã viết ở mục 9.4/10.9 (`gopCacTemPdf`, `inLabelChoDon`/
  `muaTrackingVaInLabelChoDon`, đã cập nhật dữ liệu giả sang "Đã sản xuất") — vẫn pass toàn bộ, xác nhận
  tính năng IN LABEL không bị hồi quy khi đổi điều kiện trạng thái nguồn.
- `node --check` mọi file `.js` sửa/thêm (`data/pipelineTinhTrang.js`, `services/orderService.js`,
  `routes/photos.js`, `routes/gke.js`, `routes/chatbot.js`, `routes/reports.js`,
  `services/trackingAutoService.js`, `services/gkeService.js`, `scripts/migrate-trang-thai-v4.js`) +
  script inline trích xuất từ `orders.html`/`order.html`/`tracking.html`/`scan.html`.
- Test tương tác qua trang mock cho `scan.html` (thật `/js/api.js`/`/js/icons.js`, mock `apiFetch`, stub
  3 hàm điều khiển camera để tránh gọi `navigator.mediaDevices` thật) — dropdown chế độ còn ĐÚNG 4 lựa
  chọn (không còn "Chụp ảnh đóng gói"), phần tử `mode-photo-dong-goi` không còn trong DOM, chuyển sang
  mode "Chụp ảnh đã sản xuất" (mode còn lại duy nhất dùng chung cấu trúc cũ) hoạt động bình thường,
  không lỗi console.

## 12. Bổ sung 09/09/2026 (lần 4): thay "Quét mã QR Tracking" (GKE) bằng "Chụp ảnh ĐÃ DÁN TEM" (thuần ảnh)

Theo yêu cầu người dùng, qua 2 lượt hỏi lại để làm rõ (ban đầu gõ nhầm "ĐÃ DÁN NHÃN" thành trạng thái
mới — thực ra là "ĐÃ DÁN TEM" đã có; sau đó xác nhận rõ đây là 1 đường THỨ 2 tới "ĐÃ DÁN TEM", chấp
nhận đơn qua đường này có thể không có mã tracking thật; cuối cùng xác nhận CHỈ xoá chế độ quét camera
"Quét mã QR Tracking", KHÔNG xoá phần còn lại của tích hợp GKE): thêm kịch bản "Chụp ảnh ĐÃ DÁN TEM" ở
trang Quét mã QR — CÙNG khuôn "Chụp ảnh đã sản xuất" (quét QR xác định đơn → chụp ảnh → tự chuyển
trạng thái), KHÔNG gọi GKE — thay thế hẳn chế độ "Quét mã QR Tracking" cũ (gọi GKE thật, tạo vận đơn).

### 12.1. Quyết định cốt lõi: tách hẳn "ĐÃ DÁN TEM" khỏi việc có mã tracking GKE thật hay không

Trước lần này: `TRANG_THAI_BAT_BUOC_CHUP_ANH`/`TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM` (mục 11.2) coi "ĐÃ
DÁN TEM" là kết quả của việc GỌI GKE THẬT — đúng tinh thần đã xây khi xoá "Đã đóng gói" (mục 11.1: xoá
hẳn "Chụp ảnh đóng gói" để TRÁNH đơn "ĐÃ DÁN TEM" mà không có tracking thật). Lần này người dùng ĐẢO
NGƯỢC quyết định đó — xác nhận rõ, kể cả sau khi được nhắc lại nguyên do đã xây dựng ở mục 11.1, vẫn
CHỌN cho phép đơn đạt "ĐÃ DÁN TEM" qua thuần ảnh, không cần mã tracking thật. Tôn trọng quyết định mới
nhất của người dùng — không tự ý giữ nguyên tắc cũ.

**Cơ chế `orderService.js` KHÔNG cần đổi gì** — `TRANG_THAI_BAT_BUOC_CHUP_ANH`/
`TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM` (mục 11.2) vẫn y nguyên: bắt buộc phải qua `quaAnh:true` (chụp
ảnh QR hợp lệ) hoặc admin sửa tay, VÀ bắt buộc nguồn đúng "Đã sản xuất". Chỉ đổi NGƯỜI GỌI hợp lệ —
trước là `routes/gke.js` (đã xoá), giờ là `routes/photos.js` mốc `da_dan_tem` (cũng truyền `quaAnh:true`,
đúng khuôn mốc `da_san_xuat` có sẵn).

### 12.2. Xoá hẳn `routes/gke.js` — không chỉ ẩn chế độ quét

Đã hỏi rõ mức độ xoá (giữ nguyên phần còn lại của GKE / xoá toàn bộ) — người dùng chọn: CHỈ xoá chế độ
quét camera "Quét mã QR Tracking", GIỮ NGUYÊN nút "Mua Tracking" (thủ công/tự động), "IN LABEL"/"MUA
TRACKING và IN LABEL", trang Tracking (cấu hình GKE, bật/tắt tự động, LogsTracking).

Xác nhận `routes/gke.js` chỉ được `require` từ `server.js`, route `/tracking/quet` chỉ được gọi từ
`scan.html#xuLyQuetTracking()` (không nơi nào khác) — an toàn để XOÁ HẲN file (không giữ lại dạng dead
code), bỏ luôn dòng mount `app.use('/api/gke', ...)` trong `server.js`. `services/gkeService.js` (client
GKE cấp thấp — `taoDonGke`/`layTemIn`/`layCauHinhGke`/`MA_DANG_CHO_TEM`) giữ nguyên, vẫn dùng bởi
`trackingAutoService.js#muaTrackingChoDon()`/`inLabelChoDon()`.

### 12.3. `public/scan.html` — xoá gọn cả khối, không chỉ ẩn

Mode `gke_tracking` gắn với 1 khối code khá lớn và ĐAN XEN với code của mode "Quét kịch bản" (batch) —
không nằm liền 1 khối duy nhất. Xoá theo 2 đoạn tách biệt (xác nhận ranh giới bằng cách đọc trực tiếp
file, xoá bằng script Node theo đúng số dòng đã xác nhận, không dùng string-replace cho khối quá lớn để
tránh sai lệch khi transcribe):
- Đoạn 1: từ comment đầu `xuLyQuetTracking` tới hết `inTemTuDong()` (gồm `daBaoDangBanTracking`,
  `xuLyQuetTracking()`, `hienThiTrangThaiCamera()`, `khoiDongLaiCameraTracking()`, `base64ThanhBlob()`,
  `inTemTuDong()`) — ngay TRƯỚC `async function xuLyQuetKichBan()` (mode "Quét kịch bản", PHẢI giữ).
- Đoạn 2: từ `document.getElementById('btn-dung-quet-tracking').onclick` tới hết
  `dongTongHopTrackingLoi()` (gồm `renderTongHopTracking()`, `dongTongHopTrackingOK()`,
  `dongTongHopTrackingLoi()`) — ngay TRƯỚC `function renderXemLai()` (mode "Quét kịch bản", PHẢI giữ).

Cũng xoá: nút `<button id="btn-dung-quet-tracking">` + `<div id="trang-thai-camera-tracking">` trong
HTML, entry `gke_tracking` trong `MODE_OPTIONS`, class `che-do-to` toggle, nhánh `mode === 'gke_tracking'`
trong `capNhatManHinh()`/`dieuChinhCamera()`. Sau khi xoá, `document.getElementById('btn-dung-quet-
tracking').onclick = ...` (nếu sót lại) sẽ THROW ngay lúc tải trang vì phần tử không còn tồn tại — đã rà
kỹ để xoá đúng cả dòng này, không chỉ ẩn.

### 12.4. Thêm mode `photo_da_dan_tem` — tái dùng 100% cơ chế chung sẵn có

`CAU_HINH_ANH.photo_da_dan_tem = { moc:'da_dan_tem', nhanTab:'Chụp ảnh ĐÃ DÁN TEM', yeuCau:'Đã sản
xuất', chuyenSang:'ĐÃ DÁN TEM' }` + `dsDaChupTheoMoc.photo_da_dan_tem = []` + thêm vào `MODE_OPTIONS`
+ mở rộng điều kiện nhánh chung `mode === 'photo_san_xuat' || mode === 'photo_da_dan_tem'` trong
`capNhatManHinh()`. KHÔNG cần sửa `dieuChinhCamera()`, `xuLyQuetDeXacDinhDon()`, `xuLyChupAnh()`,
`renderDemNhomAnh()`, `renderDsDaChup()` — tất cả đã đọc `CAU_HINH_ANH[mode]`/`dsDaChupTheoMoc[mode]`
động theo biến `mode`, không hardcode tên mode cụ thể nào, nên thêm 1 mode mới hoàn toàn tái dùng được.
KHÔNG thêm nút ẩn trong menu 4-nút-cũ (đã ghi rõ trong code là "vô hại, không cần dọn vì không hiển
thị" — không perpetuate thêm phần tử DOM cho 1 UI đã deprecated).

`routes/photos.js`: thêm `da_dan_tem` vào `COT_ANH_THEO_MOC` (cột `Anh_Da_Dan_Tem_URL` — CẦN NGƯỜI
DÙNG TỰ THÊM vào Sheet) và `MOC_TU_DONG_CHUYEN_TRANG_THAI` (`{ yeuCau:'Đã sản xuất', chuyenSang:'ĐÃ
DÁN TEM' }`) — 2 route sẵn có (`/kiem-tra`, `/upload`) đọc 2 dict này ĐỘNG theo `moc` gửi lên, không
cần sửa logic route.

`public/order.html`: thêm khối upload admin-only "Ảnh ĐÃ DÁN TEM" (mốc `da_dan_tem`), CÙNG khuôn khối
"Ảnh đã sản xuất" — và thêm link xem ảnh (nếu có `Anh_Da_Dan_Tem_URL`) vào khối thông tin đơn.

### 12.5. Dọn comment tham chiếu `routes/gke.js` còn sót trong code KHÔNG bị xoá

Nhiều comment ở `services/gkeService.js`/`services/trackingAutoService.js`/`data/pipelineTinhTrang.js`
mô tả hành vi/lịch sử gắn với `routes/gke.js` (đã xoá) — rà lại và viết lại nội dung (không chỉ xoá
dòng) để không còn trỏ tới file không tồn tại, đồng thời cập nhật đúng "sự thật mới": việc đổi
`TRANG_THAI_XUONG` và việc gọi GKE giờ HOÀN TOÀN TÁCH BIỆT (trước đây gắn liền trong `routes/gke.js`).

### 12.6. Đã kiểm tra

- Test tương tác qua trang mock MỚI cho `scan.html` (build lại từ file hiện tại sau khi xoá, không tái
  dùng mock cũ) — dropdown còn ĐÚNG 4 lựa chọn (`batch`, `photo_san_xuat`, `photo_da_dan_tem`, `lookup`,
  không còn `gke_tracking`); `CAU_HINH_ANH`/`dsDaChupTheoMoc` đúng 2 khoá; phần tử `btn-dung-quet-
  tracking`/`trang-thai-camera-tracking` không còn trong DOM; không lỗi console, không có lời gọi
  `apiFetch` nào ngoài dự kiến. Chuyển sang mode `photo_da_dan_tem` hiện đúng mô tả
  (`Quét mã QR để xác định đơn cần "Chụp ảnh ĐÃ DÁN TEM". Đơn phải đang ở "Đã sản xuất".`). Gọi thẳng
  `xuLyQuetDeXacDinhDon('DH999')` với `/photos/kiem-tra` mock — gửi đúng `{moc:'da_dan_tem', sttKey:
  'DH999'}`, chuyển đúng sang trạng thái [Sẵn sàng chụp] (`photo-wrap` hiện, mô tả đúng).
- `node --check` `data/pipelineTinhTrang.js`, `services/orderService.js`, `services/gkeService.js`,
  `services/trackingAutoService.js`, `routes/photos.js`, `routes/chatbot.js`, `routes/reports.js`,
  `server.js` + script inline trích từ `scan.html`/`order.html`.
- Rà `grep` toàn repo xác nhận: không còn file `.js` nào (ngoài chính `server.js`/`data/pipelineTinhTrang.js`/
  `gkeService.js` ghi chú LỊCH SỬ có chữ "ĐÃ XOÁ") tham chiếu `routes/gke.js`; không còn `gke_tracking`
  trong bất kỳ file code nào (chỉ còn trong 1 spec doc cũ mô tả thiết kế TRƯỚC lần đổi này, giữ nguyên
  làm lịch sử).

## 13. Bổ sung 09/09/2026 (lần 5): bắt buộc ĐÃ có tracking thật mới được "ĐÃ DÁN TEM"

Theo yêu cầu người dùng: "1 đơn nếu chưa có thông tin Tracking thì sẽ không thể chuyển sang trạng thái
'ĐÃ DÁN TEM'". ĐẢO NGƯỢC lại đúng phần vừa chấp nhận đánh đổi ở mục 12.1 (cho phép "ĐÃ DÁN TEM" qua ảnh
mà không cần tracking thật) — tôn trọng quyết định mới nhất, không tự ý giữ nguyên tắc cũ.

### 13.1. `services/orderService.js` — chặn ở ĐÚNG 1 chỗ, universal, không ngoại lệ

Thêm `MA_DANG_CHO_TEM_GKE = 'DANG_CHO_GKE_TAO_TEM'` (tự khai báo lại, PHẢI khớp `gkeService.js#MA_DANG_CHO_TEM`
— KHÔNG import thẳng `gkeService.js` vào `orderService.js` để tránh module trung tâm này phải biết chi
tiết 1 tích hợp bên thứ 3 cụ thể, cùng lý do `public/order.html` cũng tự khai báo lại hằng số này).

Trong `kiemTraCongAnhBatBuoc()`, ngay sau kiểm tra trạng thái NGUỒN (mục 11.2), thêm kiểm tra: giá trị
TRACKING_ID hiệu lực SAU KHI áp dụng `updates` (`updates.TRACKING_ID ?? rowHienTai.TRACKING_ID` — đúng
cho cả trường hợp `updates` có tự set TRACKING_ID trong CÙNG lượt gọi lẫn trường hợp không) phải khác
rỗng VÀ khác `MA_DANG_CHO_TEM_GKE` (placeholder "chờ tem", KHÔNG tính là tracking thật). Đặt TRƯỚC nhánh
`quaAnh`/admin-bypass — giống hệt cách `TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM` đã làm — nên áp dụng cho
MỌI người gọi, kể cả admin sửa tay và `quaAnh:true`, không có ngoại lệ nào.

Vì `services/trackingAutoService.js#muaTrackingChoDon()`/`inLabelChoDon()`/`muaTrackingVaInLabelChoDon()`
KHÔNG BAO GIỜ tự set `TRANG_THAI_XUONG` (xác nhận từ mục 10/12 — thiết kế từ đầu đã tách 2 việc), các
hàm này KHÔNG bao giờ chạm vào nhánh kiểm tra mới này — không cần sửa gì ở `trackingAutoService.js`,
chỉ cần cập nhật lại comment cho đúng (2 việc giờ là "tách riêng NHƯNG có thứ tự bắt buộc": phải mua
tracking trước, mới chụp ảnh/sửa tay "ĐÃ DÁN TEM" được — không còn "hoàn toàn tách biệt" như mục 12.1
diễn đạt).

### 13.2. `routes/photos.js` — chặn SỚM ở cả `/kiem-tra` lẫn `/upload`, không chỉ ở `/upload`

`orderService.update()` (gọi trong `/upload`) đã tự chặn được việc GHI rồi — về mặt CHÍNH XÁC, chỉ cần
sửa `orderService.js` là đủ. Nhưng thêm kiểm tra tương tự (hàm `thieuTrackingThat(row)`, cùng khuôn
`MA_DANG_CHO_TEM_GKE`) vào CẢ `/kiem-tra` (trước khi cho mở camera chụp) lẫn `/upload` (trước khi tải
ảnh lên MinIO) — đúng tinh thần SẴN CÓ của `/kiem-tra` ("TRƯỚC KHI mở camera chụp thật — tránh lãng phí
1 lần chụp cho đơn không hợp lệ") — nếu không thêm ở `/kiem-tra`, người quét vẫn lọt qua bước kiểm tra
ban đầu, mất công chụp ảnh xong mới bị `/upload` từ chối.

Chỉ áp dụng cho mốc có `chuyenSang === 'ĐÃ DÁN TEM'` (hiện chỉ `da_dan_tem`) — không đụng tới mốc
`da_san_xuat` (không có điều kiện tracking).

### 13.3. Cập nhật chữ hiển thị

`public/scan.html` — mô tả mode "Chụp ảnh ĐÃ DÁN TEM" thêm "và đã có thông tin Tracking (mua tracking
trước ở menu Đơn hàng/Tracking)" để người quét biết điều kiện ngay từ đầu, không phải đợi bị từ chối.
`public/order.html` — sửa lại chú thích khối "Ảnh ĐÃ DÁN TEM" cho đúng thứ tự bắt buộc (mua tracking
trước, tải ảnh sau) thay vì diễn đạt "2 việc tách biệt" như trước.

### 13.4. Đã kiểm tra

- Cập nhật bộ test `orderService.js` (mục 11.5/12.6) — thêm TRACKING_ID thật vào các dòng giả lập vốn
  cần "thành công" (test 3/6 lần trước vô tình chưa có TRACKING_ID, giờ mới lộ ra nếu không thêm sẽ bị
  chặn bởi luật mới — đã sửa dữ liệu giả cho đúng ý đồ từng test), thêm 4 kịch bản mới: admin sửa tay
  thiếu tracking bị chặn; đơn đang ở placeholder "chờ tem" bị chặn (không tính là tracking thật);
  `quaAnh:true` không bỏ qua được điều kiện tracking; đơn ĐÃ có tracking thật thì chuyển bình thường,
  không bị chặn nhầm. Tổng 14 nhóm test, toàn bộ pass, không hồi quy các nhóm cũ.
- `node --check` `data/pipelineTinhTrang.js`, `services/orderService.js`, `services/trackingAutoService.js`,
  `routes/photos.js`, `public/js/api.js` + script inline trích từ `scan.html`/`order.html`.
