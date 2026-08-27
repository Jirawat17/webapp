const express = require('express');
const router = express.Router();
const { readTabCached } = require('../services/sheetsService');
const { dinhDangNgayGioNgan } = require('../services/dateUtils');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

const TAB = 'LichSuHoatDong';

function dauNgay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
// Đầu tuần = Thứ 2 (giờ Việt Nam không dùng Chủ nhật đầu tuần cho công việc xưởng)
function dauTuan(d) {
  const x = dauNgay(d);
  const thu = x.getDay(); // 0 = Chủ nhật
  const lech = thu === 0 ? 6 : thu - 1;
  x.setDate(x.getDate() - lech);
  return x;
}

function demTheoHanhDong(list) {
  const dem = {};
  list.forEach(r => { dem[r.HanhDong] = (dem[r.HanhDong] || 0) + 1; });
  return dem;
}

// Hoạt động của CHÍNH người đang đăng nhập — dùng để tự đối soát cuối ngày/cuối tuần (hôm nay đã
// quét bao nhiêu đơn, chuyển trạng thái đơn nào, upload ảnh gì...). Không cho xem hoạt động của
// người khác — mỗi người chỉ tự tra cứu được của chính mình (req.session.user.ten, không nhận
// tham số nguoiDung từ query).
router.get('/cua-toi', async (req, res) => {
  const user = req.session.user;
  const { rows } = await readTabCached(TAB, 5000);

  const cuaToi = rows
    .filter(r => r.NguoiDung === user.ten)
    .sort((a, b) => new Date(b.ThoiGian) - new Date(a.ThoiGian));

  const moocHomNay = dauNgay(new Date());
  const moocDauTuan = dauTuan(new Date());

  const hoatDongHomNay = cuaToi.filter(r => new Date(r.ThoiGian) >= moocHomNay);
  const hoatDongTuanNay = cuaToi.filter(r => new Date(r.ThoiGian) >= moocDauTuan);

  res.json({
    tongHomNay: hoatDongHomNay.length,
    tongTuanNay: hoatDongTuanNay.length,
    theoHanhDongHomNay: demTheoHanhDong(hoatDongHomNay),
    theoHanhDongTuanNay: demTheoHanhDong(hoatDongTuanNay),
    chiTiet: cuaToi.slice(0, 200).map(r => ({
      thoiGianISO: r.ThoiGian,
      thoiGian: dinhDangNgayGioNgan(new Date(r.ThoiGian)),
      hanhDong: r.HanhDong,
      sttKey: r.STT_Key || '',
      chiTiet: r.ChiTiet || '',
    })),
  });
});

module.exports = router;
