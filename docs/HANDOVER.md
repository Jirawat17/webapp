# PROJECT HANDOVER DOCUMENT

> Cập nhật: 02/10/2026. Viết từ việc đọc source code thực tế tại `D:\n8n_data\webapp` (branch `main`, ~402 commit) và lịch sử
> làm việc với người dùng. Mục nào không xác minh được ghi **CHƯA XÁC ĐỊNH**. Không chứa secret — mọi key/token/password = `<REDACTED>`.
> Người dùng (chủ xưởng, superadmin) giao tiếp bằng **tiếng Việt**; code, comment, tên biến đều tiếng Việt không dấu/có dấu.

---

## 1. Project Overview

**Là gì:** Web app quản lý **xưởng thêu** (thêu áo/mũ… bán qua Etsy/sàn TMĐT của các "Team"/Seller), thay AppSheet cũ.
Dữ liệu đơn hàng gốc vẫn nằm ở **Google Sheets**; app đọc Sheet + lưu các cột do app tự ghi vào **SQLite**.

**Người dùng (5 vai trò):** `superadmin` (chủ, toàn quyền), `admin` (quản lý — bị giới hạn theo Xưởng), `ve_file` (vẽ file thêu),
`san_xuat` (chạy máy thêu), `nguoi_lay_phoi` (lấy phôi áo).

**Quy trình chính:**
Seller nhập đơn vào Sheet riêng → (IMPORTRANGE) tab `<TEAM>_RAW` → (QUERY/VSTACK) tab `Don_Hang_ALL` → app đọc → tự gán Xưởng theo Team →
in mã QR (Đã in mã) → lấy phôi + vẽ file (song song, 2 cột riêng) → ĐÃ SẴN SÀNG CHẠY MÁY (tự động) → Đang chạy máy → chụp **Ảnh đã sản xuất**
(→ Đã sản xuất) → mua tracking **GKE** (tự động/tay) + in label → chụp **Ảnh đã dán tem** (→ ĐÃ DÁN TEM) → DELIVERED.
AI QC (QC1 vẽ file / QC2 sản xuất / QC3 dán tem) chạy tay hoặc tự động.

**Module chính:** Đơn hàng (danh sách/chi tiết/lọc/hàng loạt), Quét QR + kịch bản quét, Chụp ảnh (MinIO), Tracking GKE (tự động + tay + in label),
Đơn hàng loạt (gom đơn trùng thiết kế bằng perceptual hash), DonNhieuAo (nhiều đơn cùng OrderID dùng chung tracking), Đồng bộ Sheet Seller
(ghi ngược tracking/ghi chú/Delivered), AI QC (Gemini/Claude/Vertex), Cảnh báo Telegram, Báo cáo/PDF/Excel, Chatbot (LLM), Trung tâm hành động,
Bảng điều khiển, Kho phôi (tài sản), Quản lý nhân viên, Settings, Logs, Backup SQLite.

**Hệ thống ngoài:** Google Sheets API + Google Drive API (Service Account), MinIO (S3) trên Zima NAS, GKE Logistics OpenAPI, Telegram Bot API,
Google Gemini (AI Studio REST + Agent Platform/Vertex REST), Anthropic Claude Messages API, LLM proxy OpenAI-compatible (chatbot).

---

## 2. Architecture

| Thành phần | Thực tế |
|---|---|
| Frontend | HTML tĩnh + vanilla JS (không framework, không build). `public/*.html`, dùng chung `public/js/api.js` (nav, apiFetch, helpers), `public/css/style.css`. Cache-bust bằng `?v=` (api.js **v109**, style.css **v107**) |
| Backend | Node.js (Docker `node:20-alpine`, `engines >=18`), Express 4 + `express-async-errors`, `express-session` (**memory store → chỉ chạy 1 container**) |
| Database | SQLite qua **better-sqlite3** (không ORM, SQL tay). 6 file trong `data/` (xem §4) |
| Nguồn đơn | Google Sheet (`SHEET_ID`), tab `Don_Hang_ALL` — **app không ghi** vào tab này (là kết quả công thức) |
| Auth | Session cookie; đăng nhập bằng **tên** (+ mật khẩu nếu tài khoản có `MatKhau`). `middleware/auth.js` |
| File storage | MinIO S3-compatible (AWS SDK v3), 1 bucket, key `orders/{ma-don}/...`; app trả URL proxy `/api/photos/file/<objectKey>` |
| Scheduler | `node-cron` trong cùng process (xem §19). Không có queue riêng |
| AI | `services/qc/*` (QC); chatbot qua `LLM_API_URL` |
| PDF/ảnh | pdfkit, pdf-lib, qrcode, sharp, puppeteer-core + Chromium (Alpine) |

**Data flow chung:** User → HTML page → `apiFetch('/api/...')` → `routes/*.js` → `services/*.js` →
`orderService.getAll()` (Sheet `readTabCached` 10s + overlay SQLite `trang_thai_don`) / ghi SQLite / gọi API ngoài → JSON → render.

**Ghi dữ liệu:** mọi cột "app tự ghi" (trạng thái, ảnh, tracking, Xưởng…) → **SQLite `trang_thai_don`** (không ghi Sheet chính).
Muốn Seller thấy (tracking, ghi chú xưởng, Delivered) → `sheetSellerService` ghi thẳng vào **Sheet của Seller**.

### Cột Google Sheet `Don_Hang_ALL` (theo file xuất tháng 7/2026 — cột thật có thể đã thêm, CHƯA XÁC ĐỊNH bản hiện tại)
`HANG_VAN_CHUYEN2, TRACKING_ID2, TINH_TRANG, NGAY_LEN_DON, STT_Key, TEN_DIA_CHI, MA_DON_HANG_ORDERID, DUONG_DAN_URL (PNG/Design – link Drive file/thư mục), MOCKUP, LOAI, KICH_THUOC, MAU_SAC, VI_TRI_1, SO_LUONG, SO_LUONG_AO_TREN_DON, GHI_CHU, GHI_CHU_XUONG, TEN, SDT, DIA_CHI_TEN_DUONG, DIA_CHI_TEN_DUONG_2, DIA_CHI_TEN_TP, DIA_CHI_BANG, MA_ZIPCODE, DIA_CHI_NUOC, QUOC_GIA_TRACKING, MA_IOSS, PRICE, DISCOUNT, ADDED_COST, GhiChuTinhGia, TOTAL, PAYMENT, CashBack, NgayAddTracking, NgayGuiHangVanChuyen, Delivered, MaHangVanChuyen, MaShop, TAM_THOI`
Tab khác code dùng: `CONFIG` (TEAM → Spreadsheet ID, Tab của Sheet Seller), `Khach_Hang`, `Ton_Kho_Phoi`, `LichSuNhapPhoi`, `<TEAM>_RAW`.
Code đọc theo **tên cột dòng 1**, không theo vị trí. `TAM_THOI` bắt buộc tồn tại để mua tracking.

---

## 3. Source Code Structure

```
server.js                 Khởi động Express, mount routes, bật các cron job
middleware/auth.js        requireLogin, requireRole, requireExactRole, laAdmin, laSuperAdmin
data/pipelineTinhTrang.js Danh sách trạng thái + thứ tự pipeline (TINH_TRANG_VALUES...)
data/scenarios.js         (kịch bản quét cũ — giờ ở SQLite kich_ban.db)
routes/                   API (xem bảng dưới)
services/                 Business logic
services/qc/              AI QC: qcService, qcAutoService, aiProvider, geminiProvider, claudeProvider
public/                   Frontend (mỗi menu 1 file html)
scripts/                  migrate-*.js (Sheets→SQLite 1 lần), chẩn đoán, khôi phục
docs/superpowers/specs/   56 file thiết kế theo ngày (nguồn tra cứu lý do quyết định)
n8n-workflows/, config/   CHƯA XÁC ĐỊNH vai trò hiện tại (không thấy code app dùng)
```

### File / function quan trọng

