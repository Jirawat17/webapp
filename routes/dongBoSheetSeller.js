// Theo dõi / đẩy lại việc ghi sang Sheet Seller (bổ sung 28/09/2026, theo yêu cầu người dùng) — xem
// services/sheetSellerService.js. Lỗi đang chờ: admin + superadmin (cùng người xem Trung tâm hành động);
// Đẩy lại, nhật ký, CONFIG: CHỈ superadmin. KHÔNG tự thử lại — chỉ đẩy khi superadmin bấm.
const express = require('express');
const router = express.Router();
const { requireLogin, requireRole, requireExactRole } = require('../middleware/auth');
const nhatKyDbService = require('../services/nhatKyDbService');
const sheetSellerService = require('../services/sheetSellerService');
const orderService = require('../services/orderService');

router.use(requireLogin);

router.get('/loi-dang-cho', requireRole(), (req, res) => {
  const trongPhamVi = orderService.phamViDon(req.session.user); // admin: chỉ đơn Xưởng mình (29/09/2026)
  res.json(nhatKyDbService.layLoiDongBoDangCho().filter(d => trongPhamVi(d.STT_Key)));
});

// Giá trị HIỆN TẠI trong app để đẩy lại (không dùng lại giá trị cũ lúc lỗi).
function giaTriHienTai(r, loai) {
  if (loai === 'GHI_CHU') return { GHI_CHU_XUONG: r.GHI_CHU_XUONG_NOI_BO || '' };
  if (loai === 'TRACKING') return r.TRACKING_ID ? { TRACKING_ID2: r.TRACKING_ID, HANG_VAN_CHUYEN2: r.HANG_VAN_CHUYEN || '' } : null;
  if (loai === 'DELIVERED') return r.TRANG_THAI_TRACKING ? { Delivered: r.TRANG_THAI_TRACKING } : null;
  return null;
}

// body: { items: [{ sttKey, loai }] } hoặc { tatCa: true } (mọi lỗi đang chờ).
router.post('/day-lai', requireExactRole('superadmin'), async (req, res) => {
  const ds = req.body.tatCa
    ? nhatKyDbService.layLoiDongBoDangCho().map(d => ({ sttKey: d.STT_Key, loai: d.Loai }))
    : (Array.isArray(req.body.items) ? req.body.items : []);
  if (ds.length === 0) return res.status(400).json({ error: 'Không có đơn nào để đẩy lại' });
  const { rows } = await orderService.getAll({ fresh: true });
  const theoKey = new Map(rows.map(r => [r.STT_Key, r]));
  const canGhi = [];
  const khongGhi = [];
  for (const { sttKey, loai } of ds) {
    const r = theoKey.get(sttKey);
    const giaTri = r && giaTriHienTai(r, loai);
    if (!r) khongGhi.push({ sttKey, loai, ok: false, lyDo: 'Không còn đơn này trong Don_Hang_ALL.' });
    else if (!giaTri) khongGhi.push({ sttKey, loai, ok: false, lyDo: loai === 'SO_MUI' ? 'Số mũi chỉ không đẩy lại tự động — nhập và Lưu lại ở trang Chi tiết đơn.'
      : loai in sheetSellerService.COT_THEO_LOAI ? 'Trong app chưa có giá trị để ghi (chưa có tracking/trạng thái vận chuyển).' : `Loại không hợp lệ: ${loai}` });
    else canGhi.push({ sttKey, loai, giaTri });
  }
  const ketQua = await sheetSellerService.ghiHangLoat(canGhi, req.session.user);
  res.json({
    ketQua: [...ketQua.map(({ sttKey, loai, ok, lyDo, tab, dong }) => ({ sttKey, loai, ok, lyDo, tab, dong })), ...khongGhi],
  });
});

router.get('/nhat-ky', requireExactRole('superadmin'), (req, res) => {
  const { loai, ketQua, sttKey, gioiHan } = req.query;
  res.json(nhatKyDbService.layNhatKyDongBoSheetSeller({ loai, ketQua, sttKey: sttKey ? String(sttKey).trim().toUpperCase() : '', gioiHan }));
});

// ?kiemTra=1 -> đọc thử dòng tiêu đề từng Sheet/tab trong CONFIG.
router.get('/config', requireExactRole('superadmin'), async (req, res) => {
  res.json(await sheetSellerService.kiemTraConfig({ kiemTraSheet: req.query.kiemTra === '1' }));
});

module.exports = router;
