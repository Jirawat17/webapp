# Thiết kế 21 tính năng chọn từ Sổ đề xuất (04/10/2026)

Nguồn: các mục người dùng tích chọn trên trang Sổ đề xuất Xưởng Thêu (artifact `AUpDgu6dWKp3vFvpqmBzba`, bộ sưu tập `chon`).
21 mục: A1, A2, A3, A10, B2, B4, D1, E3, E4, F1, F4, G1, G4, L2, T5, U2, X1, Y5, Y6, Y14, Y20.

Trạng thái: **đã duyệt 04/10/2026** — người dùng đồng ý toàn bộ phương án mặc định Q1–Q12 (mục 0.4). Đang code đợt 1
(X1, U2, G1, D1, B2, A3, F1).

---

## 0. Phần chung

### 0.1 Ghi nhận sau khi đọc code

- **F4 (âm báo và rung khi quét) đã có sẵn.** `public/scan.html` (dòng 309–362) đã phát 4 loại tiếng bíp khác nhau (nhận mã,
  OK, sai trạng thái, không tìm thấy) và rung 2 kiểu, dùng ở chế độ quét kịch bản và hai chế độ chụp ảnh. Lúc đề xuất tôi đã
  không kiểm tra chỗ này. Phần còn thiếu duy nhất là một tiếng cảnh báo riêng cho đơn nhiều áo chưa đủ, nên **F4 gộp vào F1**
  (mục 6). Tổng cộng còn 20 thiết kế.
- `THOI_GIAN_CAP_NHAT_TRACKING` là **lúc app hỏi GKE** (`trackingAutoService.js` dòng 725 ghi `new Date()`), không phải lúc kiện
  có sự kiện vận chuyển mới. L2 không dùng được cột này để biết kiện đứng yên bao lâu (mục 9).
- Thư viện Tìm ảnh **giữ cả file của link cũ** khi seller đổi DUONG_DAN_URL (giai đoạn 3, không xoá). B2 phải lọc theo link
  hiện tại, nếu không PDF in đơn sẽ in nhầm thiết kế cũ (mục 4).
- Ở chi tiết đơn, `nguoi_lay_phoi` thấy ảnh thu nhỏ của thiết kế nhưng không có link mở PNG/Mockup gốc (`order.html` dòng 181–185).
  U2 giữ nguyên quy tắc này.

### 0.2 Thành phần dùng chung (làm trước, nhiều tính năng cùng dùng)

**C1. API tóm tắt thư viện theo nhiều đơn.** `POST /api/thu-vien/tom-tat-don` nhận `{ keys: [...] }` (tối đa 500 mã), trả về
cho mỗi mã đơn mà người gọi được xem (lọc theo `duocXemDon`):

```
{ "10LH72": { emb: { id, soThuTu, ten } | null, soPng: 2, khoaThietKe: "<sha256 PNG số 1>" | null,
              goiY: { sttKey, embId, nhom, phanTramAnh, phanTramHinhDang } | null } }
```

Dùng bởi A1 (nhãn "Có EMB sẵn"), A10 (đơn chưa có EMB), B4 (nút Tải EMB ở Chạy máy), E3 (gom theo mẫu).
Vai trò được gọi: ve_file, admin, superadmin, san_xuat (san_xuat chỉ nhận phần `emb` và `khoaThietKe`). Truy vấn SQLite theo lô
500 mã, không gọi MinIO.

**C2. Bảng "đã xử lý" cho các cảnh báo mới.** Bảng SQLite `canh_bao_da_xu_ly` (trong `nhat_ky.db`):
`loai` (QC / TRACKING / SUA_DON / NHAN_LAU), `khoa` (mã đơn, hoặc mã đơn + loại QC), `gia_tri_luc_danh_dau`, `nguoi`, `luc`,
`ghi_chu`. Cảnh báo đã đánh dấu sẽ ẩn khỏi Trung tâm hành động. Nếu dữ liệu đổi tiếp sau lúc đánh dấu (giá trị khác
`gia_tri_luc_danh_dau`) thì cảnh báo hiện lại.

**C3. Kênh Telegram vận hành.** Ô cấu hình mới trong Setting (superadmin): "Chat Telegram nhận cảnh báo vận hành". Dùng bot
`TELEGRAM_BOT_TOKEN` có sẵn (`telegramService.guiTinNhan`). Để trống thì không gửi Telegram, cảnh báo chỉ hiện trong app.
Dùng cho: L2 (tổng hợp mỗi ngày), Y5 (gửi ngay), Y6 (tổng hợp mỗi ngày), Y20 (gửi ngay).

**C4. Hàm sao chép dùng chung** `saoChepNhanh(text, nut)` trong `public/js/api.js` (X1). Đổi `api.js?v=` trên mọi trang lên
**113** (bản đã commit là 110, bản 112 trong working tree chưa deploy).

### 0.3 Thứ tự làm đề xuất

| Đợt | Tính năng | Lý do |
|---|---|---|
| 1 | X1, U2, G1, D1, B2, A3, F1 | Nhỏ, độc lập, thấy hiệu quả ngay |
| 2 | C1, B4, A10, E3, A1, A2 | Cùng dựa trên thư viện Tìm ảnh và API C1 |
| 3 | C2, C3, G4, Y6, Y5, L2 | Cùng khung cảnh báo ở Trung tâm hành động và Telegram |
| 4 | T5, E4, Y14, Y20 | Mỗi mục một trang riêng |

### 0.4 Các điểm cần người dùng quyết định

