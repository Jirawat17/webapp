const express = require('express');
const router = express.Router();
const taiSanService = require('../services/taiSanService');
const { requireRole } = require('../middleware/auth');

// Mở cho admin (luôn được phép, xem middleware/auth.js) + ve_file + san_xuat + nguoi_lay_phoi.
// (Cập nhật 31/08/2026, theo yêu cầu người dùng) — trước đó nguoi_lay_phoi bị chặn khỏi trang này dù
// đây chính là người trực tiếp lấy phôi ngoài đời; nay được xem tồn kho + tự nhập kho như ve_file/
// san_xuat. Đây là NGOẠI LỆ DUY NHẤT trong chính sách "nguoi_lay_phoi chỉ dùng menu Quét mã QR" — xem
// thêm renderNav() trong public/js/api.js.
router.use(requireRole('ve_file', 'san_xuat', 'nguoi_lay_phoi'));

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
