// Trợ lý AI (menu "Trợ lý") — 23/10/2026, theo yêu cầu người dùng: CHỈ superadmin; Claude (services/troLyAiService.js), hội thoại nhớ ở máy
// chủ; cấu hình API key / model + bot Telegram (services/telegramAiService.js) ở Settings > Trợ lý AI.
const express = require('express');
const router = express.Router();
const { requireExactRole } = require('../middleware/auth');
const troLy = require('../services/troLyAiService');
const telegramAi = require('../services/telegramAiService');

router.use(requireExactRole('superadmin'));

router.post('/hoi', async (req, res) => {
  const cauHoi = String((req.body && req.body.cauHoi) || '').trim();
  if (!cauHoi) return res.status(400).json({ error: 'Thiếu câu hỏi' });
  const u = req.session.user;
  res.json(await troLy.hoi({ user: u, cauHoi, khoa: 'web:' + u.ten, nguon: 'web' }));
});
router.post('/moi', (req, res) => { troLy.batDauLai('web:' + req.session.user.ten); res.json({ ok: true }); });

// ---- Settings ----
const baoCaoLog = () => require('../services/baoCaoLogService');
const cauHinh = () => ({ ai: troLy.thongTinCauHinh(), telegram: telegramAi.trangThai(), sang: baoCaoLog().cauHinhSang() });
router.get('/cau-hinh', (req, res) => res.json(cauHinh()));
// body: { apiKey ('' = giữ, null = xoá), model, tgToken ('' = giữ, null = xoá), sangBat, sangGio (tóm tắt buổi sáng, 24/10/2026) }
router.put('/cau-hinh', (req, res) => {
  const b = req.body || {};
  try {
    if (b.sangBat !== undefined || b.sangGio !== undefined) baoCaoLog().luuCauHinhSang({ bat: b.sangBat, gio: b.sangGio });
    troLy.luuCauHinh({ apiKey: b.apiKey, model: b.model }); telegramAi.luuToken(b.tgToken);
  }
  catch (err) { return res.status(400).json({ error: err.message }); }
  res.json(cauHinh());
});
router.post('/telegram/ma-lien-ket', (req, res) => {
  if (!telegramAi.trangThai().coToken) return res.status(400).json({ error: 'Lưu bot token trước' });
  res.json({ ...cauHinh(), telegram: telegramAi.taoMaLienKet(req.session.user.ten) });
});
router.post('/telegram/huy-lien-ket', (req, res) => { telegramAi.huyLienKet(); res.json(cauHinh()); });
// Gửi thử ngay qua bot Trợ lý (24/10/2026): tóm tắt buổi sáng / báo cáo tuần theo người -> { ok, loi }.
router.post('/gui-thu/:loai', async (req, res) => {
  const gui = { sang: baoCaoLog().guiTomTatSang, 'theo-nguoi': baoCaoLog().guiBaoCaoTheoNguoi }[req.params.loai];
  if (!gui) return res.status(400).json({ error: 'Loại không hợp lệ' });
  try { res.json(await gui()); } catch (err) { res.json({ ok: false, loi: err.message }); }
});

module.exports = router;
