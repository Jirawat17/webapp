const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const alertService = require('../services/alertService');
const scenarioService = require('../services/scenarioService');
const { layBanDoTenKhachHang } = require('../services/khachHangService');
const { ghiLog, layLichSuTheoDon, ghiNhatKyQuetHangLoat } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Ghi log không chặn phản hồi cho người dùng — việc ghi nhật ký chỉ phục vụ truy vết/thống kê sau
// này, không ảnh hưởng tới kết quả trả về, nên không cần bắt nhân viên chờ ghi xong mới thấy phản hồi.
// Lỗi ghi log (nếu có) chỉ log ra console server, không làm hỏng trải nghiệm quét.
function ghiKhongCho(promise) {
  promise.catch(err => console.error('[QR] Lỗi ghi log nền:', err.message));
}

async function lamGiauDon(row) {
  const [daGanKH] = await orderService.ganTenKhachHang([row]);
  return { ...daGanKH, TieuDeSanPham: orderService.tieuDeSanPham(row), CanhBao: alertService.tinhMucCanhBao(row) };
}

// Quét đơn lẻ để tra cứu — CHỈ đọc thông tin, không đổi trạng thái gì cả
router.get('/tra-cuu/:sttKey', async (req, res) => {
  const { sttKey } = req.params;
  const user = req.session.user;

  const [{ row }, lichSu] = await Promise.all([
    orderService.getByKey(sttKey),
    layLichSuTheoDon(sttKey),
  ]);

  if (!row) {
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_TRA_CUU_LOI', sttKey, chiTiet: 'Không tìm thấy đơn' }));
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng với mã: ' + sttKey });
  }

  ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_TRA_CUU', sttKey }));
  res.json({ ...(await lamGiauDon(row)), lichSu });
});

// Danh sách kịch bản — đọc trực tiếp từ tab CauHinhKichBan, KHÔNG hardcode trong code.
// Sửa/thêm kịch bản chỉ cần sửa trực tiếp trên Sheet.
router.get('/kich-ban', async (req, res) => {
  const list = await scenarioService.layDanhSachKichBan();
  res.json(list);
});

// Quét đơn lẻ, ghi ngay lập tức — dùng cho nút "Chuyển sang..." thủ công ở trang chi tiết đơn,
// KHÔNG dùng trong màn hình camera hàng loạt (xem 2 route kiem-tra/xac-nhan-hang-loat bên dưới).
router.post('/kich-ban/:scenarioId/quet', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;
  const scenario = await scenarioService.timKichBanTheoId(req.params.scenarioId);

  if (!scenario) return res.status(404).json({ error: 'Không tìm thấy kịch bản (có thể đã bị xoá khỏi tab CauHinhKichBan)' });
  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  // Đọc THẬT (bỏ qua cache) vì đây là bước quyết định có ghi hay không — phải chắc chắn mới nhất
  const { row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) {
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_LOI', sttKey, chiTiet: { scenario: scenario.label, loi: 'Không tìm thấy đơn' } }));
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng với mã: ' + sttKey });
  }

  if (scenario.requireStatus && row.TINH_TRANG !== scenario.requireStatus) {
    ghiKhongCho(ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_SAI_TRANG_THAI',
      sttKey, chiTiet: { scenario: scenario.label, trangThaiHienTai: row.TINH_TRANG, trangThaiCanCo: scenario.requireStatus },
    }));
    ghiKhongCho(ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: row.TINH_TRANG, trangThaiMoi: '', ketQua: 'LOI_SAI_TRANG_THAI',
      ghiChu: `Cần đang ở '${scenario.requireStatus}' nhưng đơn đang ở '${row.TINH_TRANG}'`,
    }));
    return res.status(400).json({
      error: `Đơn đang ở trạng thái '${row.TINH_TRANG}', cần đang ở '${scenario.requireStatus}' để dùng kịch bản này`,
    });
  }

  const trangThaiCu = row.TINH_TRANG;
  const updated = await orderService.update(sttKey, {
    TINH_TRANG: scenario.setStatus,
    NguoiCapNhatCuoi: user.ten,
    ThoiGianCapNhatCuoi: new Date().toISOString(),
  });

  ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KICH_BAN', sttKey, chiTiet: { scenario: scenario.label, tu: trangThaiCu, sang: scenario.setStatus } }));
  ghiKhongCho(ghiNhatKyQuetHangLoat({
    nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
    trangThaiCu, trangThaiMoi: scenario.setStatus, ketQua: 'THANH_CONG',
  }));

  res.json({ ok: true, don: await lamGiauDon(updated) });
});

// ============================================================
// LUỒNG QUÉT HÀNG LOẠT: quét = CHỈ kiểm tra (không ghi Sheet) → xem lại theo 3 nhóm → xác nhận hàng loạt
//
// TỐI ƯU TỐC ĐỘ (quan trọng cho camera quét liên tục):
// - scenario + đơn hàng được đọc SONG SONG (Promise.all) thay vì tuần tự.
// - Cả 2 đều đọc qua cache (readTabCached trong orderService/scenarioService) — không gọi mạng
//   tới Google Sheets ở phần lớn các lượt quét trong cùng 1 phiên (chỉ cách nhau vài giây).
// - Ghi log KHÔNG chờ (fire-and-forget) — nhân viên thấy kết quả ngay, log chạy nền phía sau.
// Độ an toàn KHÔNG đổi: bước xác nhận hàng loạt bên dưới luôn đọc THẬT (fresh) trước khi ghi.
// ============================================================

