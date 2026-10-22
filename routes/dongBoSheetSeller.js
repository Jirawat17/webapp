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

// "Bỏ qua" 1 lỗi đang chờ (14/10/2026, theo yêu cầu người dùng) — CHỈ superadmin (cùng quyền Đẩy lại). Ghi nhận đúng LẦN lỗi hiện tại
// (id dòng lỗi): đơn đó ghi lỗi lần mới thì hiện lại (nhatKyDbService.js#layLoiDongBoDangCho).
// body { ids: [id dòng lỗi] } (22/10/2026, theo yêu cầu người dùng — nút "Bỏ qua tất cả"): bỏ qua ĐÚNG các lỗi đang hiện trên màn hình người
// bấm (lỗi mới phát sinh sau khi tải trang KHÔNG bị bỏ qua theo); mỗi lỗi ghi nhận đúng lần lỗi đó như bỏ qua từng dòng.
router.post('/bo-qua', requireExactRole('superadmin'), (req, res) => {
  const { sttKey, loai, ids } = req.body || {};
  const dangCho = nhatKyDbService.layLoiDongBoDangCho();
  const theoDs = Array.isArray(ids);
  const dsId = new Set(theoDs ? ids.map(String) : []);
  const ds = theoDs ? dangCho.filter(d => dsId.has(String(d.id))) : dangCho.filter(d => d.STT_Key === sttKey && d.Loai === loai);
  if (!ds.length) return res.status(404).json({ error: theoDs ? 'Các lỗi này không còn trong danh sách (đã ghi lại được hoặc đã bỏ qua).' : 'Lỗi này không còn trong danh sách (đã ghi lại được hoặc đã bỏ qua).' });
  const luc = require('../services/dateUtils').thoiGianVNISOString();
  for (const loi of ds) {
    nhatKyDbService.danhDauDaXuLy({ loai: 'SHEET_SELLER', khoa: `${loi.STT_Key}|${loi.Loai}`, giaTri: String(loi.id), nguoi: req.session.user.ten, luc });
  }
  res.json({ ok: true, soDaBoQua: ds.length });
});

// Giá trị HIỆN TẠI trong app để đẩy lại (không dùng lại giá trị cũ lúc lỗi).
function giaTriHienTai(r, loai) {
  if (loai === 'GHI_CHU') return { GHI_CHU_XUONG: r.GHI_CHU_XUONG_NOI_BO || '' };
  if (loai === 'TRACKING') return r.TRACKING_ID ? { TRACKING_ID2: r.TRACKING_ID, HANG_VAN_CHUYEN2: r.HANG_VAN_CHUYEN || '' } : null;
  if (loai === 'DELIVERED') return r.TRANG_THAI_TRACKING ? { Delivered: r.TRANG_THAI_TRACKING } : null;
  // Số mũi chỉ (16/10/2026): lưu ở Chi tiết đơn giờ báo "đã lưu" ngay rồi ghi Sheet chạy nền -> đẩy lại bản trong app (trống = đã xoá).
  if (loai === 'SO_MUI') return r.SO_MUI_CHI_LUC ? { GhiChuTinhGia: r.SO_MUI_CHI_NOI_BO || '' } : null;
  return null;
}

// Số mũi chỉ: chỉ đẩy lại khi bản trong app ĐÚNG là giá trị của lần ghi lỗi gần nhất. Lỗi từ trước 16/10/2026 (lưu lỗi thì app không lưu
// gì): bản app là số CŨ hơn -> đẩy lên sẽ đè số Seller có thể đã sửa thẳng trên Sheet. -> câu báo | null.
function loiSoMuiKhacBanApp(sttKey, banApp) {
  const ganNhat = nhatKyDbService.layDongBoGanNhat(sttKey, 'SO_MUI');
  if (!ganNhat || ganNhat.KetQua !== 'LOI' || String(ganNhat.GiaTriSau ?? '') === String(banApp ?? '')) return null;
  return `Số mũi chỉ trong app ("${banApp}") khác giá trị lần ghi lỗi ("${ganNhat.GiaTriSau}") — không đẩy để tránh đè số trên Sheet; nhập và Lưu lại ở Chi tiết đơn.`;
}

// body: { items: [{ sttKey, loai }] } hoặc { tatCa: true } (mọi lỗi đang chờ).
router.post('/day-lai', requireExactRole('superadmin'), async (req, res) => {
  const ds = req.body.tatCa
    ? nhatKyDbService.layLoiDongBoDangCho().map(d => ({ sttKey: d.STT_Key, loai: d.Loai }))
    : (Array.isArray(req.body.items) ? req.body.items : []);
  if (ds.length === 0) return res.status(400).json({ error: 'Không có đơn nào để đẩy lại' });
  const { banDoTheoKey: theoKey } = await orderService.getManyByKeys(ds.map(d => d.sttKey), { fresh: true });
  const canGhi = [];
  const khongGhi = [];
  for (const { sttKey, loai } of ds) {
    const r = theoKey.get(sttKey);
    const giaTri = r && giaTriHienTai(r, loai);
    const loiSoMuiCu = loai === 'SO_MUI' && giaTri && loiSoMuiKhacBanApp(sttKey, giaTri.GhiChuTinhGia);
    if (!r) khongGhi.push({ sttKey, loai, ok: false, lyDo: 'Không còn đơn này trong Don_Hang_ALL.' });
    else if (loiSoMuiCu) khongGhi.push({ sttKey, loai, ok: false, lyDo: loiSoMuiCu });
    else if (!giaTri) khongGhi.push({ sttKey, loai, ok: false, lyDo: loai === 'SO_MUI' ? 'Trong app chưa có số mũi chỉ đã lưu — nhập và Lưu ở trang Chi tiết đơn.'
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
