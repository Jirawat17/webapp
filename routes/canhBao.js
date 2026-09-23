const express = require('express');
const router = express.Router();
const { requireLogin, requireRole, requireExactRole } = require('../middleware/auth');
const { chayKiemTraCanhBao } = require('../services/canhBaoJob');
const { layNguongCanhBao } = require('../services/alertService');
const { datCaiDatCanhBao } = require('../services/caiDatDbService');

router.post('/chay-thu', requireRole('quan_ly'), async (req, res) => {
  await chayKiemTraCanhBao();
  res.json({ ok: true, message: 'Đã chạy kiểm tra cảnh báo — xem log server hoặc Telegram để xác nhận.' });
});

// Ngưỡng số ngày cho 3 mức cảnh báo (bổ sung 23/09/2026, theo yêu cầu người dùng — xem
// services/alertService.js#tinhMucCanhBao). GET yêu cầu đăng nhập thường (chỉ settings.html gọi, trang
// đó đã tự chặn superadmin ở client); POST (đổi giá trị) CHỈ superadmin.
router.get('/nguong', requireLogin, (req, res) => {
  res.json(layNguongCanhBao());
});

router.post('/nguong', requireExactRole('superadmin'), (req, res) => {
  const VANG = Number(req.body.NGUONG_VANG);
  const CAM = Number(req.body.NGUONG_CAM);
  const DO = Number(req.body.NGUONG_DO);
  if (![VANG, CAM, DO].every(n => Number.isInteger(n) && n > 0)) {
    return res.status(400).json({ error: 'Ngưỡng phải là số nguyên dương.' });
  }
  if (!(VANG < CAM && CAM < DO)) {
    return res.status(400).json({ error: 'Ngưỡng phải tăng dần: Vàng < Cam < Đỏ.' });
  }
  datCaiDatCanhBao({ NGUONG_VANG: VANG, NGUONG_CAM: CAM, NGUONG_DO: DO });
  res.json({ ok: true });
});

module.exports = router;
