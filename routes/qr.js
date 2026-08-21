const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { ghiLog, layLichSuTheoDon } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');
const scenarios = require('../data/scenarios');

router.use(requireLogin);

// Quét đơn lẻ để tra cứu — CHỈ đọc thông tin, không đổi trạng thái gì cả
router.get('/tra-cuu/:sttKey', async (req, res) => {
  const { row } = await orderService.getByKey(req.params.sttKey);
  const user = req.session.user;

  if (!row) {
    await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_TRA_CUU_LOI', sttKey: req.params.sttKey, chiTiet: 'Không tìm thấy đơn' });
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng với mã: ' + req.params.sttKey });
  }

  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_TRA_CUU', sttKey: req.params.sttKey });
  const lichSu = await layLichSuTheoDon(req.params.sttKey);
  res.json({ ...row, lichSu });
});

// Danh sách kịch bản quét hàng loạt mà vai trò hiện tại được phép dùng
router.get('/kich-ban', (req, res) => {
  const user = req.session.user;
  const list = scenarios.filter(s => user.vaiTro === 'admin' || s.allowedRoles.includes(user.vaiTro));
  res.json(list.map(({ id, label, requireStatus, setStatus }) => ({ id, label, requireStatus, setStatus })));
});

// Quét theo kịch bản — đổi trạng thái nếu đơn đang đúng trạng thái yêu cầu, ghi log kể cả khi lỗi
router.post('/kich-ban/:scenarioId/quet', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;
  const scenario = scenarios.find(s => s.id === req.params.scenarioId);

  if (!scenario) return res.status(404).json({ error: 'Không tìm thấy kịch bản' });
  if (user.vaiTro !== 'admin' && !scenario.allowedRoles.includes(user.vaiTro)) {
    return res.status(403).json({ error: 'Vai trò của bạn không được dùng kịch bản này' });
  }
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const { row } = await orderService.getByKey(sttKey);
  if (!row) {
    await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_LOI', sttKey, chiTiet: { scenario: scenario.id, loi: 'Không tìm thấy đơn' } });
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng với mã: ' + sttKey });
  }

  if (scenario.requireStatus && row.Trang_Thai !== scenario.requireStatus) {
    await ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_SAI_TRANG_THAI',
      sttKey, chiTiet: { scenario: scenario.id, trangThaiHienTai: row.Trang_Thai },
    });
    return res.status(400).json({
      error: `Đơn đang ở trạng thái '${row.Trang_Thai}', cần '${scenario.requireStatus}' để dùng kịch bản này`,
    });
  }

  const updates = { ...(scenario.setFields || {}) };
  if (scenario.setStatus) updates.Trang_Thai = scenario.setStatus;
  Object.keys(updates).forEach(k => {
    if (updates[k] === '__TODAY__') updates[k] = new Date().toLocaleDateString('vi-VN');
  });
  updates.NguoiCapNhatCuoi = user.ten;
  updates.ThoiGianCapNhatCuoi = new Date().toISOString();

  const updated = await orderService.update(sttKey, updates);
  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KICH_BAN', sttKey, chiTiet: { scenario: scenario.id, ketQua: updates } });
  res.json({ ok: true, don: updated });
});

module.exports = router;