| # | Mục | Câu hỏi | Mặc định đề xuất |
|---|---|---|---|
| Q1 | A2 | Cho phép chép EMB của đơn cũ thành phiên bản EMB mới của đơn đang làm (đổi quy tắc cũ "quyết định chỉ ghi nhận")? | Cho phép, phải bấm xác nhận |
| Q2 | A1 | Tính gợi ý cho những đơn nào? | Đơn "Chưa vẽ file" và "Đang vẽ file" |
| Q3 | A1 | Chưa lưu ngưỡng nhóm kết quả thì gợi ý gì? | Chỉ báo khi Trùng file |
| Q4 | B4 | Người chạy máy tải EMB của đơn nào? | Mọi đơn trong Xưởng của họ |
| Q5 | F1 | Đơn nhiều áo chưa đủ: chỉ cảnh báo hay chặn quét? | Chỉ cảnh báo (tiếng + khung vàng) |
| Q6 | G4 | Ai xem kết quả QC trên chi tiết đơn? | admin, superadmin (theo Xưởng) |
| Q7 | L2 | Ngưỡng ngày cho kiện bất thường? | Chưa được quét nhận sau 3 ngày; trạng thái đứng yên 7 ngày |
| Q8 | Y5 | Theo dõi những cột nào, từ bước nào? | LOAI, KICH_THUOC, MAU_SAC, SO_LUONG, DUONG_DAN_URL, MOCKUP, VI_TRI_1; từ khi Đang vẽ file hoặc Đã lấy phôi |
| Q9 | Y6 | Ngưỡng giờ và cách thu hồi? | Đang vẽ file quá 24 giờ, Đang chạy máy quá 12 giờ; chỉ nhắc, admin tự bấm thu hồi |
| Q10 | Y6 | Thu hồi thì trả đơn về trạng thái nào? | Vẽ file: "Chưa vẽ file". Chạy máy: "ĐÃ SẴN SÀNG CHẠY MÁY" |
| Q11 | Y14 | Ai được kiểm kê kho phôi? Có ghi số mới vào tab Ton_Kho_Phoi trên Sheet không? | admin, superadmin; có ghi (giống Nhập kho hiện tại), lịch sử lưu SQLite |
| Q12 | C3 | Cảnh báo vận hành gửi vào chat Telegram nào? | Ô cấu hình mới, để trống thì không gửi |

---

## 1. A1. Báo "Có EMB sẵn" trên thẻ đơn cần vẽ

**Mục tiêu.** Người vẽ thấy ngay trên thẻ đơn là thiết kế này (hoặc thiết kế rất giống) đã có file EMB ở đơn cũ, để không vẽ lại.

**Dữ liệu.** Bảng mới `tv_goi_y_emb` trong `thu_vien.db`:

| Cột | Ý nghĩa |
|---|---|
| `stt_key` (PK) | Đơn đang cần vẽ |
| `file_mau_id`, `file_khop_id` | PNG của đơn này và PNG giống nhất của đơn cũ |
| `stt_key_khop`, `emb_id` | Đơn cũ và EMB bản chính của nó |
| `nhom` | TRUNG_FILE / ANH_GIONG / CUNG_HINH_DANG (theo `nguongService.phanNhom`) |
| `phan_tram_anh`, `phan_tram_hinh_dang` | Điểm thật từ `timTuongTu`, không làm tròn hay chỉnh |
| `tinh_luc` | Lúc tính |

**Tính gợi ý** (`services/thuVien/goiYEmbService.js`):
1. Lấy PNG của đơn (`dsChiMucPng`), gọi `timTuongTu({ mau, boQuaStt: {đơn}, duocXem: mã có EMB XONG, gioiHan: 5 })`.
2. Lấy kết quả đầu tiên có nhóm TRUNG_FILE, ANH_GIONG hoặc CUNG_HINH_DANG. Chưa lưu ngưỡng thì chỉ nhận TRUNG_FILE (Q3).
3. Có thì ghi đè dòng của đơn, không có thì xoá dòng.

**Khi nào tính.**
- Lịch 10 phút/lần cho các đơn đang cần vẽ (Q2) đã có PNG trong thư viện. Nhả luồng chính sau mỗi đơn. Ước tính 15–30 ms/đơn
  ở thư viện 200.000 file, nên 300 đơn mất khoảng 6–9 giây, rải đều. Đo lại khi code.
- Ngay sau khi lưu PNG mới cho một đơn (gộp các lần gọi trong 5 giây).
- Lưu EMB mới cho một đơn bất kỳ: đánh dấu để lượt 10 phút kế tiếp tính lại toàn bộ.

**Giao diện.** `my-orders-ve-file.html`, cả hai mục. Vẽ danh sách xong thì gọi C1 cho các thẻ đang hiện. Thẻ có gợi ý hiện nhãn:
"Có EMB sẵn: đơn 9F13 · Trùng file", hoặc "Có EMB sẵn: đơn 9F13 · Hình dạng 98,4%". Kèm 3 nút:
- "So sánh": mở `tim-anh.html?stt=<đơn>`, trang tra theo mã sẵn có.
- "Tải EMB": file bản chính của đơn cũ.
- "Dùng cho đơn này" (A2).

Chi tiết đơn (khối EMB): đơn chưa có EMB mà có gợi ý thì hiện cùng dòng gợi ý.

**Quy tắc giữ nguyên.** Chỉ gợi ý, không tự gắn EMB vào đơn. Điểm hiển thị là điểm đo thật. Không có gợi ý thì không ghi gì
(không ghi "không có thiết kế giống").

