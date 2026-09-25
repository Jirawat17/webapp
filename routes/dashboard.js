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

// Mã khách hàng tách từ STT_Key (bổ sung 25/09/2026, theo yêu cầu người dùng — cột KHACH_HANG trống):
// STT_Key = <số tháng 1-2 chữ số><mã khách CHỈ chữ cái><số thứ tự>, vd 9LH471 -> LH, 09T06 -> T,
// 10SON5 -> SON (đã xác nhận: mã khách không bao giờ chứa số, nên ranh giới chữ/số là duy nhất).
const KHACH_KHONG_RO = '(Không xác định)';
function maKhachTuSttKey(sttKey) {
  const m = /^\d{1,2}([A-Za-z]+)\d/.exec(String(sttKey || '').trim());
  return m ? m[1].toUpperCase() : KHACH_KHONG_RO;
}

// Bảng thống kê theo nhóm (khách hàng / Xưởng) — xem
// docs/superpowers/specs/2026-09-15-thong-ke-khach-hang-va-an-menu-san-xuat-design.md. "Có file, chưa
// chạy máy" tính JOIN thật trên từng đơn (không suy ra từ hiệu daVeFile - daChayMay) vì dữ liệu Sheet
// có thể bị sửa tay lệch khỏi luồng app (đơn "đã chạy máy" chưa chắc "đã vẽ file"). Nhóm `nhomCuoi`
// (không xác định/chưa gán) luôn xếp cuối, còn lại theo tổng đơn giảm dần. Trường tên nhóm giữ là
// `khachHang` cho cả bảng Xưởng — bang-dieu-khien.html đọc sẵn tên trường này.
function thongKeTheoNhom(rows, layNhom, nhomCuoi) {
  const theoNhom = new Map();
  for (const r of rows) {
    const ten = layNhom(r);
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
      if (a.khachHang === nhomCuoi) return 1;
      if (b.khachHang === nhomCuoi) return -1;
      return b.tongDon - a.tongDon;
    });
}

// Tuần theo NGAY_LEN_DON dạng "2026-W38" — null nếu không đọc được ngày.
function tuanCuaDon(r) {
  const d = parseNgay(r.NGAY_LEN_DON);
  if (!d) return null;
  const dauNam = new Date(d.getFullYear(), 0, 1);
  const soTuan = Math.ceil(((d - dauNam) / 86400000 + dauNam.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${soTuan}`;
}

router.get('/thong-ke', async (req, res) => {
  const { rows: tatCaDonMoiXuong } = await orderService.getAll();
  // Lọc theo Xưởng (bổ sung 13/09/2026) — admin xem thống kê toàn bộ, vai trò khác chỉ thấy đơn cùng
  // Xưởng với mình (xem services/orderService.js#locTheoXuong).
  const tatCaDon = orderService.locTheoXuong(tatCaDonMoiXuong, req.session.user);

  // Lọc theo khoảng NGAY_LEN_DON nếu FE gửi kèm tuNgay/denNgay (nút Hôm nay/Tuần này/Tháng
  // này/Tuỳ chọn ở dashboard.html) — không truyền gì thì giữ nguyên hành vi cũ: thống kê toàn bộ.
  const { tuNgay, denNgay, khachHang } = req.query;
  // Danh sách khách cho ô lọc — lấy từ TOÀN BỘ đơn trong phạm vi Xưởng (trước lọc ngày/khách) để ô chọn
  // không bị "mất" khách khi đổi kỳ.
  const danhSachKhachHang = [...new Set(tatCaDon.map(r => maKhachTuSttKey(r.STT_Key)))].sort();
  let rows = tatCaDon;
  if (khachHang) rows = rows.filter(r => maKhachTuSttKey(r.STT_Key) === khachHang);
  if (tuNgay || denNgay) {
    const tu = tuNgay ? new Date(`${tuNgay}T00:00:00`) : null;
    const den = denNgay ? new Date(`${denNgay}T23:59:59`) : null;
    rows = rows.filter(r => {
      const d = parseNgay(r.NGAY_LEN_DON);
      if (!d) return false;
      if (tu && d < tu) return false;
      if (den && d > den) return false;
      return true;
    });
  }

  const demTheo = (list, layGiaTri) => list.reduce((acc, r) => {
    const v = layGiaTri(r);
    if (v === null) return acc;
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
  // Đếm CHỒNG theo khách hàng: { giaTri: { maKhach: soDon } } — cho biểu đồ cột chồng ở dashboard.html.
  const demChongTheoKhach = (list, layGiaTri) => list.reduce((acc, r) => {
    const v = layGiaTri(r);
    if (v === null) return acc;
    const kh = maKhachTuSttKey(r.STT_Key);
    acc[v] = acc[v] || {};
    acc[v][kh] = (acc[v][kh] || 0) + 1;
    return acc;
  }, {});
  const layTrangThai = r => r.TRANG_THAI_XUONG || '(Trống)';
  const layLoai = r => r.LOAI || '(Trống)';

  res.json({
    tongSoDon: rows.length,
    danhSachKhachHang,
    theoTrangThai: demTheo(rows, layTrangThai),
    theoKhachHangChiTiet: thongKeTheoNhom(rows, r => maKhachTuSttKey(r.STT_Key), KHACH_KHONG_RO),
    theoXuongChiTiet: thongKeTheoNhom(rows, r => r.XUONG || '(chưa gán)', '(chưa gán)'),
    theoLoaiSanPham: demTheo(rows, layLoai),
    theoTuan: demTheo(rows, tuanCuaDon),
    chongTheoKhach: {
      trangThai: demChongTheoKhach(rows, layTrangThai),
      loai: demChongTheoKhach(rows, layLoai),
      tuan: demChongTheoKhach(rows, tuanCuaDon),
    },
  });
});

module.exports = router;
module.exports.maKhachTuSttKey = maKhachTuSttKey; // cho kiểm thử
