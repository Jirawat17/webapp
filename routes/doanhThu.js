const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { layTeam } = require('../services/donNhieuAoService');
const { parseNgay } = require('../services/dateUtils');
const { requireLogin, laSuperAdmin } = require('../middleware/auth');

router.use(requireLogin);
router.use((req, res, next) => laSuperAdmin(req.session.user?.vaiTro) ? next() : res.status(403).json({ loi: 'Chỉ superadmin' }));

// "$25,50" (phẩy thập phân) → 25.50 | "$1,234.50" (phẩy ngàn) → 1234.50 | "$103.50" → 103.50
function parseTien(s) {
  const clean = String(s || '').replace(/[$\s]/g, '');
  if (!clean) return 0;
  // Phẩy ở cuối sau đúng 2 chữ số, không có dấu chấm → phẩy là thập phân
  if (/,\d{2}$/.test(clean) && !clean.includes('.'))
    return Number(clean.replace(',', '.')) || 0;
  return Number(clean.replace(/,/g, '')) || 0;
}

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
    if (!theoXuong.has(xuong)) theoXuong.set(xuong, { xuong, tongTien: 0, soDon: 0, tongSanPham: 0 });
    const nhom = theoXuong.get(xuong);
    nhom.soDon++;
    nhom.tongSanPham += Number(r.SO_LUONG) || 0;
    nhom.tongTien += parseTien(r.TOTAL);
  }

  const danhSach = [...theoXuong.values()].sort((a, b) => b.tongTien - a.tongTien);
  const tongDoanhThu = danhSach.reduce((t, x) => t + x.tongTien, 0);
  const tongSanPham = danhSach.reduce((t, x) => t + x.tongSanPham, 0);

  const theoTeam = new Map();
  for (const r of filtered) {
    const team = layTeam(r.STT_Key) || '(Không rõ)';
    if (!theoTeam.has(team)) theoTeam.set(team, { team, tongTien: 0, soDon: 0, tongSanPham: 0 });
    const nhom = theoTeam.get(team);
    nhom.soDon++;
    nhom.tongSanPham += Number(r.SO_LUONG) || 0;
    nhom.tongTien += parseTien(r.TOTAL);
  }
  const danhSachTeam = [...theoTeam.values()].sort((a, b) => b.tongTien - a.tongTien);

  res.json({ tongDoanhThu, tongDon: filtered.length, tongSanPham, theoXuong: danhSach, theoTeam: danhSachTeam });
});

module.exports = router;
