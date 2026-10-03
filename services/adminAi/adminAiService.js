// AdminAI — chạy quét, băm ảnh, Telegram, báo cáo đầu ngày, phân tích AI (03/10/2026, theo yêu cầu người dùng, CHỈ superadmin).
//  - Quét mỗi 5 phút (chỉ các luật đang bật + đủ ngưỡng, xem luat.js). Không tự sửa dữ liệu đơn nào.
//  - Telegram: dùng chung bot + Chat ID của QC. Mỗi vấn đề chỉ báo 1 lần; mỗi lượt quét gộp thành tối đa 1 tin.
//  - AI: cấu hình RIÊNG (qc_cau_hinh, Loai = 'ADMIN_AI'). AI chỉ đề xuất — bản nháp kinh nghiệm phải được superadmin Lưu rồi Xác nhận.
const cron = require('node-cron');
const caiDatDbService = require('../caiDatDbService');
const nhatKyDbService = require('../nhatKyDbService');
const telegramService = require('../telegramService');
const anhNguonService = require('../anhNguonService');
const { tinhHashAnh } = require('../perceptualHashService');
const { thoiGianVNISOString } = require('../dateUtils');
const qcService = require('../qc/qcService');
const aiProvider = require('../qc/aiProvider');
const L = require('./luat');

const LOAI_AI = 'ADMIN_AI';
const SO_ANH_BAM_MOI_LUOT = 30;
const SO_DIA_CHI_AI_MOI_LUOT = 5;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const loiNghiepVu = (thongBao, status = 400) => Object.assign(new Error(thongBao), { status });
const THU_TU_MUC = { CAO: 0, TB: 1, THAP: 2 };

let dangQuet = null;
let lanQuetCuoi = null; // { thoiGian, soVanDe, moi, loi, giay }

// ---------------- Băm ảnh (luật ANH_TRUNG) ----------------
// Ảnh cần băm: ảnh hiện tại của đơn có mốc (sản xuất / dán tem) từ (lần đầu có AdminAI - 30 ngày) trở đi, chưa băm hoặc URL đã đổi.
// Mới nhất trước, tối đa SO_ANH_BAM_MOI_LUOT ảnh / lượt -> lần quét bù đầu tiên chạy dần qua nhiều lượt, không dồn tải.
async function bamAnhMoi(ctx) {
  const tu = (L.tg(caiDatDbService.layMocApDungAdminAi()) ?? ctx.bayGio) - 30 * L.NGAY;
  // Đã băm đúng URL này thì bỏ qua — riêng lần trước LỖI (MinIO / mạng chập chờn) thì thử lại sau 6 giờ.
  const daBam = new Map(nhatKyDbService.layTatCaAnhHash().filter(a => !a.Loi || ctx.bayGio - (L.tg(a.ThoiGian) ?? 0) < 6 * L.GIO).map(a => [`${a.STT_Key}|${a.Cot}`, a.Url]));
  const can = [];
  for (const r of ctx.rows) {
    for (const [cot, cotMoc] of Object.entries(L.COT_MOC_ANH)) {
      const moc = L.tg(r[cotMoc]);
      if (r[cot] && moc && moc >= tu && daBam.get(`${r.STT_Key}|${cot}`) !== r[cot]) can.push({ sttKey: r.STT_Key, cot, url: r[cot], moc });
    }
  }
  can.sort((a, b) => b.moc - a.moc);
  for (const a of can.slice(0, SO_ANH_BAM_MOI_LUOT)) {
    let hash = '', loi = '';
    try {
      const buf = await anhNguonService.taiAnh(a.url);
      if (!buf || !buf.length) throw new Error('Không tải được ảnh');
      hash = await tinhHashAnh(buf);
      if (!hash) throw new Error('Không băm được ảnh');
    } catch (err) {
      loi = err.message.slice(0, 200);
    }
    nhatKyDbService.ghiAnhHash({ sttKey: a.sttKey, cot: a.cot, url: a.url, hash, loi, thoiGian: thoiGianVNISOString() });
  }
  return { conCho: Math.max(0, can.length - SO_ANH_BAM_MOI_LUOT) };
}
function thongKeAnh() {
  const ds = nhatKyDbService.layTatCaAnhHash();
  return { daBam: ds.filter(a => a.Hash).length, loi: ds.filter(a => !a.Hash).length };
}

