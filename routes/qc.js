// Menu QC — AI QC (30/09/2026, theo yêu cầu người dùng). CHỈ superadmin, chặn ở đây cho MỌI route (không chỉ ẩn menu).
// API key KHÔNG BAO GIỜ trả nguyên văn ra trình duyệt — chỉ dạng che (AIza…xyz9, sk-a…xyz9). Logic QC: services/qc/qcService.js.
const express = require('express');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const caiDatDbService = require('../services/caiDatDbService');
const nhatKyDbService = require('../services/nhatKyDbService');
const qcService = require('../services/qc/qcService');

router.use(requireLogin, requireExactRole('superadmin'));

const cheKey = k => (k ? (k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`) : '');

// Mỗi QC: nhà cung cấp đang dùng + cấu hình riêng của từng nhà cung cấp (Gemini/Claude lưu song song, 01/10/2026).
router.get('/cau-hinh', (req, res) => {
  res.json(Object.entries(qcService.LOAI_QC).map(([loai, ten]) => {
    const nhaCungCap = qcService.layCauHinh(loai).nhaCungCap;
    const theoNcc = Object.fromEntries(Object.keys(qcService.NHA_CUNG_CAP).map(ncc => {
      const { apiKey, model } = qcService.layCauHinh(loai, ncc);
      return [ncc, { model, coKey: !!apiKey, keyChe: cheKey(apiKey) }];
    }));
    return { loai, ten, nhaCungCap, theoNcc, daTrienKhai: qcService.LOAI_DA_TRIEN_KHAI.includes(loai) };
  }));
});

// body: { loai, nhaCungCap, model, apiKey?, xoaKey? } — lưu key/model CỦA nhà cung cấp đó + chọn nó làm nhà cung cấp
// đang dùng cho QC này. apiKey trống = giữ key cũ; xoaKey: true = xoá key (chỉ key của nhà cung cấp đó).
router.post('/cau-hinh', (req, res) => {
  const { loai, apiKey, xoaKey } = req.body;
  const nhaCungCap = req.body.nhaCungCap || 'gemini';
  const model = String(req.body.model || '').trim();
  if (!qcService.LOAI_QC[loai]) return res.status(400).json({ error: 'Loại QC không hợp lệ — chỉ QC1, QC2, QC3.' });
  if (!Object.hasOwn(qcService.NHA_CUNG_CAP, nhaCungCap)) return res.status(400).json({ error: 'Nhà cung cấp AI không hợp lệ — chỉ Gemini, Gemini (Agent Platform) hoặc Claude.' });
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) return res.status(400).json({ error: 'Tên model không hợp lệ (vd gemini-2.5-flash, claude-sonnet-5-5).' });
  const keyMoi = String(apiKey || '').trim();
  if (keyMoi && !/^[\x21-\x7e]{10,200}$/.test(keyMoi)) return res.status(400).json({ error: 'API key không hợp lệ.' });
  const { cotKey, cotModel } = qcService.NHA_CUNG_CAP[nhaCungCap];
  caiDatDbService.datCauHinhQc(loai, { NhaCungCap: nhaCungCap, [cotModel]: model, ...(xoaKey ? { [cotKey]: '' } : keyMoi ? { [cotKey]: keyMoi } : {}) });
  res.json({ ok: true });
});

// body: { loai, nhaCungCap? } — thử cấu hình ĐÃ LƯU của nhà cung cấp đó (mặc định: nhà cung cấp đang dùng).
router.post('/thu-ket-noi', async (req, res) => {
  try {
    await qcService.thuKetNoi(req.body.loai, req.body.nhaCungCap);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Cảnh báo Telegram (01/10/2026) — 1 Chat ID chung cho cả 3 QC; trống = tắt. Bot Token nhập ở đây (chỉ trả dạng che),
// trống = dùng TELEGRAM_BOT_TOKEN trong .env.
router.get('/telegram', (req, res) => {
  const { chatId, botToken } = caiDatDbService.layTelegramQc();
  res.json({ chatId, nguonToken: botToken ? 'app' : process.env.TELEGRAM_BOT_TOKEN ? 'env' : '', tokenChe: cheKey(botToken) });
});
// body: { chatId, botToken?, xoaToken? } — botToken trống = giữ token cũ.
router.post('/telegram', (req, res) => {
  const chatId = String(req.body.chatId || '').trim();
  const botToken = String(req.body.botToken || '').trim();
  if (chatId && !/^(-?\d{3,20}|@[A-Za-z0-9_]{5,32})$/.test(chatId)) return res.status(400).json({ error: 'Chat ID không hợp lệ (vd -1001234567890 hoặc @tenkenh).' });
  if (botToken && !/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(botToken)) return res.status(400).json({ error: 'Bot Token không hợp lệ (dạng 123456789:AAE..., lấy từ @BotFather).' });
  caiDatDbService.datTelegramQc({ chatId, ...(req.body.xoaToken ? { botToken: '' } : botToken ? { botToken } : {}) });
  res.json({ ok: true });
});
router.post('/telegram/gui-thu', async (req, res) => {
  try {
    await qcService.guiThuTelegram();
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Ngưỡng kết luận riêng từng QC (01/10/2026): pass/fail = score 0–100, ccl = độ chắc chắn tối thiểu (%). Xem qcService#quyetDinhKetQua.
router.get('/nguong', (req, res) => {
  res.json({
    macDinh: qcService.NGUONG_MAC_DINH,
    ds: Object.entries(qcService.LOAI_QC).map(([loai, ten]) => {
      const n = qcService.layNguong(loai);
      return { loai, ten, ...n, loi: qcService.kiemTraNguong(n, ten) };
    }),
  });
});
// body: { nguong: { QC1: { pass, fail, ccl }, ... } } — kiểm tra TẤT CẢ trước, 1 QC sai thì không lưu QC nào. Giá trị lưu
// đúng như người dùng nhập (không tự làm tròn/sửa).
router.post('/nguong', (req, res) => {
  const nguong = req.body && typeof req.body.nguong === 'object' && req.body.nguong ? req.body.nguong : {};
  const cacLoai = Object.keys(nguong);
  if (!cacLoai.length) return res.status(400).json({ error: 'Chưa có ngưỡng nào để lưu.' });
  for (const loai of cacLoai) {
    if (!Object.hasOwn(qcService.LOAI_QC, loai)) return res.status(400).json({ error: `Loại QC không hợp lệ: ${loai}.` });
    const loi = qcService.kiemTraNguong(nguong[loai], qcService.LOAI_QC[loai]);
    if (loi) return res.status(400).json({ error: loi, loai });
  }
  for (const loai of cacLoai) {
    const { pass, fail, ccl } = nguong[loai];
    caiDatDbService.datCauHinhQc(loai, { NguongPass: String(qcService.docSo(pass)), NguongFail: String(qcService.docSo(fail)), NguongCcl: String(qcService.docSo(ccl)) });
  }
  res.json({ ok: true });
});

router.post('/chay', async (req, res) => {
  try {
    res.json(await qcService.chayQc({ sttKey: req.body.sttKey, loai: req.body.loai, user: req.session.user }));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

router.get('/log', (req, res) => {
  const { loaiQc, ketQua, sttKey, gioiHan } = req.query;
  res.json(nhatKyDbService.layQcLog({ loaiQc, ketQua, sttKey: sttKey ? String(sttKey).trim() : '', gioiHan }));
});

module.exports = router;
