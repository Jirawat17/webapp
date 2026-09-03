const express = require('express');
const router = express.Router();
const { readTabCached } = require('../services/sheetsService');
const { ghiLog } = require('../services/logService');

const TAB = 'NguoiDung';

// Danh sách tên để hiển thị nút chọn ở màn hình đăng nhập — chỉ nhân viên đang kích hoạt
// Danh sách nhân viên gần như không đổi trong ngày — đọc qua cache (routes/users.js tự xoá cache
// ngay khi admin thêm/sửa nhân viên) thay vì luôn gọi Google mỗi lần ai đó mở màn hình đăng nhập.
router.get('/danh-sach', async (req, res) => {
  const { rows } = await readTabCached(TAB, 30000);
  const active = rows.filter(r => String(r.KichHoat).toUpperCase() === 'TRUE');
  res.json(active.map(r => ({ ten: r.Ten, vaiTro: r.VaiTro })));
});

router.post('/dang-nhap', async (req, res) => {
  const { ten } = req.body;
  if (!ten) return res.status(400).json({ error: 'Thiếu tên' });

  const { rows } = await readTabCached(TAB, 30000);
  const user = rows.find(r => r.Ten === ten && String(r.KichHoat).toUpperCase() === 'TRUE');
  if (!user) return res.status(404).json({ error: 'Không tìm thấy nhân viên hoặc tài khoản đã bị khoá' });

  req.session.user = { ten: user.Ten, vaiTro: user.VaiTro, team: user.Team || '' };
  await ghiLog({ nguoiDung: user.Ten, vaiTro: user.VaiTro, hanhDong: 'DANG_NHAP' });
  res.json(req.session.user);
});

router.post('/dang-xuat', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/hien-tai', (req, res) => {
  res.json(req.session.user || null);
});

module.exports = router;