// ---------------- Quét ----------------
async function quet({ guiTelegram = true } = {}) {
  if (dangQuet) return dangQuet;
  dangQuet = (async () => {
    const batDau = Date.now();
    const caiDat = caiDatDbService.layCaiDatAdminAi();
    const tt = L.trangThaiLuat(caiDat);
    if (!Object.values(tt).some(x => x.hoatDong) && !tt.ANH_TRUNG.bat) {
      // Không luật nào chạy: chỉ đóng vấn đề tự động còn mở, KHÔNG đọc Sheets / nhật ký.
      const bayGio0 = thoiGianVNISOString();
      nhatKyDbService.ghiLuotQuetAdminAi([], Object.keys(L.LUAT), bayGio0);
      lanQuetCuoi = { thoiGian: bayGio0, soVanDe: 0, moi: 0, loi: {}, conChoBam: 0, giay: 0, khongLuatNao: true };
      return lanQuetCuoi;
    }
    const ctx = await L.taoNguCanh(batDau);
    let conChoBam = 0;
    if (tt.ANH_TRUNG.bat) conChoBam = (await bamAnhMoi(ctx)).conCho;
    const { vanDe, luatDaChay, loi } = L.chayLuat(ctx, caiDat);
    const bayGio = thoiGianVNISOString();
    const moi = nhatKyDbService.ghiLuotQuetAdminAi(vanDe, luatDaChay, bayGio);
    if (caiDat.aiRaDiaChi && tt.DIA_CHI.hoatDong) await raDiaChiBangAi(vanDe.filter(v => v.luat === 'DIA_CHI'), ctx).catch(err => console.error('[AdminAI] AI rà địa chỉ lỗi:', err.message));
    if (guiTelegram) await guiVanDeMoi().catch(err => console.error('[AdminAI] Gửi Telegram lỗi:', err.message));
    lanQuetCuoi = { thoiGian: bayGio, soVanDe: vanDe.length, moi, loi, conChoBam, giay: Math.round((Date.now() - batDau) / 100) / 10 };
    return lanQuetCuoi;
  })();
  try { return await dangQuet; } finally { dangQuet = null; }
}

// ---------------- Telegram (bot QC) ----------------
async function gui(text) {
  const { chatId, botToken } = qcService.layTelegram();
  if (!chatId) return { ok: false, loi: 'Chưa có Chat ID (cấu hình ở menu QC)' };
  return telegramService.guiTinNhan(chatId, text, botToken);
}
const SO_DONG_MOI_LUAT = 8;
async function guiVanDeMoi() {
  const ds = nhatKyDbService.layVanDeChuaGuiTelegram();
  if (!ds.length) return;
  if (!qcService.layTelegram().chatId) { nhatKyDbService.danhDauDaGuiTelegram(ds.map(v => v.id)); return; } // chưa có nơi gửi — không dồn tồn
  const theoLuat = new Map();
  for (const v of ds) { if (!theoLuat.has(v.Luat)) theoLuat.set(v.Luat, []); theoLuat.get(v.Luat).push(v); }
  const nhom = [...theoLuat].sort((a, b) => THU_TU_MUC[a[1][0].Muc] - THU_TU_MUC[b[1][0].Muc]);
  // Ghép theo KHỐI hoàn chỉnh, dừng trước khi vượt giới hạn 4096 ký tự của Telegram — KHÔNG cắt chuỗi giữa chừng (cắt trúng thẻ
  // <b> / &amp; thì Telegram từ chối cả tin -> lượt sau gửi lại đúng tin đó -> kẹt mãi).
  let text = `🤖 <b>AdminAI</b> — ${ds.length} vấn đề mới\n`;
  const het = '\n… (xem đủ ở menu AdminAI)';
  for (const [luat, vs] of nhom) {
    const dong = [`\n<b>${esc((L.LUAT[luat] || {}).ten || luat)}</b> (${vs.length})`, ...vs.slice(0, SO_DONG_MOI_LUAT).map(v => `• ${esc(v.MoTa.slice(0, 220))}`)];
    if (vs.length > SO_DONG_MOI_LUAT) dong.push(`… và ${vs.length - SO_DONG_MOI_LUAT} vấn đề khác`);
    let daHet = false;
    for (const d of dong) {
      if (text.length + d.length + 1 + het.length > 3900) { text += het; daHet = true; break; }
      text += d + '\n';
    }
    if (daHet) break;
  }
  const kq = await gui(text);
  if (kq && kq.ok === false) throw new Error(kq.loi || 'Telegram từ chối');
  nhatKyDbService.danhDauDaGuiTelegram(ds.map(v => v.id));
}

