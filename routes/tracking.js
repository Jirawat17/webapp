const express = require('express');
const router = express.Router();
const { layCauHinh, luuCauHinh, layDanhSachDonAutoTracking, layLogTracking, muaTrackingChoDon } = require('../services/trackingAutoService');
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

// Mua tracking THỦ CÔNG cho 1 đơn bất kỳ — bổ sung 09/09/2026, theo yêu cầu người dùng. Dùng CHUNG
// lõi muaTrackingChoDon() với job tự động (chống trùng vận đơn, không đổi TRANG_THAI_XUONG
// — xem services/trackingAutoService.js) — CHỈ khác ở chỗ truyền người dùng đang đăng nhập thật vào,
// để log/lịch sử ghi đúng người bấm. Gọi từ CẢ 2 nơi: bảng danh sách ở trang "Tracking" (đơn đã bật
// AUTO_TRACKING) và trang chi tiết đơn order.html (đơn bất kỳ, không cần AUTO_TRACKING="YES").
router.post('/mua-thu-cong', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn' });

  try {
    const cauHinhGke = await layCauHinhGke();
    const ketQua = await muaTrackingChoDon(sttKey, cauHinhGke, user);
    if (!ketQua) return res.status(400).json({ error: 'Đơn này đã có mã tracking thật rồi — không mua lại.' });
    res.json({ ok: true, trackingNum: ketQua.tracking_num, hangVanChuyen: ketQua.delivery_carrier });
  } catch (err) {
    const khongTimThayDon = /Không tìm thấy đơn/.test(err.message);
    console.error(`[TrackingThuCong] Lỗi mua tracking cho ${sttKey}:`, err.stack || err.message);
    res.status(khongTimThayDon ? 404 : 502).json({ error: err.message });
  }
});

module.exports = router;
