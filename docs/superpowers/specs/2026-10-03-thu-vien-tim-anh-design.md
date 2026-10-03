# Menu "Tìm ảnh" — Thư viện thiết kế thêu (PNG / EMB)

## 1. Bối cảnh

Người vẽ file nhận đơn mới nhưng không biết thiết kế đó đã từng làm chưa, PNG/EMB cũ nằm ở đâu, có
tái sử dụng được không. Hiện trạng (rà soát code 03/10/2026):

- **PNG** = cột `DUONG_DAN_URL` của `Don_Hang_ALL`, nhập tay ở sheet RAW, app chỉ đọc. 1 ô là 1 link:
  file Drive, **thư mục** Drive, MinIO (`/api/photos/file/...`), link chia sẻ Gemini hoặc http thường —
  `services/anhNguonService.js#taiAnh` đã đọc được cả 5 loại.
- **EMB**: app chưa có gì (không cột, không route). File nằm trên máy người vẽ, tên file chứa `STT_Key`.
- **So khớp ảnh**: đã có `services/perceptualHashService.js#tinhHashAnh` (dHash 256 bit, `.trim()`,
  kernel `nearest`, timeout 10s) — dùng cho "Đơn hàng loạt" (`HASH_ANH_MAU`).
- **Lưu trữ**: MinIO (tự host trên NAS) qua `services/storageService.js`; Drive chỉ đọc.
- Quy mô: hầu hết đơn có PNG, ~3.000 đơn/tháng.

## 2. Quyết định đã chốt với người dùng

| # | Nội dung | Chốt |
|---|---|---|
| 1 | Tên menu | **Tìm ảnh** |
| 2 | Nơi lưu PNG | **Sao chép tất cả vào MinIO** — cả 3 nguồn: `DUONG_DAN_URL` (tự động), Excel, upload tay |
| 3 | Cấu trúc MinIO | Theo `STT_Key`; 1 đơn nhiều ảnh thì đánh số `_1`, `_2`… |
| 4 | EMB | 1 file/đơn, upload qua chi tiết đơn hoặc menu Tìm ảnh; upload lại giữ bản cũ làm lịch sử |
| 5 | EMB cũ | Upload hàng loạt (chọn cả thư mục hoặc từng file), khớp theo tên file |
| 6 | Khớp tên | Đoạn trong tên file trùng **chính xác** STT_Key; không khớp thì xét tên thư mục cha |
| 7 | Excel đơn cũ | Xuất từ Sheet, đọc 2 cột `STT_Key` + `DUONG_DAN_URL` |
| 8 | Đơn không còn trong Sheet | Vẫn lưu, gắn nhãn "Đơn không còn trong Sheet" |
| 9 | Phạm vi PNG cũ | Toàn bộ lịch sử |
| 10 | Link Gemini | Có xử lý (xếp cuối hàng chờ vì chậm) |
| 11 | Mockup | Không đưa vào thư viện |
| 12 | Quyền | `ve_file`, admin, superadmin: upload + tải EMB. `ve_file` xem thiết kế mọi Xưởng |
| 13 | Bắt buộc EMB | Không bắt buộc khi chuyển "Đã vẽ file" |
| 14 | Định dạng | PNG: `.png`, `.jpg`, `.jpeg`. EMB: chỉ `.emb`. Tối đa 30MB/file |
| 15 | Tìm bằng AI (embedding) | Chưa làm. Đo mức 1/2/2b trên dữ liệu thật trước, người dùng quyết định |

## 3. Nguyên tắc bất biến

- Không ghi bất kỳ dữ liệu nào vào Google Sheet.
- Không xoá, không ghi đè file gốc (Drive, máy người dùng) và không xoá file đã lưu trong thư viện
  (ngoại lệ duy nhất: key tạm do chính app tạo khi đổi phiên bản EMB, mục 5).
- Không tự gắn file cũ vào đơn mới, không tự kết luận 2 EMB thay thế được nhau. Điểm tương đồng chỉ để tham khảo.
- Không đoán STT_Key, người tải lên, ngày tải: không xác định được thì để trống.
- Không tạo điểm tương đồng giả: mọi con số tính từ hash thật.
- "Chưa tìm thấy EMB liên kết" — không bao giờ ghi "không tồn tại EMB".
- Không làm chậm luồng upload ảnh hiện tại (`routes/photos.js` giữ nguyên).
- Thư viện dùng prefix MinIO riêng `thu-vien/` — chức năng "Xoá dữ liệu đơn hàng"
  (`xoaDuLieuDonService`, chỉ xoá `orders/{sttKey}/`) **không** đụng tới thư viện.

## 4. Kiến trúc tổng

```
 Nguồn 1: cron 10 phút ── DUONG_DAN_URL mới/đổi ──┐
 Nguồn 2: Nhập Excel (superadmin) ─────────────────┼──> tv_hang_cho ──> Bộ xử lý (1 việc/lần)
 Nguồn 3: Upload tay (thư mục / file, PNG + EMB) ──┘    (link)           │
           └─ upload tay đi thẳng vào bộ xử lý, không qua hàng chờ        ▼
                                              tải file → SHA-256 → chống trùng → MinIO
                                              → dHash ảnh + dHash hình dạng + thumbnail
                                              → tv_file (XONG / LOI)
                                                              │
                         Menu "Tìm ảnh": Tìm kiếm · Tải lên thư viện · Nhập Excel · Cần xử lý
```

## 5. Lưu trữ MinIO

| Loại | Object key |
|---|---|
| PNG | `thu-vien/<STT_Key>/<STT_Key>_<n>.<ext gốc>` (n = 1, 2, 3…) |
| EMB bản chính | `thu-vien/<STT_Key>/<STT_Key>.emb` |
| EMB lịch sử | `thu-vien/<STT_Key>/<STT_Key>_v<k>.emb` (k = 1, 2…; k nhỏ = cũ hơn) |
| Thumbnail | `thu-vien/_thumb/<sha256>.webp` (256px cạnh dài; dùng chung khi trùng nội dung) |

- `STT_Key` được làm sạch trước khi ghép key (chỉ giữ `[A-Za-z0-9_-]`); key gốc lưu nguyên trong DB.
- Số `n` không bao giờ đánh lại, không tái sử dụng.
- Upload lại EMB: ghi bản mới ra key tạm → copy bản chính hiện tại sang `_v<k>` → ghi bản mới vào key
  chính → ghi DB. Lỗi giữa chừng không làm mất bản nào (bản cũ đã có ở `_v<k>` trước khi bị thay).
- Cùng nội dung (SHA-256) xuất hiện ở 2 đơn khác nhau: **lưu riêng ở mỗi đơn** (đúng cấu trúc theo
  STT_Key), thống kê báo số file trùng.

## 6. Database — `data/thu_vien.db` (env `THU_VIEN_DB_PATH`)

Service mới `services/thuVien/thuVienDbService.js`, cùng khuôn với các `*DbService` hiện có
(better-sqlite3, tự tạo bảng khi khởi động).