**Kiểm thử.** Đơn A có PNG trùng file với đơn B có EMB, nên A có gợi ý TRUNG_FILE. Đơn B chưa có EMB thì không gợi ý. Chưa có
ngưỡng thì cặp chỉ "giống 99%" không được gợi ý.

## 2. A2. Dùng lại EMB một chạm

**Mục tiêu.** Người vẽ thấy EMB cũ dùng được thì bấm một nút để có ngay EMB cho đơn mới, không phải tải về rồi tải lên lại.

**API.** `POST /api/thu-vien/dung-lai-emb` với `{ sttKeyMoi, embId, ghiChu }`. Vai trò ve_file, admin, superadmin.
1. Kiểm tra: `embId` là EMB đã lưu xong; người gọi được xem cả đơn cũ lẫn đơn mới. Mã đơn mới chuẩn hoá bằng `timMaCoThat` (gõ
   chữ thường vẫn ra mã thật). Đơn mới phải khác đơn cũ.
2. Đọc file từ MinIO (`getObjectBuffer`), lưu qua `luuEmb` thêm 2 tham số mới:
   - `nguon = 'TAI_SU_DUNG'`
   - `urlGoc = 'emb:<id cũ>'`, `ten_file_goc = '<mã cũ> v<n> (<tên gốc>)'`
3. File thành **phiên bản mới** của đơn mới, theo quy tắc bản chính là số phiên bản lớn nhất. Không ghi đè file nào.
4. Đơn mới đã có đúng file này thì trả về TRUNG ("Đơn đã có đúng file EMB này"), không tạo bản trùng.
5. Ghi quyết định `TAI_SU_DUNG` (bảng `tv_quyet_dinh`, `file_id` = EMB cũ) và ghi log "Tìm ảnh: dùng lại EMB".

**Giao diện.** Nút "Dùng EMB này cho đơn …" có ở hai chỗ:
- Thẻ kết quả Tìm ảnh, khi ô "Mã đơn" có đơn mới và kết quả có EMB.
- Nhãn gợi ý A1.

Bấm thì hiện khung xác nhận ngay trong trang: "Chép EMB phiên bản 3 của đơn 9F13 sang đơn 10LH72? EMB hiện có của 10LH72 vẫn giữ
làm bản cũ." Kèm ô ghi chú và nút Chép / Huỷ.

**Cần duyệt.** Q1: đây là thay đổi quy tắc cũ "quyết định chỉ ghi nhận, không đổi đơn hay file". File mới chỉ tạo ra khi người
dùng bấm và xác nhận, đúng quy tắc "không tự gắn thiết kế cũ".

**Kiểm thử.** Chép thành công tạo `_v<n+1>.emb` cho đơn mới, file đơn cũ không đổi. Chép lần 2 trả TRUNG. Admin khác Xưởng nhận 404.

## 3. A3. Tìm ảnh bằng dán, kéo-thả, chụp, dán link

**Mục tiêu.** Tìm thiết kế trong vài giây từ ảnh chụp màn hình Zalo hoặc link khách gửi, không phải lưu file về máy trước.

**Giao diện** (`tim-anh.html`, khối "Tìm thiết kế"):
- **Dán ảnh (Ctrl+V)** ở bất kỳ đâu trên trang, trừ khi đang gõ trong ô chữ. Lấy ảnh đầu tiên trong clipboard.
- **Kéo-thả** ảnh vào khung tìm (viền nét đứt khi kéo qua).
- **Chụp ảnh** bằng nút có `<input accept="image/*" capture="environment">` (camera sau trên điện thoại).
- **Dán link**: ô "Link ảnh (Drive, Gemini, URL)" và nút "Tìm theo link".

Ảnh dán, kéo, chụp đều gửi lên route sẵn có `POST /tim-theo-anh`.

**API mới** `POST /api/thu-vien/tim-theo-link` với `{ url, sttKeyMoi }`:
1. Chỉ nhận link `http(s)`, dùng `anhNguonService.taiDsAnh(url, { gioiHan: 5 })`. Hàm này đã có chặn địa chỉ nội bộ, trần 50 MB
   và hạn 60 giây.
2. Thư mục Drive lấy tối đa 5 ảnh. Mỗi ảnh tính hash và làm một mẫu so sánh, nhãn là tên file.
3. Ảnh không phải PNG/JPEG hoặc quá 30 MB thì bỏ qua và ghi lý do.
4. Trả kết quả cùng dạng `tim-theo-anh`, thêm `soAnhTuLink`.
5. Hạn tổng 90 giây cho cả yêu cầu (dưới mức 100 giây của Cloudflare). Link Gemini chậm thì báo "Link tải quá lâu, hãy tải ảnh về
   rồi dán vào".

**Kiểm thử.** Dán ảnh PNG (sự kiện `paste` giả lập) ra cùng kết quả với chọn file. Link thư mục giả lập có 3 ảnh thì ra 3 mẫu.
Link trỏ vào địa chỉ nội bộ bị từ chối.

## 4. B2. PDF in đơn lấy ảnh từ thư viện

**Mục tiêu.** PDF "IN ĐƠN" và "Thuê team khác" tạo nhanh hơn và ít thiếu ảnh, vì ảnh đọc từ MinIO (NAS nội bộ) thay vì tải lại
từ Drive/Gemini cho từng đơn.

**Cách làm.** Hàm mới `layAnhThietKeTuThuVien(don)` (đặt trong `services/thuVien/`) trả về mảng buffer hoặc `null`:
1. Tách link hiện tại của `don.DUONG_DAN_URL` (`tachLink`).
2. Lấy PNG của đơn trong thư viện có `url_goc` thuộc tập link hiện tại. File của link cũ và file tải tay bị loại, vì file tải tay
   không có `url_goc` để đối chiếu.
