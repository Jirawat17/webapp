# Xưởng Thêu — Web App (thay thế AppSheet)

Web app quản lý đơn hàng xưởng thêu. Dữ liệu vẫn nằm trên Google Sheets (`HanhPhuc99`), ảnh vẫn lưu Google Drive.

> **Bản cập nhật này khớp đúng cấu trúc Sheet thật** (dựa trên file `HanhPhuc99.xlsx` bạn cung cấp) — khác với tài liệu AppSheet mẫu ban đầu. Xem mục 9 để biết những chỗ cần bạn tự sửa trong Sheet.

## 1. Chuẩn bị Google Cloud (làm 1 lần)

1. Vào [Google Cloud Console](https://console.cloud.google.com) → tạo project mới (hoặc dùng project đã có).
2. Vào **APIs & Services > Library** → bật **Google Sheets API** và **Google Drive API**.
3. Vào **IAM & Admin > Service Accounts** → **Create Service Account**.
4. Tab **Keys** → **Add Key > Create new key > JSON** → tải về, đặt tên `service-account-key.json`, để ở thư mục gốc dự án (**KHÔNG** đưa lên git/public).
5. Copy **email của service account** → **Share** file `HanhPhuc99` trên Google Sheets với email đó, quyền **Editor**.
6. **Share** thư mục Drive gốc chứa ảnh với email đó, quyền **Editor**.

## 2. Các tab Sheet app này dùng (đã có sẵn trong `HanhPhuc99.xlsx` của bạn)

| Tab | Vai trò trong app |
|---|---|
| `Don_Hang_ALL` | Dữ liệu đơn hàng chính |
| `Khach_Hang` | Tra mã khách hàng (`MA_KHACH_HANG`) ra tên hiển thị (`TEN_KHACH_HANG`) |
| `NguoiDung` | Danh sách nhân viên dùng để đăng nhập (Ten, VaiTro, Team, KichHoat) |
| `LichSuHoatDong` | App tự ghi — nhật ký mọi thao tác (đăng nhập, sửa đơn, quét QR, chatbot...) |
| `CauHinhKichBan` | **Cấu hình kịch bản quét QR** — sửa/thêm kịch bản ở đây, không cần sửa code |
| `NhatKyQuetHangLoat` | App tự ghi — nhật ký riêng cho từng lượt quét kịch bản (khớp schema cũ đã có sẵn) |

Các tab `Nhan_Vien`, `QuetMa`, `Chatbot`, `B0_Chuan_Bi_Phoi_Ao`, `DATANEW_VIP3`, `B1_Cac_Don_Can_In`, `REFERENCE TABLE`, `BANG_GIA_FUFILL`, `DATA` có trong file bạn gửi nhưng **app này chưa dùng đến** — có thể là tàn dư từ hệ thống cũ (Apps Script/AppSheet) hoặc dự định cho tính năng khác. Không đụng tới nếu chưa cần.

## 3. Cột thật trong `Don_Hang_ALL` (app đọc/ghi đúng các tên này)

| Cột | Ý nghĩa |
|---|---|
| `STT_Key` | Mã đơn — khóa chính, dùng để quét QR |
| `MA_KHACH_HANG` | Mã khách hàng (tra tên thật qua tab `Khach_Hang`) |
| `HANG_VAN_CHUYEN` | Hãng vận chuyển |
| `MA_VAN_DON_ID` | Mã vận đơn |
| `DANH_DAU_IN` | Đã đánh dấu in (TRUE/FALSE) |
| `TINH_TRANG` | Trạng thái hiện tại — xem pipeline ở mục 4 |
| `NGAY_LEN_DON` | Ngày lên đơn — dùng để sắp xếp danh sách và tính cảnh báo |
| `TEN_DIA_CHI`, `DIA_CHI_TEN_DUONG`, `DIA_CHI_TEN_TP`, `DIA_CHI_BANG`, `MA_ZIPCODE`, `DIA_CHI_NUOC` | Các phần địa chỉ giao hàng |
| `MA_DON_HANG_ORDERID` | Mã đơn hàng trên sàn TMĐT (Etsy...) |
| `DUONG_DAN_URL` | Ảnh mẫu / thiết kế gốc |
| `MOCKUP` | Ảnh mockup thêu |
| `LOAI`, `KICH_THUOC`, `MAU_SAC` | Loại áo / kích thước / màu — app tự ghép thành tiêu đề hiển thị |
| `VI_TRI_1`, `VI_TRI_2`, `VI_TRI_3` | Vị trí thêu |
| `SO_LUONG`, `SO_LUONG_AO_TREN_DON` | Số lượng |
| `GHI_CHU` | Ghi chú xưởng — mọi vai trò đều sửa được |
| `TEN`, `SDT` | Tên & SĐT người nhận |
| `NguoiCapNhatCuoi`, `ThoiGianCapNhatCuoi` | App tự ghi — ai/khi nào sửa đơn gần nhất |

**Cột KHÔNG tồn tại** (khác với bản thiết kế mẫu trước đây, đã bỏ khỏi code): `Ten_KH`, `Ten_San_Pham`, `Co_Phoi`, `Co_File_Ve`, `Team_San_Xuat`, `Ngay_Giao_Du_Kien`, `Nguoi_Ve_File`, `Trang_Thai_Ship`, `Ngay_Ship`. Khái niệm "có phôi/có file" giờ được thể hiện qua **vị trí của đơn trong pipeline `TINH_TRANG`**, không phải checkbox riêng.

## 4. Pipeline `TINH_TRANG` thật

```
B0_Chờ xác nhận → B1_Đã in → B2_Đã lấy phôi → B3_Đã đủ Phôi và File Vẽ
→ B4_Đang sản xuất → B5_Đã sản xuất → SHIPPED_Đã gửi vận chuyển
→ IN TRAINSIT_Tracking đã hoạt động → DELIVERED_Đã giao hàng đến khách
(hoặc CANCELLED_Đã hủy đơn / REFUNDED_Hoàn đơn — trạng thái kết thúc)
```

Thứ tự này định nghĩa tại `data/pipelineTinhTrang.js` — sửa file này nếu quy trình thực tế thay đổi. Dùng để:
- Tính badge cảnh báo (mục 6)
- Lọc đơn theo vai trò (chuẩn bị phôi thấy đơn chưa tới B2, vẽ file thấy đơn chưa tới B3, sản xuất thấy đơn từ B3 đến trước B5, đóng gói thấy đơn từ B5 trở đi)

## 5. Kịch bản quét QR — đọc trực tiếp từ tab `CauHinhKichBan`

**Thay đổi quan trọng nhất so với bản trước**: kịch bản không còn hardcode trong `data/scenarios.js` (file này đã xoá) — giờ app đọc thẳng 3 cột `Ten_Kich_Ban`, `Trang_Thai_Yeu_Cau`, `Trang_Thai_Sau` từ tab `CauHinhKichBan` mỗi lần cần. **Sửa/thêm kịch bản chỉ cần sửa trực tiếp trên Sheet, không cần sửa code hay deploy lại.**

Mỗi lượt quét kịch bản (thành công hay lỗi) đều được ghi vào:
- `LichSuHoatDong` (nhật ký chung toàn hệ thống)
- `NhatKyQuetHangLoat` (nhật ký riêng cho quét QR, đúng schema đã có sẵn trong Sheet của bạn)

### ⚠️ Kịch bản hiện tại trong `CauHinhKichBan` bị LỆCH với dữ liệu thật

| Trong `CauHinhKichBan` ghi | Dữ liệu thật đang dùng | Hậu quả |
|---|---|---|
| `B0_HOLD_Chờ xác nhận` | `B0_Chờ xác nhận` (không có `_HOLD`) | Kịch bản "B1_Đã in" sẽ **không bao giờ chạy được** cho đơn đang ở `B0_Chờ xác nhận` |
| `B4_IN PRODUCTION_Đang sản xuất` | `B4_Đang sản xuất` | Kịch bản "B4..." sẽ không áp dụng được cho đơn đang ở `B3_Đã đủ Phôi và File Vẽ` muốn chuyển tiếp |

**Cách sửa**: mở tab `CauHinhKichBan`, sửa 2 dòng đó cho khớp chính xác với chuỗi đang dùng trong `Don_Hang_ALL` (copy-paste để chắc không lệch dấu cách/chính tả). Tôi không tự sửa vì không có quyền ghi vào Sheet thật của bạn — chỉ đọc được bản `.xlsx` bạn tải lên.

Cũng chưa có kịch bản nào cho các giai đoạn sau `B4`: `B5_Đã sản xuất`, `SHIPPED_Đã gửi vận chuyển`, `IN TRAINSIT...`, `DELIVERED...`. Nếu muốn quét QR để chuyển các giai đoạn này, thêm dòng mới vào `CauHinhKichBan` theo đúng 3 cột hiện có.

## 6. Cảnh báo Telegram 3 tầng + badge trên web

Sheet không có cột deadline riêng, nên cảnh báo tính theo **số ngày kể từ `NGAY_LEN_DON`** kết hợp **vị trí hiện tại trong pipeline**:
- 🟡 **Vàng**: ≥3 ngày mà chưa tới `B2_Đã lấy phôi`
- 🟠 **Cam**: ≥5 ngày mà chưa tới `B4_Đang sản xuất`
- 🔴 **Đỏ**: ≥7 ngày mà chưa `SHIPPED`

Sửa ngưỡng/điều kiện tại `services/alertService.js` nếu cần khác đi. Cấu hình `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHATID_*` trong `.env` (xem `.env.example`).

## 7. Chatbot

Route `POST /api/chatbot/hoi` gọi thẳng LLM nội bộ, ngữ cảnh xây trực tiếp từ `Don_Hang_ALL` (đã gắn tên khách hàng thật + tiêu đề sản phẩm), giới hạn theo đơn mà vai trò người hỏi được xem. Cấu hình `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` trong `.env`.

## 8. Báo cáo Excel/PDF

Trang **Báo cáo** (`admin`/`quan_ly`) lọc theo `NGAY_LEN_DON` và/hoặc `MA_KHACH_HANG`, xuất `.xlsx` hoặc `.pdf` (font Noto Sans nhúng sẵn trong `fonts/`, đã kiểm tra đủ dấu tiếng Việt).

## 9. Việc bạn cần tự làm

1. **Sửa 2 chỗ lệch tên trong `CauHinhKichBan`** (mục 5) — nếu không sửa, 2 trong 4 kịch bản không dùng được.
2. **Thêm cột nếu muốn dùng tính năng cảnh báo/đóng gói**:
   - `CanhBaoDaGui` (VANG/CAM/DO/trống) — app tự ghi, chống gửi trùng Telegram
   - `Anh_Dong_Goi_URL` — nếu muốn dùng nút "Chụp ảnh đóng gói"; chưa có thì thao tác này sẽ báo lỗi rõ ràng thay vì âm thầm ghi sai chỗ
3. **Kiểm tra lại vai trò trong tab `NguoiDung`**: `Luan` đang có `VaiTro = "operator"` — giá trị này **không khớp** với 6 vai trò app nhận diện (`admin`, `quan_ly`, `ve_file`, `chuan_bi_phoi`, `san_xuat`, `dong_goi`). Nên đổi thành `san_xuat` (dựa theo Team ghi là "San Xuat"), nếu không Luan sẽ không thấy đơn nào cả khi đăng nhập.
4. Tab `Nhan_Vien` (Cô Thu, Phượng, Chị Hoan...) là hệ thống phân quyền **cũ** (PHAN_QUYEN: NguoiLayPhoi/NguoiVeFile/NguoiChayMay) — app này **không đọc tab đó**, chỉ đọc `NguoiDung`. Nếu muốn các nhân viên này đăng nhập được vào web app mới, cần thêm họ vào tab `NguoiDung` với vai trò tương ứng (Cô Thu → `chuan_bi_phoi`, Phượng → `ve_file`, Chị Hoan → `san_xuat`).

## 10. Cài đặt và chạy

```bash
npm install
cp .env.example .env
# điền SESSION_SECRET, SHEET_ID, DRIVE_ROOT_FOLDER_ID (+ Telegram/LLM nếu dùng)
npm start
```

## 11. Deploy VPS (gợi ý)

- `pm2 start server.js --name xuong-theu` để giữ app luôn chạy
- Nginx + Certbot cho HTTPS — **bắt buộc** để mở được camera quét QR trên điện thoại
- Giữ nguyên thư mục `fonts/` khi deploy (cần cho xuất PDF)

## 12. Vai trò và quyền (đã cập nhật theo pipeline thật)

| Vai trò | Thấy đơn nào | Sửa được cột nào |
|---|---|---|
| `admin` / `quan_ly` | Tất cả | Tất cả |
| `chuan_bi_phoi` | Chưa tới `B2_Đã lấy phôi` | `GHI_CHU` |
| `ve_file` | Chưa tới `B3_Đã đủ Phôi và File Vẽ` | `GHI_CHU` |
| `san_xuat` | Từ `B3` đến trước `SHIPPED` | `GHI_CHU`, `TINH_TRANG` |
| `dong_goi` | Từ `B5_Đã sản xuất` trở đi | `GHI_CHU`, `HANG_VAN_CHUYEN`, `MA_VAN_DON_ID`, `TINH_TRANG` |

Mọi vai trò đều có thể bấm nút "Chuyển sang..." trên trang chi tiết đơn (đọc từ `CauHinhKichBan`) — Sheet hiện không có cột phân quyền theo kịch bản nên app chưa giới hạn vai trò nào được dùng kịch bản nào. Nếu cần giới hạn, có thể thêm cột (vd `VaiTro_ChoPhep`) vào `CauHinhKichBan` và báo tôi để cập nhật `scenarioService.js`.

## 13. Session & bảo mật (không đổi so với bản trước)

- Đăng nhập chọn tên, không mật khẩu — phù hợp môi trường nội bộ tin cậy, không nên public ra internet mà không thêm PIN.
- Session dùng bộ nhớ (memory store) — restart server thì phải chọn tên đăng nhập lại.
