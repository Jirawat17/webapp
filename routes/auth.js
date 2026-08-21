const express = require('express');
const router = express.Router();
const { readTab } = require('../services/sheetsService');
const { ghiLog } = require('../services/logService');

const TAB = 'NguoiDung';

// Danh sách tên để hiển thị nút chọn ở màn hình đăng nhập — chỉ nhân viên đang kích hoạt
router.get('/danh-sach', async (req, res) => {
  const { rows } = await readTab(TAB);
  const active = rows.filter(r => String(r.KichHoat).toUpperCase() === 'TRUE');
  res.json(active.map(r => ({ ten: r.Ten, vaiTro: r.VaiTro })));
});

router.post('/dang-nhap', async (req, res) => {
  const { ten } = req.body;
  if (!ten) return res.status(400).json({ error: 'Thiếu tên' });

  const { rows } = await readTab(TAB);
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