**`tv_file`** — mỗi dòng 1 file đã lưu
| Cột | Ý nghĩa |
|---|---|
| id | INTEGER PK |
| loai | `PNG` / `EMB` |
| stt_key | STT_Key (luôn có — file không xác định được đơn thì không lưu) |
| so_thu_tu | n của PNG; với EMB = số phiên bản (bản chính là lớn nhất) |
| la_ban_chinh | EMB: 1 = bản chính; PNG luôn 1 |
| object_key | key MinIO hiện tại |
| ten_file_goc | tên file gốc (upload tay / Drive) hoặc đoạn cuối URL |
| nguon | `SHEET` / `EXCEL` / `UPLOAD` |
| url_goc | link gốc (SHEET/EXCEL), rỗng với UPLOAD |
| drive_file_id | id file Drive nếu có (chống tải lại cùng file trong thư mục) |
| sha256, kich_thuoc | hash nội dung, số byte |
| dhash, dhash_hinh_dang | hex 64 ký tự (256 bit) — rỗng nếu không tính được (vd EMB) |
| thumb_key | key thumbnail (PNG) |
| nguoi_tai_len | tài khoản upload (UPLOAD) hoặc người nhập Excel; rỗng với SHEET |
| ngay_luu | thời điểm lưu vào thư viện |
| trang_thai | `XONG` / `LOI_HASH` (đã lưu file nhưng tính hash lỗi — vẫn tải được, không tìm được theo ảnh) |
| ms_xu_ly | thời gian xử lý (đo hiệu năng) |

Ràng buộc: `UNIQUE(stt_key, loai, sha256)` cho PNG (chống trùng cùng đơn); `UNIQUE(stt_key, loai, so_thu_tu)`.
Chỉ mục: `stt_key`, `sha256`.

**`tv_hang_cho`** — việc tải link (nguồn SHEET / EXCEL)
| Cột | Ý nghĩa |
|---|---|
| id, stt_key, url | `UNIQUE(stt_key, url)` → nhập lại Excel / cron chạy lại không tạo việc trùng |
| nguon | `SHEET` / `EXCEL` |
| lo_id | lô Excel (null với SHEET) |
| uu_tien | 0 = Drive/MinIO/http, 1 = Gemini (chạy sau) |
| trang_thai | `CHO` / `DANG_CHAY` / `XONG` / `LOI` / `LOI_CUOI` |
| so_lan_thu, thu_lai_luc, loi_cuoi | thử lại: sau 5, 20, 60, 180, 480 phút; quá 5 lần → `LOI_CUOI` |
| so_file | số file đã lưu từ link này |
| tao_luc, cap_nhat_luc | |

**`tv_nguon_don`** — giá trị `DUONG_DAN_URL` cron đã thấy lần cuối: `stt_key PK, gia_tri, lan_thay`.

**`tv_lo_excel`** — `id, ten_file, nguoi, tao_luc, tong_dong, dong_hop_le, dong_bo_qua (JSON: dòng + lý do)`.

**`tv_quyet_dinh`** — `id, stt_key_moi, file_id, quyet_dinh (DA_KIEM / TAI_SU_DUNG / VE_MOI), ghi_chu, nguoi, thoi_gian`.
Chỉ ghi nhận, không thay đổi đơn hay file.

**`tv_cai_dat`** — key/value: `hang_cho_tam_dung` (0/1), `da_qua_diem_do` (0/1), các ngưỡng nhóm kết quả
(rỗng cho tới khi người dùng chọn ở giai đoạn 4).

## 7. Khớp tên file → STT_Key (chỉ áp dụng cho upload tay)

Tập mã hợp lệ = STT_Key đang có trong `Don_Hang_ALL` ∪ STT_Key đã có trong `tv_file`.

1. Bỏ đuôi file, tách tên thành các **đoạn** theo ký tự không phải chữ/số.
2. Đoạn nào trùng chính xác (không phân biệt hoa thường) một mã trong tập → ứng viên.
3. Đúng 1 ứng viên → khớp. 0 ứng viên → lặp lại bước 1–2 với **tên thư mục cha gần nhất**, rồi thư mục
   cha tiếp theo, tới gốc thư mục đã chọn. ≥ 2 ứng viên ở cùng một tầng → **không khớp** (không tự chọn).
4. Không khớp → dòng đó trên bảng xem trước để trống STT_Key, người dùng có thể gõ tay (xem mục 11).

Ví dụ (giả sử có đơn `10LH72`): `10LH72.png` ✓, `10LH72_2.png` ✓, `10LH72 (1).png` ✓,
`10LH72-mat-truoc.png` ✓, `10LH72/design.png` ✓ (theo thư mục), `Design10LH72.png` ✗ (không phải đoạn riêng).

Hàm thuần `services/thuVien/khopTenFile.js#khopSttKey(duongDanTuongDoi, tapMa)` — có self-check.

## 8. Bộ xử lý file

Một vòng xử lý chạy trong tiến trình server (`services/thuVien/xuLyService.js`), **1 việc tại 1 thời
điểm** (tránh dồn RAM khi PNG lớn; sharp từng gây sự cố khi tải nặng).

**Với 1 việc trong hàng chờ (link):**
1. Lấy việc `CHO` có `thu_lai_luc` đã tới, ưu tiên `uu_tien` nhỏ, cũ trước. Bỏ qua khi `hang_cho_tam_dung = 1`.
2. Link thư mục Drive → `driveService.layChiTietAnhThuMucDrive` (đọc hết các trang, sắp theo tên), tải
   **từng file một** bằng `taiFileDriveTheoId`; file nào đã có `drive_file_id` cho đơn đó thì bỏ qua.
   Link khác → `anhNguonService.taiAnh`.
3. Mỗi buffer → **lưu 1 file** (dưới đây). Kết thúc: việc `XONG` + `so_file`; lỗi → `LOI`, đặt `thu_lai_luc`.

**Lưu 1 file (dùng chung cho cả 3 nguồn):**
1. Kiểm tra định dạng bằng chữ ký byte (PNG/JPEG); EMB kiểm tra đuôi `.emb` + kích thước.
2. SHA-256. PNG đã có `(stt_key, sha256)` → bỏ qua, báo "Trùng file đã có".
3. Trong 1 transaction: cấp `so_thu_tu` kế tiếp → ghi MinIO (`storageService`, timeout sẵn có).
4. PNG: tính `dhash` (`tinhHashAnh` hiện có), `dhash_hinh_dang` (mục 9), thumbnail webp 256px.
   Lỗi tính hash → file vẫn lưu, `trang_thai = LOI_HASH` (có nút "Tính lại").
5. Ghi `tv_file`, `ms_xu_ly`.

**Điểm dừng đo dung lượng (1 lần duy nhất):** khi tổng số file đã lưu đạt 200 lần đầu, hàng chờ tự đặt
`hang_cho_tam_dung = 1` và menu hiện: dung lượng trung bình/file, số link còn chờ, ước tính tổng dung
lượng. Superadmin bấm **Chạy tiếp** sau khi kiểm tra NAS. Sau đó superadmin vẫn có nút Tạm dừng/Chạy tiếp.

**Log:** dòng console `[ThuVien] ...` (hiện ở menu Logs qua `logCapture`) cho mọi lỗi tải/lưu/hash;
`ghiLog` cho thao tác người dùng (upload, nhập Excel, gắn tay STT_Key, quyết định tái sử dụng).

## 9. Tìm kiếm ảnh

| Mức | Cách tính | Bắt được |
|---|---|---|
| 1. Trùng file | SHA-256 bằng nhau | Giống hệt từng byte |
| 2. Ảnh giống | `tinhHashAnh` hiện có (xám, `.trim()`, 17×16, `nearest`) → khoảng cách Hamming; ảnh trong suốt đặt lên nền trắng trước (xem 21i) | Resize, đổi định dạng, nén |
| 2b. Cùng hình dạng | dHash trên **mặt nạ hình dạng** (dưới đây) | Đổi màu chỉ/màu nền, nền trong suốt/đen/trắng, viền khác |
| 3. Embedding AI | Chưa làm (giai đoạn 4 quyết định) | Biến thể nội dung |

