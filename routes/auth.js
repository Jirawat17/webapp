const express = require('express');
const router = express.Router();
const { readTabCached } = require('../services/sheetsService');
const { ghiLog } = require('../services/logService');
const { layDangHoatDong } = require('../services/presenceService');

const TAB = 'NguoiDung';

// Chống dò PIN (mật khẩu chỉ 1-4 chữ số — tối đa 10.000 khả năng, web chạy trên domain public) —
// đếm số lần sai LIÊN TIẾP theo từng tên, khoá thử đăng nhập tên đó 1 phút nếu sai đủ 10 lần. Lưu
// trong bộ nhớ (mất khi restart server, chấp nhận được) — giống mô hình _congViecHangLoat ở
// routes/orders.js, không cần thêm bảng/cột nào trong Sheet cho việc này.
const _lanSaiMatKhau = new Map(); // ten -> { soLanSai, khoaDenLucNao }
const SO_LAN_SAI_TOI_DA = 10;
const THOI_GIAN_KHOA_MS = 60 * 1000;

function kiemTraDangBiKhoa(ten) {
  const trang = _lanSaiMatKhau.get(ten);
  if (trang && trang.khoaDenLucNao && trang.khoaDenLucNao > Date.now()) {
    return Math.ceil((trang.khoaDenLucNao - Date.now()) / 1000);
  }
  return 0;
}

function ghiNhanSaiMatKhau(ten) {
  const trang = _lanSaiMatKhau.get(ten) || { soLanSai: 0, khoaDenLucNao: 0 };
  trang.soLanSai++;
  if (trang.soLanSai >= SO_LAN_SAI_TOI_DA) {
    trang.khoaDenLucNao = Date.now() + THOI_GIAN_KHOA_MS;
    trang.soLanSai = 0; // reset đếm, bắt đầu lại chu kỳ mới sau khi hết khoá
  }
  _lanSaiMatKhau.set(ten, trang);
}

// Danh sách tên để hiển thị nút chọn ở màn hình đăng nhập — chỉ nhân viên đang kích hoạt
// Danh sách nhân viên gần như không đổi trong ngày — đọc qua cache (routes/users.js tự xoá cache
// ngay khi admin thêm/sửa nhân viên) thay vì luôn gọi Google mỗi lần ai đó mở màn hình đăng nhập.
// coMatKhau (KHÔNG bao giờ trả giá trị mật khẩu thật) — để client biết có cần hiện ô nhập PIN hay
// không TRƯỚC khi thử đăng nhập (tài khoản cũ chưa đặt mật khẩu vẫn đăng nhập bằng tên như trước).
router.get('/danh-sach', async (req, res) => {
  const { rows } = await readTabCached(TAB, 30000);
  const active = rows.filter(r => String(r.KichHoat).toUpperCase() === 'TRUE');
  res.json(active.map(r => ({ ten: r.Ten, vaiTro: r.VaiTro, coMatKhau: !!r.MatKhau })));
});

router.post('/dang-nhap', async (req, res) => {
  const { ten, matKhau } = req.body;
  if (!ten) return res.status(400).json({ error: 'Thiếu tên' });

  const giaySoConLai = kiemTraDangBiKhoa(ten);
  if (giaySoConLai > 0) {
    return res.status(429).json({ error: `Tài khoản tạm khoá do nhập sai mật khẩu quá nhiều lần — thử lại sau ${giaySoConLai} giây.` });
  }

  const { rows } = await readTabCached(TAB, 30000);
  const user = rows.find(r => r.Ten === ten && String(r.KichHoat).toUpperCase() === 'TRUE');
  if (!user) return res.status(404).json({ error: 'Không tìm thấy nhân viên hoặc tài khoản đã bị khoá' });

  // Tài khoản CHƯA đặt mật khẩu (cột MatKhau rỗng) — vẫn đăng nhập bằng tên như trước, KHÔNG bắt
  // buộc nhập PIN (tạm thời, cho tới khi admin đặt mật khẩu cho tài khoản này qua trang Quản lý
  // nhân viên). Tài khoản ĐÃ có mật khẩu thì bắt buộc khớp chính xác.
  if (user.MatKhau) {
    if (String(matKhau || '') !== String(user.MatKhau)) {
      ghiNhanSaiMatKhau(ten);
      return res.status(401).json({ error: 'Sai mật khẩu' });
    }
    _lanSaiMatKhau.delete(ten);
  }

  req.session.user = { ten: user.Ten, vaiTro: user.VaiTro, team: user.Team || '' };
  await ghiLog({ nguoiDung: user.Ten, vaiTro: user.VaiTro, hanhDong: 'DANG_NHAP' });
  res.json(req.session.user);
});

router.post('/dang-xuat', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/hien-tai', (req, res) => {
  res.json(req.session.user || null);
});

// Danh sách nhân viên đang hoạt động (có request trong 5 phút gần đây) — dùng cho Bảng điều khiển
// admin. Chỉ admin được xem (danh sách ai đang online cũng là thông tin nhạy cảm về nhân sự).
router.get('/dang-hoat-dong', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập' });
  if (req.session.user.vaiTro !== 'admin') {
    return res.status(403).json({ error: 'Chỉ admin mới được xem danh sách đang hoạt động' });
  }
  res.json(layDangHoatDong());
});

module.exports = router;
