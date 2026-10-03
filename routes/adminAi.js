// Menu AdminAI (03/10/2026, theo yêu cầu người dùng) — CHỈ superadmin, chặn ở đây cho MỌI route. Logic: services/adminAi/*.
// API key không bao giờ trả nguyên văn ra trình duyệt (cùng cách che như menu QC).
const express = require('express');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const caiDatDbService = require('../services/caiDatDbService');
const nhatKyDbService = require('../services/nhatKyDbService');
const qcService = require('../services/qc/qcService');
const L = require('../services/adminAi/luat');
const aai = require('../services/adminAi/adminAiService');
const { thoiGianVNISOString } = require('../services/dateUtils');

router.use(requireLogin, requireExactRole('superadmin'));

const cheKey = k => (k ? (k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`) : '');
const traLoi = fn => async (req, res) => {
  try { res.json(await fn(req)); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
};
const loi400 = m => Object.assign(new Error(m), { status: 400 });

// Tổng quan: luật (bật / thiếu ngưỡng / đang chạy), định nghĩa + giá trị ngưỡng, cài đặt khác, lần quét cuối, số vấn đề.
router.get('/tong-quan', (req, res) => {
  const cd = caiDatDbService.layCaiDatAdminAi();
  const tt = L.trangThaiLuat(cd);
  res.json({
    luat: Object.entries(L.LUAT).map(([ma, l]) => ({ ma, ten: l.ten, moTa: l.moTa, giaiDoan: l.giaiDoan, muc: l.muc, tuDong: l.tuDong, nguong: l.nguong, motTrong: !!l.mot, ...tt[ma] })),
    nguong: Object.entries(L.NGUONG).map(([khoa, n]) => ({ khoa, ten: n.ten, donVi: n.donVi, soSanh: n.soSanh || '', gioiHan: n.gioiHan || null, giaTri: (cd.nguong || {})[khoa] ?? '' })),
    gioBaoCao: cd.gioBaoCao || '', lichPhanTich: cd.lichPhanTich || { thu: '', gio: '' }, aiRaDiaChi: !!cd.aiRaDiaChi,
    coTelegram: !!qcService.layTelegram().chatId, lanQuetCuoi: aai.layLanQuetCuoi(), anh: aai.thongKeAnh(), dem: nhatKyDbService.demVanDeAdminAi(),
  });
});

// body: { luat: { MA: bool }, nguong: { KHOA: số | '' }, gioBaoCao: 'HH:MM' | '', lichPhanTich: { thu: 0-6 | '', gio: 'HH:MM' | '' }, aiRaDiaChi: bool }
// Kiểm tra hết rồi mới lưu (1 trường sai thì không lưu gì).
router.post('/cai-dat', (req, res) => {
  const b = req.body || {};
  const moi = {};
  if (b.luat !== undefined) {
    if (!b.luat || typeof b.luat !== 'object' || Object.keys(b.luat).some(k => !Object.hasOwn(L.LUAT, k))) return res.status(400).json({ error: 'Luật không hợp lệ.' });
    moi.luat = Object.fromEntries(Object.entries(b.luat).map(([k, v]) => [k, !!v]));
  }
  if (b.nguong !== undefined) {
    if (!b.nguong || typeof b.nguong !== 'object' || Object.keys(b.nguong).some(k => !Object.hasOwn(L.NGUONG, k))) return res.status(400).json({ error: 'Ngưỡng không hợp lệ.' });
    moi.nguong = {};
    for (const [k, v] of Object.entries(b.nguong)) {
      const s = String(v ?? '').trim().replace(',', '.');
      if (s === '') continue;
      const n = Number(s);
      const [min, max] = L.NGUONG[k].gioiHan || [0, 1e6];
      if (!Number.isFinite(n) || n < min || n > max) return res.status(400).json({ error: `"${L.NGUONG[k].ten}": phải là số từ ${min} đến ${max}.` });
      moi.nguong[k] = n;
    }
    if ((moi.nguong.GIO_LAM_TU === undefined) !== (moi.nguong.GIO_LAM_DEN === undefined)) return res.status(400).json({ error: 'Giờ làm việc: nhập đủ cả giờ bắt đầu và giờ kết thúc (hoặc để trống cả 2).' });
    if (moi.nguong.GIO_LAM_TU !== undefined && moi.nguong.GIO_LAM_TU === moi.nguong.GIO_LAM_DEN) return res.status(400).json({ error: 'Giờ bắt đầu và kết thúc làm việc phải khác nhau.' });
  }
  const laGio = s => s === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  if (b.gioBaoCao !== undefined) {
    if (!laGio(String(b.gioBaoCao))) return res.status(400).json({ error: 'Giờ báo cáo phải dạng HH:MM (24 giờ) hoặc để trống.' });
    moi.gioBaoCao = String(b.gioBaoCao);
  }
  if (b.lichPhanTich !== undefined) {
    if (!b.lichPhanTich || typeof b.lichPhanTich !== 'object') return res.status(400).json({ error: 'Lịch phân tích tuần không hợp lệ.' });
    const thu = b.lichPhanTich && b.lichPhanTich.thu !== '' && b.lichPhanTich.thu !== undefined ? Number(b.lichPhanTich.thu) : '';
    const gio = String((b.lichPhanTich && b.lichPhanTich.gio) || '');
    if ((thu !== '' && !(Number.isInteger(thu) && thu >= 0 && thu <= 6)) || !laGio(gio) || ((thu === '') !== (gio === ''))) return res.status(400).json({ error: 'Lịch phân tích tuần: chọn đủ thứ và giờ (HH:MM), hoặc để trống cả 2.' });
    moi.lichPhanTich = { thu, gio };
  }
  if (b.aiRaDiaChi !== undefined) moi.aiRaDiaChi = !!b.aiRaDiaChi;
  caiDatDbService.datCaiDatAdminAi(moi);
  res.json({ ok: true });
});

// Số liệu thực tế 30 ngày cho 1 ngưỡng — để superadmin tự chọn (không tự đặt). Cache 5 phút: dựng ngữ cảnh đọc cả nhật ký.
let ctxCache = null;
router.get('/so-lieu/:khoa', traLoi(async req => {
  if (!Object.hasOwn(L.NGUONG, req.params.khoa)) throw Object.assign(new Error('Ngưỡng không tồn tại.'), { status: 404 });
  if (!ctxCache || Date.now() - ctxCache.bayGio > 5 * 60000 || req.query.moi === '1') {
    ctxCache = await L.taoNguCanh();
    const giu = ctxCache;
    setTimeout(() => { if (ctxCache === giu) ctxCache = null; }, 5 * 60000).unref(); // giải phóng bộ nhớ khi không ai xem nữa
  }
  return L.soLieuNguong(ctxCache, req.params.khoa);
}));

// ?trangThai=MO|DA_XEM|BO_QUA|DA_DONG (trống = đang mở + đã xem) &luat= — kèm kết quả AI rà địa chỉ (nếu có) của vấn đề DIA_CHI.
router.get('/van-de', (req, res) => {
  const ds = nhatKyDbService.layVanDeAdminAi({ trangThai: String(req.query.trangThai || ''), luat: String(req.query.luat || '') });
  for (const v of ds) {
    if (v.Luat !== 'DIA_CHI') continue;
    const ai = nhatKyDbService.layPhanTichMoiNhat('DIA_CHI', v.STT_Key);
    if (ai) v.ai = { thoiGian: ai.ThoiGian, loi: ai.Loi, ketQua: ai.KetQua ? JSON.parse(ai.KetQua) : null };
  }
  res.json(ds);
});
router.post('/van-de/:id/trang-thai', (req, res) => {
  const tt = req.body && req.body.trangThai;
  if (!['DA_XEM', 'BO_QUA', 'MO'].includes(tt)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
  if (!nhatKyDbService.doiTrangThaiVanDeAdminAi(Number(req.params.id), tt, req.session.user.ten, thoiGianVNISOString())) return res.status(404).json({ error: 'Không tìm thấy vấn đề.' });
  res.json({ ok: true });
});

router.post('/quet-ngay', traLoi(() => aai.quet()));
router.post('/bao-cao/gui-thu', traLoi(async () => { await aai.guiBaoCao(); return { ok: true }; }));

// ---- Cấu hình AI riêng (qc_cau_hinh Loai = 'ADMIN_AI'), cùng kiểu menu QC ----
router.get('/ai/cau-hinh', (req, res) => {
  const { nhaCungCap } = aai.layCauHinhAi();
  res.json({
    nhaCungCap,
    dsNhaCungCap: Object.entries(aai.NHA_CUNG_CAP).map(([ma, n]) => ({ ma, ten: n.ten })),
    theoNcc: Object.fromEntries(Object.keys(aai.NHA_CUNG_CAP).map(ncc => { const { apiKey, model } = aai.layCauHinhAi(ncc); return [ncc, { model, coKey: !!apiKey, keyChe: cheKey(apiKey) }]; })),
  });
});
router.post('/ai/cau-hinh', (req, res) => {
  const { apiKey, xoaKey } = req.body || {};
  const nhaCungCap = (req.body && req.body.nhaCungCap) || 'gemini';
  const model = String((req.body && req.body.model) || '').trim();
  if (!Object.hasOwn(aai.NHA_CUNG_CAP, nhaCungCap)) return res.status(400).json({ error: 'Nhà cung cấp AI không hợp lệ.' });
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) return res.status(400).json({ error: 'Tên model không hợp lệ (vd gemini-2.5-flash, claude-sonnet-5-5).' });
  const keyMoi = String(apiKey || '').trim();
  if (keyMoi && !/^[\x21-\x7e]{10,200}$/.test(keyMoi)) return res.status(400).json({ error: 'API key không hợp lệ.' });
  const { cotKey, cotModel } = aai.NHA_CUNG_CAP[nhaCungCap];
  caiDatDbService.datCauHinhQc(aai.LOAI_AI, { NhaCungCap: nhaCungCap, [cotModel]: model, ...(xoaKey ? { [cotKey]: '' } : keyMoi ? { [cotKey]: keyMoi } : {}) });
  res.json({ ok: true });
});
router.post('/ai/thu-ket-noi', async (req, res) => {
  try { await aai.thuKetNoiAi(req.body && req.body.nhaCungCap); res.json({ ok: true }); } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});
// Chi phí AdminAI theo ngày (giá token nhập ở menu QC).
router.get('/ai/chi-phi', (req, res) => {
  const gia = Object.fromEntries(caiDatDbService.layGiaTokenQc().map(g => [g.Model, g]));
  res.json(nhatKyDbService.thongKeTokenAdminAi(thoiGianVNISOString(new Date(Date.now() - 30 * 86400000))).map(d => {
    const g = gia[d.Model];
    return { ...d, chiPhi: g ? (d.tokenVao * Number(g.GiaVao) + d.tokenRa * Number(g.GiaRa)) / 1e6 : null };
  }));
});
router.get('/ai/ket-qua', (req, res) => res.json(aai.ketQuaPhanTich()));
router.post('/ai/chay/:loai', traLoi(async req => {
  if (!aai.PHAN_TICH[req.params.loai]) throw loi400('Loại phân tích không hợp lệ.');
  await aai.chayPhanTich(req.params.loai, req.session.user.ten);
  return aai.ketQuaPhanTich()[req.params.loai];
}));
// body: { phanTichId, viTri } -> tạo kinh nghiệm QC trạng thái CHƯA XÁC NHẬN.
router.post('/ai/kinh-nghiem/luu', traLoi(async req => {
  const id = await aai.luuKinhNghiem(req.body && req.body.phanTichId, req.body && req.body.viTri, req.session.user, req.body && req.body.noiDung);
  return { ok: true, id };
}));

module.exports = router;