**Mặt nạ hình dạng** (`perceptualHashService#tinhHashHinhDang`, hàm mới, không đổi `tinhHashAnh`):
1. `sharp(buf).ensureAlpha()`, thu về cạnh dài 512px (`nearest`), lấy RGBA thô.
2. Ảnh có kênh trong suốt thật (có điểm alpha < 250): nội dung = alpha ≥ 128 — trừ khi mặt nạ phủ > 90% khung của chính nó
   (tấm nền đặc bo góc / có lề trong suốt): khi đó nội dung = điểm đục lệch màu tấm nền (trung vị màu điểm đục trên viền khung).
   Ảnh không trong suốt: màu nền = trung vị 4 góc; nội dung = điểm lệch màu nền > hằng số `DO_LECH_NEN`
   (hằng số thuật toán, hiệu chỉnh bằng ảnh giả lập khi code, ghi rõ trong code).
3. Cắt theo khung vùng nội dung, bỏ 0,5% điểm nội dung ở mỗi phía (chấm lạc không kéo giãn khung) → độ phủ theo ô 17×16 → dHash 256 bit.
4. Không có điểm nội dung nào → `null` (ảnh trống).

Kết quả: nền trong suốt, nền đen, nền trắng của cùng thiết kế cho cùng mặt nạ; đổi màu chỉ không đổi mặt nạ.

**Điểm tương đồng** hiển thị = `(1 − Hamming / 256) × 100%`, riêng cho "Ảnh" và "Hình dạng".

**Nhóm kết quả:**
- Trước khi người dùng chọn ngưỡng (giai đoạn 4): chỉ nhóm **Trùng file** là chắc chắn; còn lại hiển thị
  1 danh sách sắp theo điểm cao nhất, kèm 2 con số — không gán nhãn "giống/tương tự".
- Sau khi chọn ngưỡng: Trùng file / Ảnh giống / Cùng hình dạng / Cần xem tay (ngưỡng lấy từ số đo thật,
  người dùng chọn, giống cách gợi ý ngưỡng QC).

**Hiệu năng:** mỗi lần tìm đọc `id, stt_key, sha256, dhash, dhash_hinh_dang` của toàn bộ `tv_file` PNG
và duyệt hết (~36.000 dòng/năm — vài chục ms). Phân trang 24 kết quả/trang, tối đa 200 kết quả gần nhất.
Ghi `ms` mỗi lần tìm vào log để theo dõi. (ponytail: duyệt toàn bộ; cache hash trong RAM hoặc chỉ mục
BK-tree khi đo thấy chậm.)

## 10. Nguồn 1 — tự động từ `DUONG_DAN_URL`

- Cron 10 phút (`server.js`, node-cron): `orderService.getAll()` (dùng cache sẵn có, không ép đọc tươi).
- Mỗi đơn có STT_Key: giá trị `DUONG_DAN_URL` (trim) khác `tv_nguon_don.gia_tri` → tách theo khoảng
  trắng/xuống dòng thành các link → thêm vào `tv_hang_cho` (nguồn `SHEET`) → cập nhật `tv_nguon_don`.
- Link cũ bị đổi/xoá: file đã lưu **giữ nguyên**, link mới lưu tiếp số `n` kế tiếp.
- Lần chạy đầu tiên = kiểm kê toàn bộ đơn đang có trong Sheet (chịu điểm dừng đo dung lượng mục 8).
- Đơn bị ẩn bởi "Xoá dữ liệu đơn hàng" không còn trong `getAll` → không thêm việc mới; file đã lưu giữ nguyên.

## 11. Nguồn 3 — Upload tay (khu vực "Tải lên thư viện")

1. Hai nút: **Chọn thư mục** (`<input webkitdirectory>`, Chrome/Edge máy tính) và **Chọn file**
   (`multiple`, dùng được trên điện thoại).
2. Trình duyệt đọc tên + đường dẫn tương đối + kích thước, tính SHA-256 (`crypto.subtle`), gửi danh sách
   lên `POST /xem-truoc` (chỉ metadata, chưa gửi file).
3. Server trả bảng xem trước, mỗi dòng: tên file, loại (PNG/EMB/Không hỗ trợ), STT_Key khớp, trạng thái
   (`Khớp` / `Không khớp` / `Nhiều đơn` / `Trùng file đã có` / `Quá 30MB` / `Không hỗ trợ`), nhãn
   "Đơn không còn trong Sheet" nếu mã chỉ có trong thư viện.
4. Dòng không khớp: ô gõ tay STT_Key. Mã không có trong Sheet → cảnh báo, phải tick xác nhận.
5. Bấm **Xác nhận tải lên**: trình duyệt gửi **từng file một** (`POST /upload`) — tránh giới hạn
   ~100MB/request của Cloudflare; thanh tiến độ + nút Dừng. Server **khớp lại** tên file (không tin
   STT_Key từ trình duyệt, trừ dòng gõ tay — kiểm tra định dạng mã + quyền), tính lại SHA-256, rồi chạy
   "Lưu 1 file" (mục 8) ngay trong request.
6. Xong: bảng kết quả (thành công / bỏ qua / lỗi + lý do), nút tải bảng kết quả `.xlsx`.
   Dòng không khớp và không gõ tay → **không upload**, ghi trong bảng kết quả.

## 12. Nguồn 2 — Nhập Excel (superadmin)

1. Upload `.xlsx` (≤ 3MB — chỉ giữ 2 cột khi xuất, xem 21c; đọc bằng `exceljs` có sẵn). Tìm dòng tiêu đề có cột `STT_Key` và
   `DUONG_DAN_URL` (so khớp tên cột sau trim, không phân biệt hoa thường); các cột khác bỏ qua.
   Thiếu 1 trong 2 cột → báo lỗi, không làm gì.
2. Mỗi dòng: thiếu STT_Key hoặc link → bỏ qua (ghi lý do). Link tách theo khoảng trắng/xuống dòng.
   Đơn không có trong Sheet vẫn nhận (nhãn "Đơn không còn trong Sheet").
3. Tạo `tv_lo_excel` + thêm việc vào `tv_hang_cho` (nguồn `EXCEL`, `UNIQUE(stt_key, url)` bỏ qua việc đã có).
   Trả ngay: tổng dòng, dòng hợp lệ, dòng bỏ qua, việc đã có từ trước.
4. Tiến độ lô: số việc CHO / XONG / LOI / LOI_CUOI, số file đã lưu. Nút tải **file kết quả `.xlsx`**:
   mỗi dòng gốc + Trạng thái + Số ảnh đã lưu + Lý do lỗi.
5. 1 thư mục Drive / nhiều link trong 1 ô → nhiều PNG `_1`, `_2`… theo thứ tự đọc được.

## 13. EMB trong chi tiết đơn (`public/order.html`)

- Khối mới "File EMB" cạnh "Ảnh file thêu": trạng thái **Đã có** (tên file gốc, ngày, người tải) /
  **Chưa tìm thấy file EMB liên kết**; nút **Tải EMB** và **Tải lên EMB** (theo quyền); danh sách phiên bản cũ.
- Upload ở đây dùng chung "Lưu 1 file" (nguồn `UPLOAD`), không qua bước khớp tên (đã biết đơn).
- Không gắn với luồng đổi trạng thái — không bắt buộc, không chặn.

