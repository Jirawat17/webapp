// AI QC (30/09/2026, theo yêu cầu người dùng) — QC thủ công theo STT_Key ở menu QC (routes/qc.js, CHỈ superadmin).
// Triển khai theo giai đoạn đã xác nhận: QC3 (dán tem) -> QC2 (sản xuất) -> QC1 (vẽ file) — cả 3 xong 30/09/2026.
// Mỗi lần chạy (kể cả lỗi API / thiếu dữ liệu) ghi 1 dòng qc_log (nhatKyDbService.js). KHÔNG đổi dữ liệu/trạng thái đơn.
// Kết quả luôn là PASS / FAIL / CAN_CHECK_LAI; server tự kiểm tra lại phần đối chiếu được bằng dữ liệu (mã tracking),
// không tin tuyệt đối vào AI — AI trả PASS mà mã trên tem không khớp đơn thì vẫn FAIL.
const orderService = require('../orderService');
const donNhieuAoService = require('../donNhieuAoService');
const caiDatDbService = require('../caiDatDbService');
const nhatKyDbService = require('../nhatKyDbService');
const { taiAnh } = require('../anhNguonService');
const { layChiTietAnhThuMucDrive, taiFileDriveTheoId } = require('../driveService');
const { tachLink, ghiChuXuongHienThi, chuanHoaAnh } = require('../thueTeamKhacService');
const { thoiGianVNISOString } = require('../dateUtils');
const aiProvider = require('./aiProvider');
const telegramService = require('../telegramService');

const LOAI_QC = { QC1: 'QC1 – QC Vẽ File', QC2: 'QC2 – QC Sản Xuất', QC3: 'QC3 – QC Dán Tem' };
const LOAI_DA_TRIEN_KHAI = ['QC1', 'QC2', 'QC3'];
const MODEL_MAC_DINH = 'gemini-2.5-flash';
// Nhà cung cấp AI chọn riêng cho từng QC (01/10/2026); chưa chọn = gemini như trước.
// vertex (01/10/2026): Gemini gọi qua Agent Platform / Vertex AI — dùng được credits Google Cloud (Gemini API của AI Studio thì không).
// cotKey/cotModel: cột lưu trong qc_cau_hinh (caiDatDbService.js) — mỗi nhà cung cấp 1 cặp riêng, lưu song song.
const NHA_CUNG_CAP = {
  gemini: { ten: 'Gemini', modelMacDinh: MODEL_MAC_DINH, cotKey: 'ApiKey', cotModel: 'Model' },
  claude: { ten: 'Claude', modelMacDinh: 'claude-sonnet-5-5', cotKey: 'ApiKeyClaude', cotModel: 'ModelClaude' },
  vertex: { ten: 'Gemini (Agent Platform / Vertex AI)', modelMacDinh: MODEL_MAC_DINH, cotKey: 'ApiKeyVertex', cotModel: 'ModelVertex' },
};
const KET_QUA = ['PASS', 'FAIL', 'CAN_CHECK_LAI'];
const DUNG_LUONG_ANH_TOI_DA = 15 * 1024 * 1024; // Gemini giới hạn ~20MB/lượt gửi ảnh trực tiếp

const loiNghiepVu = (thongBao, status = 400) => Object.assign(new Error(thongBao), { status });

// -> { nhaCungCap, apiKey, model } của nhà cung cấp đang chọn cho QC `loai` (hoặc `nhaCungCap` truyền vào).
function layCauHinh(loai, nhaCungCap) {
  const ch = caiDatDbService.layCauHinhQc()[loai] || {};
  const ncc = Object.hasOwn(NHA_CUNG_CAP, nhaCungCap) ? nhaCungCap : Object.hasOwn(NHA_CUNG_CAP, ch.NhaCungCap) ? ch.NhaCungCap : 'gemini';
  const { cotKey, cotModel, modelMacDinh } = NHA_CUNG_CAP[ncc];
  return { nhaCungCap: ncc, apiKey: ch[cotKey] || '', model: ch[cotModel] || modelMacDinh };
}

