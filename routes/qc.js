// Menu QC — AI QC (30/09/2026, theo yêu cầu người dùng). CHỈ superadmin, chặn ở đây cho MỌI route (không chỉ ẩn menu).
// API key KHÔNG BAO GIỜ trả nguyên văn ra trình duyệt — chỉ dạng che (AIza…xyz9). Logic QC: services/qc/qcService.js.
const express = require('express');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const caiDatDbService = require('../services/caiDatDbService');
const nhatKyDbService = require('../services/nhatKyDbService');
const qcService = require('../services/qc/qcService');

router.use(requireLogin, requireExactRole('superadmin'));

const cheKey = k => (k ? (k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`) : '');

router.get('/cau-hinh', (req, res) => {
  res.json(Object.entries(qcService.LOAI_QC).map(([loai, ten]) => {
    const { apiKey, model } = qcService.layCauHinh(loai);
    return { loai, ten, model, coKey: !!apiKey, keyChe: cheKey(apiKey), daTrienKhai: qcService.LOAI_DA_TRIEN_KHAI.includes(loai) };
  }));
});

// body: { loai, model, apiKey?, xoaKey? } — apiKey trống = giữ key cũ; xoaKey: true = xoá key.
router.post('/cau-hinh', (req, res) => {
  const { loai, apiKey, xoaKey } = req.body;
  const model = String(req.body.model || '').trim();
  if (!qcService.LOAI_QC[loai]) return res.status(400).json({ error: 'Loại QC không hợp lệ — chỉ QC1, QC2, QC3.' });
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) return res.status(400).json({ error: 'Tên model không hợp lệ (vd gemini-2.5-flash).' });
  const keyMoi = String(apiKey || '').trim();
  if (keyMoi && !/^[\x21-\x7e]{10,200}$/.test(keyMoi)) return res.status(400).json({ error: 'API key không hợp lệ.' });
  caiDatDbService.datCauHinhQc(loai, { Model: model, ...(xoaKey ? { ApiKey: '' } : keyMoi ? { ApiKey: keyMoi } : {}) });
  res.json({ ok: true });
});

router.post('/thu-ket-noi', async (req, res) => {
  try {
    await qcService.thuKetNoi(req.body.loai);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
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