3. **Mọi link hiện tại phải có ít nhất 1 file** trong thư viện. Thiếu link nào (chưa tải xong, link lỗi) thì trả `null` cho cả đơn,
   để không in nửa ảnh mới nửa ảnh cũ.
4. Sắp theo `so_thu_tu` (đúng thứ tự tải: thư mục Drive theo tên file). Đọc tối đa 6 file bằng `getObjectBuffer` (có hạn chờ).
   Đọc lỗi thì trả `null`.

**Nối vào.**
- `routes/reports.js#taiAnhChoDon`: thử thư viện trước, `null` thì gọi `taiDsAnh(don.DUONG_DAN_URL)` như cũ. Ảnh MOCKUP giữ nguyên
  cách cũ (thư viện không lưu mockup).
- `thueTeamKhacService.taiAnhCuaDon`: dùng buffer từ thư viện nhưng **giữ nguyên link gốc** để in trên phiếu, vì link
  `/api/thu-vien/file/…` cần đăng nhập, team ngoài không mở được.

**Kiểm thử.** Đơn có đủ ảnh trong thư viện thì không gọi `taiDsAnh`. Đổi DUONG_DAN_URL sang link chưa tải thì dùng lại cách cũ
(không in ảnh cũ). Đo thời gian tạo PDF 50 đơn trước và sau trên server giả.

## 5. B4. Người chạy máy tải EMB trên thẻ đơn

**Mục tiêu.** Người chạy máy lấy file EMB ngay tại máy, bỏ bước chép USB từ máy người vẽ.

**Quyền.**
- `GET /api/thu-vien/emb/:sttKey`: `duocTai = true` cho cả san_xuat. `duocTaiLen` giữ ve_file, admin, superadmin.
- `GET /api/thu-vien/file/:id`: san_xuat **chỉ tải được file EMB**, không được tải PNG; trong phạm vi Xưởng (Q4).
- Mỗi lần tải ghi log "Tìm ảnh: tải EMB".

**Giao diện.** `my-orders.html` (cả "Đơn sẵn sàng chạy máy" và "Đơn đang chạy máy"): vẽ thẻ xong thì gọi C1. Thẻ có EMB hiện
"EMB v3" và nút "Tải EMB" (tải về tên `<STT_Key>.emb`). Thẻ chưa có EMB hiện "Chưa tìm thấy EMB". Chi tiết đơn đã có sẵn link khi
`duocTai = true`.

**Kiểm thử.** san_xuat tải EMB được, tải PNG nhận 404. san_xuat Xưởng khác nhận 404.

## 6. F1 (gộp F4). Cảnh báo đơn nhiều áo chưa đủ khi quét

**Mục tiêu.** Quét dán tem hay đóng gói một áo thuộc đơn nhiều áo (cùng OrderID, dùng chung tracking) mà các áo khác chưa xong
thì người quét biết ngay, tránh gửi thiếu áo.

**Server.** Các route quét đổi trạng thái (`routes/qr.js`, kịch bản và chụp ảnh đã dán tem) trả thêm `nhomNhieuAo` từ
`donNhieuAoService.tomTatChoDon`, đã có danh sách thành viên và trạng thái từng áo. Thêm trường `chuaDu`: danh sách áo có
`TRANG_THAI_XUONG` đứng **trước** trạng thái đích của lượt quét trong thứ tự pipeline (`THU_TU_TINH_TRANG`).

**Giao diện** (`scan.html`):
- Có `chuaDu` thì dòng kết quả kèm khung vàng: "Nhóm 9F13 (3 áo): 9F13.1 ✓ Đã sản xuất · 9F13,2 ✗ Đang chạy máy · 9F13,3 ✓".
- Phát âm mới `CANH_BAO_NHOM`: 3 tiếng sine 660 Hz ngắn, khác hẳn 4 tiếng hiện có. Rung `[80, 60, 80, 60, 80]`.
- Không chặn lượt quét (Q5).

**Kiểm thử.** Nhóm 3 áo, quét dán tem áo .1 khi áo ,2 còn "Đang chạy máy" thì `chuaDu = ['9F13,2']`. Nhóm đủ thì không cảnh báo.
Đơn lẻ thì không có trường này.

## 7. G1. Nhớ bộ lọc và vị trí cuộn

**Mục tiêu.** Vào chi tiết đơn rồi bấm quay lại thì danh sách giữ nguyên bộ lọc, sắp xếp, số thẻ đã mở thêm và vị trí cuộn.

**Cách làm** (3 trang `orders.html`, `my-orders.html`, `my-orders-ve-file.html`):
- Khoá `sessionStorage` riêng cho từng trang và từng mục. Lưu giá trị mọi ô lọc (theo `id`), ô sắp xếp, số thẻ đang hiện và
  `scrollY`.
- Lưu khi đổi bộ lọc và khi rời trang (`pagehide`).
- Lúc mở trang: khôi phục ô lọc **trước** lượt tải đầu. Vẽ xong thì mở đủ số thẻ đã lưu rồi cuộn tới vị trí cũ.
- Nút "Xoá lọc" xoá luôn bản đã lưu.
- Dùng `sessionStorage` (theo từng tab) chứ không dùng `localStorage`, để hai tab mở hai bộ lọc khác nhau không đè nhau.

