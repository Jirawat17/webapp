const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get('/thong-ke', async (req, res) => {
  const { rows } = await orderService.getAll();

  const demTheo = (key) => rows.reduce((acc, r) => {
    const v = r[key] || '(Trống)';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});

  const theoTuan = rows.reduce((acc, r) => {
    if (!r.Ngay_Dat) return acc;
    const d = new Date(r.Ngay_Dat);
    if (isNaN(d)) return acc;
    const dauNam = new Date(d.getFullYear(), 0, 1);
    const soTuan = Math.ceil(((d - dauNam) / 86400000 + dauNam.getDay() + 1) / 7);
    const key = `${d.getFullYear()}-W${soTuan}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  res.json({
    tongSoDon: rows.length,
    theoTrangThai: demTheo('Trang_Thai'),
    theoTeam: demTheo('Team_San_Xuat'),
    theoNguoiVeFile: demTheo('Nguoi_Ve_File'),
    theoTuan,
  });
});

module.exports = router;