router.post('/kich-ban/:scenarioId/kiem-tra', async (req, res) => {
  const { sttKey } = req.body;
  const user = req.session.user;

  if (!sttKey) return res.status(400).json({ error: 'Thiếu mã đơn hàng' });

  const [scenario, { row }, banDoKhachHang] = await Promise.all([
    scenarioService.timKichBanTheoId(req.params.scenarioId),
    orderService.getByKey(sttKey), // qua cache — nhanh, đủ an toàn vì bước xác nhận sẽ đọc thật lại
    layBanDoTenKhachHang(), // gộp vào cùng lượt song song, không đợi xong scenario/order mới bắt đầu
  ]);

  if (!scenario) return res.status(404).json({ error: 'Không tìm thấy kịch bản' });

  if (!row) {
    ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_KHONG_TIM_THAY', sttKey, chiTiet: { scenario: scenario.label } }));
    ghiKhongCho(ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: '', trangThaiMoi: '', ketQua: 'KIEM_TRA_KHONG_TIM_THAY', ghiChu: 'Không tìm thấy mã trong Sheet',
    }));
    return res.json({ nhom: 'KHONG_TIM_THAY', sttKey, lyDo: 'Không tìm thấy đơn hàng với mã này trong Sheet' });
  }

  const tieuDe = orderService.tieuDeSanPham(row);
  const tenKhachHang = banDoKhachHang[row.MA_KHACH_HANG] || row.MA_KHACH_HANG || '';

  if (scenario.requireStatus && row.TINH_TRANG !== scenario.requireStatus) {
    const lyDo = `Đang ở '${row.TINH_TRANG}', kịch bản này yêu cầu đang ở '${scenario.requireStatus}'`;
    ghiKhongCho(ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_SAI_TRANG_THAI',
      sttKey, chiTiet: { scenario: scenario.label, trangThaiHienTai: row.TINH_TRANG, trangThaiCanCo: scenario.requireStatus },
    }));
    ghiKhongCho(ghiNhatKyQuetHangLoat({
      nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
      trangThaiCu: row.TINH_TRANG, trangThaiMoi: '', ketQua: 'KIEM_TRA_SAI_TRANG_THAI', ghiChu: lyDo,
    }));
    return res.json({ nhom: 'SAI_TRANG_THAI', sttKey, tieuDe, tenKhachHang, trangThaiHienTai: row.TINH_TRANG, trangThaiYeuCau: scenario.requireStatus, lyDo });
  }

  ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KIEM_TRA_OK', sttKey, chiTiet: { scenario: scenario.label, seChuyenSang: scenario.setStatus } }));
  ghiKhongCho(ghiNhatKyQuetHangLoat({
    nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey,
    trangThaiCu: row.TINH_TRANG, trangThaiMoi: scenario.setStatus, ketQua: 'KIEM_TRA_OK',
  }));
  res.json({ nhom: 'OK', sttKey, tieuDe, tenKhachHang, trangThaiHienTai: row.TINH_TRANG, trangThaiSau: scenario.setStatus });
});

// Xác nhận cập nhật hàng loạt — chỉ gọi cho các mã đã kiểm tra OK ở bước quét.
// QUAN TRỌNG: đọc THẬT (fresh, bỏ qua cache) trước khi quyết định ghi — đây là bước chống ghi đè
// khi dữ liệu đã đổi giữa lúc quét (kiem-tra, dùng cache cho nhanh) và lúc xác nhận thật sự.
// Mã nào không còn hợp lệ trả về trong "loi", KHÔNG âm thầm bỏ qua.
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
      const { row } = await orderService.getByKey(sttKey, { fresh: true }); // BẮT BUỘC đọc thật ở đây

      if (!row) {
        loi.push({ sttKey, lyDo: 'Không còn tìm thấy đơn hàng (có thể vừa bị xoá/sửa ở nơi khác)' });
        ghiKhongCho(ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu: '', trangThaiMoi: '', ketQua: 'LOI_XAC_NHAN', ghiChu: 'Không tìm thấy khi xác nhận' }));
        continue;
      }
      if (scenario.requireStatus && row.TINH_TRANG !== scenario.requireStatus) {
        loi.push({ sttKey, lyDo: `Trạng thái đã đổi thành '${row.TINH_TRANG}' trước khi kịp xác nhận` });
        ghiKhongCho(ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu: row.TINH_TRANG, trangThaiMoi: '', ketQua: 'LOI_XAC_NHAN', ghiChu: 'Trạng thái đã đổi trước khi xác nhận' }));
        continue;
      }

      const trangThaiCu = row.TINH_TRANG;
      await orderService.update(sttKey, {
        TINH_TRANG: scenario.setStatus,
        NguoiCapNhatCuoi: user.ten,
        ThoiGianCapNhatCuoi: new Date().toISOString(),
      });

      thanhCong.push(sttKey);
      ghiKhongCho(ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'QUET_KICH_BAN_HANG_LOAT', sttKey, chiTiet: { scenario: scenario.label, tu: trangThaiCu, sang: scenario.setStatus } }));
      ghiKhongCho(ghiNhatKyQuetHangLoat({ nguoiQuet: user.ten, tenKichBan: scenario.label, sttKey, trangThaiCu, trangThaiMoi: scenario.setStatus, ketQua: 'THANH_CONG' }));
    } catch (err) {
      loi.push({ sttKey, lyDo: err.message });
    }
  }

  res.json({ ok: true, thanhCong, loi });
});

module.exports = router;
