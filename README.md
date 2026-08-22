# Xưởng Thêu — Web App (thay thế AppSheet)

Web app quản lý đơn hàng xưởng thêu. Dữ liệu vẫn nằm trên Google Sheets (`HanhPhuc99`), ảnh vẫn lưu Google Drive — chỉ thay lớp giao diện AppSheet bằng web app tự host.

## 1. Chuẩn bị Google Cloud (làm 1 lần)

1. Vào [Google Cloud Console](https://console.cloud.google.com) → tạo project mới (hoặc dùng project đã có).
2. Vào **APIs & Services > Library** → bật **Google Sheets API** và **Google Drive API**.
3. Vào **IAM & Admin > Service Accounts** → **Create Service Account** → đặt tên bất kỳ (vd `xuong-theu-webapp`).
4. Vào tab **Keys** của service account đó → **Add Key > Create new key > JSON** → tải file JSON về, đặt tên `service-account-key.json`, để vào thư mục gốc dự án này (**KHÔNG** đưa lên git/public).
5. Copy **email của service account** (dạng `xuong-theu-webapp@ten-project.iam.gserviceaccount.com`).
6. Mở file `HanhPhuc99` trên Google Sheets → **Share** → dán email service account vào, cấp quyền **Editor**.
7. Mở thư mục Drive gốc muốn chứa ảnh → **Share** → cũng cấp quyền **Editor** cho email service account đó.

## 2. Chuẩn bị 2 tab mới trong `HanhPhuc99`

### Tab `NguoiDung`
Tạo tab tên chính xác `NguoiDung`, dòng 1 là header với đúng các cột sau:

| Ten | VaiTro | Team | KichHoat |
|---|---|---|---|

- `VaiTro` nhận 1 trong 6 giá trị: `admin`, `quan_ly`, `ve_file`, `chuan_bi_phoi`, `san_xuat`, `dong_goi`
- `Team` chỉ cần điền nếu `VaiTro = san_xuat` (phải khớp đúng giá trị cột `Team_San_Xuat` trong tab đơn hàng)
- `KichHoat` = `TRUE` hoặc `FALSE`

Nhập sẵn ít nhất 1 dòng admin để đăng nhập lần đầu, ví dụ:
```
Ten: Bạn | VaiTro: admin | Team: | KichHoat: TRUE
```

### Tab `LichSuHoatDong`
Tạo tab tên chính xác `LichSuHoatDong`, dòng 1 là header:

| ThoiGian | NguoiDung | VaiTro | HanhDong | STT_Key | ChiTiet |
|---|---|---|---|---|---|

Tab này app sẽ tự ghi, không cần nhập gì thêm.

## 3. Thêm các cột mới vào tab `Don_Hang_ALL` (nếu chưa có)

| Cột mới | Dùng để làm gì |
|---|---|
| `NguoiCapNhatCuoi` | Tên người vừa sửa đơn gần nhất |
| `ThoiGianCapNhatCuoi` | Thời điểm sửa gần nhất |
| `CanhBaoDaGui` | App tự ghi (`VANG`/`CAM`/`DO`/trống) — chống gửi trùng Telegram, không cần nhập tay |
| `NhacShipDaGui` | App tự ghi (`TRUE`/trống) — chống nhắc ship lặp lại nhiều lần cùng 1 đơn |

Các cột còn lại giữ nguyên như trong tài liệu `HuongDan_AppSheet_XuongTheu` (STT_Key, Ten_KH, Ten_San_Pham, So_Luong, Ngay_Dat, Ngay_Giao_Du_Kien, URL_Hinh_Anh, URL_Mockup, Co_Phoi, Co_File_Ve, Team_San_Xuat, Trang_Thai, Nguoi_Ve_File, Ghi_Chu_Xuong, Ma_Van_Don, Trang_Thai_Ship, Anh_Dong_Goi_URL, Ngay_Ship).

## 4. Cài đặt và chạy

```bash
npm install
cp .env.example .env
# mở .env, điền SESSION_SECRET, SHEET_ID, DRIVE_ROOT_FOLDER_ID
npm start
```

Mở `http://VPS_IP:3000` (hoặc domain đã trỏ vào VPS).

## 5. Deploy thật trên VPS (gợi ý)

- Dùng `pm2` để giữ app luôn chạy: `npm i -g pm2 && pm2 start server.js --name xuong-theu`
- Dùng Nginx làm reverse proxy + SSL (Let's Encrypt / Certbot) để truy cập qua HTTPS — **bắt buộc** vì trình duyệt chỉ cho phép mở camera (quét QR) trên trang HTTPS hoặc `localhost`.
- Mở port tương ứng trên firewall VPS nếu chưa dùng Nginx.

## 6. Vai trò và quyền

| Vai trò | Xem đơn nào | Sửa được cột nào |
|---|---|---|
| `admin` | Tất cả | Tất cả + quản lý nhân viên |
| `quan_ly` | Tất cả | Tất cả + phân công team |
| `ve_file` | Đơn thiếu phôi hoặc file | `Co_File_Ve`, `Nguoi_Ve_File`, `Ghi_Chu_Xuong` |
| `chuan_bi_phoi` | Đơn thiếu phôi hoặc file | `Co_Phoi`, `Ghi_Chu_Xuong` |
| `san_xuat` | Đơn đủ phôi+file, đúng team, trạng thái `SAN_XUAT` | `Trang_Thai`, `Ghi_Chu_Xuong` |
| `dong_goi` | Đơn `DONG_GOI` hoặc `SHIPPED` | `Trang_Thai`, `Trang_Thai_Ship`, `Ma_Van_Don`, `Ghi_Chu_Xuong`, upload ảnh đóng gói |

## 7. Kịch bản quét QR hàng loạt

Sửa file `data/scenarios.js` để thêm/sửa kịch bản — không cần sửa code route. Hiện có sẵn 2 kịch bản mẫu:
- Sản xuất xong → Đóng gói (vai trò `san_xuat`)
- Xác nhận đã ship (vai trò `dong_goi`)

## 8. Cảnh báo Telegram 3 tầng + badge trên web

- App tự quét toàn bộ đơn mỗi 30 phút (`services/canhBaoJob.js`). Quy tắc giữ nguyên bản AppSheet cũ:
  **Vàng** (≥3 ngày chưa đủ phôi+file) → **Cam** (≥5 ngày chưa đóng gói) → **Đỏ** (≥7 ngày chưa ship), cộng thêm **Nhắc ship** khi còn đúng 1 ngày tới deadline mà chưa ship.
- Mỗi mức chỉ gửi Telegram 1 lần (không gửi lại mỗi 30 phút) nhờ cột `CanhBaoDaGui`/`NhacShipDaGui` tự ghi.
- Cấu hình `TELEGRAM_BOT_TOKEN` và 4 biến `TELEGRAM_CHATID_*` trong `.env` (hướng dẫn lấy chat_id có ghi chú ngay trong `.env.example`). Nếu để trống, app vẫn chạy bình thường, chỉ là không gửi được Telegram.
- Badge cảnh báo hiển thị ngay trên danh sách đơn và trang chi tiết — tính trực tiếp mỗi lần gọi API (`GET /api/orders`), luôn khớp thực tế, độc lập với việc Telegram đã gửi hay chưa.
- Admin/Quản lý có thể bấm chạy thử ngay: `POST /api/canh-bao/chay-thu` (chưa có nút riêng trên UI, có thể gọi bằng `curl` hoặc Postman kèm cookie session để kiểm tra cấu hình Telegram).

## 9. Chatbot

- Route `POST /api/chatbot/hoi` gọi thẳng LLM nội bộ (`llm.wokushop.com`, định dạng OpenAI-compatible) — **không** đọc/ghi qua tab Chatbot trong Sheet như cách cũ.
- Ngữ cảnh trả lời được xây trực tiếp từ tab `Don_Hang_ALL` tại thời điểm hỏi, giới hạn trong phạm vi đơn mà vai trò người hỏi được phép xem (dùng lại đúng logic phân quyền của `orderService.filterForRole`).
- Cấu hình `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` trong `.env`. Nếu thiếu, chatbot trả lỗi rõ ràng thay vì im lặng.
- Widget chat nổi ở góc dưới phải, tự hiện trên mọi trang đã đăng nhập (`public/js/chatbot.js`), lịch sử hội thoại lưu tạm ở `sessionStorage` (mất khi đóng tab, không lưu lên Sheet).

## 10. Báo cáo Excel/PDF

- Trang **Báo cáo** (chỉ `admin`/`quan_ly` thấy trong menu) cho lọc theo khoảng ngày đặt hàng và/hoặc khách hàng, xuất file `.xlsx` (ExcelJS) hoặc `.pdf` (PDFKit).
- File PDF nhúng sẵn font Noto Sans (`fonts/NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`) — đã kiểm tra đủ dấu tiếng Việt, không cần cài thêm gì. Giữ nguyên 2 file font này khi deploy.

## 11. Việc còn thiếu / tuỳ chọn thêm sau (không có trong bản này)

- Tích hợp trực tiếp API VNEpacket để tự điền `Ma_Van_Don` (bạn đã có code Apps Script riêng cho việc này — có thể gọi lại API đó từ route `photos.js` hoặc `qr.js` khi cần).
- Đăng nhập bằng mã PIN thay vì chỉ chọn tên (bạn đã chọn "chỉ chọn tên" cho bản này).
- Session hiện dùng bộ nhớ (memory store) — nếu restart server thường xuyên, nhân viên phải chọn tên đăng nhập lại. Cân nhắc `connect-sqlite3` hoặc Redis nếu muốn giữ session bền hơn.
- Chưa có giới hạn tốc độ (rate limit) cho API — vì đăng nhập không mật khẩu, ai biết tên nhân viên đều đăng nhập được. Phù hợp môi trường nội bộ tin cậy; nếu app lộ ra ngoài internet công khai, nên cân nhắc thêm PIN hoặc giới hạn theo IP.
