const express = require('express');
const router = express.Router();
const { readTab, readTabCached, appendRow, updateCells } = require('../services/sheetsService');
const { requireRole } = require('../middleware/auth');

const TAB = 'NguoiDung';

router.use(requireRole('admin'));

// Mật khẩu PIN 1-4 chữ số (xem docs/superpowers/specs/2026-09-07-mat-khau-dang-nhap-design.md) —
// lưu trực tiếp KHÔNG mã hoá (đã xác nhận đánh đổi với người dùng: admin xem/nhắc lại được PIN cho
// nhân viên quên, đổi lại ai mở được Sheet cũng biết hết PIN mọi tài khoản).
function matKhauHopLe(mk) {
  return /^\d{1,4}$/.test(String(mk));
}

router.get('/', async (req, res) => {
  const { rows } = await readTabCached(TAB, 30000); // chỉ liệt kê để xem — POST/PUT bên dưới vẫn đọc thật vì ghi ngay sau đó
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { ten, vaiTro, team, matKhau } = req.body;
  if (!ten || !vaiTro) return res.status(400).json({ error: 'Thiếu tên hoặc vai trò' });
  // Tài khoản MỚI bắt buộc phải có mật khẩu ngay từ đầu — chỉ tài khoản CŨ (tạo trước khi có tính
  // năng này) mới được tạm thời chưa có (xem routes/auth.js).
  if (!matKhauHopLe(matKhau)) return res.status(400).json({ error: 'Mật khẩu phải là 1-4 chữ số' });

  const { headers, rows } = await readTab(TAB);
  // appendRow() CHỈ ghi đúng những cột có trong headers, IM LẶNG bỏ qua cột lạ (khác updateCells()
  // — throw lỗi rõ ràng nếu thiếu cột). Không chặn ở đây thì mật khẩu người dùng gõ vào sẽ bị mất
  // trắng mà không có lỗi nào báo, tưởng đã đặt thành công.
  if (!headers.includes('MatKhau')) {
    return res.status(400).json({ error: 'Sheet chưa có cột MatKhau — cần thêm vào tab NguoiDung trước khi dùng tính năng mật khẩu' });
  }
  if (rows.some(r => r.Ten === ten)) return res.status(400).json({ error: 'Tên này đã tồn tại' });

  await appendRow(TAB, headers, { Ten: ten, VaiTro: vaiTro, Team: team || '', KichHoat: 'TRUE', MatKhau: String(matKhau) });
  res.json({ ok: true });
});

// Đổi vai trò / team / khoá-mở tài khoản / đặt (lại) mật khẩu
router.put('/:ten', async (req, res) => {
  const { headers, rows } = await readTab(TAB);
  const user = rows.find(r => r.Ten === req.params.ten);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });

  if (req.body.MatKhau !== undefined && !matKhauHopLe(req.body.MatKhau)) {
    return res.status(400).json({ error: 'Mật khẩu phải là 1-4 chữ số' });
  }

  const updates = {};
  ['VaiTro', 'Team', 'KichHoat', 'MatKhau'].forEach(f => {
    if (req.body[f] !== undefined) updates[f] = f === 'MatKhau' ? String(req.body[f]) : req.body[f];
  });

  await updateCells(TAB, headers, user._row, updates);
  res.json({ ok: true });
});

module.exports = router;