**Kiểm thử.** Lọc Xưởng HN, mở thêm 2 lần, cuộn xuống, vào chi tiết rồi quay lại: cùng bộ lọc, cùng số thẻ, cùng vị trí. Tab mới
mở trang thì không có bộ lọc cũ.

## 8. G4. Hiện kết quả QC trên đơn

**Mục tiêu.** Kết quả AI QC (đang chỉ nằm trong menu QC của superadmin và Telegram) hiện trên chi tiết đơn, và đơn chưa đạt được
gom về Trung tâm hành động để admin từng Xưởng xử lý.

**API.** `GET /api/qc/ket-qua-don/:sttKey` (admin, superadmin, theo Xưởng; Q6). Trả bản ghi `qc_log` mới nhất cho từng loại
QC1/QC2/QC3: `KetQua`, `ThoiGian`, `LyDo` (cắt 300 ký tự), `CheDo`, `id`.

**Chi tiết đơn.** Khối "AI QC" với 3 nhãn, ví dụ "QC1 ĐẠT 03/10 14:20", "QC2 KHÔNG ĐẠT: chữ lệch tâm", "QC3 chưa chạy".
Superadmin có link sang log QC tương ứng.

**Trung tâm hành động.** Mục mới "AI QC chưa đạt, chưa xử lý":
- Mỗi cặp (đơn, loại QC) lấy bản ghi mới nhất. Hiện khi kết quả là FAIL hoặc CAN_CHECK_LAI, trong 7 ngày gần đây, và chưa đánh
  dấu xử lý (C2, `khoa = <mã>:<loại>`, `gia_tri_luc_danh_dau = id log`).
- Lần QC mới hơn ra PASS thì tự ẩn.
- Nút "Đã xử lý" kèm ô ghi chú.

**Kiểm thử.** Đơn có QC2 FAIL rồi QC2 PASS thì không hiện. Đánh dấu xử lý thì ẩn; chạy QC lại ra FAIL lần nữa (id mới) thì hiện lại.

## 9. L2. Cảnh báo vận chuyển bất thường

**Mục tiêu.** Biết sớm kiện bị kẹt hoặc có vấn đề để xử lý trước khi khách khiếu nại.

**Dữ liệu thiếu cần bổ sung** (cột SQLite mới trong `trang_thai_don`, tự thêm theo cơ chế cột sẵn có):
- `THOI_GIAN_MUA_TRACKING`: ghi khi mua tracking thành công. Đơn cũ để trống, quy tắc R1 bỏ qua những đơn này.
- `THOI_GIAN_DOI_TRANG_THAI_TRACKING`: ghi trong `capNhatTrangThaiTrackingChoDon` khi `TRANG_THAI_TRACKING` **đổi giá trị**. Đây mới
  là mốc "kiện có tin mới". Đơn cũ để trống cho tới lần đổi kế tiếp.

**Quy tắc** (superadmin chỉnh ngưỡng trong Setting; Q7):

| Mã | Điều kiện |
|---|---|
| R1 Chưa được quét nhận | Có tracking, `TRANG_THAI_TRACKING` rỗng (GKE chưa có sự kiện), mua quá 3 ngày |
| R2 Đứng yên | Chưa giao xong (`daGiaoThanhCongGke` sai), `TRANG_THAI_TRACKING` không đổi quá 7 ngày |
| R3 Trạng thái bất thường | `TRANG_THAI_TRACKING` chứa một từ khoá trong danh sách superadmin chọn |

**Không suy đoán mã GKE.** R3 không cài sẵn từ khoá nào. Trang Setting liệt kê **các giá trị `TRANG_THAI_TRACKING` thực tế đang có
trong dữ liệu** kèm số đơn, superadmin tự tích những giá trị coi là bất thường. Đơn đã huỷ, đã xoá dữ liệu hoặc đã giao xong không
xét.

**Hiển thị.**
- Trung tâm hành động, mục mới "Vận chuyển bất thường": mã đơn, tracking, quy tắc vi phạm, trạng thái hiện tại, số ngày.
- Nút "Đã xử lý" (C2, `gia_tri_luc_danh_dau` = trạng thái tracking lúc đánh dấu). Tracking đổi tiếp thì hiện lại nếu vẫn vi phạm.
- Telegram vận hành (C3): 1 tin tổng hợp mỗi ngày lúc 8 giờ.

**Việc cần kiểm tra khi code.** Lịch quét tracking (`trackingJob.js`) phải quét lại các đơn chưa giao đủ thường xuyên. Nếu lịch bỏ
qua đơn cũ, R2 sẽ báo sai cho những đơn đó.

## 10. T5. Thao tác cả nhóm ở trang Đơn hàng loạt

**Mục tiêu.** Làm việc với cả một nhóm đơn cùng mẫu ngay trên trang Đơn hàng loạt, không phải sang trang Đơn hàng lọc rồi chọn lại.

**Giao diện** (`don-hang-loat.html`, mỗi nhóm đã xác nhận):
- Dòng tóm tắt trạng thái thành viên, ví dụ "8 đơn: 3 chưa vẽ, 5 đã vẽ · 2 đang chạy máy".
- Thanh nút:

| Nút | Gọi route có sẵn | Ai dùng |
|---|---|---|
| Đã vẽ file cho cả nhóm | `/orders/chuyen-trang-thai-hang-loat` (cột TRANG_THAI_VE_FILE) | ve_file, admin |
| Chỉ định người vẽ | `/orders/chi-dinh-nguoi-ve-file` | admin |
| Chỉ định người chạy máy | `/orders/chi-dinh-nguoi-chay-may` | admin |
| In đơn cả nhóm | Job PDF "IN ĐƠN" (`/reports/don-can-in/bat-dau`) với danh sách mã của nhóm | ve_file, admin |