// Báo cáo đầu ngày: vấn đề đang mở theo luật, vấn đề mới 24 giờ qua, chi phí AI hôm qua.
function taoBaoCao(bayGio = Date.now()) {
  const dangMo = nhatKyDbService.layVanDeAdminAi({ trangThai: 'MO' });
  const moi24h = dangMo.filter(v => (L.tg(v.LanDau) ?? 0) >= bayGio - L.NGAY);
  const homQua = L.ngayVN(bayGio - L.NGAY);
  const cp = L.chiPhiTheoNgay(thoiGianVNISOString(new Date(bayGio - 2 * L.NGAY))).get(homQua);
  const theoLuat = new Map();
  for (const v of dangMo) theoLuat.set(v.Luat, (theoLuat.get(v.Luat) || 0) + 1);
  let text = `☀️ <b>AdminAI — báo cáo đầu ngày ${L.ngayVN(bayGio)}</b>\n\nĐang mở: <b>${dangMo.length}</b> vấn đề (mới trong 24 giờ: ${moi24h.length})\n`;
  for (const [luat, n] of [...theoLuat].sort((a, b) => b[1] - a[1])) text += `• ${esc((L.LUAT[luat] || {}).ten || luat)}: ${n}\n`;
  const cao = dangMo.filter(v => v.Muc === 'CAO').slice(0, 5);
  if (cao.length) text += `\n<b>Mức cao</b>\n${cao.map(v => `• ${esc(v.MoTa.slice(0, 200))}`).join('\n')}\n`;
  text += `\nChi phí AI hôm qua (${homQua}): ${cp ? `${Math.round(cp.chiPhi * 100) / 100} USD${cp.chuaCoGia.size ? ` (chưa có giá: ${[...cp.chuaCoGia].join(', ')})` : ''}` : '0 USD'}`;
  return text;
}
async function guiBaoCao() {
  const kq = await gui(taoBaoCao());
  if (kq && kq.ok === false) throw loiNghiepVu(kq.loi || 'Telegram từ chối');
}
const gioHienTaiVN = (bayGio = Date.now()) => new Date(bayGio + 7 * L.GIO).toISOString().slice(11, 16);
async function guiBaoCaoNeuDenGio(bayGio = Date.now()) {
  const cd = caiDatDbService.layCaiDatAdminAi();
  const homNay = L.ngayVN(bayGio);
  if (!cd.gioBaoCao || cd.ngayBaoCaoCuoi === homNay || gioHienTaiVN(bayGio) < cd.gioBaoCao) return;
  caiDatDbService.datCaiDatAdminAi({ ngayBaoCaoCuoi: homNay }); // ghi trước — lỗi gửi thì bỏ qua hôm nay, không gửi lặp mỗi phút
  await guiBaoCao();
}