## 14. Menu "Tìm ảnh" (`public/tim-anh.html`)

Một trang, các khu vực xếp dọc (khu vực theo quyền mới hiện):

1. **Tìm kiếm**
   - Ô nhập STT_Key → khối tình trạng: `PNG thiết kế: ĐÃ CÓ (n file) / CHƯA CÓ`
     (+ "Đang chờ sao chép" nếu `DUONG_DAN_URL` có link chưa xử lý xong); `File EMB: ĐÃ CÓ / CHƯA TÌM THẤY`;
     danh sách file của đơn; rồi kết quả tương tự cho từng PNG của đơn (loại trừ chính đơn đó).
     Hiển thị rõ STT_Key đang tra.
   - Hoặc **Tải ảnh lên để tìm** (không lưu vào thư viện) → nút **TÌM THIẾT KẾ TƯƠNG TỰ**.
   - Mỗi kết quả: thumbnail, STT_Key cũ, tên file PNG, EMB (có/chưa + tên), % Ảnh, % Hình dạng, ngày lưu,
     nguồn (Sheet / Excel / Upload + link gốc), nhãn "Đơn không còn trong Sheet"; thao tác: Xem ảnh gốc,
     Tải PNG, Tải EMB (theo quyền), Mở chi tiết đơn (nếu đơn còn trong Sheet), "Xem tất cả file của đơn".
   - Khi tra theo STT_Key: nút **Đã kiểm tra / Tái sử dụng / Vẽ mới** + ghi chú → `tv_quyet_dinh`.
     Không thay đổi đơn hay file.
2. **Tải lên thư viện** — mục 11.
3. **Nhập từ Excel** (superadmin) — mục 12 + nút Tạm dừng/Chạy tiếp hàng chờ + thông tin điểm dừng đo.
4. **Cần xử lý** (admin, superadmin): link lỗi (`LOI_CUOI`) kèm lý do + nút Thử lại (từng dòng / tất cả);
   file `LOI_HASH` + nút Tính lại.
5. **Thống kê** (admin, superadmin — giai đoạn 5).

Link menu thêm trong `public/js/api.js` (tăng `?v=` vượt số đã commit — Cloudflare cache 4h).

## 15. Phân quyền

Hàm dùng chung `duocXemDon(user)`: superadmin và `ve_file` → mọi đơn (kể cả đơn không còn trong Sheet);
vai trò khác → `orderService.phamViDon(user)` sẵn có (theo Xưởng được phân công; đơn không rõ Xưởng → không thấy).

| Thao tác | ve_file | admin | superadmin | khác |
|---|---|---|---|---|
| Thấy menu, tìm kiếm, xem/tải PNG | ✓ (mọi Xưởng) | ✓ (Xưởng mình) | ✓ | ✗ |
| Upload thư viện, upload/tải EMB | ✓ | ✓ (Xưởng mình) | ✓ | ✗ |
| Xem trạng thái EMB trong chi tiết đơn | ✓ | ✓ | ✓ | ✓ (ai đã xem được đơn) |
| Ghi quyết định tái sử dụng | ✓ | ✓ | ✓ | ✗ |
| Cần xử lý, Thống kê | ✗ | ✓ (Xưởng mình) | ✓ | ✗ |
| Nhập Excel, Tạm dừng/Chạy tiếp, chọn ngưỡng | ✗ | ✗ | ✓ | ✗ |

- Tên Xưởng **không** hiển thị cho người không phải superadmin.
- File chỉ phát qua proxy `GET /api/thu-vien/file/:id` (kiểm tra đăng nhập + quyền + `duocXemDon`),
  không dùng link công khai, không public file Drive.

## 16. API (`routes/thuVien.js`, mount `/api/thu-vien`)

| Method | Đường dẫn | Quyền | Việc |
|---|---|---|---|
| GET | `/don/:sttKey` | menu | Tình trạng PNG/EMB + file của đơn + kết quả tương tự |
| POST | `/tim-theo-anh` | menu | multipart 1 ảnh (bộ nhớ, không lưu) → kết quả tương tự |
| GET | `/file/:id` | menu (EMB: quyền tải EMB) | Proxy tải file |
| GET | `/thumb/:id` | menu | Proxy thumbnail |
| POST | `/xem-truoc` | upload | Danh sách metadata → bảng khớp |
| POST | `/upload` | upload | multipart 1 file + đường dẫn tương đối + (STT_Key gõ tay) |
| POST | `/emb/:sttKey` | upload | Upload EMB từ chi tiết đơn |
| POST | `/quyet-dinh` | menu | Ghi `tv_quyet_dinh` |
| POST | `/excel` | superadmin | Nhập Excel → tạo lô |
| GET | `/excel/:loId` | superadmin | Tiến độ lô |
| GET | `/excel/:loId/ket-qua.xlsx` | superadmin | File kết quả |
| GET/POST | `/hang-cho` | superadmin | Trạng thái + Tạm dừng/Chạy tiếp |
| GET | `/can-xu-ly` | admin+ | Link lỗi, file LOI_HASH |
| POST | `/can-xu-ly/thu-lai` | admin+ | Thử lại / tính lại |
| GET | `/thong-ke` | admin+ | Thống kê (giai đoạn 5) |

Lỗi multer (quá 30MB) → 400 dễ hiểu (cùng cách `routes/notes.js`).

## 17. File dự kiến

Mới: `services/thuVien/thuVienDbService.js`, `services/thuVien/xuLyService.js`,
`services/thuVien/khopTenFile.js`, `services/thuVien/timKiemService.js`, `routes/thuVien.js`,
`public/tim-anh.html`.
Sửa: `services/perceptualHashService.js` (thêm `tinhHashHinhDang`, không đổi `tinhHashAnh`),
`services/storageService.js` (hàm copy object cho phiên bản EMB nếu chưa có), `server.js` (route + cron +
khởi động vòng xử lý), `public/order.html` (khối EMB), `public/js/api.js` (link menu, `?v=`).
Không sửa: `routes/photos.js`, Sheets, `xoaDuLieuDonService`.

## 18. Kiểm thử

Mọi lần chạy node đều export DB tạm (`THU_VIEN_DB_PATH`, `SQLITE_DB_PATH`, … trỏ vào scratchpad) —
không bao giờ mở `data/`. Không có Sheets/MinIO thật trong sandbox: dùng server giả (stub) như các lần trước.

- `khopTenFile`: self-check các ví dụ mục 7 + nhiều ứng viên + thư mục lồng nhau.
- Hash: ảnh giả lập (sharp tạo) — cùng thiết kế nền trong suốt / đen / trắng, đổi màu chỉ, resize,
  thêm viền → `dhash_hinh_dang` gần nhau; 2 thiết kế chữ khác nhau → xa nhau. Ghi số đo vào spec khi code.
- Chống trùng: lưu cùng file 2 lần, nhập cùng Excel 2 lần, cron chạy 2 lần → không tăng bản ghi.
- EMB: upload 3 lần → 1 bản chính + `_v1`, `_v2`, tải được cả 3.
- Hàng chờ: link lỗi → thử lại theo lịch → `LOI_CUOI`; Thử lại tay; điểm dừng 200 file; Tạm dừng/Chạy tiếp.
- Quyền: từng vai trò gọi từng API (403 đúng chỗ), admin không thấy đơn Xưởng khác.
- Trình duyệt (stub): chọn thư mục, xem trước, gõ tay, upload tuần tự, Dừng giữa chừng.

