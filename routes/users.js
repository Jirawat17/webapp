const express = require('express');
const router = express.Router();
const taiKhoanService = require('../services/taiKhoanService');
const { layDanhSachXuong } = require('../services/orderService');
const { requireRole, requireExactRole } = require('../middleware/auth');

// Mật khẩu PIN 1-4 chữ số (xem docs/superpowers/specs/2026-09-07-mat-khau-dang-nhap-design.md) —
// lưu trực tiếp KHÔNG mã hoá (đã xác nhận đánh đổi với người dùng: admin xem/nhắc lại được PIN cho
// nhân viên quên, đổi lại ai mở được Sheet cũng biết hết PIN mọi tài khoản — giữ đúng đánh đổi này sau
// khi chuyển sang SQLite, xem docs/superpowers/specs/2026-09-18-tai-khoan-sqlite-design.md).
function matKhauHopLe(mk) {
  return /^\d{1,4}$/.test(String(mk));
}

// Danh sách RÚT GỌN (Ten/VaiTro/KichHoat — KHÔNG có MatKhau/Xuong) — dùng cho các trang KHÁC cần
// liệt kê nhân viên để đổ vào ô chọn (chỉ định người chạy máy/vẽ file, xem hoạt động của người khác...
// — xem public/orders.html, order.html, my-orders.html, my-orders-ve-file.html, hoat-dong.html), KHÔNG
// phải trang Quản lý nhân viên (GET / dưới đây, giờ CHỈ superadmin — xem router.use bên dưới). Đặt
// TRƯỚC router.use(requireExactRole('superadmin')) nên KHÔNG bị chặn bởi rào đó — vẫn mở cho
// admin/superadmin qua requireRole() (bổ sung 18/09/2026, theo yêu cầu người dùng: superadmin CHỈ mới
// xem/sửa được thông tin ĐẦY ĐỦ ở Quản lý nhân viên, nhưng KHÔNG được yêu cầu bớt quyền nào khác của
// admin — vẫn cần đủ tên/vai trò để chỉ định người chạy máy/vẽ file như trước).
router.get('/tom-tat', requireRole(), async (req, res) => {
  const list = taiKhoanService.layTatCa();
  res.json(list.map(r => ({ Ten: r.Ten, VaiTro: r.VaiTro, KichHoat: r.KichHoat })));
});

// CHỈ superadmin — bổ sung 18/09/2026, theo yêu cầu người dùng (thu hẹp từ admin+superadmin xuống
// CHỈ superadmin, khác MỌI nơi khác trong app vẫn coi admin/superadmin ngang quyền — xem laAdmin() ở
// middleware/auth.js). Dùng requireExactRole() (KHÔNG dùng requireRole() — hàm đó tự cho admin qua,
// đúng ngược với ý muốn ở đây) để admin KHÔNG còn xem/sửa được thông tin nhân viên (kể cả PIN đăng
// nhập — cột MatKhau trả về thẳng ở GET / dưới đây) qua đường này nữa.
router.use(requireExactRole('superadmin'));

router.get('/', async (req, res) => {
  res.json(taiKhoanService.layTatCa());
});

router.post('/', async (req, res) => {
  const { ten, vaiTro, xuong, matKhau } = req.body;
  if (!ten || !vaiTro) return res.status(400).json({ error: 'Thiếu tên hoặc vai trò' });
  // Tài khoản MỚI bắt buộc phải có mật khẩu ngay từ đầu — chỉ tài khoản CŨ (tạo trước khi có tính
  // năng này) mới được tạm thời chưa có (xem routes/auth.js).
  if (!matKhauHopLe(matKhau)) return res.status(400).json({ error: 'Mật khẩu phải là 1-4 chữ số' });
  // Xưởng (bổ sung 13/09/2026, theo yêu cầu người dùng — phân loại đơn/nhân viên theo xưởng vật lý
  // HN/BN) — không bắt buộc phải chọn ngay lúc tạo tài khoản (admin có thể gán sau), nhưng
  // nếu CÓ chọn thì phải đúng 1 trong danh sách hợp lệ, tránh gõ nhầm khiến nhân viên đó không thấy
  // đơn nào (xem services/orderService.js#locTheoXuong — thiếu/sai Xuong coi như không có quyền xem).
  if (xuong && !layDanhSachXuong().includes(xuong)) {
    return res.status(400).json({ error: `Xưởng không hợp lệ: "${xuong}" — chỉ chấp nhận: ${layDanhSachXuong().join(', ')}` });
  }
  if (taiKhoanService.layTheoTen(ten)) return res.status(400).json({ error: 'Tên này đã tồn tại' });

  taiKhoanService.themMoi({ Ten: ten, VaiTro: vaiTro, Xuong: xuong || '', KichHoat: 'TRUE', MatKhau: String(matKhau) });
  res.json({ ok: true });
});

// Đổi tên / vai trò / team / xưởng / khoá-mở tài khoản / đặt (lại)/xoá mật khẩu / ẩn-hiện khỏi màn hình
// đăng nhập. MatKhau === '' (chuỗi rỗng, KHÁC undefined) = xoá mật khẩu, cho đăng nhập không cần PIN —
// cùng trạng thái "chưa đặt" tài khoản cũ đã có sẵn từ trước (xem matKhauHopLe ở đầu file).
router.put('/:ten', async (req, res) => {
  const user = taiKhoanService.layTheoTen(req.params.ten);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });

  if (req.body.MatKhau !== undefined && req.body.MatKhau !== '' && !matKhauHopLe(req.body.MatKhau)) {
    return res.status(400).json({ error: 'Mật khẩu phải là 1-4 chữ số (hoặc rỗng để xoá mật khẩu)' });
  }
  if (req.body.Xuong && !layDanhSachXuong().includes(req.body.Xuong)) {
    return res.status(400).json({ error: `Xưởng không hợp lệ: "${req.body.Xuong}" — chỉ chấp nhận: ${layDanhSachXuong().join(', ')}` });
  }

  let ten = req.params.ten;
  if (req.body.TenMoi !== undefined) {
    const tenMoi = String(req.body.TenMoi).trim();
    if (!tenMoi) return res.status(400).json({ error: 'Tên mới không được để trống' });
    if (tenMoi !== ten && taiKhoanService.layTheoTen(tenMoi)) return res.status(400).json({ error: 'Tên này đã tồn tại' });
    taiKhoanService.doiTen(ten, tenMoi);
    ten = tenMoi;
  }

  const updates = {};
  ['VaiTro', 'Xuong', 'KichHoat', 'MatKhau', 'HienThiDangNhap'].forEach(f => {
    if (req.body[f] !== undefined) updates[f] = f === 'MatKhau' ? String(req.body[f]) : req.body[f];
  });

  taiKhoanService.capNhat(ten, updates);
  res.json({ ok: true, ten });
});

module.exports = router;
