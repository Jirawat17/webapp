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

## 3. Thêm 2 cột mới vào tab `Don_Hang_ALL` (nếu chưa có)

Thêm 2 cột vào cuối bảng, dùng để biết ai vừa sửa đơn gần nhất:
- `NguoiCapNhatCuoi`
- `ThoiGianCapNhatCuoi`

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

## 8. Việc còn thiếu tuỳ chọn thêm sau (không có trong bản này)

- Tích hợp trực tiếp API VNEpacket để tự điền `Ma_Van_Don` (bạn đã có code Apps Script riêng cho việc này — có thể gọi lại API đó từ route `photos.js` hoặc `qr.js` khi cần).
- Đăng nhập bằng mã PIN thay vì chỉ chọn tên (bạn đã chọn "chỉ chọn tên" cho bản này).
- Session hiện dùng bộ nhớ (memory store) — nếu chạy nhiều instance hoặc restart server thường xuyên, cân nhắc chuyển sang `connect-sqlite3` hoặc Redis để giữ session không bị mất.
