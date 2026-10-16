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

// ---------- Báo cáo logs hằng ngày qua Telegram (15/10/2026) — services/baoCaoLogService.js ----------
// Không bao giờ trả Bot Token về trình duyệt — chỉ bản che (giống token QC ở routes/qc.js).
const baoCaoLog = require('../services/baoCaoLogService');
const cheToken = k => (k ? (k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`) : '');
router.get('/bao-cao-log', (req, res) => {
  const ch = baoCaoLog.layCauHinh();
  res.json({ gio: ch.gio, chat: ch.chat, nguonToken: ch.token ? 'app' : process.env.TELEGRAM_BOT_TOKEN ? 'env' : '', tokenChe: cheToken(ch.token), ngayCuoi: ch.ngayCuoi });
});
// body: { gio: 'HH:MM' | '' (tắt), chat, botToken? (trống = giữ token cũ), xoaToken? }
router.post('/bao-cao-log', (req, res) => {
  const b = req.body || {};
  const gio = String(b.gio || '').trim();
  if (gio && !/^([01]\d|2[0-3]):[0-5]\d$/.test(gio)) return res.status(400).json({ error: 'Giờ gửi không hợp lệ (dạng HH:MM, vd 23:30).' });
  const chat = String(b.chat || '').trim();
  if (chat && !/^-?\d+$|^@\w+$/.test(chat)) return res.status(400).json({ error: 'Chat ID Telegram không hợp lệ (dạng số, vd -1001234567890, hoặc @tenkenh).' });
  if (gio && !chat) return res.status(400).json({ error: 'Đã đặt giờ gửi thì phải nhập Chat ID nhận báo cáo.' });
  const botToken = String(b.botToken || '').trim();
  if (botToken && !/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(botToken)) return res.status(400).json({ error: 'Bot Token không hợp lệ (dạng 123456789:AAE..., lấy từ @BotFather).' });
  baoCaoLog.luuCauHinh({ gio, chat, token: b.xoaToken ? '' : botToken || undefined });
  res.json({ ok: true });
});
// Gửi NGAY báo cáo 24 giờ gần nhất theo cấu hình ĐÃ LƯU (không tính là lần gửi hằng ngày).
router.post('/bao-cao-log/gui-ngay', async (req, res) => {
  let kq;
  try { kq = await baoCaoLog.guiBaoCao(); } catch (err) { kq = { ok: false, loi: 'Lỗi khi tạo báo cáo: ' + err.message }; }
  if (!kq.ok) return res.status(400).json({ error: kq.loi });
  res.json({ ok: true });
});
// Gửi NGAY báo cáo vận hành tuần (7 ngày tới lúc bấm) / danh sách lỗi dữ liệu — cùng chat báo cáo logs (16/10/2026).
router.post('/bao-cao-log/gui-tuan', async (req, res) => {
  const kq = await baoCaoLog.guiBaoCaoTuan();
  if (!kq.ok) return res.status(400).json({ error: kq.loi });
  res.json({ ok: true });
});
router.post('/bao-cao-log/gui-loi-du-lieu', async (req, res) => {
  const kq = await baoCaoLog.guiLoiDuLieuNgay();
  if (!kq.ok) return res.status(400).json({ error: kq.loi });
  res.json({ ok: true, soLoi: kq.soLoi });
});

module.exports = router;