| FILE | FUNCTION | Vai trò |
|---|---|---|
| `services/orderService.js` | `getAll({fresh,ttlMs})` | Đọc Sheet (cache 10s; `fresh:true` bỏ cache) + overlay SQLite + lọc `DA_XOA` + `tuGanXuongTheoTeam` + `dongBoDaMuaTracking` |
| | `update(sttKey, updates, user, {quaAnh, boQua, donDaDoc})` | **Cửa duy nhất đổi trạng thái/cột đơn**: khoá theo đơn (`xepHangTheoDon`), `kiemTraTinhHopLy`, tự tính phôi/vẽ file khi in mã, tự "ĐÃ SẴN SÀNG CHẠY MÁY", ghi mốc `THOI_GIAN_IN_MA / _SAN_XUAT / _VE_FILE / _DAN_TEM`, huỷ cả nhóm DonNhieuAo, ghi log |
| | `kiemTraTinhHopLy` | Từ "ĐÃ SẴN SÀNG CHẠY MÁY" trở đi bắt buộc `Đã lấy phôi` + `Đã vẽ file`; "Chưa in mã" không được "Đã lấy phôi" |
| | `filterForRole`, `locTheoXuong`, `coQuyenTheoXuong` | Phạm vi xem/thao tác theo vai trò + Xưởng |
| | `anCotTheoDoiMuaTracking` | Ẩn `TU_MUA_*` + `THONG_TIN_GKE_CHO_DON_LOI` với vai trò không có menu Tracking |
| `services/trangThaiDbService.js` | `CAC_COT`, `ghiDe`, `ghiDeNhieu`, `layTatCa`, `layTheoKey` | Bảng `trang_thai_don`; thêm tên vào `CAC_COT` = tự ALTER thêm cột |
| `services/sheetsService.js` | `readTab`, `readTabCached`, `updateCells`… | Google Sheets API |
| `services/sheetSellerService.js` | `ghiHangLoat` | Ghi Sheet Seller đúng ô (GHI_CHU→GHI_CHU_XUONG, TRACKING→TRACKING_ID2+HANG_VAN_CHUYEN2, DELIVERED→Delivered); log `dong_bo_sheet_seller` |
| `services/donNhieuAoService.js` | `phanTichStt` (chặt), `layTeam` (lỏng), `layNhomCuaDon`, `xayDungBanDoNhom` | Team + nhóm DonNhieuAo |
| `services/gkeService.js` | `layCauHinhGkeChoDon`, `taoDonGke`, `layTemIn`, `layLichSuTrackingGke`, `thongTinNguoiNhan`, `diaChiGuiGke`, `duocMuaTrackingTheoQuocGia` | GKE API |
| `services/trackingAutoService.js` | `muaTrackingChoDon`, `chayQuetTuDongMuaTracking`, `thoiDiemDenHan`, `layDonChuyenThuCong`, `choTuDongThuLai`, `suaThongTinGke`, `apDungThongTinGke`, `inLabelChoDon`, `muaTrackingVaInLabelChoDon`, `chayQuetCapNhatTrangThaiTracking` | Toàn bộ nghiệp vụ tracking |
| `services/trackingJob.js` | `batDauLichTracking` | Cron mua tracking (2 phút) + cập nhật trạng thái tracking (5 phút) |
| `services/qc/qcService.js` | `chayQc`, `quyetDinhKetQua`, `chuanHoaAi`, `hoanThienKetQua3`, `hoanThienKetQuaDoiChieu`, `chayQc3`, `chayDoiChieu`, `layCauHinh`, `layNguong`, `kiemTraNguong`, `canhBaoTelegram`, `guiThuTelegram`, `thuKetNoi` | AI QC |
| `services/qc/qcAutoService.js` | `chayLuotAutoQc`, `batDauLichAutoQc`, `layCauHinhAuto`, `luuCauHinhAuto`, `QUY_TAC` | Auto QC |
| `services/qc/aiProvider.js` | `phanTichAnh(thamSo, ncc)`, `thuKetNoi` | Registry `{gemini, claude, vertex}` |
| `services/qc/geminiProvider.js` | `taoProvider({ten, diaChiApi})`, export `phanTichAnh/thuKetNoi` (AI Studio) + `vertex` | Gemini REST |
| `services/qc/claudeProvider.js` | `phanTichAnh`, `thuKetNoi`, `sangSchemaClaude` | Anthropic Messages API (tool use ép JSON) |
| `services/storageService.js` | `uploadImageBuffer`, `getObjectBuffer`, `getObjectStream`, `tonTaiObject`, `proxyUrlToObjectKey` | MinIO |
| `services/anhNguonService.js` | `taiAnh`, `taiDsAnh` | Tải ảnh từ MinIO / Drive / link Gemini / HTTP |
| `services/driveService.js` | `layChiTietAnhThuMucDrive`, `taiFileDriveTheoId` | Đọc thư mục/ảnh Drive (Design/Mockup) |
| `services/thueTeamKhacService.js` | `chuanHoaAnh` (sharp → JPEG ≤1400px), `ghiChuXuongHienThi`, `tachLink` | PDF thuê team khác + helper ảnh dùng chung QC |
| `services/caiDatDbService.js` | cấu hình tracking/GKE/Xưởng/Team/nhóm hàng/QC | `cai_dat.db` |
| `services/nhatKyDbService.js` | lịch sử hoạt động, logs_tracking, qc_log, qc_auto, đồng bộ Seller | `nhat_ky.db` |
| `services/logService.js` | `ghiLog`, `layLichSuTheoDon` (ẩn hành động giới hạn với vai trò không có menu Tracking) | Lịch sử |
| `services/moTaLichSu.js` | `moTaLichSu` | Mô tả tiếng Việt từng hành động lịch sử |
| `services/telegramService.js` | `guiTinNhan(chatId, text, botToken=env)` → `{ok, loi}` (không bao giờ reject), `guiCanhBao` | Telegram |
| `services/taiKhoanService.js` | `cacXuongCuaNguoiDung`, `themMoi`… | `tai_khoan.db` |
| `routes/photos.js` | `/kiem-tra`, `/upload`, `/file/*` | Chụp/tải ảnh + tự chuyển trạng thái |
| `routes/tracking.js` | `/mua-thu-cong`, `/canh-bao-thu-cong`, `/cho-tu-dong-lai`, `/thong-tin-gke`, in label… | Tracking |
| `routes/qc.js` | `/cau-hinh`, `/thu-ket-noi`, `/telegram`, `/telegram/gui-thu`, `/nguong`, `/auto`, `/chay`, `/log` | **Toàn bộ chỉ superadmin** (`requireExactRole('superadmin')`) |
| `routes/orders.js` | danh sách, chi tiết, `PUT /:sttKey` (sửa đơn — có `TRUONG_CAM_SUA`), hàng loạt, quét hàng loạt, ghi chú xưởng, Xưởng/Team | Đơn hàng |
| `routes/donHangLoat.js` | `/goi-y` (+ `DELETE /goi-y/:maNhom`), CRUD nhóm | Đơn hàng loạt (requireRole('ve_file')) |
| `public/js/suaThongTinGke.js` | `htmlSuaThongTinGke`, `luuThongTinGke`, `xoaThongTinGke` | Ô sửa dữ liệu gửi GKE (dùng ở tracking.html + orders.html) |

---

## 4. Database

Engine: **SQLite (better-sqlite3)**, WAL. Không migration framework: mỗi module tự `CREATE TABLE IF NOT EXISTS` + tự `ALTER TABLE ADD COLUMN`
khi khởi động. Không có foreign key. Đường dẫn file đổi được qua env (`*_DB_PATH`) — **tests dùng thư mục tạm, KHÔNG BAO GIỜ trỏ vào `data/` thật**.

### `trang_thai_don.db` (SQLITE_DB_PATH) — overlay đơn hàng
`trang_thai_don`: **stt_key (PK)**, TRANG_THAI_PHOI, TRANG_THAI_VE_FILE, QUOC_GIA, MA_CODE_STT, MA_KHACH_HANG, NGUOI_VAN_HANH,
Anh_File_Theu_URL, Anh_File_Theu_URL_2, Anh_File_Theu_URL_3, Anh_Da_San_Xuat_URL, TRONG_LUONG, TRANG_THAI_XUONG, Anh_Da_Dan_Tem_URL,
NGUOI_VE_FILE, GHI_CHU_VE_FILE, NGUOI_CHAY_MAY, GHI_CHU_CHAY_MAY, HASH_ANH_MAU, NHOM_HANG_LOAT, AUTO_TRACKING (không còn dùng), THOI_GIAN_IN_MA,
IN_LABEL, THOI_GIAN_IN_LABEL, DON_UU_TIEN, TAM_THOI, THOI_GIAN_SAN_XUAT, **THOI_GIAN_VE_FILE**, **THOI_GIAN_DAN_TEM**, HANG_VAN_CHUYEN, TRACKING_ID,
TRANG_THAI_TRACKING, THOI_GIAN_CAP_NHAT_TRACKING, MA_NODE_TRACKING, MA_TRANG_THAI_NODE_TRACKING, KHACH_HANG, XUONG, NguoiCapNhatCuoi,
ThoiGianCapNhatCuoi, TRACKING_CHUNG_CUA, DA_MUA_TRACKING, TAI_KHOAN_GKE, TU_MUA_SO_LAN_THU, TU_MUA_CHE_DO, TU_MUA_LOI_GAN_NHAT,
TU_MUA_THOI_GIAN_THU, **THONG_TIN_GKE_CHO_DON_LOI** (JSON), GHI_CHU_XUONG_NOI_BO, CanhBaoDaGui, DA_XOA.
Cột SQLite **trùng tên cột Sheet sẽ đè giá trị Sheet** khi gộp — vì vậy ghi chú xưởng trong app tên là `GHI_CHU_XUONG_NOI_BO`, không phải `GHI_CHU_XUONG`.

### `cai_dat.db` (CAI_DAT_DB_PATH)
- `cau_hinh_tracking` (id=1): BatTuDongMuaTracking, SoPhutCho, SoGioSauInMa (mặc định 48), MocApDungTheoInMa, SoPhutQuetTrangThai, ThoiDiemQuetTrangThaiGanNhat, DaChuyenTaiKhoanGke, Gke* (cũ — đã chuyển sang tai_khoan_gke), CanNangMoiAoKg
- `tai_khoan_gke`: id(PK), Ten, GkeUsername, GkePassword (plaintext), GkeServiceCode, Shipper*, Customs*, CanNangMoiAoKg
- `danh_sach_xuong`: Ten(PK), TaiKhoanGke (Xưởng → tài khoản GKE)
- `team_xuong_mac_dinh`: Team(PK), Xuong
- `cai_dat_mau_xuong`: Xuong(PK), Mau
- `cai_dat_canh_bao`: NGUONG_VANG/CAM/DO; `cai_dat_nen_anh`: ChatLuongJpeg, CanhDaiToiDa; `cai_dat_hang_loat`: NGUONG_HAMMING
- `nhom_hang_loai`: id, Ten, Nhom, TuKhoa; `cai_dat_nhom_hang`: NhomLoaiTrong ('' = Chưa phân loại / Nhóm 1 / Nhóm 2)
- `qc_cau_hinh`: **Loai(PK: QC1/QC2/QC3)**, NhaCungCap (gemini|claude|vertex, '' = gemini), ApiKey/Model (Gemini AI Studio), ApiKeyClaude/ModelClaude, ApiKeyVertex/ModelVertex, NguongPass/NguongFail/NguongCcl ('' = mặc định 85/40/70), AutoBat ('TRUE'/''), AutoGio, AutoPhut. **API key lưu plaintext (người dùng đồng ý), chỉ trả ra UI dạng che.**
- `qc_canh_bao_telegram` (id=1): ChatId, BotToken
- `qc_auto_moc` (id=1): MocApDung (ISO, ghi 1 lần ở lần khởi động đầu tiên có tính năng)