// Nhận dạng định dạng ảnh theo byte đầu (ảnh MinIO luôn JPEG sau khi nén ở trình duyệt, nhưng ảnh cũ có thể khác).
function mimeTuBuffer(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Mã tracking so sánh: bỏ khoảng trắng/ký tự phân cách, không phân biệt hoa thường. Cho phép 1 mã nằm trong mã kia (>= 10
// ký tự) vì dòng chữ dưới mã vạch USPS thường có thêm tiền tố "420 + zipcode" trước mã tracking thật.
const chuanHoaMa = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function khopMa(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [ngan, dai] = a.length <= b.length ? [a, b] : [b, a];
  return ngan.length >= 10 && dai.includes(ngan);
}

// ---------------- NGƯỠNG KẾT LUẬN + QUYẾT ĐỊNH CUỐI (01/10/2026, theo yêu cầu người dùng) ----------------
// AI chỉ PHÂN TÍCH: score (0–100, mức khớp yêu cầu, càng CAO càng tốt), confidence (0–1, độ chắc chắn), từng hạng mục,
// evidence (quan sát trực tiếp) và result ĐỀ XUẤT. Kết quả cuối do quyetDinhKetQua() — nơi DUY NHẤT quyết định PASS/FAIL/
// CAN_CHECK_LAI — tính từ ngưỡng cấu hình riêng từng QC (menu QC) + luật cứng hệ thống tự kiểm tra (luật cứng ưu tiên).
const NGUONG_MAC_DINH = { pass: 85, fail: 40, ccl: 70 };
const TEN_NGUONG = { pass: 'PASS', fail: 'FAIL', ccl: 'CAN_CHECK_LAI' };

// Chỉ nhận số thật (number hữu hạn hoặc chuỗi thập phân "85", "72.5"). -> number | null
function docSo(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

// n = { pass, fail, ccl } (số hoặc chuỗi). -> thông báo lỗi tiếng Việt, hoặc null nếu hợp lệ.
// Quy tắc: cả 3 là số 0–100; FAIL < PASS (score nằm giữa = CAN_CHECK_LAI). CAN_CHECK_LAI là thang ĐỘ CHẮC CHẮN (%), độc lập.
function kiemTraNguong(n, ten = '') {
  const tien = ten ? `${ten}: ` : '';
  const so = {};
  for (const k of ['pass', 'fail', 'ccl']) {
    const x = docSo(n && n[k]);
    if (x === null) return `${tien}ngưỡng ${TEN_NGUONG[k]} phải là số.`;
    if (x < 0 || x > 100) return `${tien}ngưỡng ${TEN_NGUONG[k]} phải từ 0 đến 100 (đang là ${x}).`;
    so[k] = x;
  }
  if (!(so.fail < so.pass)) return `${tien}ngưỡng FAIL (${so.fail}) phải NHỎ HƠN ngưỡng PASS (${so.pass}) — score nằm giữa 2 ngưỡng mới là CAN_CHECK_LAI.`;
  return null;
}

// Ngưỡng đang lưu của 1 QC (trống = mặc định). Giá trị giữ nguyên dạng đã lưu — gọi kiemTraNguong() trước khi dùng.
function layNguong(loai) {
  const ch = caiDatDbService.layCauHinhQc()[loai] || {};
  const lay = (cot, k) => (ch[cot] === undefined || ch[cot] === '' ? NGUONG_MAC_DINH[k] : ch[cot]);
  return { pass: lay('NguongPass', 'pass'), fail: lay('NguongFail', 'fail'), ccl: lay('NguongCcl', 'ccl') };
}
const nguongSo = n => ({ pass: docSo(n.pass), fail: docSo(n.fail), ccl: docSo(n.ccl) });

// Làm sạch phần CHUNG của JSON AI. Không tự sửa giá trị sai — ghi vào loiDinhDang để quyết định an toàn (CAN_CHECK_LAI).
// Hạng mục AI chấm FAIL mà không có evidence nào của chính hạng mục đó -> hạ xuống CAN_CHECK_LAI (FAIL phải có bằng chứng).
function chuanHoaAi(ai, hangMuc) {
  const a = ai && typeof ai === 'object' ? ai : {};
  const loiDinhDang = [];
  const aiDeXuat = KET_QUA.includes(a.result) ? a.result : null;
  if (!aiDeXuat) loiDinhDang.push('thiếu/sai "result" đề xuất.');
  const score = docSo(a.score);
  const scoreHopLe = score !== null && score >= 0 && score <= 100;
  if (!scoreHopLe) loiDinhDang.push('thiếu/sai "score" (phải là số 0–100).');
  const tinCay = docSo(a.confidence);
  const tinCayHopLe = tinCay !== null && tinCay >= 0 && tinCay <= 1;
  if (!tinCayHopLe) loiDinhDang.push('thiếu/sai "confidence" (phải là số 0–1).');
  const evidence = (Array.isArray(a.evidence) ? a.evidence : [])
    .filter(e => e && hangMuc.includes(e.hang_muc) && typeof e.quan_sat === 'string' && e.quan_sat.trim())
    .slice(0, 40)
    .map(e => ({ hang_muc: e.hang_muc, anh: typeof e.anh === 'string' ? e.anh : '', quan_sat: e.quan_sat.trim() }));
  const kq = {
    result: 'CAN_CHECK_LAI',
    ai_de_xuat: aiDeXuat,
    score: scoreHopLe ? score : null,
    confidence: tinCayHopLe ? tinCay : 0,
    checked_items: Object.fromEntries(Object.entries(a.checked_items && typeof a.checked_items === 'object' ? a.checked_items : {})
      .filter(([k, v]) => hangMuc.includes(k) && KET_QUA.includes(v))),
    evidence,
    issues: Array.isArray(a.issues) ? a.issues.map(String) : [],
    reason: String(a.reason || ''),
    kiem_tra_he_thong: [],
  };
  for (const [h, v] of Object.entries(kq.checked_items)) {
    if (v === 'FAIL' && !evidence.some(e => e.hang_muc === h)) {
      kq.checked_items[h] = 'CAN_CHECK_LAI';
      kq.kiem_tra_he_thong.push(`AI chấm "${h}" FAIL nhưng không kèm quan sát cụ thể — hạ xuống CAN_CHECK_LAI.`);
    }
  }
  return { kq, loiDinhDang };
}

// NƠI DUY NHẤT quyết định kết quả cuối. Thứ tự ưu tiên:
//  1. failCung (luật hệ thống tự kiểm tra, vd tem mang mã tracking khác) -> FAIL
//  2. JSON AI sai/thiếu score/confidence/result -> CAN_CHECK_LAI
//  3. độ chắc chắn < ngưỡng CAN_CHECK_LAI -> CAN_CHECK_LAI
//  4. score >= PASS -> PASS nếu không vướng chanPass / hạng mục FAIL / AI không đề xuất PASS; vướng -> CAN_CHECK_LAI
//  5. score <= FAIL -> FAIL nếu có hạng mục FAIL (đã có bằng chứng) và AI không đề xuất PASS; không thì CAN_CHECK_LAI
//  6. còn lại (giữa 2 ngưỡng) -> CAN_CHECK_LAI
function quyetDinhKetQua(kq, { nguong, loiDinhDang = [], failCung = [], chanPass = [] }) {
  kq.nguong = { ...nguong };
  // Lưu đầu vào (02/10/2026) để Gợi ý ngưỡng tính lại ĐÚNG kết luận với ngưỡng khác (goiYNguong) bằng chính hàm này.
  kq.dau_vao_quyet_dinh = { loiDinhDang: [...loiDinhDang], failCung: [...failCung], chanPass: [...chanPass] };
  const ketLuan = (result, lyDo) => Object.assign(kq, { result, ly_do_ket_luan: lyDo });
  if (failCung.length) return ketLuan('FAIL', `Luật hệ thống: ${failCung.join(' ')}`);
  if (loiDinhDang.length) return ketLuan('CAN_CHECK_LAI', `Kết quả AI không hợp lệ: ${loiDinhDang.join(' ')} Không tự kết luận.`);
  const tinCay = Math.round(kq.confidence * 1000) / 10; // %, 1 chữ số thập phân — tránh sai số 0.57*100
  if (tinCay < nguong.ccl) return ketLuan('CAN_CHECK_LAI', `Độ chắc chắn ${tinCay}% < ngưỡng CAN_CHECK_LAI ${nguong.ccl}%.`);
  const hangMucFail = Object.entries(kq.checked_items).filter(([, v]) => v === 'FAIL').map(([k]) => k);
  if (kq.score >= nguong.pass) {
    const chan = [...chanPass];
    if (hangMucFail.length) chan.push(`AI chấm FAIL hạng mục ${hangMucFail.join(', ')} — mâu thuẫn với score cao.`);
    if (kq.ai_de_xuat !== 'PASS') chan.push(`AI đề xuất ${kq.ai_de_xuat} — mâu thuẫn với score cao.`);
    return chan.length
      ? ketLuan('CAN_CHECK_LAI', `Score ${kq.score} ≥ ngưỡng PASS ${nguong.pass} nhưng chưa đủ điều kiện PASS: ${chan.join(' ')}`)
      : ketLuan('PASS', `Score ${kq.score} ≥ ngưỡng PASS ${nguong.pass}, độ chắc chắn ${tinCay}% ≥ ${nguong.ccl}%.`);
  }
  if (kq.score <= nguong.fail) {
    if (!hangMucFail.length) return ketLuan('CAN_CHECK_LAI', `Score ${kq.score} ≤ ngưỡng FAIL ${nguong.fail} nhưng không có hạng mục FAIL kèm bằng chứng — không kết luận FAIL.`);
    if (kq.ai_de_xuat === 'PASS') return ketLuan('CAN_CHECK_LAI', `Score ${kq.score} ≤ ngưỡng FAIL ${nguong.fail} nhưng AI đề xuất PASS — mâu thuẫn.`);
    return ketLuan('FAIL', `Score ${kq.score} ≤ ngưỡng FAIL ${nguong.fail}; lỗi có bằng chứng ở: ${hangMucFail.join(', ')}.`);
  }
  return ketLuan('CAN_CHECK_LAI', `Score ${kq.score} nằm giữa ngưỡng FAIL ${nguong.fail} và PASS ${nguong.pass}.`);
}

// Kết quả khi KHÔNG gọi AI (thiếu dữ liệu) — cùng khuôn với kết quả có AI.
const ketQuaThieuDuLieu = (lyDo, nguong) => ({
  result: 'CAN_CHECK_LAI', ai_de_xuat: null, score: null, confidence: 0, nguong: { ...nguong }, design_file: null, mockup_file: null,
  checked_items: {}, evidence: [], issues: [lyDo], reason: 'Chưa đủ dữ liệu để QC — cần người kiểm tra lại.',
  ly_do_ket_luan: `Thiếu dữ liệu, không gọi AI: ${lyDo}`, kiem_tra_he_thong: [lyDo],
});

// Phần yêu cầu chung cuối mỗi prompt — AI phân tích + đưa bằng chứng, KHÔNG tự quyết định kết quả cuối.
const QUY_TAC_KET_QUA = [
  '',
  'CÁCH TRẢ KẾT QUẢ (hệ thống tự quyết định PASS/FAIL/CAN_CHECK_LAI cuối cùng từ các trường dưới — "result" chỉ là ĐỀ XUẤT của bạn):',
  '- score: số 0–100 = mức khớp với yêu cầu đơn (100 = mọi hạng mục kiểm được đều đúng; lỗi rõ ràng càng nhiều/càng nặng thì càng thấp; 0 = sai hoàn toàn). Hạng mục thiếu dữ liệu KHÔNG làm giảm score — thể hiện ở confidence.',
  '- confidence: số 0–1 = mức chắc chắn về đánh giá (ảnh rõ, đủ dữ liệu -> cao; ảnh mờ, bị che, thiếu dữ liệu -> thấp).',
  '- evidence: danh sách QUAN SÁT trực tiếp (điều NHÌN THẤY, không phải kết luận): hang_muc, anh (đúng tên ảnh), quan_sat (cụ thể, vd "ký tự thứ 3 trên file_theu_1 là A, trên Design là O"). Mỗi hạng mục chấm FAIL BẮT BUỘC có ít nhất 1 evidence của chính hạng mục đó — thiếu thì hệ thống bỏ FAIL.',
  '- reason: kết luận ngắn gọn DỰA TRÊN evidence. Không đủ dữ liệu -> CAN_CHECK_LAI và hạ confidence, TUYỆT ĐỐI không đoán.',
];

// ---------------- QC3 – QC DÁN TEM ----------------
const HANG_MUC = { type: 'string', enum: KET_QUA };
const HANG_MUC_QC3 = ['tracking', 'nguoi_nhan', 'dia_chi', 'ma_don_gom'];
const schemaEvidence = hangMuc => ({
  type: 'array',
  items: { type: 'object', properties: { hang_muc: { type: 'string', enum: hangMuc }, anh: { type: 'string' }, quan_sat: { type: 'string' } }, required: ['hang_muc', 'anh', 'quan_sat'] },
});
const SCHEMA_QC3 = {
  type: 'object',
  properties: {
    result: { type: 'string', enum: KET_QUA },
    score: { type: 'number' },
    confidence: { type: 'number' },
    evidence: schemaEvidence(HANG_MUC_QC3),
    design_file: { type: 'string', nullable: true },
    mockup_file: { type: 'string', nullable: true },
    checked_items: {
      type: 'object',
      properties: { tracking: HANG_MUC, nguoi_nhan: HANG_MUC, dia_chi: HANG_MUC, ma_don_gom: { ...HANG_MUC, nullable: true } },
      required: ['tracking', 'nguoi_nhan', 'dia_chi'],
    },
    issues: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
    doc_duoc: {
      type: 'object',
      properties: {
        co_tem: { type: 'boolean' },
        ma_tracking: { type: 'string', nullable: true },
        ten_nguoi_nhan: { type: 'string', nullable: true },
        dia_chi: { type: 'string', nullable: true },
        hang_van_chuyen: { type: 'string', nullable: true },
        ma_don_tren_tem: { type: 'array', items: { type: 'string' } },
      },
      required: ['co_tem'],
    },
  },
  required: ['result', 'score', 'confidence', 'evidence', 'checked_items', 'issues', 'reason', 'doc_duoc'],
};

// Mẫu prompt MẶC ĐỊNH (02/10/2026: prompt sửa được ở menu QC — xem MAU_PROMPT_MAC_DINH/taoPrompt bên dưới).
function mauPromptQc3() {
  return [
    'Bạn là nhân viên QC của xưởng thêu, nhiệm vụ: kiểm tra TEM VẬN CHUYỂN đã dán trên kiện hàng trong ảnh có đúng đơn hàng hay không.',
    'Dữ liệu đơn hàng trong hệ thống (JSON):',
    '{{DU_LIEU_DON}}',
    '',
    'Quy tắc BẮT BUỘC:',
    '1. Đọc NGUYÊN VĂN chữ trên tem vào "doc_duoc": mã tracking (dòng số/chữ dưới mã vạch), tên người nhận, địa chỉ người nhận, hãng vận chuyển, và mọi mã đơn in trên tem (vd dòng "KIEN GOM ... DON: ..."). Không đọc được rõ thì để null — TUYỆT ĐỐI không đoán hay tự điền từ dữ liệu đơn.',
    '2. Nếu ảnh không có tem vận chuyển nào: doc_duoc.co_tem = false và result = "CAN_CHECK_LAI".',
    '3. checked_items (mỗi mục PASS / FAIL / CAN_CHECK_LAI): "tracking" so mã đọc được với ma_tracking_can_co; "nguoi_nhan" so tên người nhận; "dia_chi" so địa chỉ (đường, thành phố, bang, zipcode, nước); "ma_don_gom" CHỈ khi don_gom.la_kien_gom = true — tem phải có dòng kiện gom chứa ma_don, không phải kiện gom thì để null.',
    '4. Tem thường in HOA, bỏ dấu, viết tắt (Street/St, Avenue/Ave, Apartment/Apt, tên bang viết tắt như CA = California, United States/US/USA) — những khác biệt kiểu này KHÔNG phải lỗi.',
    '5. Chỉ dùng FAIL khi đọc RÕ và thấy KHÁC thật sự (sai người, sai địa chỉ, sai mã). Ảnh mờ, bị che, bị cắt, lóa, không chắc chắn -> CAN_CHECK_LAI. Không được kết luận chỉ vì "nhìn khá giống".',
    '6. result tổng: FAIL nếu có ít nhất 1 mục FAIL rõ ràng; PASS chỉ khi mọi mục cần kiểm đều PASS và đọc được mã tracking; còn lại CAN_CHECK_LAI.',
    '7. design_file và mockup_file luôn null (QC dán tem không dùng design/mockup). confidence từ 0 đến 1. issues và reason viết tiếng Việt, ngắn gọn, nêu cụ thể chỗ sai/chỗ không đọc được. Tên ảnh trong evidence: "anh_da_dan_tem".',
    '',
    '{{KINH_NGHIEM}}',
    ...QUY_TAC_KET_QUA,
  ].join('\n');
}

// Làm sạch JSON AI + đối chiếu mã tracking bằng dữ liệu hệ thống, rồi quyetDinhKetQua(). Luật cứng: mã trên tem khác mã đơn /
// là mã của đơn khác -> FAIL; không đọc được mã, không có tem, người nhận/địa chỉ/mã kiện gom chưa PASS -> không được PASS.
// Mã vạch (02/10/2026, theo yêu cầu người dùng): ảnh có thể có NHIỀU mã (tem cũ, mã sản phẩm, SKU...). Chỉ xét mã >= 10 ký tự.
//  - có mã của ĐƠN KHÁC, không có mã khớp đơn -> FAIL (dán nhầm, theo mã vạch)
//  - có cả mã khớp đơn lẫn mã của đơn khác -> CAN_CHECK_LAI (có thể 2 tem trên 1 kiện)
//  - mã khớp đơn: AI đọc chữ ra mã KHÁC -> CAN_CHECK_LAI; còn lại -> tracking PASS (không phụ thuộc AI đọc chữ)
//  - chỉ có mã lạ (không thuộc đơn nào) / không đọc được mã vạch -> giữ cách đối chiếu chữ AI đọc như cũ.
// -> true nếu mã vạch đã quyết định hạng mục tracking.
function doiChieuMaVach(kq, maVach, { maCanCo, row, rows, cungNhom }, failCung, chanPass, heThongThay) {
  if (!maVach.length) return false;
  kq.ma_vach_doc_duoc = maVach;
  const maDonKhac = ma => rows.filter(r => r.STT_Key !== row.STT_Key && !cungNhom.has(r.STT_Key)
    && (khopMa(ma, chuanHoaMa(r.TRACKING_ID)) || khopMa(ma, chuanHoaMa(r.TRACKING_ID2)))).map(r => r.STT_Key);
  const khopDon = maVach.filter(m => khopMa(chuanHoaMa(m), maCanCo));
  const cuaDonKhac = maVach.filter(m => !khopDon.includes(m)).map(m => ({ ma: m, don: maDonKhac(chuanHoaMa(m)) })).filter(x => x.don.length);
  const moTaKhac = cuaDonKhac.map(x => `${x.ma} (đơn ${x.don.join(', ')})`).join('; ');
  if (cuaDonKhac.length && !khopDon.length) {
    const moTa = `Mã vạch trên ảnh là tracking của đơn khác: ${moTaKhac} — nghi DÁN NHẦM TEM.`;
    kq.checked_items.tracking = 'FAIL';
    kq.issues.unshift(moTa);
    kq.kiem_tra_he_thong.push(`Mã vạch: ${moTa}`);
    heThongThay(moTa);
    failCung.push(moTa);
    return true;
  }
  if (cuaDonKhac.length) {
    kq.checked_items.tracking = 'CAN_CHECK_LAI';
    kq.kiem_tra_he_thong.push(`Mã vạch: ảnh có cả mã của đơn này và mã của đơn khác (${moTaKhac}) — có thể có 2 tem trên 1 kiện.`);
    chanPass.push('Ảnh có mã vạch của cả đơn này và đơn khác.');
    return true;
  }
  if (khopDon.length) {
    const maTem = chuanHoaMa(kq.doc_duoc.ma_tracking);
    if (maTem && !khopMa(maTem, maCanCo)) {
      kq.checked_items.tracking = 'CAN_CHECK_LAI';
      kq.kiem_tra_he_thong.push(`Mã vạch khớp đơn nhưng chữ AI đọc ra mã khác (${kq.doc_duoc.ma_tracking}) — có thể có 2 tem trên 1 kiện.`);
      chanPass.push('Mã vạch và chữ AI đọc trên tem không thống nhất.');
      return true;
    }
    kq.checked_items.tracking = 'PASS';
    kq.kiem_tra_he_thong.push('Mã vạch trên tem khớp mã tracking của đơn (đọc bằng thư viện mã vạch).');
    return true;
  }
  kq.kiem_tra_he_thong.push(`Mã vạch đọc được không thuộc đơn nào (${maVach.join(', ')}) — bỏ qua, đối chiếu theo chữ AI đọc.`);
  return false;
}

// Đọc mọi mã vạch / QR trong ảnh (zxing-wasm, chạy WASM tại chỗ — không gọi mạng). -> [chuỗi gốc] mã >= 10 ký tự (sau chuẩn hoá),
// không trùng. Lỗi đọc -> [] (QC vẫn chạy theo AI như cũ).
// LƯU Ý: mặc định zxing-wasm TẢI file .wasm từ CDN jsdelivr khi có fetch (kể cả trong Node) -> nạp thẳng file .wasm trong node_modules
// qua overrides.wasmBinary, không bao giờ gọi mạng.
let zxingDaNap = false;
function napZxing() {
  const zxing = require('zxing-wasm/reader');
  if (!zxingDaNap) {
    const fs = require('fs');
    const duongDan = require('path').join(require.resolve('zxing-wasm/reader'), '../../../reader/zxing_reader.wasm');
    zxing.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(duongDan) } });
    zxingDaNap = true;
  }
  return zxing;
}
async function docMaVach(buffer) {
  try {
    const { readBarcodes } = napZxing();
    const ds = await readBarcodes(new Uint8Array(buffer), { tryHarder: true, maxNumberOfSymbols: 20 });
    return [...new Set(ds.filter(d => d.isValid).map(d => d.text.trim()).filter(t => chuanHoaMa(t).length >= 10))];
  } catch (err) {
    console.error('[QC3] Không đọc được mã vạch:', err.message);
    return [];
  }
}