## 19. Giai đoạn triển khai

| GĐ | Nội dung | Kết quả nghiệm thu |
|---|---|---|
| 1 | DB, bộ xử lý + hàng chờ, MinIO, hash 2 mức + thumbnail, **Nhập Excel**, Tạm dừng/điểm dừng đo, Cần xử lý (cơ bản) | Nhập Excel đơn cũ → PNG nằm trên MinIO theo STT_Key, có hash; lỗi có log và thử lại |
| 2 | Menu **Tìm ảnh**: Tìm kiếm (theo mã + theo ảnh), Tải lên thư viện (thư mục/file, PNG + EMB), EMB trong chi tiết đơn, quyết định tái sử dụng | Người vẽ tìm được thiết kế theo ảnh, biết đơn đã có PNG/EMB chưa, tải được file |
| 3 | Cron `DUONG_DAN_URL` tự động | Đơn mới có PNG tự vào thư viện, không trùng |
| 4 | Đo ngưỡng trên cặp ảnh thật người dùng chọn → chọn ngưỡng nhóm; quyết định có cần mức 3 (AI) | Bảng số đo + ngưỡng do người dùng chọn |
| 5 | Thống kê: số PNG, EMB, đơn có PNG chưa có EMB và ngược lại, file trùng SHA, đơn không còn trong Sheet, việc chờ/lỗi, dung lượng | Một khối thống kê trong menu |

Mỗi giai đoạn: người dùng xác nhận trước khi code, tự commit/deploy.

## 20. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| NAS đầy (PNG 1–10MB/file, ~36.000/năm + toàn bộ lịch sử) | Điểm dừng đo 200 file đầu; thống kê dung lượng; Tạm dừng bất cứ lúc nào |
| Quota / link Drive chết | 1 việc/lần, thử lại giãn cách, `LOI_CUOI` + lý do, không dừng cả hàng chờ |
| Link Gemini chậm (trình duyệt ảo) | Xếp cuối hàng chờ, timeout sẵn có của `trangWebService` |
| sharp treo / ảnh rất lớn | 1 việc/lần, timeout sẵn có, lỗi hash vẫn lưu file (`LOI_HASH`) |
| Sheets chậm/treo làm cron kẹt | Cron dùng `getAll` có cache; không chạy chồng (cờ đang chạy) |
| Gắn nhầm đơn khi khớp tên | Chỉ khớp đoạn chính xác; nhiều ứng viên → không tự chọn; bảng xem trước + xác nhận |
| Trang Danh sách đơn hàng đang không tải được (03/10/2026) | Xử lý dứt điểm trước khi chạy cron/nhập thật — cùng phụ thuộc đọc Sheets |

## 21b. Ghi chú triển khai giai đoạn 1 (03/10/2026)

**Số đo hash hình dạng** (ảnh giả lập: thiết kế chữ + hình tròn, canvas 2400px trong suốt; khoảng cách Hamming /256):

| Biến thể cùng thiết kế | `tinhHashAnh` | `tinhHashHinhDang` |
|---|---|---|
| Đổi màu chỉ (đen → đỏ) | 0 | 0 |
| Chữ trắng nền đen | 0 | 2 |
| Chữ đen nền trắng | **59** | 2 |
| Chữ vàng nền navy | 0 | 2 |
| Resize 30% | 24 | 8 |
| Resize 25% (lanczos) + JPEG nền trắng | **74** | 12 |
| Canvas lớn hơn + lệch tâm | 0 | 9 |
| Sửa 1 ký tự (ALABAMA → ALABANA) | 11 | 10 |

8 thiết kế chữ khác nhau: khoảng cách nhỏ nhất `tinhHashAnh` = 20, `tinhHashHinhDang` = 27. Tức hash hình dạng
tách được "cùng thiết kế" (≤ 12) với "khác thiết kế" (≥ 27) trên mẫu giả lập; hash ảnh cũ thì chồng lấn (nền trắng
lệch 59–74, lớn hơn cả khoảng cách giữa 2 thiết kế khác nhau). Ngưỡng thật vẫn chờ đo trên ảnh thật ở giai đoạn 4.
`DO_LECH_NEN = 48`.

**Khác bản thiết kế:**
- Liên kết lô Excel ↔ việc qua bảng `tv_lo_dong` (mỗi dòng Excel × link 1 bản ghi, tra kết quả theo `(stt_key, url)`)
  thay vì cột `lo_id` trong `tv_hang_cho` — 1 link có thể đã có từ lô trước/cron, vẫn báo đúng kết quả cho lô sau.
- `tv_hang_cho` thêm `nguoi` (người nhập Excel → `nguoi_tai_len`) và `ghi_chu` (file bỏ qua vĩnh viễn: sai định dạng,
  quá 30MB, thư mục rỗng — việc vẫn `XONG`, không thử lại).
- Tạm dừng (bấm tay hoặc điểm dừng đo) được kiểm tra **sau từng file** trong 1 thư mục Drive — dừng đúng ở file thứ 200;
  thư mục dở dang quay về `CHO`, lần sau bỏ qua file đã lưu (theo `drive_file_id`).
- Ô Excel không có link nào (vd "xem trong zalo") → 1 dòng "Bỏ qua" cho cả ô; ô có link kèm chữ mô tả → chỉ lấy link.
- `tv_nguon_don` (giai đoạn 3) và `tv_quyet_dinh` (giai đoạn 2) chưa tạo — tạo cùng giai đoạn dùng tới.
- Menu "Tìm ảnh" giai đoạn 1 chỉ hiện với admin/superadmin (chưa có gì cho `ve_file`); mở cho `ve_file` ở giai đoạn 2.
- Proxy file/thumbnail trả `Cache-Control: no-store`: thử thật thấy trình duyệt phát lại thumbnail đã cache khi đổi tài
  khoản trên cùng máy, lọt qua kiểm tra quyền theo Xưởng.
- Kiểm thử để lại trong repo: `node scripts/kiem-tra-thu-vien.js` (tự tạo CSDL tạm trong thư mục temp, giả lập
  MinIO/Drive/HTTP) — các giai đoạn sau bổ sung vào đây.
- `api.js?v=112` (bỏ qua 111 — đã từng commit ở `e8572bd` rồi revert, Cloudflare có thể còn giữ bản 111 cũ).

## 21c. Sửa sau rà soát code giai đoạn 1 (03/10/2026)

- **Thư mục / link file Drive**: lọc theo `mimeType` + `size` của Drive TRƯỚC khi tải — chỉ tải `image/png`, `image/jpeg`
  (và `application/octet-stream` để magic bytes quyết định), tối đa 30MB. PSD/TIFF/GIF/file lớn ghi vào ghi chú, không làm
  cả việc lỗi, không tải. Link file Drive lấy thêm tên gốc (`driveService.layThongTinFileDrive`); không có quyền -> lỗi kèm
  thông điệp của Google.
- **Ước tính dung lượng ở điểm dừng**: ảnh/link chỉ tính từ việc `XONG` (`thongKeViecXong`) — bản đầu tính cả file của thư
  mục đang dở nên thổi phồng ~25 lần (đo: 25,0 -> 0,75 ảnh/link trên cùng dữ liệu thử). Thông báo điểm dừng chỉ hiện khi
  hàng chờ dừng VÌ điểm dừng (`dung_tai_diem_do`), tạm dừng tay về sau không hiện.
