// Giờ đóng truy cập theo Xưởng (23/10/2026) — services/gioTruyCapService.js. Thiết lập / mở tạm: CHỈ superadmin + mật khẩu xác nhận.
const express = require('express');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const { ghiLog } = require('../services/logService');
const svc = require('../services/gioTruyCapService');

// Trạng thái của chính người đang đăng nhập (trang tự hẹn giờ thông báo trước 60 / 30 phút). null = không bị giới hạn.
router.get('/trang-thai', requireLogin, (req, res) => res.json(svc.trangThaiChoUser(req.session.user)));

router.get('/', requireExactRole('superadmin'), (req, res) => res.json(svc.layThietLap()));

const kiemMatKhau = (req, res, next) => {
  const loi = svc.kiemTraMatKhau(req.body && req.body.matKhau);
  return loi ? res.status(403).json({ error: loi }) : next();
};

router.put('/', requireExactRole('superadmin'), kiemMatKhau, async (req, res) => {
  let ds;
  try { ds = svc.luuThietLap(req.body.ds); } catch (err) { return res.status(400).json({ error: err.message }); }
  const u = req.session.user;
  await ghiLog({ nguoiDung: u.ten, vaiTro: u.vaiTro, hanhDong: 'CAI_DAT_GIO_TRUY_CAP',
    chiTiet: { _chu: ds.map(d => `${d.ten}: ${d.bat ? `đóng ${d.tu}–${d.den}` : 'tắt'}`).join(' · ') } });
  res.json(svc.layThietLap());
});

router.post('/mo-tam', requireExactRole('superadmin'), kiemMatKhau, async (req, res) => {
  const xuong = String(req.body.xuong || ''), den = String(req.body.den || '');
  let gio;
  try { gio = svc.datMoTam(xuong, den); } catch (err) { return res.status(400).json({ error: err.message }); }
  const u = req.session.user;
  await ghiLog({ nguoiDung: u.ten, vaiTro: u.vaiTro, hanhDong: 'MO_TAM_GIO_TRUY_CAP',
    chiTiet: { _chu: gio ? `mở tạm Xưởng ${xuong} tới ${gio}` : `huỷ mở tạm Xưởng ${xuong}` } });
  res.json(svc.layThietLap());
});

module.exports = router;
