require('dotenv').config();
require('express-async-errors'); // tự bắt lỗi từ các route async, không cần try/catch thủ công ở mỗi route

const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'doi-chuoi-bi-mat-nay-truoc-khi-chay-that',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 ngày — chọn tên 1 lần là máy nhớ luôn
}));

// Ghi nhận "còn đang hoạt động" cho mọi request đã đăng nhập — phục vụ Bảng điều khiển admin, xem
// services/presenceService.js. Đặt sau session, trước mọi route, để áp dụng cho toàn bộ API.
const { ghiNhanHoatDong } = require('./services/presenceService');
app.use((req, res, next) => {
  if (req.session.user) ghiNhanHoatDong(req.session.user);
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/orders', require('./routes/orders'));
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

app.use(express.static(path.join(__dirname, 'public')));

// Middleware xử lý lỗi tập trung — mọi lỗi throw/reject trong route đều rơi vào đây
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Lỗi máy chủ, vui lòng thử lại' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Xưởng Thêu app đang chạy tại http://localhost:${PORT}`));

// Bật lịch kiểm tra cảnh báo 3 tầng + nhắc ship — chạy nền, độc lập với request nào đang tới
require('./services/canhBaoJob').batDauLichCanhBao();

// Bật lịch quét tự động mua tracking GKE (bổ sung 09/09/2026, xem
// docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md) — TẮT theo mặc định cho tới khi
// admin tự bật ở trang "Tracking" (services/trackingAutoService.js tự đọc cấu hình mỗi lượt quét).
require('./services/trackingJob').batDauLichTracking();
