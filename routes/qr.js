const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const alertService = require('../services/alertService');
const scenarioService = require('../services/scenarioService');
const { ghiLog, layLichSuTheoDon, ghiNhatKyQuetHangLoat } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

async function lamGiauDon(row) {
  const [daGanKH] = await orderService.ganTenKhachHang([row]);
  return { ...daGanKH, TieuDeSanPham: orderService.tieuDeSanPham(row), CanhBao: alertService.tinhMucCanhBao(row) };
}

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
  res.json({ ...(await lamGiauDon(row)), lichSu });
});

// Danh sách kịch bản — đọc trực tiếp từ tab CauHinhKichBan, KHÔNG hardcode trong code.
// Sửa/thêm kịch bản chỉ cần sửa trực tiếp trên Sheet.
router.get('/kich-ban', async (req, res) => {
  const list = await scenarioService.layDanhSachKichBan();
  res.json(list);
});

// Quét theo kịch bản — đổi TINH_TRANG nếu đơn đang đúng trạng thái yêu cầu, ghi log kể cả khi lỗi
router.post('/kich-ban/:scenarioId/quet', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;
  const scenario = await scenarioService.timKichBanTheoId(req.params.scenarioId);

  if (!scenario) return res.status(404).json({ error: 'Không tìm thấy kịch bản (có thể đã bị xoá khỏi tab CauHinhKichBan)' });
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const { row } = await orderService.getByKey(sttKey);
  if (!row) {
    await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_LOI', sttKey, chiTiet: { scenario: scenario.label, loi: 'Không tìm thấy đơn' } });
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng với mã: ' + sttKey });
  }

  if (scenario.requireStatus && row.TINH_TRANG !== scenario.requireStatus) {
    await ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_SAI_TRANG_THAI',
      sttKey, chiTiet: { scenario: scenario.label, trangThaiHienTai: row.TINH_TRANG, trangThaiCanCo: scenario.requireStatus },
    });
    await ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: row.TINH_TRANG, trangThaiMoi: '', ketQua: 'LOI_SAI_TRANG_THAI',
      ghiChu: `Cần đang ở '${scenario.requireStatus}' nhưng đơn đang ở '${row.TINH_TRANG}'`,
    });
    return res.status(400).json({
      error: `Đơn đang ở trạng thái '${row.TINH_TRANG}', cần đang ở '${scenario.requireStatus}' để dùng kịch bản này`,
    });
  }

  const trangThaiCu = row.TINH_TRANG;
  const updates = {
    TINH_TRANG: scenario.setStatus,
    NguoiCapNhatCuoi: user.ten,
    ThoiGianCapNhatCuoi: new Date().toISOString(),
  };

  const updated = await orderService.update(sttKey, updates);

  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KICH_BAN', sttKey, chiTiet: { scenario: scenario.label, tu: trangThaiCu, sang: scenario.setStatus } });
  await ghiNhatKyQuetHangLoat({
    nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
    trangThaiCu, trangThaiMoi: scenario.setStatus, ketQua: 'THANH_CONG',
  });

  res.json({ ok: true, don: await lamGiauDon(updated) });
});

module.exports = router;
