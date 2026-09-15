const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { parseNgay } = require('../services/dateUtils');
const { requireLogin } = require('../middleware/auth');
const { chiSoTinhTrang } = require('../data/pipelineTinhTrang');

router.use(requireLogin);

// Đơn đã đi tới mốc `tenMoc` trở đi trên đường chính (vd "Đã sản xuất" -> gồm cả "ĐÃ DÁN TEM",
// DELIVERED). Trạng thái rẽ nhánh (LỖI SẢN XUẤT/CANCELLED/REFUNDED) trả null ở chiSoTinhTrang() nên
// luôn coi là CHƯA tới mốc — đúng ý nghĩa "làm lại" (xem data/pipelineTinhTrang.js).
function daQuaMoc(trangThaiXuong, tenMoc) {
  const idx = chiSoTinhTrang(trangThaiXuong);
  const idxMoc = chiSoTinhTrang(tenMoc);
  return idx !== null && idx >= idxMoc;
}

// Bảng thống kê theo khách hàng (bổ sung 15/09/2026, xem
// docs/superpowers/specs/2026-09-15-thong-ke-khach-hang-va-an-menu-san-xuat-design.md) — nhóm theo
// cột KHACH_HANG trực tiếp (KHÔNG qua MA_KHACH_HANG/tab Khach_Hang, đã xác nhận với người dùng).
// "Có file, chưa chạy máy" tính JOIN thật trên từng đơn (không suy ra từ hiệu daVeFile - daChayMay)
// vì dữ liệu Sheet có thể bị sửa tay lệch khỏi luồng app (đơn "đã chạy máy" chưa chắc "đã vẽ file").
function thongKeTheoKhachHang(rows) {
  const theoNhom = new Map();
  for (const r of rows) {
    const ten = r.KHACH_HANG || '(Trống)';
    if (!theoNhom.has(ten)) {
      theoNhom.set(ten, { khachHang: ten, tongDon: 0, daDanTem: 0, daVeFile: 0, daChayMay: 0, coFileChuaChayMay: 0 });
    }
    const nhom = theoNhom.get(ten);
    const daVeFileXong = r.TRANG_THAI_VE_FILE === 'Đã vẽ file';
    const daChayMayXong = daQuaMoc(r.TRANG_THAI_XUONG, 'Đã sản xuất');

    nhom.tongDon++;
    if (daQuaMoc(r.TRANG_THAI_XUONG, 'ĐÃ DÁN TEM')) nhom.daDanTem++;
    if (daVeFileXong) nhom.daVeFile++;
    if (daChayMayXong) nhom.daChayMay++;
    if (daVeFileXong && !daChayMayXong) nhom.coFileChuaChayMay++;
  }

  return [...theoNhom.values()]
    .map(n => ({ ...n, chuaDanTem: n.tongDon - n.daDanTem, chuaCoFileVe: n.tongDon - n.daVeFile }))
    .sort((a, b) => {
      if (a.khachHang === '(Trống)') return 1;
      if (b.khachHang === '(Trống)') return -1;
      return b.tongDon - a.tongDon;
    });
}

router.get('/thong-ke', async (req, res) => {
  const { rows: tatCaDonMoiXuong } = await orderService.getAll();
  // Lọc theo Xưởng (bổ sung 13/09/2026) — admin xem thống kê toàn bộ, vai trò khác chỉ thấy đơn cùng
  // Xưởng với mình (xem services/orderService.js#locTheoXuong).
  const tatCaDon = orderService.locTheoXuong(tatCaDonMoiXuong, req.session.user);

  // Lọc theo khoảng NGAY_LEN_DON nếu FE gửi kèm tuNgay/denNgay (nút Hôm nay/Tuần này/Tháng
  // này/Tuỳ chọn ở dashboard.html) — không truyền gì thì giữ nguyên hành vi cũ: thống kê toàn bộ.
  const { tuNgay, denNgay } = req.query;
  let rows = tatCaDon;
  if (tuNgay || denNgay) {
    const tu = tuNgay ? new Date(`${tuNgay}T00:00:00`) : null;
    const den = denNgay ? new Date(`${denNgay}T23:59:59`) : null;
    rows = tatCaDon.filter(r => {
      const d = parseNgay(r.NGAY_LEN_DON);
      if (!d) return false;
      if (tu && d < tu) return false;
      if (den && d > den) return false;
      return true;
    });
  }

  const demTheo = (list, key) => list.reduce((acc, r) => {
    const v = r[key] || '(Trống)';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});

  const theoTuan = rows.reduce((acc, r) => {
    const d = parseNgay(r.NGAY_LEN_DON);
    if (!d) return acc;
    const dauNam = new Date(d.getFullYear(), 0, 1);
    const soTuan = Math.ceil(((d - dauNam) / 86400000 + dauNam.getDay() + 1) / 7);
    const key = `${d.getFullYear()}-W${soTuan}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  res.json({
    tongSoDon: rows.length,
    theoTrangThai: demTheo(rows, 'TRANG_THAI_XUONG'),
    theoKhachHangChiTiet: thongKeTheoKhachHang(rows),
    theoLoaiSanPham: demTheo(rows, 'LOAI'),
    theoTuan,
  });
});

module.exports = router;