// ---------------- AI ----------------
const NHA_CUNG_CAP = qcService.NHA_CUNG_CAP;
const layCauHinhAi = nhaCungCap => qcService.layCauHinh(LOAI_AI, nhaCungCap);
async function goiAi({ loai, khoa = '', prompt, schema, dauVao = '', nguoi = '' }) {
  const ch = layCauHinhAi();
  if (!ch.apiKey) throw loiNghiepVu('Chưa cấu hình AI cho AdminAI (khối "Cấu hình AI" trong menu AdminAI).');
  const thongKe = {};
  const dong = { Loai: loai, Khoa: khoa, DauVao: dauVao, Model: ch.model, ThoiGian: thoiGianVNISOString(), NguoiChay: nguoi };
  try {
    const kq = await aiProvider.phanTichAnh({ apiKey: ch.apiKey, model: ch.model, prompt, anh: [], schema, thongKe }, ch.nhaCungCap);
    const id = nhatKyDbService.ghiPhanTichAdminAi({ ...dong, KetQua: JSON.stringify(kq), TokenVao: thongKe.tokenVao ?? '', TokenRa: thongKe.tokenRa ?? '' });
    return { id, ketQua: kq };
  } catch (err) {
    nhatKyDbService.ghiPhanTichAdminAi({ ...dong, Loi: err.message.slice(0, 500), TokenVao: thongKe.tokenVao ?? '', TokenRa: thongKe.tokenRa ?? '' });
    throw err;
  }
}
async function thuKetNoiAi(nhaCungCap) {
  const ch = layCauHinhAi(nhaCungCap);
  if (!ch.apiKey) throw loiNghiepVu('Chưa có API key.');
  await aiProvider.thuKetNoi(ch, ch.nhaCungCap);
}

// AI rà địa chỉ — CHỈ đơn đang bị luật DIA_CHI gắn cờ, mỗi địa chỉ chỉ rà 1 lần (đổi địa chỉ thì rà lại). Chỉ đề xuất, không sửa.
const SCHEMA_DIA_CHI = {
  type: 'object',
  properties: {
    co_van_de: { type: 'boolean' },
    van_de: { type: 'array', items: { type: 'object', properties: { truong: { type: 'string' }, mo_ta: { type: 'string' }, de_xuat: { type: 'string' } }, required: ['truong', 'mo_ta', 'de_xuat'] } },
    nhan_xet: { type: 'string' },
  },
  required: ['co_van_de', 'van_de', 'nhan_xet'],
};
const chuoiDiaChi = r => JSON.stringify({ ten: r.TEN || '', sdt: r.SDT || '', duong_1: r.DIA_CHI_TEN_DUONG || '', duong_2: r.DIA_CHI_TEN_DUONG_2 || '', thanh_pho: r.DIA_CHI_TEN_TP || '', bang: r.DIA_CHI_BANG || '', zip: r.MA_ZIPCODE || '', nuoc: r.DIA_CHI_NUOC || '' });
async function raDiaChiBangAi(dsVanDe, ctx) {
  if (!layCauHinhAi().apiKey) return;
  const boQua = new Set(nhatKyDbService.layVanDeAdminAi({ trangThai: 'BO_QUA', luat: 'DIA_CHI' }).map(v => v.STT_Key)); // đã Bỏ qua -> không tốn tiền AI
  let soLan = 0;
  for (const v of dsVanDe) {
    if (soLan >= SO_DIA_CHI_AI_MOI_LUOT) break;
    if (boQua.has(v.sttKey)) continue;
    const r = ctx.theoKey.get(v.sttKey);
    if (!r) continue;
    const diaChi = chuoiDiaChi(r);
    const cu = nhatKyDbService.layPhanTichMoiNhat('DIA_CHI', r.STT_Key);
    // Đã rà đúng địa chỉ này: bỏ qua; riêng lần trước LỖI (mạng, quota...) thì thử lại sau 6 giờ.
    if (cu && cu.DauVao === diaChi && (!cu.Loi || Date.now() - (L.tg(cu.ThoiGian) ?? 0) < 6 * L.GIO)) continue;
    soLan++;
    await goiAi({
      loai: 'DIA_CHI', khoa: r.STT_Key, dauVao: diaChi, nguoi: 'AdminAI', schema: SCHEMA_DIA_CHI,
      prompt: `Bạn rà dữ liệu giao hàng quốc tế (thường là Mỹ / Anh) của 1 đơn hàng trước khi mua nhãn vận chuyển.
Hệ thống đã phát hiện: ${v.moTa}
Dữ liệu (JSON): ${diaChi}
Nhiệm vụ: chỉ ra lỗi CÓ THỂ có (thiếu trường, ZIP/postcode không khớp bang/thành phố, sai chính tả tên thành phố/bang, dữ liệu nằm nhầm cột, ký tự lạ...).
Với mỗi lỗi: "truong" (tên trường), "mo_ta" (vì sao nghi sai), "de_xuat" (cách kiểm tra / sửa). KHÔNG bịa dữ liệu còn thiếu — trường trống thì đề xuất "hỏi lại khách / kiểm tra đơn gốc".
Không chắc chắn thì nói rõ là nghi ngờ. Viết tiếng Việt, ngắn gọn. Trả JSON đúng cấu trúc.`,
    }).catch(err => console.error(`[AdminAI] AI rà địa chỉ ${r.STT_Key}:`, err.message));
  }
}

