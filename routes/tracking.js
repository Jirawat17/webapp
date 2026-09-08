const express = require('express');
const router = express.Router();
const { layCauHinh, luuCauHinh, layDanhSachDonAutoTracking } = require('../services/trackingAutoService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Chỉ admin — đây là tính năng có thể phát sinh chi phí thật (mua vận đơn GKE), không mở cho vai trò
// khác xem/đổi cấu hình hay danh sách (thông tin vận hành nội bộ).
function chiAdmin(req, res, next) {
  if (req.session.user.vaiTro !== 'admin') {
    return res.status(403).json({ error: 'Chỉ admin mới được dùng tính năng Tracking' });
  }
  next();
}
router.use(chiAdmin);

router.get('/cau-hinh', async (req, res) => {
  res.json(await layCauHinh());
});

router.post('/cau-hinh', async (req, res) => {
  const { bat, soPhutCho } = req.body;
  if (typeof bat !== 'boolean') return res.status(400).json({ error: 'Thiếu giá trị bật/tắt' });
  const soPhut = Number(soPhutCho);
  if (!Number.isFinite(soPhut) || soPhut <= 0) {
    return res.status(400).json({ error: 'Số phút chờ phải là số dương' });
  }
  await luuCauHinh({ bat, soPhutCho: soPhut });
  res.json({ ok: true });
});

router.get('/danh-sach', async (req, res) => {
  res.json(await layDanhSachDonAutoTracking());
});

module.exports = router;
