const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { chayKiemTraCanhBao } = require('../services/canhBaoJob');

router.post('/chay-thu', requireRole('quan_ly'), async (req, res) => {
  await chayKiemTraCanhBao();
  res.json({ ok: true, message: 'Đã chạy kiểm tra cảnh báo — xem log server hoặc Telegram để xác nhận.' });
});

module.exports = router;