### `nhat_ky.db` (NHAT_KY_DB_PATH)
- `lich_su_hoat_dong`: id, ThoiGian, NguoiDung, VaiTro, HanhDong, STT_Key, ChiTiet(JSON). Index STT_Key/NguoiDung/HanhDong. Mô tả: `moTaLichSu.js`
- `logs_tracking`: id, ThoiGian, STT_Key, Nguon, NguoiDung, VaiTro, KetQua, TRACKING_ID, HANG_VAN_CHUYEN, ChiTiet (chứa **body thật gửi GKE**)
- `dong_bo_sheet_seller`: log ghi Sheet Seller (ô trước → sau)
- `nhat_ky_quet_hang_loat`
- `qc_log`: id, ThoiGian, NguoiDung, STT_Key, LoaiQc, Model, AnhDaDung, FileTheu, DesignFile, MockupFile, KetQua (PASS/FAIL/CAN_CHECK_LAI/LOI), DoTinCay (0–1), LyDo, ChiTiet (JSON `{ket_qua, ai_goc}`), LoiApi, Diem, AiDeXuat, NguongDaDung, LyDoKetLuan, CheDo (MANUAL/AUTO; '' cũ = MANUAL), ThoiGianKetThuc, ThongTinAuto (JSON). Index STT_Key
- `qc_auto`: **PK (STT_Key, LoaiQc)**, TrangThai (DANG_CHAY/XONG/LOI), SoLanThu, LanThuCuoi (ISO UTC), KetQua, QcLogId

### Khác
- `tai_khoan.db`: `nguoi_dung` (Ten PK, VaiTro, Team, Xuong (nhiều Xưởng tách dấu phẩy), KichHoat, MatKhau, HienThiDangNhap). Bảng trống → không ai đăng nhập được (chạy `scripts/migrate-nguoi-dung-tu-sheets.js --apply`)
- `don_hang_loat.db`: `dhl_nhom`, `dhl_thanh_vien` (STT_Key PK — 1 đơn thuộc tối đa 1 nhóm), `dhl_bo_dem`
- `kich_ban.db`: `cau_hinh_kich_ban` (kịch bản quét QR: trạng thái yêu cầu → sau, cột, người thực hiện)

Backup: `services/backupDbService.js` cron mỗi giờ (`0 * * * *`), SQLite online backup → `data-backups/` (volume riêng).

---

## 5. Business Logic

### Order
- **Tạo đơn:** KHÔNG tạo trong app. Seller nhập Sheet riêng → RAW → `Don_Hang_ALL` (Apps Script/công thức ngoài app — CHƯA XÁC ĐỊNH chi tiết Apps Script).
- **STT_Key:** `<tháng 1–2 số><TEAM chữ cái><số thứ tự>[.n | ,n]`, vd `10U1`, `9F13.1`, `9F13,2`, `10TRA5332sdafn`.
  - `layTeam` (lỏng, regex `/^\d{1,2}([A-Za-z]+)\d/`): dùng cho Xưởng mặc định theo Team + Sheet Seller.
  - `phanTichStt` (chặt, `/^(\d{1,2})([A-Za-z]+)(\d+)(?:[.,](\d+))?$/`): **chỉ** dùng cho DonNhieuAo.
- **Trạng thái chung `TRANG_THAI_XUONG`:** `Chưa in mã → Đã in mã → ĐÃ SẴN SÀNG CHẠY MÁY → Đang chạy máy → Đã sản xuất → ĐÃ DÁN TEM → DELIVERED_Đã giao đến khách`;
  nhánh: `LỖI SẢN XUẤT CẦN LÀM LẠI`, `CANCELLED_Đã hủy`, `REFUNDED_Hoàn đơn`.
- `TRANG_THAI_PHOI`: Chưa lấy phôi | Đã lấy phôi. `TRANG_THAI_VE_FILE`: Chưa vẽ file | Đang vẽ file | Đã vẽ file (**giữ nguyên "Đã vẽ file" suốt các bước sau**).
- **Tự động:** Đã in mã + Đã lấy phôi + Đã vẽ file → "ĐÃ SẴN SÀNG CHẠY MÁY" (chỉ lần đầu từ "Đã in mã"); upload Ảnh đã sản xuất (yêu cầu đang "Đang chạy máy") → "Đã sản xuất";
  upload Ảnh đã dán tem (yêu cầu "Đã sản xuất" + **phải có TRACKING_ID thật**) → "ĐÃ DÁN TEM". Không có tự động sang DELIVERED (trừ cập nhật trạng thái tracking — CHƯA XÁC ĐỊNH có tự đổi TRANG_THAI_XUONG hay không).
- **Mốc thời gian** (ghi trong `orderService.update` khi vừa chuyển sang): THOI_GIAN_IN_MA, THOI_GIAN_SAN_XUAT, THOI_GIAN_VE_FILE, THOI_GIAN_DAN_TEM (định dạng ISO +07:00). Các cột này nằm trong `TRUONG_CAM_SUA` (không sửa tay được).
- **Huỷ 1 đơn DonNhieuAo = huỷ cả nhóm** (chặn nếu nhóm có đơn đã ĐÃ DÁN TEM/DELIVERED).
- **Lịch sử:** mọi thay đổi ghi `lich_su_hoat_dong`; trang chi tiết đơn hiển thị timeline.
- **Xoá đơn:** soft delete `DA_XOA='TRUE'` (chỉ superadmin, `xoaDuLieuDonService`).

### Workshop (Xưởng) / Team
- Xưởng là danh sách động (`danh_sach_xuong`), hiện dùng **HN, BN** (CHƯA XÁC ĐỊNH đầy đủ danh sách thật trên production).
- **Tự gán Xưởng theo Team:** đơn có `XUONG` rỗng + Team có trong `team_xuong_mac_dinh` → ghi Xưởng lúc đọc (`tuGanXuongTheoTeam`). Đổi cấu hình **không** chuyển đơn đã gán. Team chưa cấu hình → "chưa gán".
- **Phạm vi:** superadmin thấy mọi đơn; **mọi vai trò khác (kể cả admin) chỉ thấy đơn cùng Xưởng**; đơn chưa gán Xưởng hoặc người dùng chưa có Xưởng → không thấy.
- `san_xuat` chỉ thấy đơn từ "ĐÃ SẴN SÀNG CHẠY MÁY" trở đi + "LỖI SẢN XUẤT CẦN LÀM LẠI".
- Mỗi Xưởng gán 1 tài khoản GKE (`danh_sach_xuong.TaiKhoanGke`); đơn đã tạo vận đơn dùng `TAI_KHOAN_GKE` của chính đơn.

### Nhóm hàng
Bộ lọc theo LOAI ↔ keyword (`nhom_hang_loai`), so khớp nguyên giá trị đã chuẩn hoá; LOAI trống thuộc nhóm theo Settings "Đơn có LOAI trống thuộc" (mặc định Chưa phân loại).

### Tracking (xem §9)
### QC (xem §6, §11)

---

## 6. Auto QC (implementation hiện tại — `services/qc/qcAutoService.js`)

- **Cron:** `*/2 * * * *`, bật 1 lần trong `server.js` (`batDauLichAutoQc`). Khoá trong bộ nhớ `dangChay` chống 2 lượt chồng nhau. Khởi động: `donDepAutoQcDangChay()` chuyển DANG_CHAY → LOI.
- **Cấu hình:** `qc_cau_hinh.AutoBat/AutoGio/AutoPhut` mỗi QC; mặc định **TẮT, 0 giờ 5 phút**; giờ 0–720, phút 0–59. UI menu QC, API `GET/POST /api/qc/auto`.
- **Mốc áp dụng:** `qc_auto_moc.MocApDung` — chỉ đơn có mốc chuyển trạng thái **≥ mốc** (người dùng chốt: không QC hàng loạt đơn cũ).

| | QC1 | QC2 | QC3 |
|---|---|---|---|
| Trạng thái (QUY_TAC.trangThai) | `TRANG_THAI_VE_FILE = 'Đã vẽ file'` và XUONG ∉ {CANCELLED, REFUNDED} | XUONG ∈ {Đã sản xuất, ĐÃ DÁN TEM, DELIVERED_Đã giao đến khách} | XUONG ∈ {ĐÃ DÁN TEM, DELIVERED_Đã giao đến khách} |
| File | ≥1 trong `Anh_File_Theu_URL`, `_2`, `_3` **tồn tại thật** | `Anh_Da_San_Xuat_URL` tồn tại thật | `Anh_Da_Dan_Tem_URL` (của chính đơn) tồn tại thật |
| Mốc tính chờ | `THOI_GIAN_VE_FILE` | `THOI_GIAN_SAN_XUAT` | `THOI_GIAN_DAN_TEM` |

