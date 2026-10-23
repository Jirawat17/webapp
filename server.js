require('dotenv').config();
// PHẢI require SỚM NHẤT có thể (bổ sung 23/09/2026, theo yêu cầu người dùng) — "chặn" console.log/warn/
// error để ghi thêm ra file, xem services/logCapture.js. Trước dòng này, mọi console.* KHÔNG được ghi
// (chỉ 2 dòng dotenv/express-async-errors phía trên có thể lỡ mất, không đáng kể).
require('./services/logCapture');
// Phiên bản đang chạy (16/10/2026) — dòng này đánh dấu mỗi lần deploy/khởi động lại trong log; báo cáo Telegram đọc lại để biết số liệu thuộc bản nào.
console.log(`[PhienBan] Khởi động: ${require('./services/phienBanService').moTa}`);
require('express-async-errors'); // tự bắt lỗi từ các route async, không cần try/catch thủ công ở mỗi route

const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// Mốc request VÀO app cho lượt đo mạng (17/10/2026) — đặt TRƯỚC đọc body + phiên để thời gian "máy chủ xử lý" (Server-Timing,
// routes/doMang.js) gồm cả phần app tự làm trước route.
app.use('/api/ping', (req, res, next) => { req._tVaoPing = performance.now(); next(); });
// Mốc request upload ảnh VÀO app (22/10/2026) — lúc nhận xong phần đầu (header), TRƯỚC khi đọc dữ liệu ảnh: routes/photos.js tính thời gian
// nhận hết ảnh (= đoạn Cloudflare -> máy chủ ở nhà, nếu Cloudflare đã nhận đủ ảnh rồi mới chuyển tiếp; nếu chuyển tiếp dần thì gồm cả đoạn
// điện thoại -> Cloudflare).
app.use('/api/photos/upload', (req, res, next) => { req._tVaoUpload = performance.now(); next(); });
app.use(express.json());
// Phiên lưu SQLite (16/10/2026) — khởi động lại máy chủ không còn đăng xuất mọi người (xem services/phienStore.js).
const { PhienSqliteStore, donPhienHetHan } = require('./services/phienStore');
donPhienHetHan();
setInterval(donPhienHetHan, 6 * 3600 * 1000).unref();
app.use(session({
  secret: process.env.SESSION_SECRET || 'doi-chuoi-bi-mat-nay-truoc-khi-chay-that',
  store: new PhienSqliteStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 ngày — chọn tên 1 lần là máy nhớ luôn
}));
// Chỉ /api (16/10/2026): file tĩnh (js/css/ảnh) không cần đọc lại tài khoản — quyền chỉ kiểm tra ở API.
app.use('/api', require('./middleware/auth').kiemTraLaiTaiKhoan);
// Lượt GET (xem/tra cứu) được dùng tạm bản Sheet cũ < 5 phút khi Google lỗi; lượt ghi (POST/PUT...) và job nền KHÔNG (sheetsService).
app.use('/api', (req, res, next) => (req.method === 'GET' ? require('./services/sheetsService').choPhepDungTamKhiLoi(next) : next()));

