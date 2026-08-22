const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get('/thong-ke', async (req, res) => {
  const { rows } = await orderService.getAll();
  const daGanKH = await orderService.ganTenKhachHang(rows);

  const demTheo = (list, key) => list.reduce((acc, r) => {
    const v = r[key] || '(Trống)';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});

  const theoTuan = rows.reduce((acc, r) => {
    if (!r.NGAY_LEN_DON) return acc;
    const d = new Date(r.NGAY_LEN_DON);
    if (isNaN(d)) return acc;
    const dauNam = new Date(d.getFullYear(), 0, 1);
    const soTuan = Math.ceil(((d - dauNam) / 86400000 + dauNam.getDay() + 1) / 7);
    const key = `${d.getFullYear()}-W${soTuan}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  res.json({
    tongSoDon: rows.length,
    theoTrangThai: demTheo(rows, 'TINH_TRANG'),
    theoKhachHang: demTheo(daGanKH, 'TenKhachHang'),
    theoLoaiSanPham: demTheo(rows, 'LOAI'),
    theoTuan,
  });
});

module.exports = router;
