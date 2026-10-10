// Cấu hình cảnh báo vận hành (11/10/2026, theo yêu cầu người dùng) — chat Telegram vận hành (C3), ngưỡng Y6 / L2. CHỈ superadmin.
const express = require('express');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const vanHanh = require('../services/vanHanhService');
const caiDat = require('../services/caiDatDbService');
const orderService = require('../services/orderService');

router.use(requireLogin, requireExactRole('superadmin'));

// Cấu hình + các giá trị TRANG_THAI_TRACKING THỰC TẾ đang có (kèm số đơn) để superadmin tự tích R3 — không cài sẵn mã GKE nào.
router.get('/cau-hinh', async (req, res) => {
  const { rows } = await orderService.getAll();
  const dem = new Map();
  for (const r of rows) {
    const tt = String(r.TRANG_THAI_TRACKING || '').trim();
    if (r.TRACKING_ID && tt) dem.set(tt, (dem.get(tt) || 0) + 1);
  }
  res.json({ cauHinh: vanHanh.layCauHinh(), trangThaiTracking: [...dem].map(([giaTri, soDon]) => ({ giaTri, soDon })).sort((a, b) => b.soDon - a.soDon) });
});

const soDuong = (v, toiDa) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= toiDa ? n : null; };
router.post('/cau-hinh', (req, res) => {
  const b = req.body || {};
  const gioVe = soDuong(b.y6?.gioVe, 24 * 60), gioChay = soDuong(b.y6?.gioChay, 24 * 60);
  const ngayR1 = soDuong(b.l2?.ngayR1, 365), ngayR2 = soDuong(b.l2?.ngayR2, 365);
  if (!gioVe || !gioChay) return res.status(400).json({ error: 'Số giờ nhắc phải là số nguyên dương.' });
  if (!ngayR1 || !ngayR2) return res.status(400).json({ error: 'Số ngày cảnh báo vận chuyển phải là số nguyên dương.' });
  const chat = String(b.telegramChat || '').trim();
  if (chat && !/^-?\d+$|^@\w+$/.test(chat)) return res.status(400).json({ error: 'Chat ID Telegram không hợp lệ (dạng số, vd -1001234567890, hoặc @tenkenh).' });
  const r3 = Array.isArray(b.l2?.trangThaiR3) ? [...new Set(b.l2.trangThaiR3.map(s => String(s).trim()).filter(Boolean))] : [];
  caiDat.datCaiDatVanHanh({
    TELEGRAM_CHAT: chat,
    Y6_BAT_VE: b.y6?.batVe ? '1' : '0', Y6_GIO_VE: gioVe, Y6_BAT_CHAY: b.y6?.batChay ? '1' : '0', Y6_GIO_CHAY: gioChay,
    L2_BAT_R1: b.l2?.batR1 ? '1' : '0', L2_NGAY_R1: ngayR1, L2_BAT_R2: b.l2?.batR2 ? '1' : '0', L2_NGAY_R2: ngayR2,
    L2_BAT_R3: b.l2?.batR3 ? '1' : '0', L2_TRANG_THAI_R3: JSON.stringify(r3),
  });
  res.json({ ok: true });
});

router.post('/gui-thu', async (req, res) => {
  const kq = await vanHanh.guiTinVanHanh('✅ Tin thử từ Xưởng Thêu — chat Telegram vận hành đã nhận được cảnh báo.');
  if (!kq || !kq.ok) return res.status(400).json({ error: (kq && kq.loi) || 'Không gửi được.' });
  res.json({ ok: true });
});

module.exports = router;