function hoanThienKetQua3(ai, { maCanCo, row, rows, cungNhom, laKienGom = false, maVach = [] }, nguong) {
  const { kq, loiDinhDang } = chuanHoaAi(ai, HANG_MUC_QC3);
  kq.design_file = null;
  kq.mockup_file = null;
  kq.doc_duoc = (ai && typeof ai.doc_duoc === 'object' && ai.doc_duoc) || {};
  const failCung = [];
  const chanPass = [];
  const heThongThay = quanSat => kq.evidence.unshift({ hang_muc: 'tracking', anh: 'anh_da_dan_tem', quan_sat: `Hệ thống: ${quanSat}` });

  const maTem = chuanHoaMa(kq.doc_duoc.ma_tracking);
  if (doiChieuMaVach(kq, maVach, { maCanCo, row, rows, cungNhom }, failCung, chanPass, heThongThay)) {
    // mã vạch đã quyết định hạng mục tracking
  } else if (!maTem) {
    kq.kiem_tra_he_thong.push('Không đọc được mã tracking trên tem — hệ thống không đối chiếu được.');
    kq.checked_items.tracking = 'CAN_CHECK_LAI';
    chanPass.push('Không đọc được mã tracking trên tem.');
  } else {
    // Dán nhầm: mã trên tem là tracking của đơn KHÁC (ngoài đơn này và nhóm DonNhieuAo của nó).
    const donKhac = rows.filter(r => r.STT_Key !== row.STT_Key && !cungNhom.has(r.STT_Key)
      && (khopMa(maTem, chuanHoaMa(r.TRACKING_ID)) || khopMa(maTem, chuanHoaMa(r.TRACKING_ID2)))).map(r => r.STT_Key);
    if (donKhac.length && !khopMa(maTem, maCanCo)) {
      const moTa = `Mã tracking trên tem (${kq.doc_duoc.ma_tracking}) là của đơn ${donKhac.join(', ')} — nghi DÁN NHẦM TEM.`;
      kq.checked_items.tracking = 'FAIL';
      kq.issues.unshift(moTa);
      kq.kiem_tra_he_thong.push(`Mã trên tem trùng tracking của đơn khác: ${donKhac.join(', ')}.`);
      heThongThay(moTa);
      failCung.push(moTa);
    } else if (!khopMa(maTem, maCanCo)) {
      const moTa = `Mã tracking trên tem (${kq.doc_duoc.ma_tracking}) khác mã của đơn (${maCanCo}).`;
      kq.checked_items.tracking = 'FAIL';
      kq.issues.unshift(moTa);
      kq.kiem_tra_he_thong.push('Mã tracking trên tem KHÔNG khớp đơn.');
      heThongThay(moTa);
      failCung.push(moTa);
    } else {
      kq.checked_items.tracking = 'PASS';
      kq.kiem_tra_he_thong.push('Mã tracking trên tem khớp đơn.');
    }
  }
  if (kq.doc_duoc.co_tem === false) chanPass.push('AI báo ảnh không có tem vận chuyển.');
  const chuaDat = ['nguoi_nhan', 'dia_chi', ...(laKienGom ? ['ma_don_gom'] : [])].filter(h => kq.checked_items[h] !== 'PASS');
  if (chuaDat.length) chanPass.push(`Hạng mục chưa PASS: ${chuaDat.join(', ')}.`);
  return quyetDinhKetQua(kq, { nguong, loiDinhDang, failCung, chanPass });
}