// Ca QC AI đánh giá SAI (đã có kết quả thực tế khác kết quả AI) trong 30 ngày — đầu vào cho tổng kết QC + bản nháp kinh nghiệm.
function caAiSai() {
  const tu = thoiGianVNISOString(new Date(Date.now() - 30 * L.NGAY));
  const kn = new Map(nhatKyDbService.layDanhSachKinhNghiem({}).map(k => [k.QcLogId, k]));
  // ponytail: chỉ 150 ca MỚI NHẤT (giới hạn độ dài prompt / chi phí); cần hơn thì gom theo nhóm trước khi gửi.
  return nhatKyDbService.layQcLogTu(tu).filter(r => r.DanhGiaThucTe && r.KetQua !== 'LOI' && r.KetQua !== r.DanhGiaThucTe).slice(-150).map(r => ({
    log_id: r.id, loai_qc: r.LoaiQc, ma_don: r.STT_Key, ai_ket_luan: r.KetQua, thuc_te: r.DanhGiaThucTe,
    ly_do_ai: String(r.LyDoKetLuan || r.LyDo || '').slice(0, 400), giai_thich_superadmin: String(r.DanhGiaLyDo || '').slice(0, 400),
    kinh_nghiem_da_co: kn.get(r.id) ? String(kn.get(r.id).KinhNghiem).slice(0, 400) : '',
  }));
}
const SCHEMA_TONG_KET = {
  type: 'object',
  properties: {
    nhom_loi: { type: 'array', items: { type: 'object', properties: { ten: { type: 'string' }, loai_qc: { type: 'string' }, so_ca: { type: 'integer' }, mo_ta: { type: 'string' }, vi_du_ma_don: { type: 'array', items: { type: 'string' } }, goi_y: { type: 'string' } }, required: ['ten', 'loai_qc', 'so_ca', 'mo_ta', 'vi_du_ma_don', 'goi_y'] } },
    nhan_xet: { type: 'string' },
  },
  required: ['nhom_loi', 'nhan_xet'],
};
const SCHEMA_KINH_NGHIEM = {
  type: 'object',
  properties: {
    de_xuat: { type: 'array', items: { type: 'object', properties: {
      loai_qc: { type: 'string' }, pham_vi: { type: 'string', enum: ['TOAN_QC', 'LOAI_SAN_PHAM'] }, ai_sai_gi: { type: 'string' },
      noi_dung: { type: 'string' }, can_cu_log_ids: { type: 'array', items: { type: 'integer' } },
    }, required: ['loai_qc', 'pham_vi', 'ai_sai_gi', 'noi_dung', 'can_cu_log_ids'] } },
  },
  required: ['de_xuat'],
};
const SCHEMA_LOI_SX = {
  type: 'object',
  properties: { nhan_xet: { type: 'array', items: { type: 'string' } }, de_xuat: { type: 'array', items: { type: 'string' } } },
  required: ['nhan_xet', 'de_xuat'],
};

