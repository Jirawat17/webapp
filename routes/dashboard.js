const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { parseNgay } = require('../services/dateUtils');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get('/thong-ke', async (req, res) => {
  const { rows: tatCaDon } = await orderService.getAll();

  // Lọc theo khoảng NGAY_LEN_DON nếu FE gửi kèm tuNgay/denNgay (nút Hôm nay/Tuần này/Tháng
  // này/Tuỳ chọn ở dashboard.html) — không truyền gì thì giữ nguyên hành vi cũ: thống kê toàn bộ.
  const { tuNgay, denNgay } = req.query;
  let rows = tatCaDon;
  if (tuNgay || denNgay) {
    const tu = tuNgay ? new Date(`${tuNgay}T00:00:00`) : null;
    const den = denNgay ? new Date(`${denNgay}T23:59:59`) : null;
    rows = tatCaDon.filter(r => {
      const d = parseNgay(r.NGAY_LEN_DON);
      if (!d) return false;
      if (tu && d < tu) return false;
      if (den && d > den) return false;
      return true;
    });
  }

  const daGanKH = await orderService.ganTenKhachHang(rows);

  const demTheo = (list, key) => list.reduce((acc, r) => {
    const v = r[key] || '(Trống)';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});

  const theoTuan = rows.reduce((acc, r) => {
    const d = parseNgay(r.NGAY_LEN_DON);
    if (!d) return acc;
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