(QC2/QC3 chấp nhận đơn đã sang bước sau — người dùng chốt "Vẫn QC nếu đã qua".)

- **Điều kiện chạy:** mốc tồn tại, mốc ≥ MocApDung, `now ≥ mốc + chờ`, đúng trạng thái, có URL ảnh, chưa có dòng `qc_auto` (hoặc LOI còn lượt thử).
- **Kiểm tra file thật:** `storageService.tonTaiObject` (HEAD). Không tồn tại → bỏ qua lượt này, **không** đánh dấu (lượt sau xét lại). Link ngoài MinIO (Drive cũ) → coi là có. Lỗi mạng/MinIO → bỏ qua đơn ở lượt này.
- **Mỗi QC tối đa 10 đơn/lượt**, sắp theo mốc cũ trước, chạy tuần tự.
- **Chống trùng (DB-level):** `nhatKyDbService.giuQuyenAutoQc` = `INSERT OR IGNORE` (lần đầu) hoặc `UPDATE … WHERE TrangThai='LOI' AND SoLanThu<3 AND LanThuCuoi<=now-30ph` (thử lại) — 1 câu lệnh nguyên tử; `changes===1` mới chạy. Khoá (STT_Key, LoaiQc) → QC1/QC2/QC3 độc lập.
- **Chạy:** `qcService.chayQc({sttKey, loai, user:{ten:'Hệ thống (Auto QC)', vaiTro:'superadmin'}, cheDo:'AUTO', thongTinAuto})`.
- **Kết quả:** có kết quả (PASS/FAIL/CAN_CHECK_LAI, kể cả CAN_CHECK_LAI do không gọi AI) → `XONG`, không bao giờ chạy lại. Lỗi kỹ thuật (`kq.loi` hoặc exception) → `LOI`; **thử lại tối đa 2 lần (tổng 3), cách ≥ 30 phút**, sau đó dừng hẳn.
- **Ngưỡng QC đang lỗi** → bỏ cả loại QC trong lượt, không tiêu lần thử.
- **Đơn đã QC thủ công** → auto **vẫn chạy** (người dùng chốt).
- **Log:** `qc_log` với `CheDo='AUTO'`, `ThoiGianKetThuc`, `ThongTinAuto` = {trang_thai_luc_qc, moc_chuyen_trang_thai{trang_thai,cot,luc}, thoi_gian_cho, lan_thu, so_lan_toi_da, anh_dieu_kien, thoi_diem_upload (từ lịch sử UPLOAD_ANH)}. Telegram như QC thủ công.
- **Hạn chế đã biết:** đơn con DonNhieuAo không có ảnh dán tem riêng → không Auto QC3 (QC3 thủ công vẫn dùng ảnh của nhóm).

---

## 7. APIs & External Services

