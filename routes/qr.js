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

// ============================================================
// LUỒNG QUÉT HÀNG LOẠT MỚI: quét = CHỈ kiểm tra (không ghi Sheet) → xem lại theo 3 nhóm → xác nhận hàng loạt
// ============================================================

// Kiểm tra 1 mã theo kịch bản — KHÔNG ghi Sheet. Luôn ghi log ngay lập tức dù kết quả gì (kể cả lỗi/sai trạng thái)
// để biết cả những lần quét nhầm chưa được xử lý — dữ liệu hữu ích để cải thiện việc in/dán QR sau này.
router.post('/kich-ban/:scenarioId/kiem-tra', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;
  const scenario = await scenarioService.timKichBanTheoId(req.params.scenarioId);

  if (!scenario) return res.status(404).json({ error: 'Không tìm thấy kịch bản' });
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const { row } = await orderService.getByKey(sttKey);

  if (!row) {
    await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_KHONG_TIM_THAY', sttKey, chiTiet: { scenario: scenario.label } });
    await ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: '', trangThaiMoi: '', ketQua: 'KIEM_TRA_KHONG_TIM_THAY', ghiChu: 'Không tìm thấy mã trong Sheet',
    });
    return res.json({ nhom: 'KHONG_TIM_THAY', sttKey, lyDo: 'Không tìm thấy đơn hàng với mã này trong Sheet' });
  }

  const [donDaGan] = await orderService.ganTenKhachHang([row]);
  const tieuDe = orderService.tieuDeSanPham(row);
  const tenKhachHang = donDaGan.TenKhachHang;

  if (scenario.requireStatus && row.TINH_TRANG !== scenario.requireStatus) {
    const lyDo = `Đang ở '${row.TINH_TRANG}', kịch bản này yêu cầu đang ở '${scenario.requireStatus}'`;
    await ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_SAI_TRANG_THAI',
      sttKey, chiTiet: { scenario: scenario.label, trangThaiHienTai: row.TINH_TRANG, trangThaiCanCo: scenario.requireStatus },
    });
    await ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: row.TINH_TRANG, trangThaiMoi: '', ketQua: 'KIEM_TRA_SAI_TRANG_THAI', ghiChu: lyDo,
    });
    return res.json({ nhom: 'SAI_TRANG_THAI', sttKey, tieuDe, tenKhachHang, trangThaiHienTai: row.TINH_TRANG, trangThaiYeuCau: scenario.requireStatus, lyDo });
  }

  await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_OK', sttKey, chiTiet: { scenario: scenario.label, seChuyenSang: scenario.setStatus } });
  await ghiNhatKyQuetHangLoat({
    nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
    trangThaiCu: row.TINH_TRANG, trangThaiMoi: scenario.setStatus, ketQua: 'KIEM_TRA_OK',
  });
  res.json({ nhom: 'OK', sttKey, tieuDe, tenKhachHang, trangThaiHienTai: row.TINH_TRANG, trangThaiSau: scenario.setStatus });
});

// Xác nhận cập nhật hàng loạt — chỉ gọi cho các mã đã kiểm tra OK ở bước quét.
// Kiểm tra lại từng mã ngay tại thời điểm này (phòng dữ liệu đã đổi giữa lúc quét và lúc xác nhận) —
// mã nào không còn hợp lệ sẽ trả về trong "loi", KHÔNG âm thầm bỏ qua.
router.post('/kich-ban/:scenarioId/xac-nhan-hang-loat', async (req, res) => {
  const { sttKeys } = req.body;
  const user = req.session.user;
  const scenario = await scenarioService.timKichBanTheoId(req.params.scenarioId);

  if (!scenario) return res.status(404).json({ error: 'Không tìm thấy kịch bản' });
  if (!Array.isArray(sttKeys) || sttKeys.length === 0) return res.status(400).json({ error: 'Danh sách mã trống' });

  const thanhCong = [];
  const loi = [];

  for (const sttKey of sttKeys) {
    try {
      const { row } = await orderService.getByKey(sttKey);

      if (!row) {
        loi.push({ sttKey, lyDo: 'Không còn tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        await ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu: '', trangThaiMoi: '', ketQua: 'LOI_XAC_NHAN', ghiChu: 'Không tìm thấy khi xác nhận' });
        continue;
      }
      if (scenario.requireStatus && row.TINH_TRANG !== scenario.requireStatus) {
        loi.push({ sttKey, lyDo: `Trạng thái đã đổi thành '${row.TINH_TRANG}' trước khi kịp xác nhận` });
        await ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu: row.TINH_TRANG, trangThaiMoi: '', ketQua: 'LOI_XAC_NHAN', ghiChu: 'Trạng thái đã đổi trước khi xác nhận' });
        continue;
      }

      const trangThaiCu = row.TINH_TRANG;
      await orderService.update(sttKey, {
        TINH_TRANG: scenario.setStatus,
        NguoiCapNhatCuoi: user.ten,
        ThoiGianCapNhatCuoi: new Date().toISOString(),
      });

      thanhCong.push(sttKey);
      await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KICH_BAN_HANG_LOAT', sttKey, chiTiet: { scenario: scenario.label, tu: trangThaiCu, sang: scenario.setStatus } });
      await ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu, trangThaiMoi: scenario.setStatus, ketQua: 'THANH_CONG' });
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  }

  res.json({ ok: true, thanhCong, loi });
});

module.exports = router;
