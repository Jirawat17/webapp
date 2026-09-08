const express = require('express');
const router = express.Router();
const { layHoatDongCuaToi } = require('../services/logService');
const orderService = require('../services/orderService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin); // mọi vai trò đăng nhập đều xem được hoạt động của CHÍNH MÌNH

// Đếm số ĐƠN DUY NHẤT khớp điều kiện trong 1 mảng log (Set theo STT_Key) — tránh đếm trùng 1 đơn
// nhiều lần nếu có nhiều lượt ghi log cho cùng đơn trong cùng khoảng thời gian (vd vẽ lại file sau
// khi bị lỗi sản xuất cần làm lại).
function demSoDonDuyNhat(list, dieuKien) {
  return new Set(list.filter(dieuKien).map(x => x.sttKey)).size;
}

function tongSoLuongTheoDon(list, dieuKien, slTheoStt) {
  const cacStt = new Set(list.filter(dieuKien).map(x => x.sttKey));
  return [...cacStt].reduce((tong, stt) => tong + (slTheoStt.get(stt) || 0), 0);
}

// Chỉ tiêu công việc theo vai trò (bổ sung 08/09/2026, xem
// docs/superpowers/specs/2026-09-08-chi-tieu-hoat-dong-theo-vai-tro-design.md) — LUÔN tính đủ cả 3
// nhóm (san_xuat/ve_file/nguoi_lay_phoi) bất kể vai trò người xem là gì (rẻ, dữ liệu nguồn vốn đã có
// sẵn trong kết quả layHoatDongCuaToi ở trên) — public/hoat-dong.html tự chọn hiển thị đúng nhóm khớp
// user.vaiTro. Số lượng sản phẩm (chạy máy/vẽ file/đóng gói) tra theo SO_LUONG HIỆN TẠI của đơn (đọc
// cache, đủ dùng cho màn hình xem) — không có log số lượng riêng cho 3 việc này như phôi.
async function tinhChiTieuTheoVaiTro(hoatDong) {
  const { rows } = await orderService.getAll();
  const slTheoStt = new Map(rows.map(r => [r.STT_Key, Number(r.SO_LUONG) || 0]));

  const laDaSanXuat = x => x.moc === 'da_san_xuat';
  const laDongGoi = x => x.moc === 'dong_goi';
  const laDaLayPhoi = x => x.cot === 'TRANG_THAI_PHOI' && x.sang === 'Đã lấy phôi';
  const laDaVeFile = x => x.cot === 'TRANG_THAI_VE_FILE' && x.sang === 'Đã vẽ file';

  return {
    soDonDaChayMay: demSoDonDuyNhat(hoatDong.uploadAnh, laDaSanXuat),
    tongSlDaChayMay: tongSoLuongTheoDon(hoatDong.uploadAnh, laDaSanXuat, slTheoStt),
    soFileDaVe: demSoDonDuyNhat(hoatDong.doiTrangThai, laDaVeFile),
    tongSlDaVe: tongSoLuongTheoDon(hoatDong.doiTrangThai, laDaVeFile, slTheoStt),
    soDonDaLayPhoi: demSoDonDuyNhat(hoatDong.doiTrangThai, laDaLayPhoi),
    tongSlPhoiDaLay: hoatDong.tongSoLuongPhoiDaLay,
    soDonDaDongGoi: demSoDonDuyNhat(hoatDong.uploadAnh, laDongGoi),
    tongSlDaDongGoi: tongSoLuongTheoDon(hoatDong.uploadAnh, laDongGoi, slTheoStt),
  };
}

// Không nhận tham số 'nguoiDung' từ client — luôn lấy đúng người đang đăng nhập (req.session.user),
// tránh việc 1 tài khoản xem được hoạt động của tài khoản khác qua sửa query string.
router.get('/cua-toi', async (req, res) => {
  const { tuNgay, denNgay } = req.query;
  const ketQua = await layHoatDongCuaToi({ nguoiDung: req.session.user.ten, tuNgay, denNgay });
  ketQua.chiTieu = await tinhChiTieuTheoVaiTro(ketQua);
  res.json(ketQua);
});

module.exports = router;