| Service | Mục đích | Base URL | Auth | Ghi chú |
|---|---|---|---|---|
| Google Sheets/Drive | Đọc đơn, ghi Sheet Seller, đọc ảnh Design/Mockup | googleapis | Service Account JSON (`GOOGLE_SERVICE_ACCOUNT_KEY_PATH`, mount `service-account.json`) | `SHEET_ID` |
| MinIO | Lưu ảnh | `MINIO_ENDPOINT` (LAN Zima) | `MINIO_ACCESS_KEY/SECRET_KEY=<REDACTED>` | 1 bucket `MINIO_BUCKET` |
| GKE Logistics | Tạo vận đơn, in tem, tra tracking | `https://order.gkelogistics.com/openapi/customer` | `POST /auth/login/` → Bearer token (cache 12h/tài khoản) | §9 |
| Telegram | Cảnh báo | `api.telegram.org` | `TELEGRAM_BOT_TOKEN=<REDACTED>` (+ token QC riêng trong DB) | `guiTinNhan` không reject |
| Gemini AI Studio | QC | `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | header `x-goog-api-key` | key trong `qc_cau_hinh` |
| Gemini Agent Platform/Vertex | QC (dùng credits GCP) | `aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent` (global) | header `x-goog-api-key` | **chưa test với key thật** |
| Anthropic Claude | QC | `api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01` | `x-api-key` | tool use bắt buộc để ép JSON |
| LLM proxy | Chatbot | `LLM_API_URL` (OpenAI-compatible) | `LLM_API_KEY=<REDACTED>` | `LLM_MODEL`, `LLM_MODEL_MANH` |

---

## 8. Google Sheets

- Đọc: `sheetsService.readTabCached('Don_Hang_ALL', 10000)` (cache 10s; `fresh:true` khi cần dữ liệu mới, vd mua tracking, QC).
- Mapping: mỗi dòng → object theo tiêu đề dòng 1; khoá `STT_Key`; overlay SQLite; bỏ dòng `STT_Key` trống và `DA_XOA='TRUE'`.
- **App không ghi `Don_Hang_ALL`/RAW.** Ghi ra ngoài duy nhất qua `sheetSellerService` vào Sheet Seller (tìm theo tab CONFIG; đúng 1 dòng khớp mới ghi; ghi RAW để không hỏng mã tracking 22 số).
- Không có cron sync Sheet riêng — đọc theo yêu cầu.
- **Vấn đề dữ liệu đã thấy (file tháng 7):** 134/347 đơn có `DIA_CHI_TEN_DUONG_2`, phần lớn bị **lệch cột** (thành phố nằm ở DUONG_2, bang ở TP, ZIP ở BANG, nước ở ZIP, NUOC trống; 33 đơn lệch 2 cột, mất số nhà). Ví dụ người dùng gửi từ dữ liệu hiện tại thì đúng cột (`2037 VININGS CIR APT | 311 APT | Wellington | FL | 33414 | US`). **Mức độ lệch trên dữ liệu hiện tại: CHƯA XÁC ĐỊNH.** Nguyên nhân nằm ở bước nạp Sheet (ngoài app).
- Cột `TEN_DIA_CHI` trong dữ liệu tháng 7 chứa **tên người** (trùng `TEN`) nhưng code vẫn dùng làm fallback địa chỉ khi `DIA_CHI_TEN_DUONG` trống (giữ nguyên để backward compatible).

---

## 9. GKE Integration

- **Tài khoản:** bảng `tai_khoan_gke`, gán cho Xưởng (`danh_sach_xuong.TaiKhoanGke`); `layCauHinhGkeChoDon(row)`: dùng `row.TAI_KHOAN_GKE` nếu đã tạo vận đơn, đơn cũ có tracking không có id → tài khoản id `1`; đơn chưa gán Xưởng/Xưởng chưa gán tài khoản → lỗi chung. Env `GKE_*` chỉ dùng 1 lần để chuyển cấu hình cũ sang DB (`chuyenCauHinhCuSangTaiKhoan`).
- **Khi nào tự mua** (`trackingAutoService.thoiDiemDenHan`, cron 2 phút, bật/tắt + số phút + số giờ ở trang Tracking): điều kiện nào đến trước:
  1. XUONG ∈ {Đã sản xuất, ĐÃ DÁN TEM} và `now ≥ THOI_GIAN_SAN_XUAT + SoPhutCho`;
  2. XUONG ∈ {Đã in mã, ĐÃ SẴN SÀNG CHẠY MÁY, Đang chạy máy, Đã sản xuất, LỖI SẢN XUẤT CẦN LÀM LẠI, ĐÃ DÁN TEM} và `THOI_GIAN_IN_MA ≥ MocApDungTheoInMa` và `now ≥ THOI_GIAN_IN_MA + SoGioSauInMa` (mặc định 48h).
  Loại: đã có TRACKING_ID, `TU_MUA_CHE_DO='THU_CONG'`, đơn con DonNhieuAo/nhóm lỗi, quốc gia ∉ {US, UK}.
- **Giới hạn 10 lần tự động:** chỉ đếm lỗi riêng của đơn từ bước gọi GKE (không đếm `err.loiChung`); lần 10 → `TU_MUA_CHE_DO='THU_CONG'`, hộp đỏ ở Tracking + Danh sách đơn (admin/superadmin/ve_file), nút "Mua ngay", "Cho tự động thử lại".
- **Luồng mua** (`muaTrackingChoDon`): đọc fresh → chặn huỷ/đã có tracking → kiểm cột TAM_THOI → DonNhieuAo (chỉ `.1` mua, con nhận bản sao) → `apDungThongTinGke` (sửa tay) → kiểm US/UK → `taoDonGke` (nếu chưa từng tạo: `TAM_THOI` rỗng) → ghi `TAM_THOI='đang chờ tem'` + `TAI_KHOAN_GKE` → `layTemIn` (thử 6 lần × 3s nếu "等待抓取面单") → ghi TRACKING_ID, HANG_VAN_CHUYEN → ghi Sheet Seller → log.
- **Payload `POST /order/create/`:** `customer_order_num=STT_Key, service_code, 'need-track':'Y', need_scan:false, shipper_info (từ tài khoản), consignee_info, parcel_list[{weight, item_list[{export/import_declared, hscode, price, currency}]}]`.
- **consignee_info** (`thongTinNguoiNhan`): `full_name=TEN`, `phone=SDT || '0000000000'`, `country=maQuocGia(DIA_CHI_NUOC)`, `postcode=MA_ZIPCODE`, `province=DIA_CHI_BANG`, `city=DIA_CHI_TEN_TP`, `address=diaChiGuiGke()`. Bắt buộc có TEN, DIA_CHI_TEN_TP, MA_ZIPCODE (thiếu → lỗi `[chuẩn bị dữ liệu]`).
- **`DIA_CHI_TEN_DUONG_2` (ĐÃ SỬA 02/10/2026):** trước đây bị bỏ hẳn ở `thongTinNguoiNhan`. Tài liệu GKE (`address_info`) **không có trường địa chỉ dòng 2** (chỉ `address` max 254, `street`, `house_no`, `region`). Hiện tại: `address = trim(DIA_CHI_TEN_DUONG || TEN_DIA_CHI) + ' ' + trim(DIA_CHI_TEN_DUONG_2)` (bỏ phần trống; trùng vẫn ghép; giữ ký tự đặc biệt/dấu). Sửa tay "Địa chỉ" → gửi nguyên văn, **không** ghép dòng 2. Trang chi tiết đơn hiển thị cả dòng 2. QC3 **chưa** dùng dòng 2 (người dùng chốt).
- **Sửa dữ liệu gửi GKE** (đơn mua thủ công): cột `THONG_TIN_GKE_CHO_DON_LOI` JSON với 7 trường (MA_ZIPCODE, TEN, SDT, DIA_CHI_TEN_DUONG, DIA_CHI_TEN_TP, DIA_CHI_BANG, DIA_CHI_NUOC); chỉ khi `TU_MUA_CHE_DO='THU_CONG'`; chỉ dùng khi gửi GKE (cả kiểm US/UK); không ghi Sheet; log lịch sử `SUA_THONG_TIN_GKE`/`XOA_THONG_TIN_GKE` + logs_tracking.
- **Response:** `{code, success, detail, data}`; `code 301` = đơn đã tồn tại → dùng lại `data`; token hỏng → làm mới 1 lần. Lỗi chung (đăng nhập/mạng/timeout) gắn `err.loiChung`.
- **Logging:** body gửi + phản hồi lỗi vào `logs_tracking.ChiTiet` (`[GKE] [tạo đơn] Body gửi cho đơn …`).
- **Cập nhật trạng thái vận chuyển:** `POST /query/track/` (Accept-Language vi) theo chu kỳ cấu hình.

---

## 10. File Upload

- Route `routes/photos.js`: `/kiem-tra`, `/upload` (multer → nén ảnh ở trình duyệt/ sharp → `storageService.uploadImageBuffer` → URL proxy `/api/photos/file/<key>`), `/file/*` (stream từ MinIO).
- **Loại ảnh xác định theo "mốc" (`moc`) → cột** (`COT_ANH_THEO_MOC`):
  - `ve_file` → `Anh_File_Theu_URL`, `ve_file_2` → `_2`, `ve_file_3` → `_3` (**File thêu**, không đổi trạng thái)
  - `da_san_xuat` → `Anh_Da_San_Xuat_URL` (**Ảnh đã sản xuất**; yêu cầu "Đang chạy máy" → tự chuyển "Đã sản xuất")
  - `da_dan_tem` → `Anh_Da_Dan_Tem_URL` (**Ảnh đã dán tem**; yêu cầu "Đã sản xuất" + có tracking thật → tự chuyển "ĐÃ DÁN TEM")
- Tải lại = ghi đè URL. Mỗi lần upload ghi lịch sử `UPLOAD_ANH` (ChiTiet `{moc, url, tu, sang}`) — dùng làm thời điểm upload.
- Permission: mọi vai trò đăng nhập, nhưng phải cùng Xưởng với đơn (`coQuyenTheoXuong`).
- Ảnh Design/Mockup: link Google Drive (file hoặc thư mục) trong `DUONG_DAN_URL`, `MOCKUP` (từ Sheet).
- Ảnh cũ có thể là link Drive/Gemini/HTTP → `anhNguonService.taiAnh` tự thử từng nguồn.

---

## 11. AI / Gemini / QC AI

**Lịch sử provider (KHÔNG nhầm):**
- OLD: chỉ Gemini AI Studio (30/09/2026).
- CURRENT: mỗi QC chọn riêng **gemini** (AI Studio) | **vertex** (Gemini qua Agent Platform/Vertex AI) | **claude**; key/model lưu song song. Mặc định gemini, model `gemini-2.5-flash` (vertex cũng `gemini-2.5-flash`, claude `claude-sonnet-5-5`). Chatbot dùng LLM proxy riêng — **không** liên quan QC.

**QC chỉ superadmin** (menu + mọi route `/api/qc/*`).

| | QC1 – Vẽ file | QC2 – Sản xuất | QC3 – Dán tem |
|---|---|---|---|
| Ảnh cần kiểm (bắt buộc ≥1 đọc được) | File thêu 1–3 (`file_theu_N`) | `Anh_Da_San_Xuat_URL` (`san_pham`) | `Anh_Da_Dan_Tem_URL` (đơn con DonNhieuAo: ảnh của donIn/donMua nhóm) |
| Ảnh phụ | — | File thêu 1–3 | — |
| Tham chiếu | Design (`DUONG_DAN_URL`) + Mockup xen kẽ, tổng ≤10 ảnh | như QC1 | Dữ liệu đơn (tên, địa chỉ, tracking) |
| Hạng mục | design, text, chi_tiet, color, size, ty_le, position, huong, design_mockup | design, text, chi_tiet, color, position, huong, size, loi_san_xuat | tracking, nguoi_nhan, dia_chi, ma_don_gom |
| Bắt buộc PASS | design, text, chi_tiet, huong, design_mockup + có design_file | design, text, chi_tiet, position, loi_san_xuat + có design_file | tracking khớp (server tự so), nguoi_nhan, dia_chi, (ma_don_gom nếu kiện gom), có tem |
| Không gọi AI → CAN_CHECK_LAI | thiếu/hỏng hết File thêu, không có Design/Mockup đọc được | thiếu/hỏng ảnh SX, không có Design/Mockup | thiếu ảnh, thiếu tracking (TRACKING_ID → nhóm → TRACKING_ID2), ảnh không phải JPEG/PNG/WEBP, >15MB |

- **Ảnh:** tải → `chuanHoaAnh` (JPEG ≤1400px) cho QC1/QC2; QC3 gửi ảnh gốc. Claude: ảnh >3.5MB tự thu về 1568px.
- **AI output (schema bắt buộc):** `result` (chỉ là ĐỀ XUẤT), `score` 0–100, `confidence` 0–1, `evidence[{hang_muc, anh, quan_sat}]`, `checked_items`, `issues`, `reason`, + (`doc_duoc` QC3 | `design_file, mockup_file, vai_tro_anh` QC1/2). Gemini: `responseSchema` + temperature 0; Claude: tool `ghi_ket_qua_qc` + `tool_choice`.
- **Quyết định cuối = `quyetDinhKetQua` (nơi duy nhất):** 1) luật cứng FAIL (QC3 mã tracking lệch / thuộc đơn khác → FAIL) 2) JSON sai/thiếu score/confidence/result → CAN_CHECK_LAI 3) confidence×100 < ngưỡng CCL → CAN_CHECK_LAI 4) score ≥ PASS → PASS nếu không vướng luật chặn/không có hạng mục FAIL/AI đề xuất PASS, ngược lại CAN_CHECK_LAI 5) score ≤ FAIL → FAIL chỉ khi có hạng mục FAIL kèm evidence và AI không đề xuất PASS 6) còn lại CAN_CHECK_LAI. Hạng mục FAIL không có evidence của chính nó → hạ CAN_CHECK_LAI.
- **Ngưỡng** riêng từng QC (`/api/qc/nguong`): mặc định PASS 85 / FAIL 40 / CCL 70; số 0–100, FAIL < PASS; lưu tất cả-hoặc-không; ngưỡng hỏng → `chayQc` từ chối chạy.
- **Timeout:** Gemini/Vertex 90s, Claude 120s. **Không có retry** ở tầng provider; lỗi HTTP (gồm 429/503) → `loiApi` → `qc_log.KetQua='LOI'` + Telegram. Retry chỉ ở Auto QC (§6). **Xử lý riêng 503/quota: KHÔNG CÓ** (chỉ báo lỗi).
- **Telegram QC:** 1 Chat ID chung + Bot Token riêng (fallback env), gửi khi FAIL / CAN_CHECK_LAI (kể cả không gọi AI) / lỗi API; không gửi PASS và lỗi nghiệp vụ (đơn không tồn tại, thiếu mã); gửi ngầm không chờ.
- **Chưa test với AI thật:** Gemini AI Studio, Vertex, Claude (key Claude của người dùng báo "credit balance too low" — chưa nạp tiền API).
- **Credits Google Cloud:** tài liệu Google: credits **không** trả cho Gemini API AI Studio; có thể trả cho Gemini qua Vertex (chỉ loại trừ model đối tác) — **CHƯA XÁC ĐỊNH** chắc chắn, người dùng cần kiểm tra Billing Reports.

---

## 12. Frontend / UI

Menu theo vai trò (`public/js/api.js#renderNav`): nguoi_lay_phoi (Quét QR…), san_xuat (Chạy máy, Quét QR), ve_file (Đơn hàng, Vẽ file, Quét QR, Tracking, Đơn hàng loạt…), admin/superadmin (BĐK, Cần xử lý, Đơn hàng, Chạy máy, Vẽ file, Đơn hàng loạt, Tracking, TK, SL Phôi, Báo cáo, Lịch sử, Setting…); chỉ superadmin: Kịch bản quét, QC, Nhân viên, Logs.

**Menu QC (`public/qc.html`, chỉ superadmin) — thứ tự khối:**
1. Cấu hình AI: mỗi QC 1 dòng — chọn nhà cung cấp (Gemini AI Studio / Gemini Agent Platform-Vertex / Claude), API key (password, che), model (datalist gợi ý), Lưu / Thử kết nối / Xoá key.
2. Tự động quét QC: bảng QC1–3 (checkbox Bật, giờ, phút, mô tả điều kiện) + "Lưu tự động quét".
3. Ngưỡng kết luận: bảng PASS/FAIL/CAN_CHECK_LAI + "Lưu ngưỡng".
4. Cảnh báo Telegram: Bot Token (che), Chat ID, Lưu, Gửi thử, Xoá token.
5. QC thủ công: mã đơn + chọn QC → kết quả (nhãn, score, chắc chắn, model, "Hệ thống kết luận", ngưỡng đã dùng, AI đề xuất, lý do, bằng chứng, hạng mục, vấn đề, AI đọc được trên tem, design/mockup chọn, vai trò ảnh, hệ thống tự kiểm tra, ảnh đã dùng).
6. Log QC: lọc Loại/Kết quả/Mã đơn; cột Thời gian, Mã đơn, QC, Chế độ (AUTO/MANUAL), Kết quả (+AI đề xuất), Score, Chắc chắn, Lý do/lỗi, Người chạy, Chi tiết (JSON + chế độ, bắt đầu/kết thúc, ThongTinAuto, model, ngưỡng, ảnh).

**Chi tiết đơn (`public/order.html`) — trạng thái hiện tại (đã làm):**
- Vai trò khác san_xuat: thứ tự **Ghi chú (đậm cả nhãn+giá trị) → Ghi chú xưởng (đậm) → [Ghi chú xưởng bản trong app nếu cảnh báo] → [Nhóm DonNhieuAo] → Vị trí thêu → Số lượng → Ngày lên đơn → Người nhận → Địa chỉ giao hàng (gồm DIA_CHI_TEN_DUONG_2) → Mã IOSS → Hãng vận chuyển → Mã tracking → Đã mua Tracking → [Trạng thái vận chuyển] → Mã đơn (sàn TMĐT) → Xưởng → Cập nhật lần cuối**.
- **Đã ẩn:** Mã đơn (STT_Key), Khách hàng, Loại/Kích thước/Màu (tiêu đề trang vẫn có thể hiện STT_Key khi không có tên sản phẩm).
- san_xuat: Ghi chú, Ghi chú xưởng (đậm), Số lượng, Ngày lên đơn.
- ve_file được dùng khối "Sửa trạng thái thủ công" như admin.

**Danh sách đơn (`orders.html`):** SL font 1.8rem; khối Nâng cao chứa Lọc tổng quát, Mã Tracking, Đã mua Tracking, DonNhieuAo (+ các lọc ít dùng); nút "IN DANH SÁCH PHÔI", "IN DANH SÁCH PHÔI + IN ĐƠN", "IN ĐƠN"; hộp đỏ đơn mua thủ công (có ô sửa dữ liệu gửi GKE).
**Tracking (`tracking.html`):** cấu hình tự mua (bật, số phút, số giờ sau in mã), hộp đỏ mua thủ công (Mua ngay, Cho tự động thử lại, Sửa dữ liệu gửi GKE), bảng đơn, logs.
**Đơn hàng loạt:** "Nhóm hệ thống đề xuất" có nút "Xoá nhóm đề xuất" (bên trái "Xác nhận…") — chỉ xoá `NHOM_HANG_LOAT` của các đơn đang hiện, trong phạm vi Xưởng; quét lại có thể gom lại.
**Đăng nhập:** logo Σ/X (`public/images/logo.png`), favicon `public/favicon.ico`, `apple-touch-icon.png`.

---

## 13. Settings

| Config | Ở đâu | Mặc định | UI |
|---|---|---|---|
| Session, Sheet, MinIO, Telegram (cảnh báo Vàng/Cam/Đỏ, tracking KH), LLM, Puppeteer | `.env` | — | Không |
| DB paths, `BACKUP_DIR`, `SERVER_LOG_PATH` | env | `data/…` | Không |
| Tự mua tracking (bật, SoPhutCho=10, SoGioSauInMa=48, quét trạng thái) | `cai_dat.db/cau_hinh_tracking` | Tắt | Tracking |
| Tài khoản GKE + gán Xưởng | `tai_khoan_gke`, `danh_sach_xuong` | — | Settings (superadmin) |
| Xưởng, màu Xưởng, Team → Xưởng | `danh_sach_xuong`, `cai_dat_mau_xuong`, `team_xuong_mac_dinh` | — | Settings |
| Nhóm hàng (loại/keyword, LOAI trống) | `nhom_hang_loai`, `cai_dat_nhom_hang` | Chưa phân loại | Settings |
| Ngưỡng cảnh báo trễ, nén ảnh, ngưỡng Hamming | `cai_dat_*` | — | Settings / Đơn hàng loạt |
| QC: provider/key/model, ngưỡng, auto | `qc_cau_hinh` | gemini, gemini-2.5-flash, 85/40/70, auto TẮT 0h5m | QC |
| Telegram QC | `qc_canh_bao_telegram` | trống = tắt | QC |
| Kịch bản quét | `kich_ban.db` | — | Kịch bản quét |

---

## 14. Users & Permissions

- `middleware/auth.js`: `requireLogin`; `requireRole(...)` (admin+superadmin luôn qua); `requireExactRole(...)` (chặn cả admin); `laAdmin` (admin|superadmin); `laSuperAdmin`.
- **Chỉ superadmin:** QC, Nhân viên (`routes/users.js`), Logs, Kịch bản quét, Tài khoản GKE, xoá dữ liệu đơn, thông tin Xưởng một số chỗ, nút bỏ qua ràng buộc trạng thái.
- **Menu Tracking + cột TU_MUA_*/THONG_TIN_GKE_CHO_DON_LOI + lịch sử giới hạn thử:** admin, superadmin, ve_file (`orderService.VAI_TRO_MENU_TRACKING`).
- **Xưởng:** mọi vai trò trừ superadmin bị lọc theo Xưởng (§5). Admin chỉ thao tác đơn Xưởng mình.
- `TRUONG_DUOC_SUA` (routes/orders.js): allowlist trường sửa được cho san_xuat/nguoi_lay_phoi; `TRUONG_CAM_SUA`: trường không ai sửa được qua `PUT /orders/:sttKey`.