- **Excel tối đa 3MB** (đo RSS khi `exceljs` đọc cả file: 50.000 dòng × 40 cột = 12,5MB -> 1.136MB; 150.000 dòng × 2 cột
  = 2,4MB -> 363MB). Bản streaming của exceljs 4.4 lỗi với chính file nó tạo (`reading 'sheets'`) nên không dùng. Người
  dùng chỉ giữ 2 cột `STT_Key` + `DUONG_DAN_URL` khi xuất.
- **Phát file MinIO dùng chung `storageService.guiObjectQuaHttp`** (photos, notes, thư viện) thay `getObjectStream` +
  `.pipe()`. Đo thật: bản cũ khi NAS ngắt giữa chừng hoặc MinIO đứng thì kết nối người xem **treo mãi** (không sập server
  như nhận định ban đầu khi rà soát — đã tái hiện để kiểm tra); bản mới đóng sau 62ms (ngắt) / ~400ms (đứng, theo timeout),
  MinIO không trả header -> 502.
- **`taiUrlTho`**: trần 50MB (theo `Content-Length` hoặc đếm khi đang tải) + bắt `error` trên response — đo thật: bản cũ khi
  nguồn ngắt giữa chừng thì promise **không bao giờ kết thúc** (hàng chờ thư viện sẽ đứng im tới khi khởi động lại).
- **Key MinIO đơn ánh** (`lamSachKey`): giữ `A-Za-z0-9-_.`, ký tự khác mã hoá `~XX` — `9U121.2` và `9U121_2` không còn trùng thư mục.
- **Thử lại đủ 5 lần** (5′, 20′, 60′, 3 giờ, 8 giờ) rồi mới `LOI_CUOI` ở lần lỗi thứ 6 — bản đầu dừng ở lần 5, không dùng mốc 8 giờ.
  Nhánh lỗi bất thường cũng theo đúng giới hạn này (trước đó thử lại mãi).
- **Tiến độ lô**: `tv_lo_dong.viec_id` (thêm cột + điền cho dữ liệu cũ khi khởi động) — đếm theo việc khác nhau, không cộng
  trùng dòng lặp; bảng ghi rõ "Dòng" / "Link chờ/xong/lỗi" / "Dòng bỏ qua"; làm mới 15 giây thay vì 5. "Link đã có từ trước"
  không còn đếm dòng lặp trong chính file.
- **Nhận dạng định dạng ảnh dùng chung** `anhNguonService.nhanDangKieuAnh` (photos + thư viện). `routes/reports.js` và
  `services/qc/qcService.js` vẫn giữ bản riêng — không đụng QC/báo cáo khi không cần.

## 21d. Rà soát chống nghẽn (03/10/2026)

Đo ở quy mô nhập toàn bộ lịch sử (200.000 việc, 200.000 file, 1 lô 180.000 dòng — CSDL tạm):

| Hạng mục | Trước | Sau |
|---|---|---|
| Truy vấn trong vòng xử lý (lấy việc kế tiếp, kiểm tra trùng) | 0,01–1,2 ms | (giữ nguyên — đã dùng chỉ mục) |
| Trang hàng chờ (5 giây/lần) / bảng lô (15 giây/lần) | ~28 ms / ~82 ms | (giữ nguyên — chấp nhận được) |
| File kết quả lô 180.000 dòng | 4,6 s, RSS 2.044MB, **chặn luồng chính 3.460ms liền** | 2,7 s, RSS 269MB, chặn lâu nhất 44ms (ghi luồng `WorkbookWriter`, đọc DB từng trang 2.000 dòng theo `(dong, rowid)`) |
| Nhập Excel 150.000 dòng | chặn liền 1.694ms (1 giao dịch SQLite) | chặn lâu nhất 464ms (ghi từng đợt 5.000 dòng; phần còn lại là exceljs tự đọc file) |

Cơ chế chống kẹt thêm:
- **Xử lý ảnh (sharp) ở tiến trình con** `services/thuVien/xuLyAnhWorker.js` (fork, `serialization: 'advanced'`). Quá 60 giây
  -> SIGKILL + tạo lại ở lần sau; file vẫn lưu (LOI_HASH). Lý do: Promise.race chỉ thôi chờ, luồng libuv (4 luồng, dùng chung
  với đọc file/tra DNS của cả app) vẫn kẹt khi sharp treo native — đã có 2 sự cố thật với sharp trên production. Rảnh 2 phút
  thì tắt tiến trình con; server chính tắt thì tiến trình con tự thoát.
- **Bộ canh hàng chờ**: không tiến triển 10 phút (await treo ở thư viện không có timeout — token Google, trình duyệt ảo...)
  -> việc đang chạy ghi lỗi theo lịch thử lại, lượt treo bị bỏ rơi (đếm lượt — nếu sau đó chạy tiếp cũng không ghi đè trạng
  thái việc), lượt mới chạy tiếp các việc khác.
- **Tự tạm dừng** khi 5 link liên tiếp gặp lỗi hệ thống (MinIO, ENOTFOUND/ECONNREFUSED/ETIMEDOUT, quota/xác thực Google) hoặc 5
  file liên tiếp không tính được hash/thumbnail — tránh đốt hết hàng chờ thành lỗi khi dịch vụ đang sập. Lỗi riêng từng link
  (link chết, chưa chia sẻ) không tính. Lý do hiện ở menu; bấm Chạy tiếp xoá lý do + bộ đếm.
- **`taiUrlTho` hạn tổng 60 giây** (timeout 15s cũ chỉ tính lúc im lặng — server nhỏ giọt giữ kết nối gần như mãi).
- Kiểm thử: `node scripts/kiem-tra-thu-vien.js` thêm các kịch bản treo vĩnh viễn, MinIO sập, tiến trình con quá giờ, nhỏ giọt.
- Ngưỡng chỉnh được bằng biến môi trường khi cần: `THU_VIEN_NGUONG_KET_MS` (mặc định 600000), `THU_VIEN_XU_LY_ANH_MS` (60000).

## 21e. Ghi chú triển khai giai đoạn 2 (03/10/2026)

**Khác bản thiết kế:**
- **Khớp tên file (mục 7) sửa quy tắc**: so theo **cụm token liền nhau giữ nguyên dấu ngăn cách gốc** (tối đa 4 token), không
  phải từng token rời. Lý do: mã đơn có thể chứa dấu chấm (`9U121.2`) — tách từng token thì `9U121.2.png` không khớp được
  đơn của nó, tệ hơn là khớp NHẦM sang `9U121`. Nhiều mã chồng lên nhau ở cùng chỗ -> mã dài hơn thắng; còn ≥ 2 mã khác
  nhau -> không khớp (không tự chọn). Đã kiểm 17 trường hợp (`services/thuVien/khopTenFile.js`, `scripts/kiem-tra-thu-vien.js`).
- **EMB lưu theo key bất biến** `thu-vien/<k>/<k>_v<n>.emb` cho MỌI phiên bản (bản chính = bản mới nhất, cột `la_ban_chinh`)
  thay vì bản chính ở `<k>.emb` + chép bản cũ sang `_v<n>` — không ghi đè object nào, không cần key tạm. Tải về bản chính
  vẫn đặt tên `<STT_Key>.emb`.
- **Bảng kết quả tải lên là .csv** (UTF-8 có BOM, Excel mở đúng tiếng Việt) tạo ngay trên trình duyệt, thay vì .xlsx từ
  server — kết quả nằm sẵn ở trình duyệt; gửi ngược lên server vướng giới hạn body JSON 100KB của app.
