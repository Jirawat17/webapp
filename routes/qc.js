// Menu QC — AI QC (30/09/2026, theo yêu cầu người dùng). CHỈ superadmin, chặn ở đây cho MỌI route (không chỉ ẩn menu).
// API key KHÔNG BAO GIỜ trả nguyên văn ra trình duyệt — chỉ dạng che (AIza…xyz9, sk-a…xyz9). Logic QC: services/qc/qcService.js.
const express = require('express');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const caiDatDbService = require('../services/caiDatDbService');
const nhatKyDbService = require('../services/nhatKyDbService');
const qcService = require('../services/qc/qcService');
const { thoiGianVNISOString } = require('../services/dateUtils');

router.use(requireLogin, requireExactRole('superadmin'));

const cheKey = k => (k ? (k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`) : '');

// Mỗi QC: nhà cung cấp đang dùng + cấu hình riêng của từng nhà cung cấp (Gemini/Claude lưu song song, 01/10/2026).
router.get('/cau-hinh', (req, res) => {
  res.json(Object.entries(qcService.LOAI_QC).map(([loai, ten]) => {
    const nhaCungCap = qcService.layCauHinh(loai).nhaCungCap;
    const theoNcc = Object.fromEntries(Object.keys(qcService.NHA_CUNG_CAP).map(ncc => {
      const { apiKey, model } = qcService.layCauHinh(loai, ncc);
      return [ncc, { model, coKey: !!apiKey, keyChe: cheKey(apiKey) }];
    }));
    return { loai, ten, nhaCungCap, theoNcc, daTrienKhai: qcService.LOAI_DA_TRIEN_KHAI.includes(loai) };
  }));
});

// body: { loai, nhaCungCap, model, apiKey?, xoaKey? } — lưu key/model CỦA nhà cung cấp đó + chọn nó làm nhà cung cấp
// đang dùng cho QC này. apiKey trống = giữ key cũ; xoaKey: true = xoá key (chỉ key của nhà cung cấp đó).
router.post('/cau-hinh', (req, res) => {
  const { loai, apiKey, xoaKey } = req.body;
  const nhaCungCap = req.body.nhaCungCap || 'gemini';
  const model = String(req.body.model || '').trim();
  if (!qcService.LOAI_QC[loai]) return res.status(400).json({ error: 'Loại QC không hợp lệ — chỉ QC1, QC2, QC3.' });
  if (!Object.hasOwn(qcService.NHA_CUNG_CAP, nhaCungCap)) return res.status(400).json({ error: 'Nhà cung cấp AI không hợp lệ — chỉ Gemini, Gemini (Agent Platform) hoặc Claude.' });
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) return res.status(400).json({ error: 'Tên model không hợp lệ (vd gemini-2.5-flash, claude-sonnet-5-5).' });
  const keyMoi = String(apiKey || '').trim();
  if (keyMoi && !/^[\x21-\x7e]{10,200}$/.test(keyMoi)) return res.status(400).json({ error: 'API key không hợp lệ.' });
  const { cotKey, cotModel } = qcService.NHA_CUNG_CAP[nhaCungCap];
  caiDatDbService.datCauHinhQc(loai, { NhaCungCap: nhaCungCap, [cotModel]: model, ...(xoaKey ? { [cotKey]: '' } : keyMoi ? { [cotKey]: keyMoi } : {}) });
  res.json({ ok: true });
});

// body: { loai, nhaCungCap? } — thử cấu hình ĐÃ LƯU của nhà cung cấp đó (mặc định: nhà cung cấp đang dùng).
router.post('/thu-ket-noi', async (req, res) => {
  try {
    await qcService.thuKetNoi(req.body.loai, req.body.nhaCungCap);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Cảnh báo Telegram (01/10/2026) — 1 Chat ID chung cho cả 3 QC; trống = tắt. Bot Token nhập ở đây (chỉ trả dạng che),
// trống = dùng TELEGRAM_BOT_TOKEN trong .env.
router.get('/telegram', (req, res) => {
  const { chatId, botToken, gopCclPhut, gioTongKet } = caiDatDbService.layTelegramQc();
  res.json({ chatId, nguonToken: botToken ? 'app' : process.env.TELEGRAM_BOT_TOKEN ? 'env' : '', tokenChe: cheKey(botToken), gopCclPhut, gioTongKet });
});
// Gộp cảnh báo (02/10/2026): body { gopCclPhut: 0 | 15..1440, gioTongKet: 'HH:MM' | '' } — logic: services/qc/qcTelegramService.js.
router.post('/telegram/gop', async (req, res) => {
  const gopCclPhut = Number(req.body.gopCclPhut);
  const gioTongKet = String(req.body.gioTongKet || '').trim();
  if (!Number.isInteger(gopCclPhut) || (gopCclPhut !== 0 && (gopCclPhut < 15 || gopCclPhut > 1440))) return res.status(400).json({ error: 'Chu kỳ gộp phải là 0 (gửi ngay) hoặc số phút nguyên từ 15 đến 1440.' });
  if (gioTongKet && !/^([01]\d|2[0-3]):[0-5]\d$/.test(gioTongKet)) return res.status(400).json({ error: 'Giờ tổng kết phải dạng HH:MM (vd 20:00) hoặc để trống để tắt.' });
  await require('../services/qc/qcTelegramService').luuCauHinhGop({ gopCclPhut, gioTongKet });
  res.json({ ok: true });
});
// body: { chatId, botToken?, xoaToken? } — botToken trống = giữ token cũ.
router.post('/telegram', (req, res) => {
  const chatId = String(req.body.chatId || '').trim();
  const botToken = String(req.body.botToken || '').trim();
  if (chatId && !/^(-?\d{3,20}|@[A-Za-z0-9_]{5,32})$/.test(chatId)) return res.status(400).json({ error: 'Chat ID không hợp lệ (vd -1001234567890 hoặc @tenkenh).' });
  if (botToken && !/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(botToken)) return res.status(400).json({ error: 'Bot Token không hợp lệ (dạng 123456789:AAE..., lấy từ @BotFather).' });
  caiDatDbService.datTelegramQc({ chatId, ...(req.body.xoaToken ? { botToken: '' } : botToken ? { botToken } : {}) });
  res.json({ ok: true });
});
router.post('/telegram/gui-thu', async (req, res) => {
  try {
    await qcService.guiThuTelegram();
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Ngưỡng kết luận riêng từng QC (01/10/2026): pass/fail = score 0–100, ccl = độ chắc chắn tối thiểu (%). Xem qcService#quyetDinhKetQua.
router.get('/nguong', (req, res) => {
  res.json({
    macDinh: qcService.NGUONG_MAC_DINH,
    ds: Object.entries(qcService.LOAI_QC).map(([loai, ten]) => {
      const n = qcService.layNguong(loai);
      return { loai, ten, ...n, loi: qcService.kiemTraNguong(n, ten) };
    }),
  });
});
// body: { nguong: { QC1: { pass, fail, ccl }, ... } } — kiểm tra TẤT CẢ trước, 1 QC sai thì không lưu QC nào. Giá trị lưu
// đúng như người dùng nhập (không tự làm tròn/sửa).
router.post('/nguong', (req, res) => {
  const nguong = req.body && typeof req.body.nguong === 'object' && req.body.nguong ? req.body.nguong : {};
  const cacLoai = Object.keys(nguong);
  if (!cacLoai.length) return res.status(400).json({ error: 'Chưa có ngưỡng nào để lưu.' });
  for (const loai of cacLoai) {
    if (!Object.hasOwn(qcService.LOAI_QC, loai)) return res.status(400).json({ error: `Loại QC không hợp lệ: ${loai}.` });
    const loi = qcService.kiemTraNguong(nguong[loai], qcService.LOAI_QC[loai]);
    if (loi) return res.status(400).json({ error: loi, loai });
  }
  for (const loai of cacLoai) {
    const { pass, fail, ccl } = nguong[loai];
    caiDatDbService.datCauHinhQc(loai, { NguongPass: String(qcService.docSo(pass)), NguongFail: String(qcService.docSo(fail)), NguongCcl: String(qcService.docSo(ccl)) });
  }
  res.json({ ok: true });
});

// Prompt AI sửa được (02/10/2026) — mỗi lần Lưu = 1 phiên bản mới + dùng ngay; kích hoạt lại phiên bản cũ / về mặc định (0);
// chạy thử bản đang sửa (chưa lưu) trên 1 đơn. Kiểm tra mẫu: qcService#kiemTraMauPrompt.
router.get('/prompt', (req, res) => {
  res.json({ choGiuCho: qcService.CHO_GIU_CHO, ds: Object.entries(qcService.LOAI_QC).map(([loai, ten]) => {
    const dang = qcService.layPromptDangDung(loai);
    return { loai, ten, choGiuCho: qcService.CHO_GIU_CHO_THEO_LOAI[loai], macDinh: qcService.MAU_PROMPT_MAC_DINH[loai],
      dangDung: dang.nhan, noiDung: dang.noiDung, lichSu: caiDatDbService.layLichSuPromptQc(loai) };
  }) });
});
router.get('/prompt/phien-ban/:id', (req, res) => {
  const pb = caiDatDbService.layPhienBanPromptQc(Number(req.params.id));
  if (!pb) return res.status(404).json({ error: 'Không tìm thấy phiên bản.' });
  res.json(pb);
});
// body: { loai, noiDung, ghiChu? }
router.post('/prompt', (req, res) => {
  const { loai, noiDung } = req.body || {};
  const loi = qcService.kiemTraMauPrompt(loai, noiDung);
  if (loi) return res.status(400).json({ error: loi });
  const ghiChu = String((req.body && req.body.ghiChu) || '').trim().slice(0, 300);
  res.json({ ok: true, id: caiDatDbService.luuPhienBanPromptQc(loai, noiDung.replace(/\r\n/g, '\n'), ghiChu, req.session.user.ten, thoiGianVNISOString()) });
});
// body: { loai, phienBan } — 0 = mặc định.
router.post('/prompt/kich-hoat', (req, res) => {
  const { loai } = req.body || {};
  const phienBan = Number(req.body && req.body.phienBan) || 0;
  if (!Object.hasOwn(qcService.LOAI_QC, loai)) return res.status(400).json({ error: 'Loại QC không hợp lệ.' });
  if (phienBan) {
    const pb = caiDatDbService.layPhienBanPromptQc(phienBan);
    if (!pb || pb.LoaiQc !== loai) return res.status(404).json({ error: 'Không tìm thấy phiên bản của QC này.' });
  }
  caiDatDbService.datPromptDangDungQc(loai, phienBan);
  res.json({ ok: true });
});
// body: { loai, sttKey, noiDung } — ghi Log chế độ TEST, không Telegram, không tính thống kê.
router.post('/prompt/chay-thu', async (req, res) => {
  const { loai, sttKey, noiDung } = req.body || {};
  try {
    res.json(await qcService.chayQc({ sttKey, loai, user: req.session.user, mauChayThu: String(noiDung ?? '').replace(/\r\n/g, '\n') }));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

// Đơn hàng vừa cập nhật trạng thái (02/10/2026): đơn có Trạng thái chung / Phôi / Vẽ file đổi trong 1 giờ gần nhất (mốc
// THOI_GIAN_DOI_TRANG_THAI do trangThaiDbService.ghiDe tự ghi). Mỗi đơn 1 dòng (lần đổi gần nhất), mới nhất trước.
router.get('/don-vua-cap-nhat', (req, res) => {
  const tu = thoiGianVNISOString(new Date(Date.now() - 3600000));
  res.json({ bayGio: new Date().toISOString(), ds: require('../services/trangThaiDbService').layDonDoiTrangThaiTu(tu)
    .filter(r => !r.DA_XOA)
    .map(r => {
      let truoc = null; // null = lần đổi trước khi có cột này (không rõ)
      try { truoc = r.TRANG_THAI_TRUOC_DO ? JSON.parse(r.TRANG_THAI_TRUOC_DO) : null; } catch (e) { /* bỏ qua */ }
      return { sttKey: r.STT_Key, trangThai: r.TRANG_THAI_XUONG, phoi: r.TRANG_THAI_PHOI, veFile: r.TRANG_THAI_VE_FILE, thoiGian: r.THOI_GIAN_DOI_TRANG_THAI,
        xuong: r.XUONG, nguoi: r.NGUOI_DOI_TRANG_THAI || '', truoc };
    }) });
});

// Gợi ý ngưỡng (02/10/2026) — CHỈ tính và hiển thị, không lưu gì. ?loai=QC1 [&pass=&fail=&ccl= : bộ ngưỡng muốn thử]
router.get('/nguong/goi-y', (req, res) => {
  const { loai, pass, fail, ccl } = req.query;
  try {
    res.json(qcService.goiYNguong(loai, pass !== undefined || fail !== undefined || ccl !== undefined ? { pass, fail, ccl } : null));
  } catch (err) { if (!err.status) throw err; res.status(err.status).json({ error: err.message }); }
});

// Tự động quét QC (02/10/2026) — bật/tắt + thời gian chờ riêng từng QC. Logic: services/qc/qcAutoService.js.
router.get('/auto', (req, res) => {
  res.json(require('../services/qc/qcAutoService').layCauHinhAuto());
});
// body: { ds: [{ loai, bat, gio, phut }] } — 1 dòng sai thì không lưu dòng nào.
router.post('/auto', (req, res) => {
  const loi = require('../services/qc/qcAutoService').luuCauHinhAuto(req.body && req.body.ds);
  if (loi) return res.status(400).json({ error: loi });
  res.json({ ok: true });
});

router.post('/chay', async (req, res) => {
  try {
    res.json(await qcService.chayQc({ sttKey: req.body.sttKey, loai: req.body.loai, user: req.session.user }));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

router.get('/log', (req, res) => {
  const { loaiQc, ketQua, sttKey, danhGia, gioiHan } = req.query;
  res.json(nhatKyDbService.layQcLog({ loaiQc, ketQua, sttKey: sttKey ? String(sttKey).trim() : '', danhGia, gioiHan }));
});

// Đánh giá QC (02/10/2026): body { thucTe: 'PASS' | 'FAIL' | '' (bỏ đánh giá), lyDo? } — chỉ ghi nhận, không đổi trạng thái đơn.
router.post('/log/:id/danh-gia', (req, res) => {
  const thucTe = String(req.body.thucTe || '');
  if (!['PASS', 'FAIL', ''].includes(thucTe)) return res.status(400).json({ error: 'Kết quả thực tế chỉ PASS hoặc FAIL.' });
  const lyDo = String(req.body.lyDo || '').trim().slice(0, 1000);
  const n = nhatKyDbService.danhGiaQcLog(Number(req.params.id), { thucTe, lyDo, nguoi: req.session.user.ten, thoiGian: thoiGianVNISOString() });
  if (!n) return res.status(404).json({ error: 'Không tìm thấy lần QC này (hoặc là dòng LỖI — không đánh giá được).' });
  res.json({ ok: true });
});

// Kinh nghiệm QC (02/10/2026) — giải thích của Superadmin về lỗi AI. Logic + kiểm tra: qcService (taoKinhNghiemTuLog...).
const traLoiLoi = (res, err) => { if (!err.status) throw err; res.status(err.status).json({ error: err.message }); };
router.get('/kinh-nghiem/danh-muc', (req, res) => {
  res.json({ hangMuc: qcService.HANG_MUC_THEO_LOAI, nguyenNhan: qcService.NGUYEN_NHAN_KN, phamVi: qcService.PHAM_VI_KN,
    trangThai: qcService.TRANG_THAI_KN, doDaiKinhNghiem: qcService.KN_DO_DAI_KINH_NGHIEM });
});
router.get('/kinh-nghiem', (req, res) => {
  const q = req.query;
  res.json(nhatKyDbService.layDanhSachKinhNghiem({ loaiQc: q.loaiQc, trangThai: q.trangThai, hangMuc: q.hangMuc, nguyenNhan: q.nguyenNhan,
    loaiSanPham: String(q.loaiSanPham || '').trim(), tuKhoa: String(q.tuKhoa || '').trim() }));
});
router.get('/kinh-nghiem/:id', (req, res) => {
  const k = nhatKyDbService.layKinhNghiemTheoId(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Không tìm thấy kinh nghiệm.' });
  res.json(k);
});
// body: { qcLogId, aiSaiGi, hangMucSai[], nguyenNhan[], nguyenNhanKhac, kinhNghiem, phamVi } — luôn tạo ở trạng thái Chưa xác nhận.
router.post('/kinh-nghiem', async (req, res) => {
  try { res.json({ ok: true, id: await qcService.taoKinhNghiemTuLog(req.body.qcLogId, req.body, req.session.user) }); } catch (err) { traLoiLoi(res, err); }
});
router.put('/kinh-nghiem/:id', async (req, res) => {
  try { await qcService.suaKinhNghiem(req.params.id, req.body, req.session.user); res.json({ ok: true }); } catch (err) { traLoiLoi(res, err); }
});
// body: { trangThai: CHUA_XAC_NHAN | DA_XAC_NHAN | KHONG_SU_DUNG }
router.post('/kinh-nghiem/:id/trang-thai', (req, res) => {
  try { qcService.doiTrangThaiKinhNghiem(req.params.id, req.body.trangThai, req.session.user); res.json({ ok: true }); } catch (err) { traLoiLoi(res, err); }
});

// Chi phí AI (02/10/2026): ?ngay=7|30|'' &gom=NGAY|THANG. Chi phí = ước tính theo giá ĐANG lưu; model chưa nhập giá -> chiPhi null.
router.get('/chi-phi', (req, res) => {
  const ngay = Number(req.query.ngay);
  const gia = Object.fromEntries(caiDatDbService.layGiaTokenQc().map(g => [g.Model, g]));
  const ds = nhatKyDbService.thongKeTokenQc(ngay > 0 ? thoiGianVNISOString(new Date(Date.now() - ngay * 86400000)) : '', req.query.gom === 'THANG' ? 'THANG' : 'NGAY')
    .map(d => {
      const g = gia[d.Model];
      return { ...d, chiPhi: g ? (d.tokenVao * Number(g.GiaVao) + d.tokenRa * Number(g.GiaRa)) / 1e6 : null };
    });
  // Model cần nhập giá: đang cấu hình ở các QC + đã xuất hiện trong log + đã có giá.
  const model = new Set([...Object.keys(gia), ...nhatKyDbService.thongKeTokenQc('', 'THANG').map(d => d.Model)]);
  for (const loai of Object.keys(qcService.LOAI_QC)) model.add(qcService.layCauHinh(loai).model);
  // AdminAI (03/10/2026) dùng chung bảng giá: thêm model đang cấu hình + đã dùng của AdminAI.
  model.add(qcService.layCauHinh('ADMIN_AI').model);
  for (const d of nhatKyDbService.thongKeTokenAdminAi('')) model.add(d.Model);
  res.json({ ds, gia: [...model].filter(Boolean).sort().map(m => ({ model: m, giaVao: gia[m] ? gia[m].GiaVao : '', giaRa: gia[m] ? gia[m].GiaRa : '' })) });
});
// body: { ds: [{ model, giaVao, giaRa }] } — USD / 1 triệu token; cả 2 trống = xoá giá. 1 dòng sai thì không lưu dòng nào.
router.post('/gia-token', (req, res) => {
  const ds = Array.isArray(req.body && req.body.ds) ? req.body.ds : [];
  const sach = [];
  for (const d of ds) {
    const model = String((d && d.model) || '').trim();
    const giaVao = String((d && d.giaVao) ?? '').trim();
    const giaRa = String((d && d.giaRa) ?? '').trim();
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) return res.status(400).json({ error: 'Tên model không hợp lệ.' });
    if ((giaVao === '') !== (giaRa === '')) return res.status(400).json({ error: `${model}: nhập đủ cả giá input và output (hoặc để trống cả 2 để xoá).` });
    for (const v of [giaVao, giaRa]) if (v !== '' && (qcService.docSo(v) === null || qcService.docSo(v) > 10000)) return res.status(400).json({ error: `${model}: giá phải là số ≥ 0 (USD / 1 triệu token).` });
    sach.push({ model, giaVao, giaRa });
  }
  caiDatDbService.datGiaTokenQc(sach);
  res.json({ ok: true });
});

// ?ngay=7|30 (trống = tất cả)
router.get('/do-chinh-xac', (req, res) => {
  const ngay = Number(req.query.ngay);
  res.json(nhatKyDbService.thongKeDanhGiaQc(ngay > 0 ? thoiGianVNISOString(new Date(Date.now() - ngay * 86400000)) : ''));
});

module.exports = router;