---

## 15. Current Work

### Đang làm
Không có task code dở. Task cuối (Auto QC) đã code + test xong, **chờ người dùng commit/deploy và chạy thử thật**.

### Đã hoàn thành (gần đây, theo thứ tự)
UI danh sách đơn (SL, Nâng cao, nút IN) · Nhóm hàng LOAI trống · Team regex lỏng · Ghi chú xưởng cho san_xuat + PDF DonCanIn · Tự mua tracking 48h sau in mã ·
Giới hạn 10 lần + hộp đỏ · ve_file sửa trạng thái thủ công · AI QC3 → QC2 → QC1 · Bố cục Chi tiết đơn · Xoá nhóm đề xuất · Logo/favicon · Claude provider ·
Telegram QC (+Bot Token UI) · Ngưỡng + quyết định ở backend · Sửa dữ liệu gửi GKE · Gemini Agent Platform/Vertex · DIA_CHI_TEN_DUONG_2 → GKE · **Auto QC**.

### Chưa hoàn thành / đã đề xuất nhưng người dùng CHƯA cho làm
- Đề xuất 1 (Tracking): tự rút ZIP+4 → 5 số cho đơn US khi gửi GKE; thêm số 0 cho ZIP US thiếu số. **Chưa làm.**
- Đề xuất 3 (Tracking): lỗi "等待抓取面单" (chờ lấy tem) không tính vào 10 lần, thử lại không tạo đơn mới. **Chưa làm.**
- Chốt chặn phát hiện lệch cột địa chỉ trước khi mua GKE. **Người dùng nói "tạm thời chưa thêm".**
- QC3 dùng `DIA_CHI_TEN_DUONG_2`. **Người dùng nói chưa cần.**
- Header logo trong nav các trang bên trong vẫn icon cũ (chỉ trang đăng nhập đổi).

### Bug hiện tại / chưa xác minh
Xem §16 (OPEN/UNKNOWN).

### Việc tiếp theo cần làm
Xem §24.

---

## 16. Bugs

| BUG | Nguyên nhân | Đã sửa | File | Status |
|---|---|---|---|---|
| DIA_CHI_TEN_DUONG_2 không lên GKE | `thongTinNguoiNhan` bỏ qua cột | Ghép vào `address` | gkeService.js | FIXED (chưa test GKE thật) |
| Lệch cột địa chỉ ở dữ liệu Sheet (tháng 7) | Bước nạp Sheet ngoài app | — | (ngoài app) | OPEN — mức độ hiện tại UNKNOWN |
| GKE từ chối ZIP+4 "postal code not in service: 75432-7243" | Giả thuyết GKE chỉ nhận ZIP 5 số — chưa kiểm chứng | Có workaround sửa tay ZIP | — | OPEN, ROOT CAUSE UNKNOWN |
| "等待抓取面单" làm đơn hết 10 lần thử (vd 9U272) | Tem chưa sinh xong; vì sao hết 10 lần nhanh chưa rõ | — | trackingAutoService.js | OPEN, ROOT CAUSE UNKNOWN |
| 5 test cũ fail: test-dongThongTinLoc-v2, test-footer-tong, test-san-sang, test-tu-dong-mua-chay-may, test-veBangPdf | Có từ trước các task gần đây | — | — | OPEN, ROOT CAUSE UNKNOWN |
| Tràn ngang ~8px trên mobile do nav | Có từ trước | — | api.js/style.css | OPEN |
| Claude: tham số `temperature` có thể bị model mới từ chối | Chưa test thật | — | claudeProvider.js | UNKNOWN |
| TU_MUA_*, lịch sử, logs lộ cho san_xuat | Thiếu lọc | `anCotTheoDoiMuaTracking`, logService lọc, strip ở route tracking | orderService/logService/routes | FIXED |
| TEN_NHOM check cho qua "constructor" | so khớp `in` | `Object.hasOwn` | — | FIXED |
| Đơn mua thủ công đã huỷ vẫn kẹt bảng Tracking | lọc thiếu trạng thái | `TRANG_THAI_KHONG_CAN_MUA` | trackingAutoService.js | FIXED |