- Tra theo mã đơn có nhiều PNG: 1 danh sách gộp, mỗi file lấy điểm cao nhất so với các PNG của đơn, ghi "giống nhất với ...".
- Tìm theo ảnh: ô "Mã đơn" (nếu có) là đơn mới đang vẽ — bỏ khỏi kết quả, dùng để ghi quyết định.
- Xem trước tải lên chia đợt 500 file/lần (giới hạn body JSON 100KB). Mã gõ tay không có trong Sheet (hoặc không đọc được
  Sheet) phải tick xác nhận; server khớp lại tên file, không tin mã từ trình duyệt.

**Số đo:**
- Tìm trong chỉ mục 200.000 file: ~30ms/lần (đếm bit trên Uint32Array). Dựng chỉ mục lần đầu sau khi khởi động ~0,6 giây;
  sau đó **cập nhật dần** theo id file đổi (`thuVienDbService.layIdDoiSauPhienBan`) — có file mới/hash tính lại thì lần tìm kế
  tiếp 15–40ms (không dựng lại cả 200.000 dòng — tránh chặn app khi hàng chờ đang nhập lịch sử).
- Ảnh giả lập (hash thật, tiến trình con): cùng thiết kế đổi màu đỏ + nền trắng -> Hình dạng **100%**, Ảnh 74,2%; thiết kế
  khác (INDIANA vs ALABAMA) -> Hình dạng 81,6%, **Ảnh 84,4%** (cao hơn cả cùng thiết kế) — xác nhận chỉ % Ảnh thì gây hiểu
  nhầm, và đúng là chưa nên gán nhãn "giống" khi chưa có ngưỡng (giai đoạn 4).
- Ảnh vẽ lại bằng canvas trình duyệt (khác font/cách vẽ) vẫn tìm đúng thiết kế gốc đứng đầu: Ảnh 98,4%, Hình dạng 99,2%.

## 21f. Ghi chú triển khai giai đoạn 3 + 4 (03/10/2026)

**Giai đoạn 3** (`services/thuVien/dongBoSheetService.js`):
- **Công tắc Bật/Tắt cho superadmin, mặc định TẮT** (khoá `tu_dong_sheet`) — bổ sung so với spec mục 10: lần quét đầu đưa link
  của TOÀN BỘ đơn trong Sheet vào hàng chờ; điểm dừng đo 200 file chỉ có 1 lần (có thể đã qua khi nhập Excel) nên không để tự
  chạy ngay khi deploy. Có nút "Quét ngay" và dòng kết quả lần quét gần nhất (hoặc lỗi).
- Cron `*/10 * * * *`; đọc Sheet qua `orderService.getAll()` (cache sẵn) có hạn 2 phút — Sheets treo không giữ cờ "đang chạy" mãi.
  Ghi việc trước, ghi "đã thấy" sau (đứt giữa chừng -> lần sau quét lại, không trùng); ghi từng đợt 5.000, nhả luồng chính.
- Link cũ bị đổi/xoá: file đã lưu giữ nguyên; việc đang chờ của link cũ cũng **giữ nguyên** (không huỷ) — DUONG_DAN_URL là cột
  công thức sống, Sheet lỗi tạm thời ra ô rỗng/#REF! mà huỷ theo thì mất việc hàng loạt. Ô không có link nào thì bỏ qua.

**Giai đoạn 4** (`services/thuVien/nguongService.js`):
- Dữ liệu đo = **cặp ảnh thật** trong thư viện do người vẽ file đánh giá (Cùng thiết kế / Khác thiết kế; bảng `tv_cap_danh_gia`).
  Hệ thống chọn cặp đều các dải điểm (≥97, 92–97, 87–92, 82–87, 75–82, <75 — ưu tiên dải đang ít cặp; dải thấp ghép 2 ảnh ngẫu
  nhiên). Lúc đánh giá **ẩn điểm %** để không dẫn dắt người đánh giá. Superadmin xoá được cặp đánh giá nhầm.
- Bộ ngưỡng `{ anh, hinhDang, xemTay }` (50..100%, xemTay ≤ 2 ngưỡng kia), **không có mặc định**. Nhóm: Trùng file > Ảnh giống
  (% Ảnh ≥ anh) > Cùng hình dạng (% Hình dạng ≥ hinhDang) > Cần xem tay (điểm cao nhất ≥ xemTay) > Điểm thấp.
- Gợi ý cùng cách menu QC: cần ≥ 30 cặp, mỗi loại ≥ 5; thử lưới (anh, hinhDang 80..100 bước 1; xemTay 50.. bước 2); 3 hướng:
  AN_TOAN (ít "giống" sai nhất), IT_BO_SOT (ít bỏ sót nhất), IT_XEM_TAY (ít xem tay nhất khi sai = 0). Có "Thử bộ này" trước khi
  lưu; kèm phân bố điểm cặp cùng/khác cho từng cột + nhận xét "tách rời / chồng lấn" để superadmin quyết định có cần mức 3 (AI).
- Ảnh giả lập (10 thiết kế x 2 biến thể đổi màu + nền, 40 cặp): % Hình dạng cặp cùng 96,5–100, cặp khác cao nhất 88,3 -> tách
  rời; cả 3 hướng gợi ý trùng nhau (Hình dạng ≥ 96%, 0 sai, 0 bỏ sót). Ảnh thật sẽ khác — phải đo lại.
- Quyền: đánh giá cặp = ve_file/admin/superadmin (admin chỉ cặp trong Xưởng mình); gợi ý/lưu/xoá ngưỡng, danh sách cặp = superadmin.

## 21g. Ghi chú triển khai giai đoạn 5 (03/10/2026)

- Khối "Thống kê thư viện" (admin+, admin chỉ Xưởng mình; `services/thuVien/thongKeService.js`, `GET /api/thu-vien/thong-ke`):
  số PNG / đơn có PNG, đơn có EMB (+ số phiên bản), dung lượng, link chờ/lỗi, file chưa tính được hash; danh sách (tối đa 50 mã
  mẫu, bấm để tra): đơn trong Sheet chưa có PNG trong thư viện, đơn có PNG chưa có EMB, đơn có EMB chưa có PNG, đơn trong thư
  viện không còn trong Sheet, nội dung PNG trùng ở ≥ 2 đơn (sha256). "File chưa xác định được mã đơn" của yêu cầu gốc không có
  trong thiết kế này — file không khớp đơn không được lưu (gõ tay ở bảng xem trước, mục 11).
- Chỉ tính khi bấm "Tính thống kê" (không tự tính khi mở trang). Đo 200.000 file: bản đầu chặn luồng chính ~1,5 giây liền ->
  lọc nhóm trùng trong SQL, chỉ đếm việc chưa xong, vòng lặp nhả luồng chính mỗi 20.000 mục: tổng ~0,7 giây, chặn liền lâu
  nhất ~0,3 giây (câu GROUP BY của SQLite).
- Phát hiện khi thử: trạng thái tạm sau khi ghi MinIO là `LOI_HASH` -> thống kê/Cần xử lý đếm nhầm file đang tính hash dở là lỗi.
  Đổi sang trạng thái riêng `DANG_TINH`; khởi động lại mà còn `DANG_TINH` (tắt giữa chừng) -> chuyển `LOI_HASH` để Tính lại.

## 21h. Sửa sau rà soát code giai đoạn 1–5 (03/10/2026)

