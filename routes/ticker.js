const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { requireLogin, laAdmin } = require('../middleware/auth');

router.use(requireLogin);
router.use((req, res, next) => {
  const vt = req.session.user?.vaiTro;
  if (laAdmin(vt) || vt === 've_file') return next();
  res.status(403).json({ loi: 'Không có quyền.' });
});

router.get('/', async (req, res) => {
  const { rows } = await orderService.getAll();
  const uu = rows.filter(r => r.DonUuTien).map(r => r.STT_Key).filter(Boolean);
  res.json({ donUuTien: uu });
});

module.exports = router;