**Quy tắc.** Kiểm tra trạng thái giữ nguyên ở server: đơn không đúng trạng thái bị từ chối và hiện trong bảng kết quả, đơn khác
vẫn chạy. Chạy tuần tự qua `chayHangLoatCoTienDo` có sẵn để hiện tiến độ. Kiểm tra lúc code xem job "IN ĐƠN" đã nhận danh sách
mã chưa; nếu chưa thì thêm tham số.

**Kiểm thử.** Nhóm 4 đơn có 1 đơn chưa lấy phôi: "Đã vẽ file cho cả nhóm" vẫn đổi đủ 4 (vẽ file và lấy phôi độc lập). Đơn đang ở
LỖI SẢN XUẤT thì xử lý theo đúng quy tắc server hiện tại.

## 11. U2. Màn đối chiếu ảnh trên chi tiết đơn

**Mục tiêu.** Xem cạnh nhau các ảnh của một đơn để tự kiểm tra bằng mắt và khi xử lý khiếu nại.

**Giao diện** (`order.html`). Nút "Đối chiếu ảnh" mở khung lưới, máy tính 4 cột, điện thoại 2 cột:

| Cột | Nguồn |
|---|---|
| Thiết kế | Ảnh thu nhỏ trong thư viện nếu có, không thì DUONG_DAN_URL qua `anh-ngoai` (cỡ lớn). nguoi_lay_phoi vẫn thấy ảnh như hiện nay nhưng không có link mở bản gốc |
| File thêu | Anh_File_Theu_URL, _2, _3 |
| Đã sản xuất | Anh_Da_San_Xuat_URL |
| Đã dán tem / đóng gói | Anh_Da_Dan_Tem_URL, Anh_Dong_Goi_URL |

Ô không có ảnh ghi "Chưa có ảnh". Bấm ảnh mở bản gốc ở tab mới. Không thêm API mới; ảnh lấy qua proxy sẵn có nên vẫn kiểm quyền.

## 12. X1. Nút sao chép nhanh

**Chỗ đặt.**
- `order.html`: mã đơn (cạnh tiêu đề), khối địa chỉ người nhận (chép đủ tên, SĐT, đường, thành phố, bang, ZIP, quốc gia, mỗi thứ
  một dòng như trên nhãn), mã tracking (TRACKING_ID và TRACKING_ID2 nếu có).
- `tracking.html`: mã tracking ở từng dòng danh sách.

**Cách làm.** Hàm C4: `navigator.clipboard.writeText`; trình duyệt từ chối (trang http, máy cũ) thì dùng ô chữ ẩn và
`execCommand('copy')`. Báo "Đã sao chép" 2 giây ngay trên nút.

## 13. D1. Xem trước báo "cùng nội dung với đơn khác"

**Mục tiêu.** Lúc tải thư mục lên thư viện, biết ngay file nào đã có ở đơn khác (nhất là đơn đã có EMB), để dùng lại thay vì vẽ mới.

**Server** (`/xem-truoc`). Các dòng có sha256 hợp lệ gom thành một truy vấn
`SELECT sha256, stt_key FROM tv_file WHERE loai = ? AND sha256 IN (…)`, có chỉ mục `idx_tv_file_sha`.
- Bỏ chính đơn đang khớp. Chỉ giữ đơn người gọi được xem (không lộ mã Xưởng khác).
- Gắn `cungNoiDung: [{ sttKey, coEmb }]` (tối đa 5) và `soCungNoiDung`. `coEmb` lấy từ `embChinhCuaCacDon`.

**Giao diện.** Dưới trạng thái từng dòng: "Cùng nội dung với: 9F13 (có EMB), 8U2". Mỗi mã có link tra theo mã. File EMB trùng với
EMB đơn khác cũng báo như vậy.

## 14. E3. Gom lô chạy máy theo mẫu và phôi

**Mục tiêu.** Các đơn cùng thiết kế và cùng loại phôi đứng cạnh nhau, người chạy máy chạy liền một mạch, ít phải đổi file và thay chỉ.

**Giao diện** (`my-orders.html`, 2 mục). Ô sắp xếp thêm lựa chọn "Gom theo mẫu và phôi":
- **Khoá nhóm**, ưu tiên theo thứ tự:
  1. `NHOM_HANG_LOAT` (nhóm hàng loạt hệ thống đã gợi ý, có sẵn trên mỗi đơn).
  2. `khoaThietKe` từ C1 (sha256 của PNG số 1, tức trùng file thật).
  3. Riêng từng đơn.

  Không gom theo "giống gần đúng", để không gộp nhầm hai thiết kế khác nhau.
- Trong nhóm: sắp theo LOAI, MAU_SAC, KICH_THUOC.
- Giữa các nhóm: nhóm nhiều đơn trước, rồi theo ngày lên đơn cũ nhất.
- Mỗi nhóm có tiêu đề "Cùng mẫu: 5 đơn · cùng file thiết kế" và ô "Chọn cả nhóm", dùng với nút "Nhận chạy máy" hàng loạt có sẵn.

## 15. E4. Danh sách tự làm mới

**Mục tiêu.** Biết khi có đơn mới hoặc đơn vừa bị người khác nhận, không phải tự tải lại trang.

