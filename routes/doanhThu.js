const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { parseNgay } = require('../services/dateUtils');
const { requireLogin, laSuperAdmin } = require('../middleware/auth');

router.use(requireLogin);
router.use((req, res, next) => laSuperAdmin(req.session.user?.vaiTro) ? next() : res.status(403).json({ loi: 'Chỉ superadmin' }));

router.get('/', async (req, res) => {
  const { rows: tatCa } = await orderService.getAll();
  const rows = orderService.locTheoXuong(tatCa, req.session.user);

  const { tuNgay, denNgay } = req.query;
  let filtered = rows;
  if (tuNgay || denNgay) {
    const tu = tuNgay ? new Date(`${tuNgay}T00:00:00`) : null;
    const den = denNgay ? new Date(`${denNgay}T23:59:59`) : null;
    filtered = rows.filter(r => {
      const d = parseNgay(r.NGAY_LEN_DON);
      if (!d) return false;
      if (tu && d < tu) return false;
      if (den && d > den) return false;
      return true;
    });
  }

  const theoXuong = new Map();
  for (const r of filtered) {
    const xuong = (r.XUONG || '').trim() || '(Chưa gán)';
    if (!theoXuong.has(xuong)) theoXuong.set(xuong, { xuong, tongTien: 0, soDon: 0 });
    const nhom = theoXuong.get(xuong);
    nhom.soDon++;
    nhom.tongTien += Number(r.TOTAL) || 0;
  }

  const danhSach = [...theoXuong.values()].sort((a, b) => b.tongTien - a.tongTien);
  const tongDoanhThu = danhSach.reduce((t, x) => t + x.tongTien, 0);

  res.json({ tongDoanhThu, tongDon: filtered.length, theoXuong: danhSach });
});

module.exports = router;