- **Đọc Sheet để khớp mã** (`layTapMa`): chờ tối đa 15 giây; quá hạn/lỗi -> dùng tạm danh sách Sheet lần trước, chưa có thì chỉ
  khớp với mã trong thư viện (trước đây Sheets treo thì tra mã / xem trước / tải lên / thống kê treo theo). Nhiều yêu cầu cùng
  lúc dùng chung 1 lượt đọc. Lưu xong 1 file: thêm mã vào tập đang giữ thay vì dựng lại cả tập sau mỗi file.
- **Mã gõ tay / mã từ chi tiết đơn**: khác chữ hoa/thường hoặc NFC/NFD với đúng 1 mã có thật -> lưu vào mã có thật (không tạo
  thư mục thứ 2 cho 1 đơn); khớp nhiều mã -> báo, bắt gõ đúng. Mã chưa có trong Sheet lẫn thư viện phải xác nhận; thông điệp tách
  2 trường hợp "không có trong Sheet" và "không đọc được Sheet lúc này". Tải EMB ở chi tiết đơn áp cùng quy tắc (server trả
  `CAN_XAC_NHAN`, trang hỏi rồi gửi lại).
- **Khớp tên file**: chuẩn hoá NFC cả tên file lẫn mã (tên file từ macOS là NFD — mã có chữ Việt có dấu không khớp được).
- **Quét ngay**: công tắc TẮT thì hỏi xác nhận rõ (lượt này vẫn đưa link vào hàng chờ; chưa quét lần nào = toàn bộ đơn), server
  cũng đòi `xacNhanKhiTat`. Trả lời ngay, quét chạy nền; "Đang quét..." và kết quả hiện ở dòng "Lần quét gần nhất" (hàng chờ 5
  giây/lần).
- **Quét Sheet**: 1 mã ở nhiều dòng -> gộp DUONG_DAN_URL các dòng rồi mới so (trước đây giá trị "đã thấy" nhảy qua lại giữa các
  dòng, lượt nào cũng coi là đổi). Mã 1 dòng giữ nguyên giá trị như trước.
- **Gợi ý ngưỡng**: lưới chỉ tính khi bấm "Tính gợi ý" (mở trang / Thử / lưu không chạy lưới); trang giữ gợi ý đã tính, bỏ khi có
  cặp mới/xoá cặp. Đếm theo mảng số thay vì tạo object mỗi cặp — đo lưới 8.386 bộ: 1.000 cặp 62 -> 32ms, 3.000 cặp 303 -> 119ms,
  kết quả giống hệt bản cũ.
- **Chọn cặp đánh giá cho admin**: rút ảnh mốc ngẫu nhiên tới 300 lần, lọc theo Xưởng (trước 12 lần — Xưởng nhỏ gần như không bao
  giờ chọn được cặp). Xưởng < ~1% thư viện vẫn có thể trượt — khi đó đổi sang rút từ danh sách mã của Xưởng.
- **Tìm kiếm**: xếp chỉ số theo thùng điểm bằng 1 lượt sắp kiểu đếm (trước: mỗi thùng quét lại cả thư viện). Đo 200.000 file
  hash ngẫu nhiên: 31 -> 14ms (thấy tất cả), 43 -> 24ms (phạm vi 1%), kết quả giống hệt.
- **Tiến trình con xử lý ảnh**: bỏ tham chiếu trước khi kill (tắt khi rảnh / quá 60 giây) — yêu cầu kế tiếp không gửi nhầm vào
  tiến trình đang chết.
- **Giao diện**: CSV kết quả tải lên thêm `'` trước ô bắt đầu bằng `= + - @` (Excel không chạy như công thức); cặp ảnh đánh giá
  dùng thumbnail 256px (lỗi thì dùng ảnh gốc), có link "ảnh gốc".

## 21i. Sửa sau 2 lượt rà soát tiếp (03/10/2026)

- **Hash suy biến = không có hash.** Hash gần như hằng số (< 16 hoặc > 240 bit 1 trên 256) không mang thông tin: so với nó thì
  ảnh nào cũng "giống 100%". Tìm kiếm và đo ngưỡng bỏ qua hash suy biến (file vẫn XONG, chỉ không chấm điểm ở cột đó). Thiết kế
  thật đo được ~120–130 bit 1.
- **% Ảnh của ảnh trong suốt:** đặt lên nền trắng trước khi tính (nền trắng suy biến — chỉ trắng thuần — thì đặt lên nền đen).
  Trước đây vùng trong suốt thành đen: chỉ đen thuần ra hash toàn 0, 2 thiết kế khác nhau (TEXAS / OHIO) "giống 100%"; nay 78,9%.
  `tinhHashAnh` giữ nguyên cho Đơn hàng loạt. Thư viện chưa triển khai nên không phải tính lại hash file cũ.
- **Hash hình dạng:** tấm nền đặc bo góc (TEXAS / hình tròn) 100% → 53%; chấm lạc 4px ở góc: cùng thiết kế 66% → 99%.
  Ảnh giả lập: cặp cùng thiết kế 98,4–100%, cặp khác cao nhất 89,5% — vẫn tách rời.
- **Xem trước thư mục** chia đợt theo dung lượng body (≤ 80KB, ≤ 500 file) — 500 file đường dẫn tiếng Việt dài đã 136KB, vượt
  giới hạn 100KB của server, cả thư mục báo lỗi.
- **Phạm vi Xưởng của admin:** lấy mọi mã của Xưởng bằng 1 truy vấn (`trangThaiDbService.dsKeyTheoXuong`) rồi tra trong Set —
  cùng điều kiện với `orderService.phamViDon` (tra từng mã ~16µs, admin Xưởng nhỏ xét cả thư viện ≈ 1 giây chặn server).
  Cần xử lý lọc Xưởng trước khi lấy 500 dòng. Thông báo/bảng xem trước không gửi mã đơn của Xưởng khác.
- **Mã gõ khác hoa/thường** ở tra theo mã, đơn mới đang vẽ (tìm theo ảnh), ghi quyết định cũng đổi về mã thật như tải lên.
- **Danh sách Sheet cũ được báo:** không đọc được Sheet mà đang dùng danh sách lần trước thì bảng xem trước, thống kê và thông báo
  mã lạ ghi rõ "danh sách đơn đọc lúc ...".
- **Hàng chờ:** chỉ việc của hàng chờ mới tính vào tự tạm dừng (file tải tay lỗi hash không dừng hàng chờ). Ước tính dung lượng NAS
  và điểm dừng đo 200 file chỉ tính PNG do hàng chờ tải (không tính EMB / file tải tay). Tổng file/dung lượng đọc lại tối đa 30
  giây/lần (quét cả bảng ~70ms ở 200.000 file, trang gọi 5 giây/lần). Bảng "Các lần nhập" nhớ tiến độ lô đã xong (bấm Thử lại
  thì đếm lại) — lô 150.000 dòng ~60ms mỗi lần đếm.
- **EMB bản chính** = phiên bản số lớn nhất đã lưu xong (2 lần tải lên chồng nhau không còn lệch giữa nơi hiển thị và tên tải về).
- **Tải ảnh từ link:** hạn 60 giây tính cho cả chuỗi chuyển hướng (trước: mỗi lần chuyển đặt lại, 5 lần = 6 phút).

## 21. Ngoài phạm vi

Mockup; ghi ngược `DUONG_DAN_URL` hay bất kỳ cột Sheet nào; tự gắn/thay file cho đơn; xoá file thư viện;
bắt buộc EMB khi đổi trạng thái; tìm bằng AI embedding (chờ giai đoạn 4); định dạng thêu khác `.emb`.