---

## 17. Technical Decisions (KHÔNG tự ý đổi)

- Nguồn đơn = Google Sheet; **app không ghi `Don_Hang_ALL`/RAW**; cột app ghi nằm ở SQLite; ghi ra ngoài chỉ vào **Sheet Seller đúng cột, đúng dòng** (0 hoặc ≥2 dòng khớp → không ghi).
- Mọi thay đổi trạng thái đi qua `orderService.update` (khoá theo đơn, kiểm tính hợp lệ, ghi mốc, log).
- Admin bị giới hạn theo Xưởng; chỉ superadmin thấy tất cả. Đơn chưa gán Xưởng = ẩn với người thường.
- Xưởng mặc định theo Team chỉ gán cho đơn đang trống; đổi cấu hình không chuyển đơn cũ.
- DonNhieuAo: chỉ đơn `.1` mua tracking; nhận diện lúc đọc, không lưu nhóm; dùng `phanTichStt` chặt.
- Tự mua tracking: điều kiện "Đã sản xuất + phút" HOẶC "Đã in mã + giờ (48)" (cái nào trước); chỉ đơn in mã sau MocApDungTheoInMa; 10 lần chỉ đếm lỗi riêng; chỉ US/UK.
- QC: **chỉ superadmin**; thứ tự đã triển khai QC3 → QC2 → QC1; Order ID = STT_Key; QC3 so dữ liệu đơn (không dùng nhãn GKE); kết quả chỉ hiện ở menu QC; QC1 chỉ chạy từ menu QC/auto.
- **AI chỉ phân tích, backend quyết định** (`quyetDinhKetQua` duy nhất); luật cứng ưu tiên; FAIL phải có bằng chứng; JSON sai → CAN_CHECK_LAI, không bao giờ tự PASS.
- API key QC lưu plaintext trong SQLite, chỉ trả UI dạng che; không hard-code; không đổi model nếu người dùng chưa xác nhận.
- Provider QC chọn riêng từng QC, key lưu song song.
- Auto QC: mỗi (STT_Key, LoaiQc) tối đa 1 lần; khoá DB; chỉ đơn sau mốc áp dụng; QC2/QC3 vẫn chạy khi đơn đã qua bước sau; lỗi kỹ thuật thử lại tối đa 2 lần cách 30 phút; vẫn auto dù đã QC tay; không đổi QC thủ công.
- Sửa dữ liệu gửi GKE: chỉ đơn mua thủ công, chỉ dùng khi gửi GKE, không ghi Sheet.
- GKE address: dòng 1 + " " + dòng 2; sửa tay "Địa chỉ" = địa chỉ đầy đủ.
- Cloudflare cache 4h cho js/css → **sửa `api.js`/`style.css` phải tăng `?v=` ở MỌI trang** (cao hơn số đã commit gần nhất). File JS mới thì không cần.

---

## 18. Constraints ("KHÔNG ĐƯỢC LÀM")

- Không tự suy diễn/đổi nghiệp vụ; điểm chưa rõ **phải hỏi người dùng trước khi code**.
- Không ghi đè dữ liệu production bằng dữ liệu test; test luôn dùng env DB trỏ thư mục tạm; **không chạy `node -e` require service khi chưa set env DB tạm** (sẽ tạo bảng/cột trên `data/` thật).
- Không sửa dữ liệu Google Sheet chính; không đổi cấu trúc Sheet nếu không cần.
- Không hard-code API key/token; không log credential; không đưa secret vào tài liệu.
- Không tạo scheduler trùng; không chạy nhiều container (session memory store).
- Không làm ảnh hưởng QC thủ công; không tự chuyển QC tiếp theo khi người dùng chưa xác nhận.
- Không tự tạo cơ chế Google Drive mới nếu dùng lại được cơ chế hiện có.
- Không commit/push trừ khi người dùng yêu cầu (người dùng tự commit giữa các lượt).
- Không đọc/hiển thị các file nhạy cảm ở `D:\n8n_data` (`Token GKE.txt`, `Claude APIKey.txt`, file JSON khoá GCP, `GKE.png` chứa mật khẩu).

---

## 19. Environment

- Dev: Windows 11, thư mục `D:\n8n_data\webapp`, Git Bash/PowerShell; Node local v22 (test chạy được), Docker image `node:20-alpine`.
- Package manager: npm (`package-lock.json`, Docker `npm ci --omit=dev`).
- Production: VPS + Docker Compose, container `xuong-theu-webapp`, cổng 3000, sau **Cloudflare**; volumes `./data`, `./data-backups`, `./service-account.json`. Đường dẫn server, cách deploy cụ thể: **CHƯA XÁC ĐỊNH** (người dùng tự deploy).
- MinIO trên Zima NAS (LAN), mặc định compose `http://192.168.123.125:9010`.
- Không PM2/systemd (Docker `restart: unless-stopped`).
- Env (không ghi giá trị): `PORT, SESSION_SECRET=<REDACTED>, GOOGLE_SERVICE_ACCOUNT_KEY_PATH, SHEET_ID, MINIO_ENDPOINT, MINIO_REGION, MINIO_ACCESS_KEY=<REDACTED>, MINIO_SECRET_KEY=<REDACTED>, MINIO_BUCKET, MINIO_FORCE_PATH_STYLE, MINIO_PRESIGNED_URL_EXPIRES, TELEGRAM_BOT_TOKEN=<REDACTED>, TELEGRAM_CHATID_VANG/CAM/DO/DONGGOI/TRACKING_KH, LLM_API_URL, LLM_API_KEY=<REDACTED>, LLM_MODEL, LLM_MODEL_MANH, PUPPETEER_EXECUTABLE_PATH, CAI_DAT_DB_PATH, DON_HANG_LOAT_DB_PATH, KICH_BAN_DB_PATH, NHAT_KY_DB_PATH, SQLITE_DB_PATH, TAI_KHOAN_DB_PATH, BACKUP_DIR, SERVER_LOG_PATH`; `GKE_*` (chỉ dùng chuyển đổi 1 lần, legacy).

---

## 20. Commands

```bash
npm install                 # cài dependencies
npm run dev                 # node --watch server.js (dev)
npm start                   # node server.js
docker compose up -d --build   # build + chạy (có file mới -> phải build lại image)
node scripts/migrate-nguoi-dung-tu-sheets.js --apply   # nạp tài khoản khi bảng trống (chạy không --apply để xem trước)
```
Không có lệnh test/migration/seed chính thức trong `package.json`. Log server: menu Logs (superadmin) hoặc `docker logs xuong-theu-webapp` (CHƯA XÁC ĐỊNH người dùng dùng lệnh nào).

---

## 21. Testing

- **Không có test framework / thư mục test trong repo.** Các test đã viết là script Node thuần (`assert`) nằm ở **scratchpad của phiên làm việc** (`C:\Users\ADMIN\AppData\Local\Temp\claude\D--n8n-data-webapp\<session>\scratchpad\test-*.js`) — **có thể đã mất, không có trong git**.
- Cách chạy đã dùng: set env DB tạm rồi `node test-xxx.js`:
  `CAI_DAT_DB_PATH=$T/cd.db DON_HANG_LOAT_DB_PATH=$T/dhl.db KICH_BAN_DB_PATH=$T/kb.db NHAT_KY_DB_PATH=$T/nk.db SQLITE_DB_PATH=$T/tt.db TAI_KHOAN_DB_PATH=$T/tk.db SERVER_LOG_PATH=$T/s.log PDF_RA=$T/ra.pdf SP=$T node test-xxx.js`
- Kỹ thuật mock: thay `sheetsService.readTab/readTabCached`, `sheetsService.updateCells…`, `sheetSellerService.ghiHangLoat`, `anhNguonService.taiAnh`, `storageService.tonTaiObject`, `global.fetch` (Gemini/Vertex/Claude/GKE), `https.request` (Telegram); app Express nhỏ gắn `req.session.user` theo header `x-ten`.
- Kết quả gần nhất: **53 test đạt, 5 fail có sẵn** (§16). Test quan trọng: test-qc1/2/3, test-claude, test-telegram, test-nguong, test-vertex, test-sua-gke, test-dia-chi-2 (GKE payload thật qua fetch giả), test-auto-qc (15 case Auto QC + race 2 tiến trình), test-gioi-han-thu-mua, test-lich-su, test-xoa-goi-y.
- Kiểm tra trình duyệt: server stub (Sheet giả + DB tạm) qua `.claude/launch.json` tạm thời, **luôn `git checkout -- .claude/launch.json` sau đó**.
- Chưa có test: upload ảnh thật/MinIO thật, Google Sheets thật, GKE thật, AI thật, phân quyền toàn diện các trang.

---

## 22. Data Flows