**Cách làm** (`orders.html`, `my-orders.html`, `my-orders-ve-file.html`):
- Mỗi 60 giây, khi tab đang hiện (và ngay khi quay lại tab), gọi lại đúng API danh sách với bộ lọc hiện tại, chạy ngầm.
- So với danh sách đang hiện: mã mới, mã mất đi, mã đổi trạng thái hoặc đổi người nhận.
- **Không tự vẽ lại** (tránh nhảy trang khi đang thao tác). Hiện thanh dính đầu trang: "Có 3 đơn mới, 2 đơn đã đổi trạng thái",
  kèm nút "Cập nhật danh sách". Khi vẽ lại thì giữ lựa chọn còn hợp lệ và vị trí cuộn (dùng chung G1).
- Ở mục "chưa ai nhận", thẻ của đơn vừa có người khác nhận được làm mờ ngay và ghi "Đã có người nhận", để không bấm trùng.

**Tải server.** API danh sách đọc qua `getAll` có bộ nhớ đệm. Đo lại thời gian phản hồi với 10 tab cùng hỏi 60 giây/lần trước khi bật.

## 16. A10. Nhắc tải EMB khi bấm "Đã vẽ file"

**Mục tiêu.** Nhắc người vẽ tải EMB lên ngay lúc vừa vẽ xong, để thư viện đủ EMB. Không bắt buộc.

**Chỗ nối.**
- `my-orders-ve-file.html`: nút "Đã vẽ file" từng đơn và hàng loạt (dòng 798).
- `order.html`: lưu trạng thái thủ công khi vẽ file đổi sang "Đã vẽ file".

**Cách làm.**
- Đổi trạng thái thành công thì gọi C1 cho các mã vừa đổi. Đơn chưa có EMB hiện trong một khung nhắc **không chặn** ở đầu trang:
  "3 đơn vừa xong chưa có EMB: 10LH72 [Tải EMB] · 9F13 [Tải EMB] … [Để sau]".
- Nút "Tải EMB" mở chọn file và gửi `POST /api/thu-vien/emb/:stt` có sẵn (đã có xác nhận mã lạ).
- Có link "Tải nhiều EMB theo tên file" sang khối tải lên của Tìm ảnh.
- Trang Quét không nhắc, để giữ tốc độ quét.

## 17. Y5. Cảnh báo đơn bị sửa sau khi đã làm

**Mục tiêu.** Seller sửa size, màu, link thiết kế… khi đơn đã vẽ hoặc đã lấy phôi thì xưởng biết ngay, tránh làm hỏng áo.

**Dữ liệu.**

| Bảng (`nhat_ky.db`) | Cột |
|---|---|
| `don_anh_chup` | `stt_key` (PK), `gia_tri` (JSON các cột theo dõi), `luc` |
| `canh_bao_sua_don` | `id`, `stt_key`, `truong`, `gia_tri_cu`, `gia_tri_moi`, `trang_thai_luc_do` (JSON 3 cột trạng thái), `luc` |

**Lịch 10 phút** đọc `getAll`:
- Đơn chưa có ảnh chụp thì chụp, không cảnh báo (lần chạy đầu chỉ chụp toàn bộ).
- Cột theo dõi (Q8) đổi giá trị thì luôn cập nhật ảnh chụp. Đơn đã ở bước "đã làm" (từ Đang vẽ file, Đã vẽ file, Đã lấy phôi, Đang
  chạy máy trở đi; chưa giao, chưa huỷ) thì thêm dòng `canh_bao_sua_don`.
