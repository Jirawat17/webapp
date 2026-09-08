const express = require('express');
const router = express.Router();
const { layCauHinh, luuCauHinh, layDanhSachDonAutoTracking, layLogTracking } = require('../services/trackingAutoService');
const { layCauHinhGke, luuCauHinhGke } = require('../services/gkeService');
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

// Cấu hình GKE (tài khoản API, thông tin người gửi, khai báo hải quan, cân nặng mặc định) — thêm
// 09/09/2026, theo yêu cầu người dùng đưa toàn bộ lên giao diện thay vì nằm cứng trong .env. Người
// dùng đã CHỦ ĐỘNG chọn đưa cả username/password API GKE lên giao diện (không giữ riêng trong .env
// như đề xuất ban đầu) — xem docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md.
router.get('/cau-hinh-gke', async (req, res) => {
  res.json(await layCauHinhGke());
});

router.post('/cau-hinh-gke', async (req, res) => {
  await luuCauHinhGke(req.body || {});
  res.json({ ok: true });
});

router.get('/logs', (req, res) => {
  res.json(layLogTracking());
});

module.exports = router;
