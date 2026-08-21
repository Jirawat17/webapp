const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { ghiLog, layLichSuTheoDon } = require('../services/logService');
const { requireLogin, requireRole } = require('../middleware/auth');

router.use(requireLogin);

// Danh sách đơn hàng — tự lọc theo vai trò, có thể lọc thêm qua query string
router.get('/', async (req, res) => {
  const { rows } = await orderService.getAll();
  let list = orderService.filterForRole(rows, req.session.user);

  const { trangThai, kh, team } = req.query;
  if (trangThai) list = list.filter(r => r.Trang_Thai === trangThai);
  if (kh) list = list.filter(r => (r.Ten_KH || '').toLowerCase().includes(kh.toLowerCase()));
  if (team) list = list.filter(r => r.Team_San_Xuat === team);

  list.sort((a, b) => new Date(a.Ngay_Giao_Du_Kien) - new Date(b.Ngay_Giao_Du_Kien));
  res.json(list);
});

router.get('/:sttKey', async (req, res) => {
  const { row } = await orderService.getByKey(req.params.sttKey);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  const lichSu = await layLichSuTheoDon(req.params.sttKey);
  res.json({ ...row, lichSu });
});

// Mỗi vai trò chỉ được sửa đúng những cột thuộc phần việc của mình — admin/quản lý sửa được tất cả
const TRUONG_DUOC_SUA = {
  ve_file: ['Co_File_Ve', 'Nguoi_Ve_File', 'Ghi_Chu_Xuong'],
  chuan_bi_phoi: ['Co_Phoi', 'Ghi_Chu_Xuong'],
  san_xuat: ['Trang_Thai', 'Ghi_Chu_Xuong'],
  dong_goi: ['Trang_Thai', 'Trang_Thai_Ship', 'Ma_Van_Don', 'Ghi_Chu_Xuong'],
};

router.put('/:sttKey', async (req, res) => {
  const user = req.session.user;
  const allowed = TRUONG_DUOC_SUA[user.vaiTro]; // undefined cho admin/quan_ly = được sửa hết
  let updates = req.body;

  if (allowed) {
    updates = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Không có trường nào được phép sửa với vai trò này' });
  }

  updates.NguoiCapNhatCuoi = user.ten;
  updates.ThoiGianCapNhatCuoi = new Date().toISOString();

  const updated = await orderService.update(req.params.sttKey, updates);
  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CAP_NHAT_DON',
    sttKey: req.params.sttKey, chiTiet: updates,
  });
  res.json(updated);
});

// Phân công team sản xuất cho đơn mới — chỉ quản lý/admin
router.post('/:sttKey/phan-cong', requireRole('quan_ly'), async (req, res) => {
  const { team } = req.body;
  if (!team) return res.status(400).json({ error: 'Thiếu tên team' });

  const user = req.session.user;
  const updates = { Team_San_Xuat: team, NguoiCapNhatCuoi: user.ten, ThoiGianCapNhatCuoi: new Date().toISOString() };
  const updated = await orderService.update(req.params.sttKey, updates);

  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'PHAN_CONG_TEAM',
    sttKey: req.params.sttKey, chiTiet: { team },
  });
  res.json(updated);
});

module.exports = router;
