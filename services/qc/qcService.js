// AI QC (30/09/2026, theo yêu cầu người dùng) — QC thủ công theo STT_Key ở menu QC (routes/qc.js, CHỈ superadmin).
// Triển khai theo giai đoạn: QC3 (dán tem) trước; QC2 (sản xuất), QC1 (vẽ file) làm SAU khi người dùng xác nhận QC3.
// Mỗi lần chạy (kể cả lỗi API / thiếu dữ liệu) ghi 1 dòng qc_log (nhatKyDbService.js). KHÔNG đổi dữ liệu/trạng thái đơn.
// Kết quả luôn là PASS / FAIL / CAN_CHECK_LAI; server tự kiểm tra lại phần đối chiếu được bằng dữ liệu (mã tracking),
// không tin tuyệt đối vào AI — AI trả PASS mà mã trên tem không khớp đơn thì vẫn FAIL.
const orderService = require('../orderService');
const donNhieuAoService = require('../donNhieuAoService');
const caiDatDbService = require('../caiDatDbService');
const nhatKyDbService = require('../nhatKyDbService');
const { taiAnh } = require('../anhNguonService');
const { thoiGianVNISOString } = require('../dateUtils');
const aiProvider = require('./aiProvider');

const LOAI_QC = { QC1: 'QC1 – QC Vẽ File', QC2: 'QC2 – QC Sản Xuất', QC3: 'QC3 – QC Dán Tem' };
const LOAI_DA_TRIEN_KHAI = ['QC3'];
const MODEL_MAC_DINH = 'gemini-2.5-flash';
const KET_QUA = ['PASS', 'FAIL', 'CAN_CHECK_LAI'];
const DUNG_LUONG_ANH_TOI_DA = 15 * 1024 * 1024; // Gemini giới hạn ~20MB/lượt gửi ảnh trực tiếp

const loiNghiepVu = (thongBao, status = 400) => Object.assign(new Error(thongBao), { status });