```
ORDER FLOW
Seller Sheet ──IMPORTRANGE──> <TEAM>_RAW ──QUERY──> Don_Hang_ALL
   ↓ orderService.getAll (cache 10s) + overlay SQLite trang_thai_don + tự gán Xưởng theo Team
Chưa in mã → (in QR) Đã in mã [THOI_GIAN_IN_MA]
   → lấy phôi + vẽ file (Đã vẽ file [THOI_GIAN_VE_FILE], upload File thêu 1–3)
   → ĐÃ SẴN SÀNG CHẠY MÁY (tự động) → Đang chạy máy
   → upload Ảnh đã sản xuất ⇒ Đã sản xuất [THOI_GIAN_SAN_XUAT]
   → mua tracking GKE (auto/tay) → in label
   → upload Ảnh đã dán tem (cần TRACKING_ID) ⇒ ĐÃ DÁN TEM [THOI_GIAN_DAN_TEM]
   → DELIVERED
   ↘ ghi Sheet Seller: TRACKING_ID2+HANG_VAN_CHUYEN2, GHI_CHU_XUONG, Delivered

GKE FLOW
cron 2' / Mua ngay → muaTrackingChoDon → (DonNhieuAo: chỉ .1) → apDungThongTinGke (sửa tay)
 → kiểm US/UK → layCauHinhGkeChoDon (Xưởng→tài khoản) → thongTinNguoiNhan (address = dòng1 + " " + dòng2)
 → POST /auth/login/ (token cache) → POST /order/create/ → TAM_THOI='đang chờ tem'
 → POST /label/print/ (thử lại khi chờ tem) → TRACKING_ID, HANG_VAN_CHUYEN → Sheet Seller → logs_tracking
 lỗi riêng đơn → TU_MUA_SO_LAN_THU++ (10 → THU_CONG → hộp đỏ)

MANUAL QC FLOW (superadmin)
menu QC → POST /api/qc/chay → kiểm ngưỡng → chayQc1/2/3 → tải ảnh (+Design/Mockup) → aiProvider (gemini|vertex|claude)
 → chuanHoaAi → luật cứng → quyetDinhKetQua (ngưỡng) → qc_log (MANUAL) → Telegram nếu ≠ PASS

AUTO QC FLOW
cron 2' → QC đang BẬT → ngưỡng hợp lệ? → lọc đơn (trạng thái, URL ảnh, mốc ≥ MocApDung, now ≥ mốc+chờ, chưa auto/LOI còn lượt)
 → ≤10 đơn/QC → HEAD MinIO (file có thật) → giuQuyenAutoQc (INSERT OR IGNORE / UPDATE có điều kiện)
 → chayQc(cheDo AUTO) → qc_log (AUTO + ThongTinAuto) → qc_auto XONG | LOI (thử lại ≤2 lần, cách 30')
```

---

## 23. Next AI Instructions

INSTRUCTIONS FOR THE NEXT AI
1. Đọc toàn bộ tài liệu này trước.
2. Không giả định các mục ghi **CHƯA XÁC ĐỊNH / UNKNOWN** — hỏi người dùng hoặc kiểm tra code/dữ liệu.
3. Trước khi sửa phải đọc source code thực tế (tài liệu có thể lệch sau commit mới).
4. Không tự ý đổi business logic; mọi điểm chưa rõ → hỏi trước khi code (người dùng yêu cầu rõ điều này ở mọi task).
5. Giữ backward compatibility (đơn cũ, cột cũ, dữ liệu SQLite cũ).
6. Bug → xác định root cause trước khi sửa; có bằng chứng (log/dữ liệu) trước khi kết luận.
7. Sau khi sửa phải test (script Node + DB tạm, mock API ngoài); báo rõ phần nào đã/ chưa kiểm được (không có Sheet/MinIO/GKE/AI thật ở môi trường dev).
8. Báo cáo file/function đã đổi + file cần commit + có cần tăng `?v=`/build lại image không.
9. Không tạo implementation trùng (dùng lại `orderService.update`, `chayQc`, `quyetDinhKetQua`, `aiProvider`, `anhNguonService`, `driveService`, `sheetSellerService`, `telegramService.guiTinNhan`…).
10. Trả lời người dùng bằng **tiếng Việt**, ngắn gọn, có kết luận rõ.

---

## 24. Immediate Next Steps

1. Người dùng commit + deploy Auto QC (file mới `services/qc/qcAutoService.js` → **build lại image**), rồi bật thử 1 QC với chờ ngắn, theo dõi Log QC (cột Chế độ AUTO).
2. Chạy thử AI thật: nhập key Gemini (AI Studio hoặc Agent Platform/Vertex) cho từng QC → Thử kết nối → QC vài đơn; xem score/"Hệ thống kết luận"; chỉnh ngưỡng nếu quá nhiều CẦN CHECK LẠI.
3. Kiểm tra mua tracking thật với 1 đơn có `DIA_CHI_TEN_DUONG_2` (xem body trong Logs Tracking).
4. Chờ người dùng quyết định các đề xuất đang treo: ZIP+4 → 5 số; lỗi chờ lấy tem không tính 10 lần; chốt chặn lệch cột địa chỉ.
5. Nên đưa các script test vào repo (hiện chỉ ở scratchpad tạm) — **chỉ khi người dùng đồng ý**.

---

# CURRENT STATE — READ THIS FIRST

- **Hệ thống:** Node/Express + HTML/vanilla JS, đơn hàng đọc từ Google Sheet `Don_Hang_ALL` (không ghi), cột app ghi ở SQLite `data/*.db`, ảnh ở MinIO, chạy 1 container Docker sau Cloudflare. Người dùng là chủ xưởng (superadmin), nói tiếng Việt, tự commit/deploy.
- **Trạng thái code:** không có task dở. Task cuối = **Auto QC** (code + test xong, chưa deploy/chạy thật). Trước đó: DIA_CHI_TEN_DUONG_2 → GKE `address` (xong), Gemini Agent Platform/Vertex provider (xong), sửa dữ liệu gửi GKE (xong), ngưỡng QC + quyết định backend (xong), Telegram QC (xong), Claude provider (xong).
- **Chưa test với dịch vụ thật:** mọi AI (Gemini/Vertex/Claude), GKE với địa chỉ dòng 2, Auto QC trên dữ liệu thật.
- **Bug/vấn đề mở:** ZIP+4 bị GKE từ chối (root cause chưa xác minh); lỗi "chờ lấy tem" làm hết 10 lần thử (chưa rõ vì sao); dữ liệu Sheet tháng 7 lệch cột địa chỉ khi có DUONG_2 (hiện tại chưa rõ); 5 test cũ fail (có từ trước); tràn ngang 8px mobile.
- **Đề xuất người dùng chưa cho làm:** rút ZIP+4 → 5 số; không tính lỗi chờ tem vào 10 lần; chốt chặn lệch cột; QC3 dùng DUONG_2.
- **Luật quan trọng nhất:**
  - Mọi đổi trạng thái qua `orderService.update` (khoá đơn, kiểm hợp lệ, ghi mốc THOI_GIAN_IN_MA/SAN_XUAT/VE_FILE/DAN_TEM, log).
  - Từ "ĐÃ SẴN SÀNG CHẠY MÁY" trở đi bắt buộc Đã lấy phôi + Đã vẽ file. ĐÃ DÁN TEM bắt buộc có TRACKING_ID thật.
  - Chỉ superadmin thấy mọi Xưởng; admin và các vai trò khác chỉ thấy đơn cùng Xưởng; đơn chưa gán Xưởng bị ẩn.
  - Xưởng tự gán theo Team (`layTeam` lỏng) chỉ cho đơn trống. DonNhieuAo dùng `phanTichStt` chặt, chỉ `.1` mua tracking.
  - Tự mua tracking: (Đã sản xuất + SoPhutCho) HOẶC (Đã in mã + 48h, chỉ đơn in mã sau mốc), cái nào trước; chỉ US/UK; 10 lần lỗi riêng → mua thủ công.
  - GKE `address` = DIA_CHI_TEN_DUONG (hoặc TEN_DIA_CHI) + " " + DIA_CHI_TEN_DUONG_2; sửa tay Địa chỉ = gửi nguyên văn.
  - QC chỉ superadmin. AI chỉ đề xuất; `quyetDinhKetQua` quyết định theo ngưỡng (mặc định 85/40/70) + luật cứng; JSON sai → CAN_CHECK_LAI; FAIL cần bằng chứng.
  - Auto QC: (STT_Key, LoaiQc) tối đa 1 lần (khoá DB `qc_auto`); QC1 = "Đã vẽ file" + ≥1 File thêu, mốc THOI_GIAN_VE_FILE; QC2 = Đã sản xuất (hoặc sau) + Ảnh đã sản xuất, mốc THOI_GIAN_SAN_XUAT; QC3 = ĐÃ DÁN TEM (hoặc DELIVERED) + Ảnh đã dán tem, mốc THOI_GIAN_DAN_TEM; chỉ đơn chuyển sau mốc áp dụng; mặc định TẮT, chờ 0h5m; lỗi kỹ thuật thử lại ≤2 lần cách 30'.
  - App không ghi Sheet chính; chỉ ghi Sheet Seller đúng cột/đúng dòng.
  - Sửa `api.js`/`style.css` → tăng `?v=` mọi trang (Cloudflare cache 4h). File mới → build lại image.
  - Test luôn với DB tạm (env `*_DB_PATH`), không bao giờ đụng `data/` thật. Hỏi người dùng trước khi code khi có điểm chưa rõ.
- **Việc tiếp theo:** deploy + chạy thử Auto QC và AI thật; theo dõi Log QC; chờ người dùng quyết các đề xuất tracking đang treo.