- **Bỏ qua giá trị tạm của công thức Sheet:** giá trị mới rỗng hoặc bắt đầu bằng `#` (#REF!, #N/A…) thì không cảnh báo và không
  cập nhật ảnh chụp, chờ lượt sau. DUONG_DAN_URL là cột công thức sống nên dễ gặp trường hợp này.

**Hiển thị.**
- Trung tâm hành động, mục mới "Đơn bị sửa sau khi đã làm": "9F13: KICH_THUOC M → L lúc 14:20 (đơn đang Đã vẽ file)". Nút "Đã xử
  lý" (C2).
- Chi tiết đơn: dòng cảnh báo đỏ cho tới khi đánh dấu xử lý.
- Telegram vận hành (C3): gửi ngay.

**Kiểm thử.** Đổi KICH_THUOC của đơn "Chưa in mã" thì không cảnh báo. Đổi khi "Đã vẽ file" thì có cảnh báo. DUONG_DAN_URL thành
`#REF!` rồi trở lại như cũ thì không có cảnh báo nào.

## 18. Y6. Nhắc đơn đã nhận quá lâu

**Mục tiêu.** Đơn ai đó đã nhận ("Đang vẽ file", "Đang chạy máy") nhưng bỏ quên thì được nhắc và admin thu hồi được.

**Dữ liệu.** Cột mới `THOI_GIAN_NHAN_VE_FILE`, `THOI_GIAN_NHAN_CHAY_MAY` (SQLite `trang_thai_don`), đóng dấu trong
`orderService.update` ngay cạnh chỗ đang đóng dấu `NGUOI_VE_FILE` / `NGUOI_CHAY_MAY` (dòng 412–434). Đóng dấu cả khi admin chỉ định
người khác. Đơn đang dở lúc triển khai: điền một lần từ lịch sử hoạt động (lượt chuyển sang trạng thái đó gần nhất). Không tìm
được thì để trống và ghi "không rõ lúc nhận".

**Hiển thị** (ngưỡng trong Setting; Q9):
- Thẻ đơn ở Vẽ file / Chạy máy hiện "Đã nhận 30 giờ" (màu cam khi quá ngưỡng).
- Đầu trang của chính người nhận: "Bạn có 2 đơn đang vẽ quá 24 giờ".
- Trung tâm hành động, mục "Đơn nhận quá lâu": người nhận, số giờ, nút "Thu hồi" (chỉ admin) và "Đã xử lý" (C2).
- Telegram vận hành: tổng hợp mỗi ngày.

**Thu hồi.** Chỉ khi admin bấm, không tự động. Đơn về trạng thái theo Q10, qua route đổi trạng thái có sẵn và đúng kiểm tra hiện
tại. `NGUOI_VE_FILE` / `NGUOI_CHAY_MAY` giữ nguyên làm dấu vết, như quy ước hiện có.

## 19. Y14. Kiểm kê kho phôi

**Mục tiêu.** Đưa số tồn trong hệ thống về đúng số đếm thực tế, có lý do và lịch sử. Hiện kho chỉ có nhập kho và tự trừ.

**Giao diện** (`tai-san.html`, mục mới "Kiểm kê", Q11):
1. Bảng mọi tổ hợp phôi: Loại, Size, Màu, Tồn sổ sách, ô "Đếm thực tế" (để trống = không kiểm dòng đó).
2. Ô lý do chung, ghi chú từng dòng (tuỳ chọn).
3. Nút "Xem chênh lệch" liệt kê các dòng có chênh, rồi mới bấm "Áp dụng".

**API.** `POST /api/tai-san/kiem-ke` với `{ dong: [{ loai, kichThuoc, mauSac, thucTe, tonLucDem, ghiChu }], lyDo }`:
1. Mỗi dòng chạy trong khoá theo tổ hợp phôi có sẵn (`xepHangTheoToHopPhoi`), tránh mất lượt trừ kho chạy cùng lúc.
2. **Cộng chênh lệch, không ghi đè.** `tonMoi = tồn hiện tại + (thucTe − tonLucDem)`. Đơn "Đã lấy phôi" trong lúc đang đếm vẫn được
   tính đúng.
3. Ghi `TON_HIEN_TAI` vào tab Ton_Kho_Phoi bằng `updateCells`, giống Nhập kho hiện tại. Tổ hợp chưa có dòng thì thêm dòng như nhập kho.
4. Lịch sử lưu SQLite `kiem_ke_phoi` (lúc, người, tổ hợp, tồn sổ sách, thực tế, chênh lệch, tồn sau, lý do), không cần tạo tab Sheet
   mới. Kèm ghi log.

Có thêm mục "Lịch sử kiểm kê".

**Kiểm thử.** Tồn 10, đếm 8 thì tồn mới 8. Đang đếm có 1 đơn trừ kho (tồn 9) thì áp dụng ra 7. Dòng để trống không đổi.

## 20. Y20. Nút "Báo lỗi app"

**Mục tiêu.** Nhân viên báo lỗi ngay tại trang đang gặp, kèm đủ thông tin để sửa, không phải mô tả lại qua Zalo.

**Giao diện.** Nút "Báo lỗi" trên thanh menu (`renderNav`, mọi vai trò) mở khung:
- Mô tả (bắt buộc).
- Ảnh màn hình (tuỳ chọn): dán Ctrl+V, chọn file hoặc chụp trên điện thoại.
- Danh sách 10 báo lỗi gần nhất của chính người đó kèm trạng thái.

**Thông tin tự gửi kèm:**
- Trang đang mở, giờ, tài khoản, vai trò, trình duyệt, cỡ màn hình.
- 20 lỗi JavaScript gần nhất (`api.js` ghi từ `window.onerror` / `unhandledrejection` từ lúc mở trang).
- 10 lần gọi API lỗi gần nhất (`apiFetch` ghi lại đường dẫn, mã lỗi, thông báo).

**Server.** `POST /api/bao-loi` (ảnh tối đa 5 MB, chỉ PNG/JPEG theo magic bytes):
- Ảnh lưu MinIO `bao-loi/<năm-tháng>/<id>.<đuôi>`.
- Bảng SQLite `bao_loi_app`: `id`, `luc`, `nguoi`, `vai_tro`, `trang`, `mo_ta`, `anh_key`, `thong_tin` (JSON),
  `trang_thai` (MOI / DANG_XU_LY / DA_XONG), `ghi_chu_xu_ly`.
- Tối đa 20 báo lỗi mỗi người mỗi ngày.

**Superadmin.** Trang Logs thêm tab "Báo lỗi từ nhân viên": danh sách, xem ảnh qua proxy có kiểm quyền, đổi trạng thái, ghi chú.
Báo lỗi mới gửi Telegram vận hành (C3) nếu đã cấu hình.

---

## 21. Kiểm thử chung và giới hạn

- **Phần thư viện** (A1, A2, A3, B2, B4, C1, D1, E3): thêm vào `scripts/kiem-tra-thu-vien.js`, chạy với CSDL tạm và MinIO giả như
  hiện có.
- **Quy tắc cảnh báo** (F1, G4, L2, Y5, Y6) viết thành hàm thuần (đầu vào là các dòng đơn, đầu ra là danh sách cảnh báo), kiểm thử
  bằng một script `scripts/kiem-tra-canh-bao.js` với dữ liệu giả.
- **Giao diện** (G1, E4, U2, X1, T5, Y14, Y20) kiểm trên server giả qua trình duyệt trong app.
- **Không kiểm được ở đây:** Google Sheets thật (Y14 ghi Ton_Kho_Phoi, Y5 đọc thay đổi thật), GKE thật (L2), Telegram thật (C3).
  Phần này phải thử trên server thật sau khi deploy, với dữ liệu thật của xưởng.
