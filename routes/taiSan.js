const express = require('express');
const router = express.Router();
const taiSanService = require('../services/taiSanService');
const { requireRole } = require('../middleware/auth');

// Mở cho admin (luôn được phép, xem middleware/auth.js) + ve_file + san_xuat — KHÔNG mở cho
// nguoi_lay_phoi (đã xác nhận rõ với người dùng, dù đây là vai trò trực tiếp lấy phôi ngoài đời,
// vai trò này vẫn chỉ dùng đúng 1 menu "Quét mã QR" trong toàn app).
router.use(requireRole('ve_file', 'san_xuat'));

router.get('/ton-kho', async (req, res) => {
  const list = await taiSanService.layTonKho();
  res.json(list);
});

router.get('/lich-su-nhap', async (req, res) => {
  const list = await taiSanService.layLichSuNhap();
  res.json(list);
});

router.post('/nhap-kho', async (req, res) => {
  const { loai, kichThuoc, mauSac, soLuong, ghiChu } = req.body;
  const user = req.session.user;

  if (!loai || !kichThuoc || !mauSac) {
    return res.status(400).json({ error: 'Thiếu Loại / Kích thước / Màu sắc' });
  }
  const soLuongSo = Number(soLuong);
  if (!soLuongSo || soLuongSo <= 0) {
    return res.status(400).json({ error: 'Số lượng nhập phải là số dương' });
  }

  await taiSanService.nhapKho({
    loai: String(loai).trim(), kichThuoc: String(kichThuoc).trim(), mauSac: String(mauSac).trim(),
    soLuong: soLuongSo, nguoiNhap: user.ten, ghiChu: (ghiChu || '').trim(),
  });
  res.json({ ok: true });
});

module.exports = router;
