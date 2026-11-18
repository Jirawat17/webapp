const express = require('express');
const router = express.Router();
const db = require('../services/chiPhiDbService');
const { requireLogin, laSuperAdmin } = require('../middleware/auth');
const { thoiGianVNISOString } = require('../services/dateUtils');

router.use(requireLogin);
router.use((req, res, next) => laSuperAdmin(req.session.user?.vaiTro) ? next() : res.status(403).json({ loi: 'Chỉ superadmin' }));

const LOAI_HOP_LE = ['Thuê nhà', 'Lương nhân viên', 'Điện nước', 'Khác'];

function kiemTra({ ten, so_tien, loai, thang }) {
  if (!String(ten || '').trim()) return 'Chưa nhập tên khoản chi.';
  if (!Number.isFinite(Number(so_tien)) || Number(so_tien) <= 0) return 'Số tiền phải lớn hơn 0.';
  if (!LOAI_HOP_LE.includes(loai)) return 'Loại không hợp lệ.';
  if (!/^\d{4}-\d{2}$/.test(String(thang || ''))) return 'Tháng không hợp lệ (YYYY-MM).';
  return null;
}

// GET /api/chi-phi?thang=YYYY-MM
router.get('/', (req, res) => {
  const thang = String(req.query.thang || '').trim();
  if (!/^\d{4}-\d{2}$/.test(thang)) return res.status(400).json({ loi: 'Thiếu tham số thang (YYYY-MM).' });
  const ds = db.layTheoThang(thang);
  const tong = ds.reduce((s, x) => s + x.so_tien, 0);
  res.json({ ds, tong });
});

// POST /api/chi-phi
router.post('/', (req, res) => {
  const { ten, so_tien, loai, thang, ghi_chu } = req.body;
  const loi = kiemTra({ ten, so_tien, loai, thang });
  if (loi) return res.status(400).json({ loi });
  const r = db.them({ ten: String(ten).trim(), so_tien: Number(so_tien), loai, thang, ghi_chu: String(ghi_chu || '').trim(), ngay_tao: thoiGianVNISOString() });
  res.json({ id: r.lastInsertRowid });
});

// PUT /api/chi-phi/:id
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.layMot(id)) return res.status(404).json({ loi: 'Không tìm thấy.' });
  const { ten, so_tien, loai, thang, ghi_chu } = req.body;
  const loi = kiemTra({ ten, so_tien, loai, thang });
  if (loi) return res.status(400).json({ loi });
  db.capNhat({ id, ten: String(ten).trim(), so_tien: Number(so_tien), loai, thang, ghi_chu: String(ghi_chu || '').trim() });
  res.json({ ok: true });
});

// DELETE /api/chi-phi/:id
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.layMot(id)) return res.status(404).json({ loi: 'Không tìm thấy.' });
  db.xoa(id);
  res.json({ ok: true });
});

module.exports = router;
