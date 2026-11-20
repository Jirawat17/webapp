const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { requireLogin, laAdmin } = require('../middleware/auth');

router.use(requireLogin);
router.use((req, res, next) => {
  const vt = req.session.user?.vaiTro;
  if (laAdmin(vt) || vt === 've_file' || vt === 'san_xuat') return next();
  res.status(403).json({ loi: 'Không có quyền.' });
});

router.get('/', async (req, res) => {
  const user = req.session.user;
  const { rows } = await orderService.getAll();
  const loc = orderService.locTheoXuong(rows, user);
  const uu = loc.filter(r => orderService.laUuTien(r))
    .map(r => ({ ma: r.STT_Key, sl: r.SO_LUONG || '' }))
    .filter(x => x.ma);
  res.json({ donUuTien: uu });
});

module.exports = router;
