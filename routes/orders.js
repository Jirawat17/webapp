const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const alertService = require('../services/alertService');
const scenarioService = require('../services/scenarioService');
const { parseNgay } = require('../services/dateUtils');
const { ghiLog, layLichSuTheoDon } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Gắn thêm các trường tính toán (không phải cột thật trong Sheet) để hiển thị — dùng chung cho list/detail
async function lamGiauDon(rows) {
  const daGanKH = await orderService.ganTenKhachHang(rows);
  return daGanKH.map(r => ({
    ...r,
    TieuDeSanPham: orderService.tieuDeSanPham(r),
    ViTriTheu: orderService.danhSachViTriTheu(r),
    CanhBao: alertService.tinhMucCanhBao(r),
  }));
}

// Danh sách đơn hàng — tự lọc theo vai trò, có thể lọc thêm qua query string
router.get('/', async (req, res) => {
  const { rows } = await orderService.getAll();
  let list = orderService.filterForRole(rows, req.session.user);

  const { trangThai, kh } = req.query;
  if (trangThai) list = list.filter(r => r.TINH_TRANG === trangThai);
  if (kh) list = list.filter(r => (r.MA_KHACH_HANG || '').toLowerCase().includes(kh.toLowerCase()));

  // Không có cột deadline riêng — sắp theo ngày lên đơn, đơn cũ nhất (tồn lâu nhất) lên đầu
  list.sort((a, b) => (parseNgay(a.NGAY_LEN_DON) || 0) - (parseNgay(b.NGAY_LEN_DON) || 0));

  list = await lamGiauDon(list);
  res.json(list);
});

// Những kịch bản (trong CauHinhKichBan) có thể áp dụng cho trạng thái hiện tại của đơn —
// dùng để hiện nút "Chuyển sang..." trên trang chi tiết mà không cần quét QR
async function layKichBanKeTiep(tinhTrangHienTai) {
  const list = await scenarioService.layDanhSachKichBan();
  return list.filter(s => !s.requireStatus || s.requireStatus === tinhTrangHienTai);
}

router.get('/:sttKey', async (req, res) => {
  const { row } = await orderService.getByKey(req.params.sttKey);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

  const [lichSu, [donDaLamGiau], kichBanKeTiep] = await Promise.all([
    layLichSuTheoDon(req.params.sttKey),
    lamGiauDon([row]),
    layKichBanKeTiep(row.TINH_TRANG),
  ]);

  res.json({ ...donDaLamGiau, lichSu, kichBanKeTiep });
});

// Mỗi vai trò chỉ được sửa đúng những cột thuộc phần việc của mình — admin/quản lý sửa được tất cả
const TRUONG_DUOC_SUA = {
  ve_file: ['GHI_CHU'],
  chuan_bi_phoi: ['GHI_CHU'],
  san_xuat: ['GHI_CHU', 'TINH_TRANG'],
  dong_goi: ['GHI_CHU', 'HANG_VAN_CHUYEN', 'MA_VAN_DON_ID', 'TINH_TRANG'],
};

// Không bao giờ cho phép sửa qua các cột này — khóa chính, field nội bộ, hoặc trường chỉ tính toán để hiển thị
const TRUONG_CAM_SUA = ['STT_Key', '_row', 'NguoiCapNhatCuoi', 'ThoiGianCapNhatCuoi', 'TenKhachHang', 'TieuDeSanPham', 'ViTriTheu', 'CanhBao'];

router.put('/:sttKey', async (req, res) => {
  const user = req.session.user;
  const allowed = TRUONG_DUOC_SUA[user.vaiTro]; // undefined cho admin/quan_ly = được sửa hết (trừ TRUONG_CAM_SUA)
  let updates = req.body;

  if (allowed) {
    updates = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  }
  updates = Object.fromEntries(Object.entries(updates).filter(([k]) => !TRUONG_CAM_SUA.includes(k)));

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Không có trường nào được phép sửa với vai trò này' });
  }

  updates.NguoiCapNhatCuoi = user.ten;
  updates.ThoiGianCapNhatCuoi = new Date().toISOString();

  const updated = await orderService.update(req.params.sttKey, updates);
  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CAP_NHAT_DON',
    sttKey: req.params.sttKey, chiTiet: updates,
  });
  res.json(updated);
});

module.exports = router;
