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

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/qr', require('./routes/qr'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.use(express.static(path.join(__dirname, 'public')));

// Middleware xử lý lỗi tập trung — mọi lỗi throw/reject trong route đều rơi vào đây
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Lỗi máy chủ, vui lòng thử lại' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Xưởng Thêu app đang chạy tại http://localhost:${PORT}`));