// Thống kê lỗi sản xuất 30 ngày (CODE tính — bảng số liệu là chuẩn; AI chỉ viết nhận xét dựa trên bảng này).
async function thongKeLoiSanXuat() {
  const ctx = await L.taoNguCanh();
  const tu = Date.now() - 30 * L.NGAY;
  const ca = [];
  for (const [k, ds] of ctx.chuyen) {
    for (const c of ds) {
      if (c.sang !== 'LỖI SẢN XUẤT CẦN LÀM LẠI' || c.t < tu) continue;
      const r = ctx.theoKey.get(k) || {};
      ca.push({ maDon: k, thoiGian: L.hienGio(c.t), tuan: L.ngayVN(c.t - ((new Date(c.t + 7 * L.GIO).getUTCDay() + 6) % 7) * L.NGAY), nguoiBaoLoi: c.nguoi || '', tuTrangThai: c.tu || '',
        nguoiChayMay: r.NGUOI_CHAY_MAY || '', loai: r.LOAI || '', kichThuoc: r.KICH_THUOC || '', mau: r.MAU_SAC || '', xuong: r.XUONG || '' });
    }
  }
  const dem = truong => Object.entries(ca.reduce((m, x) => ({ ...m, [x[truong] || '(trống)']: (m[x[truong] || '(trống)'] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  return { tong: ca.length, theoNguoiChayMay: dem('nguoiChayMay'), theoLoai: dem('loai'), theoKichThuoc: dem('kichThuoc'), theoXuong: dem('xuong'), theoTuan: dem('tuan').sort((a, b) => a[0].localeCompare(b[0])), ca };
}

const PHAN_TICH = {
  TONG_KET_QC: { ten: 'Tổng kết lỗi QC' },
  KINH_NGHIEM: { ten: 'Bản nháp kinh nghiệm QC' },
  LOI_SAN_XUAT: { ten: 'Phân tích lỗi sản xuất' },
};
async function chayPhanTich(loai, nguoi) {
  if (loai === 'TONG_KET_QC' || loai === 'KINH_NGHIEM') {
    const ds = caAiSai();
    if (!ds.length) throw loiNghiepVu('30 ngày qua chưa có lần QC nào được đánh giá là AI sai — chưa có gì để phân tích.');
    if (loai === 'TONG_KET_QC') {
      return goiAi({ loai, nguoi, schema: SCHEMA_TONG_KET, dauVao: `${ds.length} ca`, prompt: `Bạn phân tích các lần AI QC (kiểm tra ảnh sản phẩm thêu: QC1 vẽ file, QC2 sản xuất, QC3 dán tem) bị đánh giá SAI so với thực tế trong 30 ngày qua.
Dữ liệu (JSON, mỗi ca: kết luận AI, thực tế, lý do AI, giải thích của superadmin): ${JSON.stringify(ds)}
Gộp các ca thành NHÓM LỖI theo nguyên nhân giống nhau. Mỗi nhóm: ten, loai_qc, so_ca (đếm đúng số ca trong dữ liệu), mo_ta, vi_du_ma_don (tối đa 5 mã có trong dữ liệu), goi_y (nên sửa prompt / thêm kinh nghiệm gì).
Sắp xếp nhóm nhiều ca nhất trước. "nhan_xet": 2-4 câu tổng quan. Chỉ dựa vào dữ liệu, không bịa. Tiếng Việt, ngắn gọn.` });
    }
    const daCo = nhatKyDbService.layDanhSachKinhNghiem({}).filter(k => k.TrangThai === 'DA_XAC_NHAN').map(k => ({ loai_qc: k.LoaiQc, pham_vi: k.PhamVi, noi_dung: k.KinhNghiem }));
    return goiAi({ loai, nguoi, schema: SCHEMA_KINH_NGHIEM, dauVao: `${ds.length} ca`, prompt: `Bạn soạn BẢN NHÁP "kinh nghiệm" để đưa vào prompt AI QC lần sau, giúp AI không lặp lại các lỗi dưới đây (QC1 vẽ file, QC2 sản xuất, QC3 dán tem).
Các ca AI đánh giá SAI 30 ngày qua (JSON): ${JSON.stringify(ds)}
Kinh nghiệm ĐÃ XÁC NHẬN đang dùng (KHÔNG đề xuất trùng ý): ${JSON.stringify(daCo)}
Mỗi đề xuất: loai_qc (QC1/QC2/QC3), pham_vi (TOAN_QC = áp dụng mọi đơn của QC đó; LOAI_SAN_PHAM = chỉ cùng loại sản phẩm với đơn căn cứ), ai_sai_gi (AI đã sai điều gì, 1-2 câu),
noi_dung (câu hướng dẫn cho AI, TỐI ĐA ${qcService.KN_DO_DAI_KINH_NGHIEM} ký tự, cụ thể, kiểm chứng được), can_cu_log_ids (log_id các ca làm căn cứ, CÙNG loai_qc).
Chỉ đề xuất khi có căn cứ rõ trong dữ liệu (ưu tiên lỗi lặp lại ≥ 2 ca). Tối đa 5 đề xuất. Tiếng Việt.` });
  }
  if (loai === 'LOI_SAN_XUAT') {
    const tk = await thongKeLoiSanXuat();
    if (!tk.tong) throw loiNghiepVu('30 ngày qua không có đơn nào chuyển sang "LỖI SẢN XUẤT CẦN LÀM LẠI".');
    const { ca, ...bang } = tk;
    const r = await goiAi({ loai, nguoi, schema: SCHEMA_LOI_SX, dauVao: JSON.stringify(tk), prompt: `Bạn phân tích lỗi sản xuất của xưởng thêu 30 ngày qua. Số liệu do hệ thống đếm (chính xác, KHÔNG được sửa số):
${JSON.stringify(bang)}
Viết "nhan_xet": 3-6 ý ngắn, chỉ rõ lỗi tập trung ở người chạy máy / loại / kích thước / xưởng / tuần nào (dẫn đúng số trong bảng). Lưu ý số lỗi phải xét cùng khối lượng việc — bảng không có tổng số đơn mỗi người, nên không kết luận "người X kém" chỉ từ số tuyệt đối.
"de_xuat": 2-4 việc nên kiểm tra. Không bịa nguyên nhân không có trong số liệu. Tiếng Việt.` });
    return { ...r, thongKe: tk };
  }
  throw loiNghiepVu('Loại phân tích không hợp lệ.');
}
// Kết quả mới nhất của từng phân tích (kèm bảng số liệu lỗi sản xuất đã lưu trong DauVao).
function ketQuaPhanTich() {
  return Object.fromEntries(Object.keys(PHAN_TICH).map(loai => {
    // Kết quả TỐT gần nhất + lỗi của lần chạy sau đó (nếu có) — lần chạy lỗi không che mất kết quả cũ.
    const moi = nhatKyDbService.layPhanTichMoiNhat(loai);
    const r = nhatKyDbService.layPhanTichThanhCongMoiNhat(loai) || moi;
    if (!r) return [loai, null];
    const loiSau = moi && moi.Loi && moi.id !== r.id ? { thoiGian: moi.ThoiGian, loi: moi.Loi } : null;
    let thongKe = null;
    if (loai === 'LOI_SAN_XUAT') { try { thongKe = JSON.parse(r.DauVao); } catch (e) { /* bản lỗi */ } }
    return [loai, { id: r.id, thoiGian: r.ThoiGian, nguoi: r.NguoiChay, model: r.Model, loi: r.Loi, ketQua: r.KetQua ? JSON.parse(r.KetQua) : null, thongKe, loiSau }];
  }));
}
// Lưu 1 đề xuất (bản nháp) thành kinh nghiệm QC — qua ĐÚNG hàm tạo kinh nghiệm của menu QC (kiểm tra giống hệt, trạng thái
// CHƯA XÁC NHẬN). Kinh nghiệm gắn với 1 lần QC căn cứ (mỗi lần QC tối đa 1 kinh nghiệm) -> lấy lần căn cứ đầu tiên chưa có kinh nghiệm.
// noiDung (tuỳ chọn): nội dung superadmin đã sửa lại trên giao diện trước khi lưu (trống = dùng nguyên bản AI).
async function luuKinhNghiem(phanTichId, viTri, user, noiDung) {
  const pt = nhatKyDbService.layPhanTichTheoId(Number(phanTichId));
  if (!pt || pt.Loai !== 'KINH_NGHIEM' || !pt.KetQua) throw loiNghiepVu('Không tìm thấy bản nháp.', 404);
  const dx = (JSON.parse(pt.KetQua).de_xuat || [])[Number(viTri)];
  if (!dx) throw loiNghiepVu('Không tìm thấy đề xuất.', 404);
  const ids = (dx.can_cu_log_ids || []).map(Number).filter(Boolean);
  let loiCuoi = null;
  for (const id of ids) {
    const log = nhatKyDbService.layQcLogTheoId(id);
    if (!log || log.LoaiQc !== dx.loai_qc) continue;
    try {
      return await qcService.taoKinhNghiemTuLog(id, {
        aiSaiGi: dx.ai_sai_gi, kinhNghiem: typeof noiDung === 'string' && noiDung.trim() ? noiDung : dx.noi_dung, hangMucSai: [], nguyenNhan: ['KHAC'],
        nguyenNhanKhac: `Bản nháp AdminAI (phân tích #${pt.id}), căn cứ ${ids.length} lần QC: ${ids.join(', ')}.`, phamVi: dx.pham_vi,
      }, user);
    } catch (err) {
      loiCuoi = err;
      if (err.status !== 409) throw err; // lần này đã có kinh nghiệm -> thử lần căn cứ kế tiếp
    }
  }
  throw loiCuoi || loiNghiepVu('Đề xuất không có lần QC căn cứ hợp lệ.');
}

// Lịch phân tích hằng tuần (thu: 0 = CN .. 6 = T7, gio 'HH:MM' giờ VN) — chạy cả 3 phân tích, gửi 1 tin tóm tắt.
async function chayLichTuanNeuDenGio(bayGio = Date.now()) {
  const cd = caiDatDbService.layCaiDatAdminAi();
  const lich = cd.lichPhanTich || {};
  const homNay = L.ngayVN(bayGio);
  if (lich.thu === undefined || lich.thu === '' || !lich.gio || cd.ngayPhanTichCuoi === homNay) return;
  if (new Date(bayGio + 7 * L.GIO).getUTCDay() !== Number(lich.thu) || gioHienTaiVN(bayGio) < lich.gio) return;
  caiDatDbService.datCaiDatAdminAi({ ngayPhanTichCuoi: homNay });
  const dong = [];
  for (const [loai, { ten }] of Object.entries(PHAN_TICH)) {
    try {
      const r = await chayPhanTich(loai, 'Lịch tuần');
      const kq = r.ketQua || {};
      dong.push(`• ${ten}: ${loai === 'TONG_KET_QC' ? `${(kq.nhom_loi || []).length} nhóm lỗi` : loai === 'KINH_NGHIEM' ? `${(kq.de_xuat || []).length} đề xuất kinh nghiệm` : `${(r.thongKe || {}).tong || 0} đơn lỗi`}`);
    } catch (err) {
      dong.push(`• ${ten}: ${err.message.slice(0, 150)}`);
    }
  }
  await gui(`📊 <b>AdminAI — phân tích tuần ${homNay}</b>\n${dong.map(esc).join('\n')}\n\nXem chi tiết ở menu AdminAI.`).catch(() => {});
}

function batDauLichAdminAi() {
  cron.schedule('*/5 * * * *', () => quet().catch(err => console.error('[AdminAI] Lỗi quét:', err.message)));
  cron.schedule('* * * * *', async () => {
    await guiBaoCaoNeuDenGio().catch(err => console.error('[AdminAI] Lỗi báo cáo đầu ngày:', err.message));
    await chayLichTuanNeuDenGio().catch(err => console.error('[AdminAI] Lỗi phân tích tuần:', err.message));
  });
}

module.exports = {
  LOAI_AI, NHA_CUNG_CAP, PHAN_TICH, quet, layLanQuetCuoi: () => lanQuetCuoi, thongKeAnh, guiBaoCao, taoBaoCao, guiBaoCaoNeuDenGio, chayLichTuanNeuDenGio,
  layCauHinhAi, thuKetNoiAi, chayPhanTich, ketQuaPhanTich, luuKinhNghiem, thongKeLoiSanXuat, raDiaChiBangAi, batDauLichAdminAi,
};