// -> { ketQua, anh: [url], model, daGoiAi }
async function chayQc3(sttKey, nguong, thongKe, mau) {
  const { rows } = await orderService.getAll({ fresh: true });
  const row = rows.find(r => r.STT_Key === sttKey);
  if (!row) throw loiNghiepVu(`Không tìm thấy đơn ${sttKey}.`, 404);
  const nhom = donNhieuAoService.layNhomCuaDon(sttKey, rows);
  const donTem = nhom ? (nhom.donIn || nhom.donMua) : null; // đơn dán tem của kiện gom

  // Mã cần có: tracking của chính đơn (đơn con DonNhieuAo đã được sao) -> của đơn mua nhóm -> mã Seller điền (TRACKING_ID2).
  const maCanCoGoc = row.TRACKING_ID || (nhom && nhom.donMua && nhom.donMua.TRACKING_ID)
    || row.TRACKING_ID2 || (nhom && nhom.donMua && nhom.donMua.TRACKING_ID2) || '';
  const urlAnh = row.Anh_Da_Dan_Tem_URL || (donTem && donTem.Anh_Da_Dan_Tem_URL) || '';
  const cungNhom = new Set(nhom ? nhom.thanhVien.map(r => r.STT_Key) : []);
  const khongGoiAi = (lyDo, anh = []) => ({ daGoiAi: false, anh, ketQua: ketQuaThieuDuLieu(lyDo, nguong) });

  if (!urlAnh) return khongGoiAi('Đơn chưa có ảnh ĐÃ DÁN TEM.');
  if (!maCanCoGoc) return khongGoiAi('Đơn chưa có mã tracking (TRACKING_ID lẫn TRACKING_ID2 đều trống).', [urlAnh]);
  const buffer = await taiAnh(urlAnh);
  if (!buffer || !buffer.length) return khongGoiAi('Không tải được ảnh ĐÃ DÁN TEM.', [urlAnh]);
  const mime = mimeTuBuffer(buffer);
  if (!mime) return khongGoiAi('Ảnh ĐÃ DÁN TEM không phải JPEG/PNG/WEBP.', [urlAnh]);
  if (buffer.length > DUNG_LUONG_ANH_TOI_DA) return khongGoiAi('Ảnh ĐÃ DÁN TEM quá lớn (> 15MB).', [urlAnh]);

  const laKienGom = !!nhom && nhom.thanhVien.length > 1;
  const duLieu = {
    ma_don: row.STT_Key,
    ma_don_san: row.MA_DON_HANG_ORDERID || '',
    nguoi_nhan: row.TEN || '',
    so_dien_thoai: row.SDT || '',
    dia_chi: {
      duong: [row.DIA_CHI_TEN_DUONG, row.TEN_DIA_CHI].filter(Boolean).join(', '),
      thanh_pho: row.DIA_CHI_TEN_TP || '', bang: row.DIA_CHI_BANG || '', zipcode: row.MA_ZIPCODE || '', nuoc: row.DIA_CHI_NUOC || '',
    },
    ma_tracking_can_co: maCanCoGoc,
    hang_van_chuyen: row.HANG_VAN_CHUYEN || row.HANG_VAN_CHUYEN2 || '',
    don_gom: { la_kien_gom: laKienGom, cac_ma_don: laKienGom ? [...cungNhom] : [] },
  };
  const { nhaCungCap, apiKey, model } = layCauHinh('QC3');
  const kn = chonKinhNghiem('QC3', row);
  const maVach = await docMaVach(buffer);
  const ai = await aiProvider.phanTichAnh({ apiKey, model, prompt: taoPrompt('QC3', mau, { duLieu, kn }), anh: [{ mime, data: buffer, ten: 'anh_da_dan_tem' }], schema: themTruongKinhNghiem(SCHEMA_QC3, kn), thongKe }, nhaCungCap);
  const ketQua = hoanThienKetQua3(ai, { maCanCo: chuanHoaMa(maCanCoGoc), row, rows, cungNhom, laKienGom, maVach }, nguong);
  if (kn.length) ketQua.kinh_nghiem_ap_dung = kinhNghiemAiApDung(ai, kn);
  return { daGoiAi: true, anh: [urlAnh], aiGoc: ai, kinhNghiem: kn, ketQua };
}

// ---------------- Phần CHUNG của QC1 (vẽ file) + QC2 (sản xuất): đối chiếu ảnh cần kiểm với Design/Mockup + ghi chú ----------------
// Căn cứ CHÍNH (người dùng xác nhận 30/09/2026): Design/Mockup + ghi chú = yêu cầu gốc. Tối đa 10 ảnh/lượt: luôn gửi ảnh
// cần kiểm (+ ảnh phụ), phần còn lại chia XEN KẼ Design/Mockup theo thứ tự tên file (CHỈ tải đúng số ảnh sẽ gửi, không tải
// cả thư mục Drive). AI tự xác định vai trò ảnh theo NỘI DUNG, không theo tên file.
const SO_ANH_TOI_DA = 10;
const NGUON_THAM_KHAO = [{ cot: 'DUONG_DAN_URL', nhan: 'PNG/Design' }, { cot: 'MOCKUP', nhan: 'Mockup' }];
const COT_FILE_THEU = ['Anh_File_Theu_URL', 'Anh_File_Theu_URL_2', 'Anh_File_Theu_URL_3'];
const VAI_TRO_ANH = ['DESIGN', 'MOCKUP', 'FILE_THEU', 'SAN_PHAM', 'THAM_KHAO', 'KHONG_LIEN_QUAN'];

const schemaDoiChieu = hangMuc => ({
  type: 'object',
  properties: {
    result: { type: 'string', enum: KET_QUA },
    score: { type: 'number' },
    confidence: { type: 'number' },
    evidence: schemaEvidence(hangMuc),
    design_file: { type: 'string', nullable: true },
    mockup_file: { type: 'string', nullable: true },
    checked_items: { type: 'object', properties: Object.fromEntries(hangMuc.map(h => [h, HANG_MUC])), required: hangMuc },
    issues: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
    vai_tro_anh: {
      type: 'array',
      items: { type: 'object', properties: { ten: { type: 'string' }, vai_tro: { type: 'string', enum: VAI_TRO_ANH }, ghi_chu: { type: 'string', nullable: true } }, required: ['ten', 'vai_tro'] },
    },
  },
  required: ['result', 'score', 'confidence', 'evidence', 'design_file', 'mockup_file', 'checked_items', 'issues', 'reason', 'vai_tro_anh'],
});

// Phần mở đầu chung của prompt: dữ liệu đơn + danh sách ảnh + quy tắc xác định vai trò ảnh.
const dauPrompt = nhiemVu => [
  nhiemVu,
  'Dữ liệu đơn hàng (JSON):',
  '{{DU_LIEU_DON}}',
  '',
  'Danh sách ảnh gửi kèm (tên ảnh đứng ngay trước mỗi ảnh). "nguon" chỉ là CỘT DỮ LIỆU chứa link — KHÔNG chắc chắn là vai trò thật của ảnh:',
  '{{DANH_SACH_ANH}}',
  '',
  'Quy tắc BẮT BUỘC:',
  '1. Xác định vai trò TỪNG ảnh vào "vai_tro_anh" (DESIGN / MOCKUP / FILE_THEU / SAN_PHAM / THAM_KHAO / KHONG_LIEN_QUAN) dựa trên NỘI DUNG ảnh, dữ liệu đơn, ghi chú và quan hệ giữa các ảnh — KHÔNG dựa vào tên file. Chọn design_file và mockup_file là ĐÚNG tên ảnh trong danh sách (null nếu không xác định chắc chắn).',
];

