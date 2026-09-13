const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const donHangLoatService = require('../services/donHangLoatService');
const { requireRole } = require('../middleware/auth');

// Toàn bộ tính năng "Đơn hàng loạt" (gợi ý + quản lý chính thức) CHỈ dành admin/ve_file — gộp 1 chỗ
// duy nhất (khác routes/orders.js vốn có nhiều phạm vi quyền khác nhau trộn lẫn trong 1 file) vì MỌI
// route bên dưới đều cần đúng 1 phạm vi quyền này, không có ngoại lệ. admin luôn được phép (xem
// middleware/auth.js#requireRole).
router.use(requireRole('ve_file'));

// Chuyển nguyên từ routes/orders.js GET /rasoat-hang-loat (xem
// docs/superpowers/specs/2026-09-13-rasoat-hang-loat-review-design.md) — CHỈ ĐỌC, liệt kê nhóm đề
// xuất tự động (NHOM_HANG_LOAT), KHÔNG tự quét lại. Đặt trước /:maDonHangLoat (nếu có) theo đúng thói
// quen rút ra từ lỗi route bị nuốt trước đây, dù ở đây method/số đoạn đường dẫn đã khác nhau nên
// không thực sự va nhau.
router.get('/goi-y', async (req, res) => {
  const user = req.session.user;
  const { rows } = await orderService.getAll();
  const daLoc = orderService.locTheoXuong(rows, user);

  const theoNhom = new Map();
  for (const r of daLoc) {
    if (!r.NHOM_HANG_LOAT) continue;
    if (!theoNhom.has(r.NHOM_HANG_LOAT)) theoNhom.set(r.NHOM_HANG_LOAT, []);
    theoNhom.get(r.NHOM_HANG_LOAT).push({
      STT_Key: r.STT_Key,
      TieuDeSanPham: orderService.tieuDeSanPham(r),
      DUONG_DAN_URL: r.DUONG_DAN_URL || '',
    });
  }

  const nhoms = [...theoNhom.entries()]
    .map(([maNhom, donHang]) => ({ maNhom, donHang }))
    .sort((a, b) => b.donHang.length - a.donHang.length);

  res.json({ nhoms });
});

router.get('/nguong', async (req, res) => {
  res.json({ nguong: await donHangLoatService.layNguong() });
});

router.put('/nguong', async (req, res) => {
  try {
    await donHangLoatService.datNguong(req.body.nguong, req.session.user);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/', async (req, res) => {
  res.json({ nhoms: await donHangLoatService.layDanhSachNhom(req.session.user) });
});

router.post('/', async (req, res) => {
  try {
    const maDonHangLoat = await donHangLoatService.xacNhanNhomMoi(req.body, req.session.user);
    res.json({ ok: true, maDonHangLoat });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:maDonHangLoat/them-don', async (req, res) => {
  try {
    await donHangLoatService.themDonVaoNhom(req.params.maDonHangLoat, req.body.sttKey, req.session.user);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:maDonHangLoat/don/:sttKey', async (req, res) => {
  try {
    await donHangLoatService.xoaDonKhoiNhom(req.params.maDonHangLoat, req.params.sttKey, req.session.user);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:maDonHangLoat/ten', async (req, res) => {
  try {
    await donHangLoatService.doiTenNhom(req.params.maDonHangLoat, req.body.tenNhom, req.session.user);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:maDonHangLoat', async (req, res) => {
  try {
    await donHangLoatService.xoaNhom(req.params.maDonHangLoat, req.session.user);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
