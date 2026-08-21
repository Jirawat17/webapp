const express = require('express');
const router = express.Router();
const { readTab, appendRow, updateCells } = require('../services/sheetsService');
const { requireRole } = require('../middleware/auth');

const TAB = 'NguoiDung';

router.use(requireRole('admin'));

router.get('/', async (req, res) => {
  const { rows } = await readTab(TAB);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { ten, vaiTro, team } = req.body;
  if (!ten || !vaiTro) return res.status(400).json({ error: 'Thiếu tên hoặc vai trò' });

  const { headers, rows } = await readTab(TAB);
  if (rows.some(r => r.Ten === ten)) return res.status(400).json({ error: 'Tên này đã tồn tại' });

  await appendRow(TAB, headers, { Ten: ten, VaiTro: vaiTro, Team: team || '', KichHoat: 'TRUE' });
  res.json({ ok: true });
});

// Đổi vai trò / team / khoá-mở tài khoản
router.put('/:ten', async (req, res) => {
  const { headers, rows } = await readTab(TAB);
  const user = rows.find(r => r.Ten === req.params.ten);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });

  const updates = {};
  ['VaiTro', 'Team', 'KichHoat'].forEach(f => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });

  await updateCells(TAB, headers, user._row, updates);
  res.json({ ok: true });
});

module.exports = router;
