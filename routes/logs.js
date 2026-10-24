const express = require('express');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const { docDongCuoi } = require('../services/logCapture');

// CHỈ superadmin (bổ sung 23/09/2026, theo yêu cầu người dùng) — log server có thể chứa thông tin nhạy
// cảm (lỗi kèm dữ liệu đơn hàng, mã lỗi API bên thứ 3...), cùng mức nhạy cảm với Settings/Nhân viên.
// Trả JSON (không phải text/plain) — apiFetch() dùng chung toàn app luôn gọi res.json(), trả text thô
// sẽ khiến apiFetch() lỗi parse JSON và mất trắng nội dung (xem public/js/api.js#apiFetch).
router.get('/', requireLogin, requireExactRole('superadmin'), (req, res) => {
  const soDong = Math.min(Number(req.query.soDong) || 500, 5000);
  res.json({ text: docDongCuoi(soDong) });
});

// Sức khoẻ hệ thống (24/10/2026, theo yêu cầu người dùng — tab đầu menu Logs): xem services/sucKhoeService.js.
router.get('/suc-khoe', requireLogin, requireExactRole('superadmin'), async (req, res) => {
  res.json(await require('../services/sucKhoeService').laySucKhoe());
});

// Tải CSV số đo mạng (23/10/2026, theo yêu cầu người dùng — cạnh "Xuất CSV" của Logs_UploadAnh): DoMangMayChu (máy chủ tự đo mỗi phút) và
// DoTocDo (tốc độ đường truyền máy chủ / điện thoại / nhận ảnh). Cùng cột với file gửi Telegram hằng ngày (baoCaoVanHanhService#taoCsv*).
// tu / den = ngày VN (YYYY-MM-DD, tính cả 2 đầu), tối đa 31 ngày. Trả THẲNG file CSV (không bọc trong JSON — 31 ngày DoMangMayChu ~44 nghìn
// dòng, bọc JSON thì phình gần gấp đôi); header X-So-Dong = số dòng. Lỗi vẫn trả JSON { error }.
const LOAI_CSV = {
  'do-mang-may-chu': { lay: 'layDoMangMayChu', tao: 'taoCsvDoMangMayChu', ten: 'DoMangMayChu' },
  'do-toc-do': { lay: 'layTocDo', tao: 'taoCsvTocDo', ten: 'DoTocDo' },
};
const SO_NGAY_TOI_DA = 31;
// Ngày có thật (loại 2026-02-31, 2026-13-01) -> ms UTC của ngày đó; không hợp lệ -> NaN.
const msNgay = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? Date.parse(`${s}T00:00:00Z`) : NaN);
router.get('/csv', requireLogin, requireExactRole('superadmin'), (req, res) => {
  const loai = LOAI_CSV[req.query.loai];
  const { tu, den } = req.query;
  if (!loai) return res.status(400).json({ error: 'Loại file không hợp lệ' });
  let msTu, msDen;
  try { msTu = msNgay(tu); msDen = msNgay(den); } catch { msTu = NaN; } // toISOString ném lỗi với ngày quá giới hạn
  if (!Number.isFinite(msTu) || !Number.isFinite(msDen) || msTu > msDen) return res.status(400).json({ error: 'Chọn Từ ngày / Đến ngày hợp lệ' });
  if ((msDen - msTu) / 86400000 + 1 > SO_NGAY_TOI_DA) return res.status(400).json({ error: `Tối đa ${SO_NGAY_TOI_DA} ngày mỗi lần tải` });
  // luc lưu dạng "YYYY-MM-DDTHH:mm:ss.sss+07:00" (giờ VN) -> so chuỗi: từ đầu ngày "tu" tới hết ngày "den".
  const ds = require('../services/nhatKyDbService')[loai.lay](`${tu}T00:00`, `${den}T24`);
  res.set('X-So-Dong', String(ds.length));
  res.attachment(`${loai.ten}_${tu}_${den}.csv`);
  res.type('text/csv; charset=utf-8').send(require('../services/baoCaoVanHanhService')[loai.tao](ds));
});

module.exports = router;