// Ghi nhận "còn đang hoạt động" cho mọi request đã đăng nhập — phục vụ Bảng điều khiển admin, xem
// services/presenceService.js. Đặt sau session, trước mọi route, để áp dụng cho toàn bộ API.
const { ghiNhanHoatDong } = require('./services/presenceService');
app.use('/api', require('./services/logCapture').ghiLuotApi); // ghi lượt API bị từ chối/lỗi/chậm vào Logs (11/10/2026)
app.use('/api', require('./services/gioTruyCapService').chanNgoaiGio); // giờ đóng truy cập theo Xưởng (23/10/2026) -> 423
app.use((req, res, next) => {
  if (req.session.user) ghiNhanHoatDong(req.session.user);
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/don-hang-loat', require('./routes/donHangLoat'));
app.use('/api/qr', require('./routes/qr'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/canh-bao', require('./routes/canhBao'));
app.use('/api/chatbot', require('./routes/chatbot'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/tai-san', require('./routes/taiSan'));
app.use('/api/hoat-dong', require('./routes/hoatDong'));
// routes/gke.js (mount '/api/gke') ĐÃ XOÁ 09/09/2026 lần 4, theo yêu cầu người dùng — chế độ "Quét mã
// QR Tracking" (gọi GKE thật) thay bằng "Chụp ảnh ĐÃ DÁN TEM" thuần ảnh (routes/photos.js, mốc
// da_dan_tem). gkeService.js vẫn dùng nguyên cho Mua Tracking/IN LABEL (services/trackingAutoService.js,
// routes/tracking.js) — chỉ riêng route quét-QR-để-tạo-vận-đơn là bị xoá.
app.use('/api/tracking', require('./routes/tracking'));
app.use('/api/trung-tam-hanh-dong', require('./routes/actionCenter'));
app.use('/api/dong-bo-sheet-seller', require('./routes/dongBoSheetSeller'));
app.use('/api/kich-ban', require('./routes/kichBan'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/qc', require('./routes/qc')); // AI QC (30/09/2026) — CHỈ superadmin
app.use('/api/notes', require('./routes/notes')); // Notes (02/10/2026) — CHỈ superadmin
app.use('/api/thu-vien', require('./routes/thuVien')); // Tìm ảnh — thư viện thiết kế thêu (03/10/2026)
app.use('/api/van-hanh', require('./routes/vanHanh')); // Cấu hình cảnh báo vận hành Y6/L2 + Telegram vận hành (11/10/2026) — CHỈ superadmin
app.use('/api/bao-loi', require('./routes/baoLoi')); // Y20 Báo lỗi app (11/10/2026)
app.use('/api/gio-truy-cap', require('./routes/gioTruyCap')); // giờ đóng truy cập theo Xưởng (23/10/2026) — thiết lập CHỈ superadmin
app.use('/api/nhat-ky-quet', require('./routes/nhatKyQuet')); // Logs_UploadAnh — thao tác menu Quét QR (12/10/2026)
app.use('/api/ping', require('./routes/doMang')); // đo tốc độ mạng từ trình duyệt — chấm báo mạng trên menu mọi trang (16/10/2026)

app.use(express.static(path.join(__dirname, 'public')));

// Middleware xử lý lỗi tập trung — mọi lỗi throw/reject trong route đều rơi vào đây
app.use((err, req, res, next) => {
  // Lượt /api: in stack CÙNG dòng [API] (có tên người dùng) ở services/logCapture.js#ghiLuotApi; ngoài /api thì in như cũ.
  if (res.locals.coGhiLuotApi) res.locals.loiStack = (err && err.stack) || String(err);
  else console.error(err);
  res.status(500).json({ error: err.message || 'Lỗi máy chủ, vui lòng thử lại' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Xưởng Thêu app đang chạy tại http://localhost:${PORT}`));

// Sửa 1 lần các đơn kẹt ở "Đã in mã" dù đủ phôi + file (bổ sung 25/09/2026, xem orderService.js).
try { require('./services/orderService').suaDonKetSanSang(); } catch (err) { console.error('[Orders] Lỗi sửa đơn kẹt:', err.message); }

// Lịch gửi Telegram cảnh báo 3 tầng (services/canhBaoJob.js) ĐÃ BỎ 16/10/2026, theo yêu cầu người dùng — không dùng (chưa từng cấu
// hình chat), lại ghi cờ "đã gửi" dù không gửi được. Mức cảnh báo trên giao diện vẫn tính trực tiếp (alertService.tinhMucCanhBao).

// Bật lịch quét tự động mua tracking GKE (bổ sung 09/09/2026, xem
// docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md) — TẮT theo mặc định cho tới khi
// admin tự bật ở trang "Tracking" (services/trackingAutoService.js tự đọc cấu hình mỗi lượt quét).
require('./services/trackingJob').batDauLichTracking();
require('./services/baoCaoLogService').batDauLichBaoCaoLog(); // báo cáo logs 24 giờ (giờ đặt ở Settings) + báo cáo vận hành tuần (7h sáng thứ 7) qua Telegram
require('./services/orderService').batDauLamMoiNen(); // Don_Hang_ALL làm mới nền mỗi 25 giây — thao tác đọc bản ≤ 30 giây (16/10/2026)
require('./services/doMangMayChuService').batDauDoMangMayChu(); // máy chủ tự đo mạng qua Cloudflare mỗi phút (17/10/2026)
require('./services/nhaMangService').batDauCapNhatNhaMang(); // dữ liệu IP -> nhà mạng cho log đo mạng, tải lại mỗi tuần (21/10/2026)

// Tự động quét QC (02/10/2026) — mỗi 2 phút; từng QC TẮT theo mặc định, bật ở menu QC (services/qc/qcAutoService.js).
require('./services/qc/qcAutoService').batDauLichAutoQc();
// Cảnh báo Telegram QC gộp CẦN CHECK LẠI + tổng kết ngày (02/10/2026) — mỗi phút, cấu hình ở menu QC (services/qc/qcTelegramService.js).
require('./services/qc/qcTelegramService').batDauLichTelegramQc();
// Thư viện "Tìm ảnh" (03/10/2026) — vòng xử lý hàng chờ tải PNG, 1 việc/lần (services/thuVien/xuLyService.js).
require('./services/thuVien/xuLyService').batDauVongXuLy();
// Giai đoạn 3: quét DUONG_DAN_URL mỗi 10 phút — TẮT theo mặc định, superadmin bật ở menu Tìm ảnh (services/thuVien/dongBoSheetService.js).
require('./services/thuVien/dongBoSheetService').batDauLichQuetSheet();
require('./services/thuVien/goiYEmbService').batDauLichGoiY(); // A1 (11/10/2026): gợi ý "Có EMB sẵn" mỗi 10 phút
require('./services/vanHanhService').batDauLichVanHanh(); // Y6 + L2 (11/10/2026): tổng hợp Telegram vận hành 8 giờ sáng

// Bật lịch backup SQLite (bổ sung 22/09/2026, theo yêu cầu người dùng — data/ trước đây không có
// cơ chế backup nào, xem services/backupDbService.js).
require('./services/backupDbService').batDauLichBackup();