// Link ảnh tham khảo (Design/Mockup) CHƯA tải, theo từng nguồn: [[{ nguon, ten, link, tai }], ...] + lỗi đọc link/thư mục.
async function lietKeAnhThamKhao(row) {
  const theoNguon = [];
  const loi = [];
  for (const { cot, nhan } of NGUON_THAM_KHAO) {
    const ds = [];
    for (const link of tachLink(row[cot])) {
      try {
        const thuMuc = await layChiTietAnhThuMucDrive(link);
        if (thuMuc) thuMuc.forEach(f => ds.push({ nguon: nhan, ten: f.ten, link: f.link, tai: () => taiFileDriveTheoId(f.id) }));
        else ds.push({ nguon: nhan, ten: tenTuLink(link), link, tai: () => taiAnh(link) });
      } catch (err) {
        loi.push(`Không đọc được link ${nhan} (${link}): ${err.message}`);
      }
    }
    theoNguon.push(ds);
  }
  return { theoNguon, loi };
}
function tenTuLink(link) {
  const cuoi = String(link).split(/[?#]/)[0].split('/').filter(Boolean).pop() || 'anh';
  try { return decodeURIComponent(cuoi); } catch (e) { return cuoi; }
}

// Xen kẽ các nguồn: [a1, b1, a2, b2, ...].
function xenKe(dsTheoNguon) {
  const kq = [];
  for (let i = 0; dsTheoNguon.some(ds => i < ds.length); i++) dsTheoNguon.forEach(ds => { if (i < ds.length) kq.push(ds[i]); });
  return kq;
}

async function taiVaChuanHoa(taiFn) {
  const buffer = await taiFn();
  if (!buffer || !buffer.length) throw new Error('không tải được ảnh');
  return (await chuanHoaAnh(buffer)).anh; // JPEG, cạnh dài tối đa 1400px
}

// Làm sạch JSON AI + ràng buộc hệ thống, rồi quyetDinhKetQua(). Luật cứng chặn PASS: không xác định được Design (tên file
// phải có thật trong ảnh đã gửi), hạng mục `batBuoc` chưa PASS (các hạng mục còn lại được phép CAN_CHECK_LAI).
function hoanThienKetQuaDoiChieu(ai, tenHopLe, { hangMuc, batBuoc }, nguong) {
  const { kq, loiDinhDang } = chuanHoaAi(ai, hangMuc);
  const a = ai && typeof ai === 'object' ? ai : {};
  kq.design_file = tenHopLe.has(a.design_file) ? a.design_file : null;
  kq.mockup_file = tenHopLe.has(a.mockup_file) ? a.mockup_file : null;
  kq.vai_tro_anh = Array.isArray(a.vai_tro_anh) ? a.vai_tro_anh.filter(v => v && tenHopLe.has(v.ten)) : [];
  if (a.design_file && !kq.design_file) kq.kiem_tra_he_thong.push(`AI chọn design_file "${a.design_file}" không có trong danh sách ảnh đã gửi.`);
  if (a.mockup_file && !kq.mockup_file) kq.kiem_tra_he_thong.push(`AI chọn mockup_file "${a.mockup_file}" không có trong danh sách ảnh — bỏ qua.`);
  const chanPass = [];
  if (!kq.design_file) chanPass.push('Không xác định chắc chắn được Design chính.');
  const chuaDat = batBuoc.filter(h => kq.checked_items[h] !== 'PASS');
  if (chuaDat.length) chanPass.push(`Hạng mục bắt buộc chưa PASS: ${chuaDat.join(', ')}.`);
  return quyetDinhKetQua(kq, { nguong, loiDinhDang, chanPass });
}

// Chạy 1 lượt QC đối chiếu. qc = {
//   loai, anhCanKiem(row) -> [{ ten, nguon, url }] (ảnh BẮT BUỘC, đọc được ít nhất 1), thieuAnh: lý do khi không có ảnh cần kiểm,
//   anhPhu(row) -> [{ ten, nguon, url }] (gửi thêm nếu đọc được), hangMuc, batBuoc, prompt(duLieu, dsAnh) }
async function chayDoiChieu(sttKey, qc, nguong, thongKe, mau) {
  const { rows } = await orderService.getAll({ fresh: true });
  const row = rows.find(r => r.STT_Key === sttKey);
  if (!row) throw loiNghiepVu(`Không tìm thấy đơn ${sttKey}.`, 404);
  const urlFileTheu = COT_FILE_THEU.map(c => row[c]).filter(Boolean);
  const khongGoiAi = (lyDo, anh = []) => ({ daGoiAi: false, anh, fileTheu: urlFileTheu, ketQua: ketQuaThieuDuLieu(lyDo, nguong) });

  const canKiem = qc.anhCanKiem(row);
  if (!canKiem.length) return khongGoiAi(qc.thieuAnh);
  const ghiChuHeThong = [];
  const dsAnh = []; // { ten, nguon, link, mime, data }
  const loiCanKiem = [];
  for (const a of canKiem) {
    try { dsAnh.push({ ten: a.ten, nguon: a.nguon, link: a.url, mime: 'image/jpeg', data: await taiVaChuanHoa(() => taiAnh(a.url)) }); }
    catch (err) { loiCanKiem.push(`Không đọc được ${a.nguon} (${err.message}).`); }
  }
  if (!dsAnh.length) return khongGoiAi(loiCanKiem.join(' '), canKiem.map(a => a.url));
  ghiChuHeThong.push(...loiCanKiem);
  for (const a of qc.anhPhu(row)) {
    try { dsAnh.push({ ten: a.ten, nguon: a.nguon, link: a.url, mime: 'image/jpeg', data: await taiVaChuanHoa(() => taiAnh(a.url)) }); }
    catch (err) { ghiChuHeThong.push(`Không đọc được ${a.nguon} (${err.message}).`); }
  }

  const { theoNguon, loi } = await lietKeAnhThamKhao(row);
  ghiChuHeThong.push(...loi);
  const ungVien = xenKe(theoNguon);
  const tenDaDung = new Set(dsAnh.map(a => a.ten));
  let soThamKhao = 0;
  for (const uv of ungVien) {
    if (dsAnh.length >= SO_ANH_TOI_DA) break;
    const goc = `${uv.nguon === 'Mockup' ? 'mockup' : 'design'}__${uv.ten}`;
    let ten = goc;
    for (let n = 2; tenDaDung.has(ten); n++) ten = `${goc}_${n}`;
    try {
      dsAnh.push({ ten, nguon: uv.nguon, link: uv.link, mime: 'image/jpeg', data: await taiVaChuanHoa(uv.tai) });
      tenDaDung.add(ten);
      soThamKhao++;
    } catch (err) { ghiChuHeThong.push(`Không đọc được ảnh ${uv.nguon} "${uv.ten}" (${err.message}).`); }
  }
  if (ungVien.length > soThamKhao) ghiChuHeThong.push(`Chỉ gửi ${soThamKhao}/${ungVien.length} ảnh Design/Mockup (giới hạn ${SO_ANH_TOI_DA} ảnh mỗi lần QC).`);
  const anhDaDung = dsAnh.map(a => a.link);
  if (!soThamKhao) return khongGoiAi('Không có ảnh Design/Mockup nào đọc được — không có căn cứ đối chiếu.', anhDaDung);

  const duLieu = {
    ma_don: row.STT_Key,
    loai: row.LOAI || '', size_ao: row.KICH_THUOC || '', mau_ao: row.MAU_SAC || '',
    so_luong: row.SO_LUONG || '', so_luong_ao_tren_don: row.SO_LUONG_AO_TREN_DON || '',
    vi_tri_theu: orderService.danhSachViTriTheu(row),
    ghi_chu: row.GHI_CHU || '', ghi_chu_xuong: ghiChuXuongHienThi(row),
    ghi_chu_ve_file: row.GHI_CHU_VE_FILE || '', ghi_chu_chay_may: row.GHI_CHU_CHAY_MAY || '',
  };
  const { nhaCungCap, apiKey, model } = layCauHinh(qc.loai);
  const kn = chonKinhNghiem(qc.loai, row);
  const ai = await aiProvider.phanTichAnh({
    apiKey, model, thongKe, schema: themTruongKinhNghiem(schemaDoiChieu(qc.hangMuc), kn),
    prompt: taoPrompt(qc.loai, mau, { duLieu, dsAnh: dsAnh.map(a => ({ ten: a.ten, nguon: a.nguon })), kn }),
    anh: dsAnh.map(a => ({ mime: a.mime, data: a.data, ten: a.ten })),
  }, nhaCungCap);
  const ketQua = hoanThienKetQuaDoiChieu(ai, tenDaDung, qc, nguong);
  ketQua.kiem_tra_he_thong.unshift(...ghiChuHeThong);
  if (kn.length) ketQua.kinh_nghiem_ap_dung = kinhNghiemAiApDung(ai, kn);
  return { daGoiAi: true, anh: anhDaDung, fileTheu: urlFileTheu, aiGoc: ai, kinhNghiem: kn, ketQua };
}

const anhFileTheu = row => COT_FILE_THEU.map((c, i) => row[c] && { ten: `file_theu_${i + 1}`, nguon: `File thêu ${i + 1}`, url: row[c] }).filter(Boolean);

// ---------------- QC2 – QC SẢN XUẤT ----------------
// Ảnh cần kiểm: ảnh đã sản xuất. File thêu gửi kèm chỉ để đối chiếu — sản phẩm khác Design là FAIL kể cả khi giống File thêu.
const QC2 = {
  loai: 'QC2',
  anhCanKiem: row => (row.Anh_Da_San_Xuat_URL ? [{ ten: 'san_pham', nguon: 'ảnh đã sản xuất', url: row.Anh_Da_San_Xuat_URL }] : []),
  thieuAnh: 'Đơn chưa có ảnh đã sản xuất.',
  anhPhu: anhFileTheu,
  hangMuc: ['design', 'text', 'chi_tiet', 'color', 'position', 'huong', 'size', 'loi_san_xuat'],
  batBuoc: ['design', 'text', 'chi_tiet', 'position', 'loi_san_xuat'],
  mauPrompt: () => [
    ...dauPrompt('Bạn là nhân viên QC của xưởng thêu, nhiệm vụ: kiểm tra SẢN PHẨM THÊU THỰC TẾ (ảnh "san_pham") có đúng yêu cầu đơn hàng hay không.'),
    '2. Yêu cầu CHÍNH là Design + Mockup + các ghi chú (ghi_chu, ghi_chu_xuong, ghi_chu_ve_file, ghi_chu_chay_may). File thêu chỉ để đối chiếu thêm: sản phẩm khác Design là FAIL kể cả khi giống File thêu — khi đó ghi rõ trong issues "lỗi có thể từ File thêu".',
    '3. Kiểm tra checked_items (PASS / FAIL / CAN_CHECK_LAI): design (đúng thiết kế), text (ĐỌC TỪNG KÝ TỰ: thiếu, sai, thừa ký tự — rất quan trọng), chi_tiet (thiếu/thừa chi tiết), color (màu chỉ/màu áo), position (vị trí thêu so với vi_tri_theu/ghi chú/mockup), huong (xoay/lật), size (kích thước/tỷ lệ — chỉ khi dữ liệu có số đo rõ, nếu không thì CAN_CHECK_LAI), loi_san_xuat (lỗi thêu nhìn thấy được: bung chỉ, nhăn, lệch, sót chỉ...).',
    '4. Nếu Design và Mockup khác nhau: nêu rõ khác biệt, xem ghi chú để biết bên nào là yêu cầu chính thức; không đủ căn cứ -> CAN_CHECK_LAI. Nhiều ảnh cùng có thể là Design mà không xác định được ảnh chính -> CAN_CHECK_LAI.',
    '5. Chỉ FAIL khi thấy RÕ lỗi. Ảnh mờ, bị che, góc chụp không thấy rõ, thiếu ảnh -> CAN_CHECK_LAI. Không kết luận kiểu "nhìn khá giống".',
    '6. result tổng: FAIL nếu có lỗi rõ ràng; PASS chỉ khi xác định được Design, và design, text, chi_tiet, position, loi_san_xuat đều PASS, không có mâu thuẫn dữ liệu; còn lại CAN_CHECK_LAI.',
    '7. confidence từ 0 đến 1. issues và reason viết tiếng Việt, ngắn gọn, nêu cụ thể (vd ký tự nào sai, chi tiết nào thiếu).',
    '',
    '{{KINH_NGHIEM}}',
    ...QUY_TAC_KET_QUA,
  ].join('\n'),
};

// ---------------- QC1 – QC VẼ FILE ----------------
// Ảnh cần kiểm: File thêu 1-3 (ảnh preview file thêu ve_file tải lên). PASS khi (người dùng xác nhận 30/09/2026) design,
// text, chi_tiet, huong đều PASS và Design/Mockup không mâu thuẫn; màu chỉ, kích thước, tỷ lệ, vị trí được phép CAN_CHECK_LAI
// (hệ thống không có dữ liệu màu chỉ/kích thước hình thêu; ảnh File thêu thường không thể hiện vị trí trên áo).
const QC1 = {
  loai: 'QC1',
  anhCanKiem: anhFileTheu,
  thieuAnh: 'Đơn chưa có ảnh File thêu nào.',
  anhPhu: () => [],
  hangMuc: ['design', 'text', 'chi_tiet', 'color', 'size', 'ty_le', 'position', 'huong', 'design_mockup'],
  batBuoc: ['design', 'text', 'chi_tiet', 'huong', 'design_mockup'],
  mauPrompt: () => [
    ...dauPrompt('Bạn là nhân viên QC của xưởng thêu, nhiệm vụ: kiểm tra FILE THÊU vừa vẽ (các ảnh "file_theu_*" — ảnh xem trước file thêu) có đúng yêu cầu đơn hàng hay không, TRƯỚC khi đưa vào sản xuất.'),
    '2. Yêu cầu CHÍNH là Design + Mockup + các ghi chú (ghi_chu, ghi_chu_xuong, ghi_chu_ve_file, ghi_chu_chay_may). Đơn có thể có 2-3 File thêu cho các vị trí/chi tiết khác nhau — đối chiếu tổng thể, mỗi phần của Design phải có trong File thêu tương ứng.',
    '3. Kiểm tra checked_items (PASS / FAIL / CAN_CHECK_LAI): design (đúng thiết kế, không đổi logo/hình dạng đáng kể), text (ĐỌC TỪNG KÝ TỰ: thiếu, sai, thừa ký tự, sai chính tả so với Design/ghi chú — rất quan trọng), chi_tiet (thiếu/thừa chi tiết), color (màu chỉ — CHỈ khi ghi chú/dữ liệu có thông tin màu chỉ hoặc mã chỉ; không có thì CAN_CHECK_LAI), size (kích thước — chỉ khi có số đo rõ, nếu không thì CAN_CHECK_LAI), ty_le (tỷ lệ/biến dạng so với Design: bị kéo dãn, bóp méo, phóng to/thu nhỏ sai từng phần), position (vị trí trên áo so với vi_tri_theu/ghi chú/mockup — File thêu không thể hiện vị trí thì CAN_CHECK_LAI), huong (xoay/lật ngược/đối xứng gương), design_mockup (Design và Mockup có nhất quán không: PASS nếu không mâu thuẫn; mâu thuẫn mà ghi chú không nói rõ bên nào đúng -> CAN_CHECK_LAI).',
    '4. Nếu Design và Mockup khác nhau: nêu rõ khác biệt, xem ghi chú để biết bên nào là yêu cầu chính thức; không tự ý chọn 1 nguồn khi chưa đủ căn cứ. Nhiều ảnh cùng có thể là Design mà không xác định được ảnh chính -> CAN_CHECK_LAI.',
    '5. Chỉ FAIL khi thấy RÕ lỗi. Ảnh mờ, bị cắt, không đủ để kết luận -> CAN_CHECK_LAI. Không kết luận kiểu "nhìn khá giống", không suy đoán kích thước/màu khi không có dữ liệu.',
    '6. result tổng: FAIL nếu có lỗi rõ ràng; PASS chỉ khi xác định được Design, và design, text, chi_tiet, huong, design_mockup đều PASS; còn lại CAN_CHECK_LAI.',
    '7. confidence từ 0 đến 1. issues và reason viết tiếng Việt, ngắn gọn, nêu cụ thể (vd ký tự nào sai, chi tiết nào thiếu, File thêu nào).',
    '',
    '{{KINH_NGHIEM}}',
    ...QUY_TAC_KET_QUA,
  ].join('\n'),
};

// ---------------- KINH NGHIỆM QC (02/10/2026, theo yêu cầu người dùng) ----------------
// Superadmin giải thích lỗi AI trên 1 dòng qc_log (đã đánh giá thực tế + AI khác thực tế) -> 1 kinh nghiệm CHUA_XAC_NHAN.
// Chỉ kinh nghiệm DA_XAC_NHAN, cùng QC, phạm vi khớp đơn mới được đưa vào prompt (chỉ phần KinhNghiem, dạng chữ, không ảnh),
// tối đa KN_TOI_DA kinh nghiệm / KN_KY_TU_TOI_DA ký tự. Chỉ là NGỮ CẢNH tham khảo — quyetDinhKetQua/ngưỡng/luật cứng không đổi.
const HANG_MUC_THEO_LOAI = { QC1: QC1.hangMuc, QC2: QC2.hangMuc, QC3: HANG_MUC_QC3 };
const NGUYEN_NHAN_KN = {
  HIEU_SAI_ANH_MAU: 'Hiểu sai hình ảnh mẫu', BO_SOT_CHI_TIET: 'Bỏ sót chi tiết quan trọng', NHAM_MAU_TUONG_TU: 'Nhầm giữa hai mẫu thêu tương tự',
  SAI_KICH_THUOC: 'Đánh giá sai kích thước', SAI_VI_TRI: 'Đánh giá sai vị trí', SAI_MAU_SAC: 'Đánh giá sai màu sắc', SAI_HINH_DANG: 'Đánh giá sai hình dạng',
  HIEU_SAI_GHI_CHU: 'Chưa hiểu đúng ghi chú đơn hàng', TIEU_CHI_CHUA_PHU_HOP: 'Dùng tiêu chí đánh giá chưa phù hợp', KHAC: 'Nguyên nhân khác',
};
const PHAM_VI_KN = { DON_NAY: 'Chỉ đơn này', LOAI_SAN_PHAM: 'Cùng loại sản phẩm', TOAN_QC: 'Toàn bộ QC này' };
const TRANG_THAI_KN = { CHUA_XAC_NHAN: 'Chưa xác nhận', DA_XAC_NHAN: 'Đã xác nhận', KHONG_SU_DUNG: 'Không sử dụng' };
const KN_TOI_DA = 5;
const KN_KY_TU_TOI_DA = 1000;
const KN_DO_DAI_KINH_NGHIEM = 600; // 1 kinh nghiệm luôn vừa ngân sách ký tự

const dongKinhNghiem = k => `[KN#${k.id}] (Hạng mục: ${JSON.parse(k.HangMucSai || '[]').join(', ') || '—'}; Phạm vi: ${PHAM_VI_KN[k.PhamVi]}${k.GiaTriPhamVi ? ' ' + k.GiaTriPhamVi : ''}) ${k.KinhNghiem}`;
// -> [{ id, phamVi, noiDung }] — bỏ qua (không cắt giữa chừng) kinh nghiệm không còn vừa ngân sách ký tự.
function chonKinhNghiem(loai, row) {
  const chon = [];
  let kyTu = 0;
  for (const k of nhatKyDbService.layKinhNghiemApDung(loai, row.STT_Key, row.LOAI)) {
    if (chon.length >= KN_TOI_DA) break;
    const noiDung = dongKinhNghiem(k);
    if (kyTu + noiDung.length > KN_KY_TU_TOI_DA) continue;
    kyTu += noiDung.length;
    chon.push({ id: k.id, phamVi: k.PhamVi, noiDung });
  }
  return chon;
}
const khoiKinhNghiem = kn => (kn.length ? [
  '',
  'KINH NGHIỆM TỪ CÁC LẦN QC TRƯỚC (Superadmin đã xác nhận) — CHỈ THAM KHẢO:',
  '- Chỉ áp dụng khi tình huống trong ảnh/dữ liệu đơn này THẬT SỰ giống mô tả. Không mặc định ca cũ đúng với đơn này.',
  '- KHÔNG được dùng kinh nghiệm để bỏ qua lỗi nhìn thấy rõ trong ảnh.',
  '- Ghi id các kinh nghiệm bạn đã thật sự áp dụng vào "kinh_nghiem_ap_dung" (không áp dụng cái nào thì để mảng rỗng).',
  ...kn.map(k => k.noiDung),
] : []);
// ---------------- PROMPT SỬA ĐƯỢC (02/10/2026, theo yêu cầu người dùng) ----------------
// Prompt = mẫu văn bản (phiên bản đang dùng ở menu QC, hoặc MAU_PROMPT_MAC_DINH) + chỗ giữ chỗ hệ thống TỰ ĐIỀN mỗi lượt:
// {{DU_LIEU_DON}} (JSON đơn), {{DANH_SACH_ANH}} (QC1/QC2), {{KINH_NGHIEM}} (kinh nghiệm đã xác nhận, trống nếu không có).
// Mỗi chỗ giữ chỗ bắt buộc ĐÚNG 1 lần. Người dùng sửa được cả phần "cách trả kết quả" — sửa sai thì AI có thể trả thiếu trường
// -> chuanHoaAi/quyetDinhKetQua tự ra CAN_CHECK_LAI (an toàn), không tự sửa prompt. Mẫu mặc định = đúng prompt trước khi có tính năng.
const CHO_GIU_CHO = {
  DU_LIEU_DON: 'Dữ liệu đơn hàng (JSON) — hệ thống tự điền',
  DANH_SACH_ANH: 'Danh sách tên ảnh gửi kèm (JSON) — hệ thống tự điền',
  KINH_NGHIEM: 'Kinh nghiệm QC đã xác nhận phù hợp đơn này — trống nếu không có',
};
const CHO_GIU_CHO_THEO_LOAI = { QC1: ['DU_LIEU_DON', 'DANH_SACH_ANH', 'KINH_NGHIEM'], QC2: ['DU_LIEU_DON', 'DANH_SACH_ANH', 'KINH_NGHIEM'], QC3: ['DU_LIEU_DON', 'KINH_NGHIEM'] };
const MAU_PROMPT_MAC_DINH = { QC1: QC1.mauPrompt(), QC2: QC2.mauPrompt(), QC3: mauPromptQc3() };
const PROMPT_TOI_DA = 30000;
function kiemTraMauPrompt(loai, mau) {
  if (!CHO_GIU_CHO_THEO_LOAI[loai]) return 'Loại QC không hợp lệ.';
  if (typeof mau !== 'string' || !mau.trim()) return 'Prompt không được để trống.';
  if (mau.length > PROMPT_TOI_DA) return `Prompt tối đa ${PROMPT_TOI_DA.toLocaleString('vi-VN')} ký tự.`;
  const dung = CHO_GIU_CHO_THEO_LOAI[loai];
  const gap = (mau.match(/\{\{[A-Z_]+\}\}/g) || []).map(x => x.slice(2, -2));
  const la = gap.filter(k => !dung.includes(k));
  if (la.length) return `Chỗ giữ chỗ không dùng được cho ${loai}: ${[...new Set(la)].map(k => `{{${k}}}`).join(', ')}.`;
  for (const k of dung) {
    const n = gap.filter(x => x === k).length;
    if (n !== 1) return `Prompt phải có ĐÚNG 1 lần {{${k}}} (${CHO_GIU_CHO[k]}) — đang có ${n} lần.`;
  }
  return null;
}
// -> { noiDung, nhan: 'MAC_DINH' | '<id phiên bản>' }
function layPromptDangDung(loai) {
  const pb = caiDatDbService.layPromptDangDungQc(loai);
  return pb ? { noiDung: pb.NoiDung, nhan: String(pb.id) } : { noiDung: MAU_PROMPT_MAC_DINH[loai], nhan: 'MAC_DINH' };
}
function taoPrompt(loai, mau, { duLieu, dsAnh = [], kn = [] }) {
  const giaTri = { DU_LIEU_DON: JSON.stringify(duLieu, null, 2), DANH_SACH_ANH: JSON.stringify(dsAnh, null, 2), KINH_NGHIEM: khoiKinhNghiem(kn).slice(1).join('\n') };
  return (mau ?? layPromptDangDung(loai).noiDung)
    .replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (Object.hasOwn(giaTri, k) ? giaTri[k] : m)) // hàm thay thế: không diễn giải $& trong dữ liệu
    .replace(/\n{3,}/g, '\n\n'); // {{KINH_NGHIEM}} trống không để lại dòng trắng thừa
}

// Chỉ thêm trường khi có kinh nghiệm — lượt QC không có kinh nghiệm giữ nguyên schema cũ.
const themTruongKinhNghiem = (schema, kn) => (kn.length
  ? { ...schema, properties: { ...schema.properties, kinh_nghiem_ap_dung: { type: 'array', items: { type: 'integer' } } } } : schema);
const kinhNghiemAiApDung = (ai, kn) => {
  const ids = new Set(kn.map(k => k.id));
  return [...new Set((ai && Array.isArray(ai.kinh_nghiem_ap_dung) ? ai.kinh_nghiem_ap_dung : []).map(Number).filter(id => ids.has(id)))];
};

// body: { aiSaiGi, hangMucSai[], nguyenNhan[], nguyenNhanKhac, kinhNghiem, phamVi } -> object cột đã làm sạch (throw 400 nếu sai).
function kiemTraKinhNghiem(body, log) {
  const b = body || {};
  const aiSaiGi = String(b.aiSaiGi || '').trim();
  const kinhNghiem = String(b.kinhNghiem || '').trim();
  const nguyenNhanKhac = String(b.nguyenNhanKhac || '').trim();
  const hangMucSai = [...new Set(Array.isArray(b.hangMucSai) ? b.hangMucSai : [])];
  const nguyenNhan = [...new Set(Array.isArray(b.nguyenNhan) ? b.nguyenNhan : [])];
  if (!aiSaiGi) throw loiNghiepVu('Chưa nhập "AI đã đánh giá sai điều gì".');
  if (aiSaiGi.length > 2000) throw loiNghiepVu('"AI đã đánh giá sai điều gì" tối đa 2000 ký tự.');
  if (!kinhNghiem) throw loiNghiepVu('Chưa nhập "Kinh nghiệm cần tích luỹ".');
  if (kinhNghiem.length > KN_DO_DAI_KINH_NGHIEM) throw loiNghiepVu(`"Kinh nghiệm cần tích luỹ" tối đa ${KN_DO_DAI_KINH_NGHIEM} ký tự (đây là phần gửi cho AI).`);
  if (hangMucSai.some(h => !HANG_MUC_THEO_LOAI[log.LoaiQc].includes(h))) throw loiNghiepVu('Hạng mục sai không hợp lệ.');
  if (!nguyenNhan.length) throw loiNghiepVu('Chọn ít nhất 1 nguyên nhân AI đánh giá sai.');
  if (nguyenNhan.some(n => !Object.hasOwn(NGUYEN_NHAN_KN, n))) throw loiNghiepVu('Nguyên nhân không hợp lệ.');
  if (nguyenNhan.includes('KHAC') && !nguyenNhanKhac) throw loiNghiepVu('Đã chọn "Nguyên nhân khác" — hãy mô tả nguyên nhân.');
  if (nguyenNhanKhac.length > 1000) throw loiNghiepVu('Mô tả nguyên nhân tối đa 1000 ký tự.');
  if (!Object.hasOwn(PHAM_VI_KN, b.phamVi)) throw loiNghiepVu('Phạm vi áp dụng không hợp lệ.');
  return { aiSaiGi, kinhNghiem, nguyenNhanKhac, hangMucSai, nguyenNhan, phamVi: b.phamVi };
}
// Phạm vi -> giá trị so khớp lấy từ ĐƠN GỐC (loại sản phẩm đọc lại từ đơn; đơn không có LOAI thì không chọn được phạm vi này).
async function giaTriPhamVi(phamVi, log) {
  if (phamVi === 'DON_NAY') return log.STT_Key;
  if (phamVi === 'TOAN_QC') return '';
  const { rows } = await orderService.getAll();
  const row = rows.find(r => r.STT_Key === log.STT_Key);
  const loai = String((row && row.LOAI) || '').trim();
  if (!loai) throw loiNghiepVu(`Đơn ${log.STT_Key} không có loại sản phẩm (LOAI) — không chọn được phạm vi "Cùng loại sản phẩm".`);
  return loai;
}
const cotKinhNghiem = (k, giaTri) => ({ AiSaiGi: k.aiSaiGi, HangMucSai: JSON.stringify(k.hangMucSai), NguyenNhan: JSON.stringify(k.nguyenNhan),
  NguyenNhanKhac: k.nguyenNhanKhac, KinhNghiem: k.kinhNghiem, PhamVi: k.phamVi, GiaTriPhamVi: giaTri });

async function taoKinhNghiemTuLog(logId, body, user) {
  const log = nhatKyDbService.layQcLogTheoId(Number(logId));
  if (!log) throw loiNghiepVu('Không tìm thấy lần QC này.', 404);
  if (log.KetQua === 'LOI') throw loiNghiepVu('Lần QC bị LỖI API — không có kết quả AI để giải thích.');
  if (!log.DanhGiaThucTe) throw loiNghiepVu('Hãy đánh giá kết quả thực tế (PASS/FAIL) của lần QC này trước.');
  if (log.KetQua === log.DanhGiaThucTe) throw loiNghiepVu('Kết quả AI trùng kết quả thực tế — không có lỗi AI để giải thích.');
  const k = kiemTraKinhNghiem(body, log);
  const giaTri = await giaTriPhamVi(k.phamVi, log);
  try {
    return nhatKyDbService.taoKinhNghiem({
      QcLogId: log.id, STT_Key: log.STT_Key, LoaiQc: log.LoaiQc, KetQuaAi: log.KetQua, DiemAi: log.Diem, LyDoAi: log.LyDoKetLuan || log.LyDo,
      KetQuaDung: log.DanhGiaThucTe, ...cotKinhNghiem(k, giaTri), NguoiTao: user.ten, ThoiGianTao: thoiGianVNISOString(),
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw loiNghiepVu('Lần QC này đã có giải thích — hãy sửa giải thích hiện có.', 409);
    throw err;
  }
}
async function suaKinhNghiem(id, body, user) {
  const cu = nhatKyDbService.layKinhNghiemTheoId(Number(id));
  if (!cu) throw loiNghiepVu('Không tìm thấy kinh nghiệm.', 404);
  const k = kiemTraKinhNghiem(body, cu);
  // Giữ giá trị phạm vi cũ nếu không đổi phạm vi (đơn gốc có thể đã đổi LOAI).
  const giaTri = k.phamVi === cu.PhamVi ? cu.GiaTriPhamVi : await giaTriPhamVi(k.phamVi, cu);
  nhatKyDbService.suaKinhNghiem(cu.id, cotKinhNghiem(k, giaTri), user.ten, thoiGianVNISOString());
}
function doiTrangThaiKinhNghiem(id, trangThai, user) {
  if (!Object.hasOwn(TRANG_THAI_KN, trangThai)) throw loiNghiepVu('Trạng thái không hợp lệ.');
  if (!nhatKyDbService.doiTrangThaiKinhNghiem(Number(id), trangThai, user.ten, thoiGianVNISOString())) throw loiNghiepVu('Không tìm thấy kinh nghiệm.', 404);
}

// ---------------- GỢI Ý NGƯỠNG (02/10/2026, theo yêu cầu người dùng) — CHỈ hiển thị, KHÔNG tự đổi ngưỡng ----------------
// Dữ liệu: các lần QC đã đánh giá thực tế, có gọi AI, đúng model ĐANG dùng của QC đó (score mỗi model khác nhau), và có lưu
// dau_vao_quyet_dinh (lần QC từ 02/10/2026). Mỗi bộ ngưỡng: chạy lại quyetDinhKetQua() trên kết quả AI đã lưu -> so thực tế.
const GOI_Y_SO_DONG_TOI_THIEU = 30;
function danhGiaBoNguong(dong, nguong) {
  const m = { pass: nguong.pass, fail: nguong.fail, ccl: nguong.ccl, dung: 0, passSai: 0, failSai: 0, canCheckLai: 0 };
  for (const d of dong) {
    const kq = quyetDinhKetQua(structuredClone(d.kq), { nguong, ...d.kq.dau_vao_quyet_dinh }).result;
    if (kq === 'CAN_CHECK_LAI') m.canCheckLai++;
    else if (kq === d.thucTe) m.dung++;
    else if (kq === 'PASS') m.passSai++;
    else m.failSai++;
  }
  return m;
}
// thu: { pass, fail, ccl } tuỳ chọn — bộ ngưỡng người dùng muốn thử.
function goiYNguong(loai, thu) {
  if (!LOAI_QC[loai]) throw loiNghiepVu('Loại QC không hợp lệ.');
  const { model } = layCauHinh(loai);
  const tatCa = nhatKyDbService.layDongDaDanhGiaCoAi(loai);
  const dong = [];
  let boQuaModelKhac = 0, boQuaThieuDuLieu = 0;
  for (const r of tatCa) {
    if (r.Model !== model) { boQuaModelKhac++; continue; }
    let kq = null;
    try { kq = JSON.parse(r.ChiTiet).ket_qua; } catch (e) { /* bỏ qua */ }
    if (!kq || !kq.dau_vao_quyet_dinh || kq.score === null || kq.score === undefined) { boQuaThieuDuLieu++; continue; }
    dong.push({ kq, thucTe: r.DanhGiaThucTe });
  }
  const hienTaiGoc = layNguong(loai);
  const loiHienTai = kiemTraNguong(hienTaiGoc);
  const ketQua = { loai, model, soDong: dong.length, boQuaModelKhac, boQuaThieuDuLieu, toiThieu: GOI_Y_SO_DONG_TOI_THIEU,
    soThucTePass: dong.filter(d => d.thucTe === 'PASS').length, soThucTeFail: dong.filter(d => d.thucTe === 'FAIL').length,
    hienTai: !loiHienTai && dong.length ? danhGiaBoNguong(dong, nguongSo(hienTaiGoc)) : null, thu: null, goiY: [] };
  if (thu) {
    const loi = kiemTraNguong(thu, 'Ngưỡng thử');
    if (loi) throw loiNghiepVu(loi);
    if (dong.length) ketQua.thu = danhGiaBoNguong(dong, nguongSo(thu));
  }
  if (!dong.length) return ketQua;
  // Lưới bước 5. KHÔNG xếp hạng chỉ theo "ít sai nhất" — đẩy hết về CAN_CHECK_LAI (PASS 100 / FAIL 0) luôn 0 sai nhưng vô dụng.
  // 3 gợi ý theo 3 hướng đánh đổi; hoà thì chọn bộ gần ngưỡng hiện tại nhất. Người dùng tự quyết.
  // ponytail: duyệt hết lưới (~1000 bộ x số dòng) — đủ nhanh tới vài nghìn dòng đã đánh giá; nhiều hơn thì thu hẹp lưới.
  const ht = ketQua.hienTai || { pass: 0, fail: 0, ccl: 0, passSai: Infinity, failSai: Infinity, canCheckLai: Infinity };
  const cacBo = [];
  for (let pass = 50; pass <= 100; pass += 5) {
    for (let fail = 0; fail < pass; fail += 5) {
      for (let ccl = 50; ccl <= 95; ccl += 5) cacBo.push(danhGiaBoNguong(dong, { pass, fail, ccl }));
    }
  }
  const lech = m => Math.abs(m.pass - ht.pass) + Math.abs(m.fail - ht.fail) + Math.abs(m.ccl - ht.ccl);
  const tot = (ds, ...tieuChi) => [...ds].sort((a, b) => tieuChi.reduce((kq, f) => kq || f(a) - f(b), 0) || lech(a) - lech(b))[0];
  const huong = [
    ['AN_TOAN', 'Ít PASS sai nhất (rồi ít CẦN CHECK LẠI nhất)', tot(cacBo, m => m.passSai, m => m.canCheckLai, m => m.failSai)],
    ['IT_CCL', 'Ít CẦN CHECK LẠI nhất mà PASS sai và FAIL sai không tăng so với hiện tại',
      tot(cacBo.filter(m => m.passSai <= ht.passSai && m.failSai <= ht.failSai), m => m.canCheckLai)],
    ['IT_SAI', 'Ít sai nhất (PASS sai + FAIL sai) mà CẦN CHECK LẠI không tăng so với hiện tại',
      tot(cacBo.filter(m => m.canCheckLai <= ht.canCheckLai), m => m.passSai + m.failSai, m => m.passSai)],
  ];
  ketQua.goiY = huong.filter(([, , m]) => m).map(([ma, moTa, m]) => ({ ma, moTa, ...m }));
  return ketQua;
}

const chayQc2 = (sttKey, nguong, thongKe, mau) => chayDoiChieu(sttKey, QC2, nguong, thongKe, mau);
const chayQc1 = (sttKey, nguong, thongKe, mau) => chayDoiChieu(sttKey, QC1, nguong, thongKe, mau);

const CHAY_THEO_LOAI = { QC1: chayQc1, QC2: chayQc2, QC3: chayQc3 };

// Cảnh báo Telegram (01/10/2026, theo yêu cầu người dùng) — gửi khi FAIL, CAN_CHECK_LAI (kể cả không gọi AI) hoặc lỗi API.
// 1 Chat ID chung (menu QC), bot TELEGRAM_BOT_TOKEN sẵn có. Không chờ gửi xong — không làm chậm/hỏng lượt QC.
// Cắt từng trường TRƯỚC khi escape (không cắt cả tin sau escape — dễ cắt đôi thẻ/entity HTML) để tin < 4096 ký tự của Telegram.
const escTg = s => String(s ?? '').slice(0, 350).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NHAN_TG = { FAIL: '🔴 QC FAIL', CAN_CHECK_LAI: '🟡 QC CẦN CHECK LẠI', LOI: '❗ QC LỖI API' };
function taoTinCanhBao({ loai, sttKey, model, nguoiChay, ketQua, loi }) {
  const dong = [`${NHAN_TG[ketQua ? ketQua.result : 'LOI']} — ${escTg(LOAI_QC[loai])}`, `Đơn: <b>${escTg(sttKey)}</b>`];
  if (loi) dong.push(`Lỗi: ${escTg(loi)}`);
  if (ketQua) {
    if (ketQua.ly_do_ket_luan) dong.push(`Kết luận: ${escTg(ketQua.ly_do_ket_luan)}`);
    if (ketQua.score !== null && ketQua.score !== undefined) dong.push(`Điểm: ${escTg(ketQua.score)} · Chắc chắn: ${Math.round((ketQua.confidence || 0) * 100)}%`);
    if (ketQua.reason) dong.push(`Lý do: ${escTg(ketQua.reason)}`);
    const vanDe = (ketQua.issues || []).slice(0, 8);
    if (vanDe.length) dong.push('Vấn đề:', ...vanDe.map(v => `• ${escTg(v)}`));
  }
  dong.push(`${model ? `Model: ${escTg(model)} · ` : 'Không gọi AI · '}Người chạy: ${escTg(nguoiChay)}`);
  return dong.join('\n');
}
// Token nhập ở menu QC; trống = TELEGRAM_BOT_TOKEN (.env).
function layTelegram() {
  const { chatId, botToken } = caiDatDbService.layTelegramQc();
  return { chatId, botToken: botToken || process.env.TELEGRAM_BOT_TOKEN || '' };
}
function canhBaoTelegram(thongTin) {
  const { chatId, botToken } = layTelegram();
  if (!chatId) return;
  // Gộp (02/10/2026): CAN_CHECK_LAI để qcTelegramService gửi gộp theo chu kỳ (lấy từ qc_log). FAIL / LỖI API luôn gửi ngay.
  if (thongTin.ketQua && thongTin.ketQua.result === 'CAN_CHECK_LAI' && caiDatDbService.layTelegramQc().gopCclPhut > 0) return;
  telegramService.guiTinNhan(chatId, taoTinCanhBao(thongTin), botToken).catch(() => {});
}
async function guiThuTelegram() {
  const { chatId, botToken } = layTelegram();
  if (!chatId) throw loiNghiepVu('Chưa lưu Chat ID Telegram.');
  const kq = await telegramService.guiTinNhan(chatId, '✅ Thử cảnh báo AI QC — Chat ID này sẽ nhận cảnh báo FAIL / CẦN CHECK LẠI / LỖI API.', botToken);
  if (!kq || !kq.ok) throw loiNghiepVu((kq && kq.loi) || 'Gửi Telegram thất bại.');
}

// Chạy 1 lượt QC + ghi log. -> { id, loai, sttKey, model, anh, ketQua | null, loi | null }
// Mã đơn không tồn tại / loại chưa triển khai -> throw (status 404/400), vẫn ghi log với mã không tồn tại.
// cheDo: 'MANUAL' (bấm ở menu QC) | 'AUTO' (Tự động quét QC — services/qc/qcAutoService.js, kèm thongTinAuto để ghi log).
// mauChayThu (02/10/2026): prompt ĐANG SỬA chưa lưu -> chế độ 'TEST': không gửi Telegram, không tính số lần dùng kinh nghiệm,
// không tính vào Độ chính xác/Gợi ý ngưỡng/mẫu kiểm PASS (nhatKyDbService lọc CheDo = 'TEST'); prompt thử lưu kèm ChiTiet.
async function chayQc({ sttKey, loai, user, cheDo = 'MANUAL', thongTinAuto = null, mauChayThu = null }) {
  sttKey = String(sttKey || '').trim();
  if (!LOAI_QC[loai]) throw loiNghiepVu('Loại QC không hợp lệ — chỉ QC1, QC2, QC3.');
  if (!LOAI_DA_TRIEN_KHAI.includes(loai)) throw loiNghiepVu(`${LOAI_QC[loai]} chưa được triển khai.`);
  if (!sttKey) throw loiNghiepVu('Chưa nhập mã đơn (STT_Key).');
  const chayThu = mauChayThu !== null;
  if (chayThu) {
    const loiMau = kiemTraMauPrompt(loai, mauChayThu);
    if (loiMau) throw loiNghiepVu(loiMau);
    cheDo = 'TEST';
  }
  // Prompt đọc 1 lần cho cả lượt (đổi phiên bản giữa chừng không ảnh hưởng lượt đang chạy); log ghi phiên bản đã dùng.
  const prompt = chayThu ? { noiDung: mauChayThu, nhan: 'CHAY_THU' } : layPromptDangDung(loai);
  // Ngưỡng đọc 1 lần cho cả lượt; cấu hình sai -> KHÔNG chạy QC (không đoán, không tự sửa).
  const nguongGoc = layNguong(loai);
  const loiNguong = kiemTraNguong(nguongGoc, LOAI_QC[loai]);
  if (loiNguong) throw loiNghiepVu(`Ngưỡng kết luận không hợp lệ — ${loiNguong} Sửa ở mục "Ngưỡng kết luận" trước khi chạy QC.`);
  const nguong = nguongSo(nguongGoc);
  const { model } = layCauHinh(loai);
  const dong = { ThoiGian: thoiGianVNISOString(), NguoiDung: user.ten, STT_Key: sttKey, LoaiQc: loai, Model: model, NguongDaDung: JSON.stringify(nguong),
    CheDo: cheDo, ThongTinAuto: thongTinAuto ? JSON.stringify(thongTinAuto) : '', PhienBanPrompt: prompt.nhan };
  let kq;
  const thongKe = {}; // { tokenVao, tokenRa } — provider tự ghi (chi phí AI, 02/10/2026)
  const cotToken = () => ({ TokenVao: thongKe.tokenVao ?? '', TokenRa: thongKe.tokenRa ?? '' });
  try {
    kq = await CHAY_THEO_LOAI[loai](sttKey, nguong, thongKe, prompt.noiDung);
  } catch (err) {
    const id = nhatKyDbService.ghiQcLog({ ...dong, ...cotToken(), KetQua: 'LOI', LoiApi: err.message, ThoiGianKetThuc: thoiGianVNISOString() });
    if (err.status) throw Object.assign(err, { logId: id });
    if (!chayThu) canhBaoTelegram({ loai, sttKey, model, nguoiChay: user.ten, loi: err.message });
    return { id, loai, sttKey, model, anh: [], ketQua: null, loi: err.message };
  }
  const k = kq.ketQua;
  const id = nhatKyDbService.ghiQcLog({
    ...dong, Model: kq.daGoiAi ? model : '',
    AnhDaDung: kq.anh.join('\n'), FileTheu: (kq.fileTheu || []).join('\n'), DesignFile: k.design_file || '', MockupFile: k.mockup_file || '',
    KetQua: k.result, DoTinCay: k.confidence, LyDo: k.reason,
    Diem: k.score === null || k.score === undefined ? '' : k.score, AiDeXuat: k.ai_de_xuat || '', LyDoKetLuan: k.ly_do_ket_luan || '',
    ThoiGianKetThuc: thoiGianVNISOString(),
    ChiTiet: JSON.stringify({ ket_qua: k, ai_goc: kq.aiGoc || null, ...(chayThu ? { prompt_chay_thu: mauChayThu } : {}) }),
    KinhNghiemDaDung: kq.kinhNghiem && kq.kinhNghiem.length ? JSON.stringify(kq.kinhNghiem) : '',
    ...cotToken(),
  });
  if (!chayThu && kq.kinhNghiem && kq.kinhNghiem.length) nhatKyDbService.tangSoLanDungKinhNghiem(kq.kinhNghiem.map(x => x.id));
  if (!chayThu && k.result !== 'PASS') canhBaoTelegram({ loai, sttKey, model: kq.daGoiAi ? model : '', nguoiChay: user.ten, ketQua: k });
  return { id, loai, sttKey, model: kq.daGoiAi ? model : '', anh: kq.anh, ketQua: k, loi: null };
}

async function thuKetNoi(loai, nhaCungCap) {
  if (!LOAI_QC[loai]) throw loiNghiepVu('Loại QC không hợp lệ — chỉ QC1, QC2, QC3.');
  const ch = layCauHinh(loai, nhaCungCap);
  await aiProvider.thuKetNoi(ch, ch.nhaCungCap);
}

module.exports = { LOAI_QC, LOAI_DA_TRIEN_KHAI, MODEL_MAC_DINH, NHA_CUNG_CAP, NGUONG_MAC_DINH, layCauHinh, layNguong, kiemTraNguong, docSo, quyetDinhKetQua, chayQc, thuKetNoi, guiThuTelegram, taoTinCanhBao, hoanThienKetQua3, hoanThienKetQuaDoiChieu, chuanHoaMa, khopMa, layTelegram, goiYNguong,
  CHO_GIU_CHO, CHO_GIU_CHO_THEO_LOAI, MAU_PROMPT_MAC_DINH, kiemTraMauPrompt, layPromptDangDung, taoPrompt,
  HANG_MUC_THEO_LOAI, NGUYEN_NHAN_KN, PHAM_VI_KN, TRANG_THAI_KN, KN_DO_DAI_KINH_NGHIEM, chonKinhNghiem, taoKinhNghiemTuLog, suaKinhNghiem, doiTrangThaiKinhNghiem };
