const express = require('express');
const router = express.Router();
const { readTab, readTabCached, appendRow, updateCells } = require('../services/sheetsService');
const { DANH_SACH_XUONG } = require('../services/orderService');
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
  const { ten, vaiTro, team, xuong, matKhau } = req.body;
  if (!ten || !vaiTro) return res.status(400).json({ error: 'Thiếu tên hoặc vai trò' });
  // Tài khoản MỚI bắt buộc phải có mật khẩu ngay từ đầu — chỉ tài khoản CŨ (tạo trước khi có tính
  // năng này) mới được tạm thời chưa có (xem routes/auth.js).
  if (!matKhauHopLe(matKhau)) return res.status(400).json({ error: 'Mật khẩu phải là 1-4 chữ số' });
  // Xưởng (bổ sung 13/09/2026, theo yêu cầu người dùng — phân loại đơn/nhân viên theo xưởng vật lý
  // HANOI/BACNINH) — không bắt buộc phải chọn ngay lúc tạo tài khoản (admin có thể gán sau), nhưng
  // nếu CÓ chọn thì phải đúng 1 trong danh sách hợp lệ, tránh gõ nhầm khiến nhân viên đó không thấy
  // đơn nào (xem services/orderService.js#locTheoXuong — thiếu/sai Xuong coi như không có quyền xem).
  if (xuong && !DANH_SACH_XUONG.includes(xuong)) {
    return res.status(400).json({ error: `Xưởng không hợp lệ: "${xuong}" — chỉ chấp nhận: ${DANH_SACH_XUONG.join(', ')}` });
  }

  const { headers, rows } = await readTab(TAB);
  // appendRow() CHỈ ghi đúng những cột có trong headers, IM LẶNG bỏ qua cột lạ (khác updateCells()
  // — throw lỗi rõ ràng nếu thiếu cột). Không chặn ở đây thì mật khẩu người dùng gõ vào sẽ bị mất
  // trắng mà không có lỗi nào báo, tưởng đã đặt thành công.
  if (!headers.includes('MatKhau')) {
    return res.status(400).json({ error: 'Sheet chưa có cột MatKhau — cần thêm vào tab NguoiDung trước khi dùng tính năng mật khẩu' });
  }
  if (rows.some(r => r.Ten === ten)) return res.status(400).json({ error: 'Tên này đã tồn tại' });

  await appendRow(TAB, headers, { Ten: ten, VaiTro: vaiTro, Team: team || '', Xuong: xuong || '', KichHoat: 'TRUE', MatKhau: String(matKhau) });
  res.json({ ok: true });
});

// Đổi vai trò / team / xưởng / khoá-mở tài khoản / đặt (lại) mật khẩu
router.put('/:ten', async (req, res) => {
  const { headers, rows } = await readTab(TAB);
  const user = rows.find(r => r.Ten === req.params.ten);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });

  if (req.body.MatKhau !== undefined && !matKhauHopLe(req.body.MatKhau)) {
    return res.status(400).json({ error: 'Mật khẩu phải là 1-4 chữ số' });
  }
  if (req.body.Xuong && !DANH_SACH_XUONG.includes(req.body.Xuong)) {
    return res.status(400).json({ error: `Xưởng không hợp lệ: "${req.body.Xuong}" — chỉ chấp nhận: ${DANH_SACH_XUONG.join(', ')}` });
  }

  const updates = {};
  ['VaiTro', 'Team', 'Xuong', 'KichHoat', 'MatKhau'].forEach(f => {
    if (req.body[f] !== undefined) updates[f] = f === 'MatKhau' ? String(req.body[f]) : req.body[f];
  });

  await updateCells(TAB, headers, user._row, updates);
  res.json({ ok: true });
});

module.exports = router;
