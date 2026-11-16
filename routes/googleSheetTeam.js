// API quản lý link Google Sheet theo Team Seller (16/11/2026, theo yêu cầu người dùng).
// Team = nhóm chữ cái trong STT_Key (vd "11DUC62" -> "DUC"). CHỈ superadmin ghi, mọi người đăng nhập đọc.
const express = require('express');
const router = express.Router();
const { requireLogin, laSuperAdmin } = require('../middleware/auth');
const caiDatDbService = require('../services/caiDatDbService');

router.use(requireLogin);

router.get('/', (req, res) => {
  res.json(caiDatDbService.layDanhSachGoogleSheet());
});

router.get('/:team', (req, res) => {
  const row = caiDatDbService.layGoogleSheetCuaTeam(req.params.team);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy team' });
  res.json(row);
});

router.post('/', (req, res) => {
  if (!laSuperAdmin(req.session.user.vaiTro)) return res.status(403).json({ error: 'Chỉ superadmin được thay đổi cấu hình này.' });
  const { team, sheet_url, ghi_chu } = req.body;
  if (!team || !String(team).trim()) return res.status(400).json({ error: 'Team không được để trống.' });
  const urlStr = String(sheet_url || '').trim();
  if (!urlStr) return res.status(400).json({ error: 'Link Google Sheet không được để trống.' });
  if (!/^https?:\/\//i.test(urlStr)) return res.status(400).json({ error: 'Link Google Sheet phải bắt đầu bằng https://' });
  try {
    caiDatDbService.luuGoogleSheet(team, urlStr, ghi_chu || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:team', (req, res) => {
  if (!laSuperAdmin(req.session.user.vaiTro)) return res.status(403).json({ error: 'Chỉ superadmin được thay đổi cấu hình này.' });
  caiDatDbService.xoaGoogleSheet(req.params.team);
  res.json({ ok: true });
});

module.exports = router;