function layCauHinh(loai) {
  const ch = caiDatDbService.layCauHinhQc()[loai] || {};
  return { apiKey: ch.ApiKey || '', model: ch.Model || MODEL_MAC_DINH };
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

// ---------------- QC3 – QC DÁN TEM ----------------
const HANG_MUC = { type: 'string', enum: KET_QUA };
const SCHEMA_QC3 = {
  type: 'object',
  properties: {
    result: { type: 'string', enum: KET_QUA },
    confidence: { type: 'number' },
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
  required: ['result', 'confidence', 'checked_items', 'issues', 'reason', 'doc_duoc'],
};

function promptQc3(duLieu) {
  return [
    'Bạn là nhân viên QC của xưởng thêu, nhiệm vụ: kiểm tra TEM VẬN CHUYỂN đã dán trên kiện hàng trong ảnh có đúng đơn hàng hay không.',
    'Dữ liệu đơn hàng trong hệ thống (JSON):',
    JSON.stringify(duLieu, null, 2),
    '',
    'Quy tắc BẮT BUỘC:',
    '1. Đọc NGUYÊN VĂN chữ trên tem vào "doc_duoc": mã tracking (dòng số/chữ dưới mã vạch), tên người nhận, địa chỉ người nhận, hãng vận chuyển, và mọi mã đơn in trên tem (vd dòng "KIEN GOM ... DON: ..."). Không đọc được rõ thì để null — TUYỆT ĐỐI không đoán hay tự điền từ dữ liệu đơn.',
    '2. Nếu ảnh không có tem vận chuyển nào: doc_duoc.co_tem = false và result = "CAN_CHECK_LAI".',
    '3. checked_items (mỗi mục PASS / FAIL / CAN_CHECK_LAI): "tracking" so mã đọc được với ma_tracking_can_co; "nguoi_nhan" so tên người nhận; "dia_chi" so địa chỉ (đường, thành phố, bang, zipcode, nước); "ma_don_gom" CHỈ khi don_gom.la_kien_gom = true — tem phải có dòng kiện gom chứa ma_don, không phải kiện gom thì để null.',
    '4. Tem thường in HOA, bỏ dấu, viết tắt (Street/St, Avenue/Ave, Apartment/Apt, tên bang viết tắt như CA = California, United States/US/USA) — những khác biệt kiểu này KHÔNG phải lỗi.',
    '5. Chỉ dùng FAIL khi đọc RÕ và thấy KHÁC thật sự (sai người, sai địa chỉ, sai mã). Ảnh mờ, bị che, bị cắt, lóa, không chắc chắn -> CAN_CHECK_LAI. Không được kết luận chỉ vì "nhìn khá giống".',
    '6. result tổng: FAIL nếu có ít nhất 1 mục FAIL rõ ràng; PASS chỉ khi mọi mục cần kiểm đều PASS và đọc được mã tracking; còn lại CAN_CHECK_LAI.',
    '7. design_file và mockup_file luôn null (QC dán tem không dùng design/mockup). confidence từ 0 đến 1. issues và reason viết tiếng Việt, ngắn gọn, nêu cụ thể chỗ sai/chỗ không đọc được.',
  ].join('\n');
}

// Làm sạch JSON AI trả về + đối chiếu mã tracking bằng dữ liệu hệ thống. -> kết quả cuối (cùng khuôn yêu cầu, thêm kiem_tra_he_thong).
function hoanThienKetQua3(ai, { maCanCo, row, rows, cungNhom }) {
  const kq = {
    result: KET_QUA.includes(ai && ai.result) ? ai.result : 'CAN_CHECK_LAI',
    confidence: Math.min(1, Math.max(0, Number(ai && ai.confidence) || 0)),
    design_file: null,
    mockup_file: null,
    checked_items: Object.fromEntries(Object.entries((ai && ai.checked_items) || {}).filter(([, v]) => KET_QUA.includes(v))),
    issues: Array.isArray(ai && ai.issues) ? ai.issues.map(String) : [],
    reason: String((ai && ai.reason) || ''),
    doc_duoc: (ai && typeof ai.doc_duoc === 'object' && ai.doc_duoc) || {},
    kiem_tra_he_thong: [],
  };
  if (!KET_QUA.includes(ai && ai.result)) kq.issues.push('AI trả kết quả không đúng định dạng — chuyển CAN_CHECK_LAI.');

  const maTem = chuanHoaMa(kq.doc_duoc.ma_tracking);
  if (!maTem) {
    kq.kiem_tra_he_thong.push('Không đọc được mã tracking trên tem — hệ thống không đối chiếu được.');
    kq.checked_items.tracking = kq.checked_items.tracking === 'FAIL' ? 'FAIL' : 'CAN_CHECK_LAI';
    if (kq.result === 'PASS') {
      kq.result = 'CAN_CHECK_LAI';
      kq.issues.push('Không đọc được mã tracking trên tem — không thể xác nhận PASS.');
    }
    return kq;
  }
  // Dán nhầm: mã trên tem là tracking của đơn KHÁC (ngoài đơn này và nhóm DonNhieuAo của nó).
  const donKhac = rows.filter(r => r.STT_Key !== row.STT_Key && !cungNhom.has(r.STT_Key)
    && (khopMa(maTem, chuanHoaMa(r.TRACKING_ID)) || khopMa(maTem, chuanHoaMa(r.TRACKING_ID2)))).map(r => r.STT_Key);
  if (donKhac.length && !khopMa(maTem, maCanCo)) {
    kq.result = 'FAIL';
    kq.checked_items.tracking = 'FAIL';
    kq.issues.unshift(`Mã tracking trên tem (${kq.doc_duoc.ma_tracking}) là của đơn ${donKhac.join(', ')} — nghi DÁN NHẦM TEM.`);
    kq.kiem_tra_he_thong.push(`Mã trên tem trùng tracking của đơn khác: ${donKhac.join(', ')}.`);
  } else if (!khopMa(maTem, maCanCo)) {
    kq.result = 'FAIL';
    kq.checked_items.tracking = 'FAIL';
    kq.issues.unshift(`Mã tracking trên tem (${kq.doc_duoc.ma_tracking}) khác mã của đơn (${maCanCo}).`);
    kq.kiem_tra_he_thong.push('Mã tracking trên tem KHÔNG khớp đơn.');
  } else {
    kq.checked_items.tracking = 'PASS';
    kq.kiem_tra_he_thong.push('Mã tracking trên tem khớp đơn.');
  }
  return kq;
}

// -> { ketQua, anh: [url], model, daGoiAi }
async function chayQc3(sttKey) {
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
  const khongGoiAi = (lyDo, anh = []) => ({
    daGoiAi: false, anh,
    ketQua: { result: 'CAN_CHECK_LAI', confidence: 0, design_file: null, mockup_file: null, checked_items: {}, issues: [lyDo], reason: 'Chưa đủ dữ liệu để QC — cần người kiểm tra lại.', kiem_tra_he_thong: [lyDo] },
  });

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
  const { apiKey, model } = layCauHinh('QC3');
  const ai = await aiProvider.phanTichAnh({ apiKey, model, prompt: promptQc3(duLieu), anh: [{ mime, data: buffer, ten: 'anh_da_dan_tem' }], schema: SCHEMA_QC3 });
  return {
    daGoiAi: true, anh: [urlAnh], aiGoc: ai,
    ketQua: hoanThienKetQua3(ai, { maCanCo: chuanHoaMa(maCanCoGoc), row, rows, cungNhom }),
  };
}

const CHAY_THEO_LOAI = { QC3: chayQc3 };

// Chạy 1 lượt QC + ghi log. -> { id, loai, sttKey, model, anh, ketQua | null, loi | null }
// Mã đơn không tồn tại / loại chưa triển khai -> throw (status 404/400), vẫn ghi log với mã không tồn tại.
async function chayQc({ sttKey, loai, user }) {
  sttKey = String(sttKey || '').trim();
  if (!LOAI_QC[loai]) throw loiNghiepVu('Loại QC không hợp lệ — chỉ QC1, QC2, QC3.');
  if (!LOAI_DA_TRIEN_KHAI.includes(loai)) throw loiNghiepVu(`${LOAI_QC[loai]} chưa được triển khai.`);
  if (!sttKey) throw loiNghiepVu('Chưa nhập mã đơn (STT_Key).');
  const { model } = layCauHinh(loai);
  const dong = { ThoiGian: thoiGianVNISOString(), NguoiDung: user.ten, STT_Key: sttKey, LoaiQc: loai, Model: model };
  let kq;
  try {
    kq = await CHAY_THEO_LOAI[loai](sttKey);
  } catch (err) {
    const id = nhatKyDbService.ghiQcLog({ ...dong, KetQua: 'LOI', LoiApi: err.message });
    if (err.status) throw Object.assign(err, { logId: id });
    return { id, loai, sttKey, model, anh: [], ketQua: null, loi: err.message };
  }
  const k = kq.ketQua;
  const id = nhatKyDbService.ghiQcLog({
    ...dong, Model: kq.daGoiAi ? model : '',
    AnhDaDung: kq.anh.join('\n'), DesignFile: k.design_file || '', MockupFile: k.mockup_file || '',
    KetQua: k.result, DoTinCay: k.confidence, LyDo: k.reason,
    ChiTiet: JSON.stringify({ ket_qua: k, ai_goc: kq.aiGoc || null }),
  });
  return { id, loai, sttKey, model: kq.daGoiAi ? model : '', anh: kq.anh, ketQua: k, loi: null };
}

async function thuKetNoi(loai) {
  if (!LOAI_QC[loai]) throw loiNghiepVu('Loại QC không hợp lệ — chỉ QC1, QC2, QC3.');
  await aiProvider.thuKetNoi(layCauHinh(loai));
}

module.exports = { LOAI_QC, LOAI_DA_TRIEN_KHAI, MODEL_MAC_DINH, layCauHinh, chayQc, thuKetNoi, hoanThienKetQua3, chuanHoaMa, khopMa };
