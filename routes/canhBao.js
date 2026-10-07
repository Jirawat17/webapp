const express = require('express');
const router = express.Router();
const { requireLogin, requireRole, requireExactRole } = require('../middleware/auth');
const { chayKiemTraCanhBao } = require('../services/canhBaoJob');
const { layCauHinhCanhBao } = require('../services/alertService');
const { THU_TU_TINH_TRANG, chiSoTinhTrang } = require('../data/pipelineTinhTrang');
const { datCaiDatCanhBao } = require('../services/caiDatDbService');

router.post('/chay-thu', requireRole('quan_ly'), async (req, res) => {
  await chayKiemTraCanhBao();
  res.json({ ok: true, message: 'Đã chạy kiểm tra cảnh báo — xem log server hoặc Telegram để xác nhận.' });
});

// Ngưỡng số ngày cho 3 mức cảnh báo (bổ sung 23/09/2026, theo yêu cầu người dùng — xem
// services/alertService.js#tinhMucCanhBao). GET yêu cầu đăng nhập thường (chỉ settings.html gọi, trang
// đó đã tự chặn superadmin ở client); POST (đổi giá trị) CHỈ superadmin.
// 07/10/2026: mỗi mức thêm trạng thái đầu vào/đầu ra + bật/tắt; bỏ ràng buộc tăng dần (đơn trúng nhiều mức lấy mức cao nhất).
router.get('/nguong', requireLogin, (req, res) => {
  res.json({ cauHinh: layCauHinhCanhBao(), trangThai: THU_TU_TINH_TRANG });
});

const TEN_MUC = { VANG: 'Vàng', CAM: 'Cam', DO: 'Đỏ' };
router.post('/nguong', requireExactRole('superadmin'), (req, res) => {
  const luu = {};
  for (const m of Object.keys(TEN_MUC)) {
    const ch = (req.body || {})[m] || {};
    const soNgay = Number(ch.soNgay);
    const vao = String(ch.vao || '');
    const ra = String(ch.ra || '');
    if (!Number.isInteger(soNgay) || soNgay <= 0) return res.status(400).json({ error: `${TEN_MUC[m]}: số ngày phải là số nguyên dương.` });
    if (vao && !THU_TU_TINH_TRANG.includes(vao)) return res.status(400).json({ error: `${TEN_MUC[m]}: trạng thái đầu vào không hợp lệ.` });
    if (!THU_TU_TINH_TRANG.includes(ra)) return res.status(400).json({ error: `${TEN_MUC[m]}: trạng thái đầu ra không hợp lệ.` });
    if (chiSoTinhTrang(ra) <= (vao ? chiSoTinhTrang(vao) : -1)) {
      return res.status(400).json({ error: `${TEN_MUC[m]}: trạng thái đầu ra phải nằm SAU trạng thái đầu vào.` });
    }
    Object.assign(luu, { [`NGUONG_${m}`]: soNgay, [`VAO_${m}`]: vao, [`RA_${m}`]: ra, [`BAT_${m}`]: ch.bat === false ? '0' : '1' });
  }
  datCaiDatCanhBao(luu);
  res.json({ ok: true });
});

module.exports = router;
