const express = require('express');
const router = express.Router();
const kichBanDbService = require('../services/kichBanDbService');
const { ghiLog } = require('../services/logService');
const { requireRole } = require('../middleware/auth');

// Quản lý "Kịch bản" quét QR — bổ sung 19/09/2026, theo yêu cầu người dùng (xây trang riêng thay cho
// sửa tay tab Sheet CauHinhKichBan cũ, xem docs/superpowers/specs/2026-09-19-kich-ban-sqlite-design.md).
// CHỈ admin/superadmin — kịch bản ảnh hưởng TOÀN BỘ luồng quét QR hệ thống (mọi vai trò dùng), không
// phải cấu hình cá nhân, nên không mở rộng cho ve_file như "Đơn hàng loạt"/"Tracking".
router.use(requireRole());

const COT_HOP_LE = ['', 'TRANG_THAI_XUONG', 'TRANG_THAI_PHOI', 'TRANG_THAI_VE_FILE'];

function chuanHoaDauVao(body) {
  const { tenKichBan, trangThaiYeuCau, trangThaiSau, cot, nguoiThucHien } = body;
  if (!tenKichBan || !String(tenKichBan).trim()) throw new Error('Cần đặt tên kịch bản');
  if (!trangThaiSau || !String(trangThaiSau).trim()) throw new Error('Cần nhập Trạng thái sau (bắt buộc — đây là trạng thái đơn sẽ chuyển sang khi quét)');
  if (cot !== undefined && !COT_HOP_LE.includes(cot)) {
    throw new Error(`Cột không hợp lệ: "${cot}" — chỉ chấp nhận: ${COT_HOP_LE.filter(Boolean).join(', ')} hoặc để trống`);
  }
  return {
    Ten_Kich_Ban: String(tenKichBan).trim(),
    Trang_Thai_Yeu_Cau: trangThaiYeuCau ? String(trangThaiYeuCau).trim() : '',
    Trang_Thai_Sau: String(trangThaiSau).trim(),
    Cot: cot || '',
    Nguoi_Thuc_Hien: nguoiThucHien ? String(nguoiThucHien).trim() : '',
  };
}

router.get('/', async (req, res) => {
  res.json(kichBanDbService.layTatCa());
});

router.post('/', async (req, res) => {
  let dong;
  try {
    dong = chuanHoaDauVao(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (kichBanDbService.layTheoTen(dong.Ten_Kich_Ban)) {
    return res.status(400).json({ error: `Tên kịch bản "${dong.Ten_Kich_Ban}" đã tồn tại` });
  }

  const id = kichBanDbService.themMoi(dong);
  await ghiLog({
    nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: 'THEM_KICH_BAN',
    chiTiet: { id, tenKichBan: dong.Ten_Kich_Ban },
  });
  res.json({ ok: true, id });
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const hienCo = kichBanDbService.layTheoId(id);
  if (!hienCo) return res.status(404).json({ error: 'Không tìm thấy kịch bản' });

  let dong;
  try {
    dong = chuanHoaDauVao(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const trungTen = kichBanDbService.layTheoTen(dong.Ten_Kich_Ban);
  if (trungTen && trungTen.id !== id) {
    return res.status(400).json({ error: `Tên kịch bản "${dong.Ten_Kich_Ban}" đã tồn tại (đang dùng cho kịch bản khác)` });
  }

  kichBanDbService.capNhat(id, dong);
  await ghiLog({
    nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: 'SUA_KICH_BAN',
    chiTiet: { id, tenKichBan: dong.Ten_Kich_Ban },
  });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const hienCo = kichBanDbService.layTheoId(id);
  if (!hienCo) return res.status(404).json({ error: 'Không tìm thấy kịch bản' });

  kichBanDbService.xoa(id);
  await ghiLog({
    nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: 'XOA_KICH_BAN',
    chiTiet: { id, tenKichBan: hienCo.Ten_Kich_Ban },
  });
  res.json({ ok: true });
});

module.exports = router;
