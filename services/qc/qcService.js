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
const NHA_CUNG_CAP = { gemini: { ten: 'Gemini', modelMacDinh: MODEL_MAC_DINH }, claude: { ten: 'Claude', modelMacDinh: 'claude-sonnet-5-5' } };
const KET_QUA = ['PASS', 'FAIL', 'CAN_CHECK_LAI'];
const DUNG_LUONG_ANH_TOI_DA = 15 * 1024 * 1024; // Gemini giới hạn ~20MB/lượt gửi ảnh trực tiếp

const loiNghiepVu = (thongBao, status = 400) => Object.assign(new Error(thongBao), { status });

// -> { nhaCungCap, apiKey, model } của nhà cung cấp đang chọn cho QC `loai` (hoặc `nhaCungCap` truyền vào).
function layCauHinh(loai, nhaCungCap) {
  const ch = caiDatDbService.layCauHinhQc()[loai] || {};
  const ncc = NHA_CUNG_CAP[nhaCungCap] ? nhaCungCap : NHA_CUNG_CAP[ch.NhaCungCap] ? ch.NhaCungCap : 'gemini';
  const [apiKey, model] = ncc === 'claude' ? [ch.ApiKeyClaude, ch.ModelClaude] : [ch.ApiKey, ch.Model];
  return { nhaCungCap: ncc, apiKey: apiKey || '', model: model || NHA_CUNG_CAP[ncc].modelMacDinh };
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
  const { nhaCungCap, apiKey, model } = layCauHinh('QC3');
  const ai = await aiProvider.phanTichAnh({ apiKey, model, prompt: promptQc3(duLieu), anh: [{ mime, data: buffer, ten: 'anh_da_dan_tem' }], schema: SCHEMA_QC3 }, nhaCungCap);
  return {
    daGoiAi: true, anh: [urlAnh], aiGoc: ai,
    ketQua: hoanThienKetQua3(ai, { maCanCo: chuanHoaMa(maCanCoGoc), row, rows, cungNhom }),
  };
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
    confidence: { type: 'number' },
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
  required: ['result', 'confidence', 'design_file', 'mockup_file', 'checked_items', 'issues', 'reason', 'vai_tro_anh'],
});

// Phần mở đầu chung của prompt: dữ liệu đơn + danh sách ảnh + quy tắc xác định vai trò ảnh.
const dauPrompt = (nhiemVu, duLieu, dsAnh) => [
  nhiemVu,
  'Dữ liệu đơn hàng (JSON):',
  JSON.stringify(duLieu, null, 2),
  '',
  'Danh sách ảnh gửi kèm (tên ảnh đứng ngay trước mỗi ảnh). "nguon" chỉ là CỘT DỮ LIỆU chứa link — KHÔNG chắc chắn là vai trò thật của ảnh:',
  JSON.stringify(dsAnh, null, 2),
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

// Làm sạch JSON AI trả về + ràng buộc hệ thống: tên file phải có thật; hạng mục FAIL -> FAIL; PASS chỉ khi xác định được
// Design và mọi hạng mục `batBuoc` đều PASS (các hạng mục còn lại được phép CAN_CHECK_LAI).
function hoanThienKetQuaDoiChieu(ai, tenHopLe, { hangMuc, batBuoc }) {
  const kq = {
    result: KET_QUA.includes(ai && ai.result) ? ai.result : 'CAN_CHECK_LAI',
    confidence: Math.min(1, Math.max(0, Number(ai && ai.confidence) || 0)),
    design_file: tenHopLe.has(ai && ai.design_file) ? ai.design_file : null,
    mockup_file: tenHopLe.has(ai && ai.mockup_file) ? ai.mockup_file : null,
    checked_items: Object.fromEntries(Object.entries((ai && ai.checked_items) || {}).filter(([k, v]) => hangMuc.includes(k) && KET_QUA.includes(v))),
    issues: Array.isArray(ai && ai.issues) ? ai.issues.map(String) : [],
    reason: String((ai && ai.reason) || ''),
    vai_tro_anh: Array.isArray(ai && ai.vai_tro_anh) ? ai.vai_tro_anh.filter(v => v && tenHopLe.has(v.ten)) : [],
    kiem_tra_he_thong: [],
  };
  const haXuong = lyDo => {
    kq.kiem_tra_he_thong.push(lyDo);
    if (kq.result === 'PASS') { kq.result = 'CAN_CHECK_LAI'; kq.issues.push(lyDo); }
  };
  if (!KET_QUA.includes(ai && ai.result)) kq.issues.push('AI trả kết quả không đúng định dạng — chuyển CAN_CHECK_LAI.');
  if (ai && ai.design_file && !kq.design_file) haXuong(`AI chọn design_file "${ai.design_file}" không có trong danh sách ảnh đã gửi.`);
  if (ai && ai.mockup_file && !kq.mockup_file) kq.kiem_tra_he_thong.push(`AI chọn mockup_file "${ai.mockup_file}" không có trong danh sách ảnh — bỏ qua.`);
  const hangMucLoi = Object.entries(kq.checked_items).filter(([, v]) => v === 'FAIL').map(([k]) => k);
  if (hangMucLoi.length && kq.result !== 'FAIL') {
    kq.result = 'FAIL';
    kq.kiem_tra_he_thong.push(`Có hạng mục FAIL (${hangMucLoi.join(', ')}) — kết quả tổng chuyển FAIL.`);
  }
  if (kq.result === 'PASS') {
    if (!kq.design_file) haXuong('Không xác định chắc chắn được Design chính — không thể PASS.');
    const chuaDat = batBuoc.filter(h => kq.checked_items[h] !== 'PASS');
    if (chuaDat.length) haXuong(`Hạng mục bắt buộc chưa PASS: ${chuaDat.join(', ')} — không thể PASS.`);
  }
  return kq;
}

// Chạy 1 lượt QC đối chiếu. qc = {
//   loai, anhCanKiem(row) -> [{ ten, nguon, url }] (ảnh BẮT BUỘC, đọc được ít nhất 1), thieuAnh: lý do khi không có ảnh cần kiểm,
//   anhPhu(row) -> [{ ten, nguon, url }] (gửi thêm nếu đọc được), hangMuc, batBuoc, prompt(duLieu, dsAnh) }
async function chayDoiChieu(sttKey, qc) {
  const { rows } = await orderService.getAll({ fresh: true });
  const row = rows.find(r => r.STT_Key === sttKey);
  if (!row) throw loiNghiepVu(`Không tìm thấy đơn ${sttKey}.`, 404);
  const urlFileTheu = COT_FILE_THEU.map(c => row[c]).filter(Boolean);
  const khongGoiAi = (lyDo, anh = []) => ({
    daGoiAi: false, anh, fileTheu: urlFileTheu,
    ketQua: { result: 'CAN_CHECK_LAI', confidence: 0, design_file: null, mockup_file: null, checked_items: {}, issues: [lyDo], reason: 'Chưa đủ dữ liệu để QC — cần người kiểm tra lại.', kiem_tra_he_thong: [lyDo] },
  });

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
  const ai = await aiProvider.phanTichAnh({
    apiKey, model, schema: schemaDoiChieu(qc.hangMuc),
    prompt: qc.prompt(duLieu, dsAnh.map(a => ({ ten: a.ten, nguon: a.nguon }))),
    anh: dsAnh.map(a => ({ mime: a.mime, data: a.data, ten: a.ten })),
  }, nhaCungCap);
  const ketQua = hoanThienKetQuaDoiChieu(ai, tenDaDung, qc);
  ketQua.kiem_tra_he_thong.unshift(...ghiChuHeThong);
  return { daGoiAi: true, anh: anhDaDung, fileTheu: urlFileTheu, aiGoc: ai, ketQua };
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
  prompt: (duLieu, dsAnh) => [
    ...dauPrompt('Bạn là nhân viên QC của xưởng thêu, nhiệm vụ: kiểm tra SẢN PHẨM THÊU THỰC TẾ (ảnh "san_pham") có đúng yêu cầu đơn hàng hay không.', duLieu, dsAnh),
    '2. Yêu cầu CHÍNH là Design + Mockup + các ghi chú (ghi_chu, ghi_chu_xuong, ghi_chu_ve_file, ghi_chu_chay_may). File thêu chỉ để đối chiếu thêm: sản phẩm khác Design là FAIL kể cả khi giống File thêu — khi đó ghi rõ trong issues "lỗi có thể từ File thêu".',
    '3. Kiểm tra checked_items (PASS / FAIL / CAN_CHECK_LAI): design (đúng thiết kế), text (ĐỌC TỪNG KÝ TỰ: thiếu, sai, thừa ký tự — rất quan trọng), chi_tiet (thiếu/thừa chi tiết), color (màu chỉ/màu áo), position (vị trí thêu so với vi_tri_theu/ghi chú/mockup), huong (xoay/lật), size (kích thước/tỷ lệ — chỉ khi dữ liệu có số đo rõ, nếu không thì CAN_CHECK_LAI), loi_san_xuat (lỗi thêu nhìn thấy được: bung chỉ, nhăn, lệch, sót chỉ...).',
    '4. Nếu Design và Mockup khác nhau: nêu rõ khác biệt, xem ghi chú để biết bên nào là yêu cầu chính thức; không đủ căn cứ -> CAN_CHECK_LAI. Nhiều ảnh cùng có thể là Design mà không xác định được ảnh chính -> CAN_CHECK_LAI.',
    '5. Chỉ FAIL khi thấy RÕ lỗi. Ảnh mờ, bị che, góc chụp không thấy rõ, thiếu ảnh -> CAN_CHECK_LAI. Không kết luận kiểu "nhìn khá giống".',
    '6. result tổng: FAIL nếu có lỗi rõ ràng; PASS chỉ khi xác định được Design, và design, text, chi_tiet, position, loi_san_xuat đều PASS, không có mâu thuẫn dữ liệu; còn lại CAN_CHECK_LAI.',
    '7. confidence từ 0 đến 1. issues và reason viết tiếng Việt, ngắn gọn, nêu cụ thể (vd ký tự nào sai, chi tiết nào thiếu).',
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
  prompt: (duLieu, dsAnh) => [
    ...dauPrompt('Bạn là nhân viên QC của xưởng thêu, nhiệm vụ: kiểm tra FILE THÊU vừa vẽ (các ảnh "file_theu_*" — ảnh xem trước file thêu) có đúng yêu cầu đơn hàng hay không, TRƯỚC khi đưa vào sản xuất.', duLieu, dsAnh),
    '2. Yêu cầu CHÍNH là Design + Mockup + các ghi chú (ghi_chu, ghi_chu_xuong, ghi_chu_ve_file, ghi_chu_chay_may). Đơn có thể có 2-3 File thêu cho các vị trí/chi tiết khác nhau — đối chiếu tổng thể, mỗi phần của Design phải có trong File thêu tương ứng.',
    '3. Kiểm tra checked_items (PASS / FAIL / CAN_CHECK_LAI): design (đúng thiết kế, không đổi logo/hình dạng đáng kể), text (ĐỌC TỪNG KÝ TỰ: thiếu, sai, thừa ký tự, sai chính tả so với Design/ghi chú — rất quan trọng), chi_tiet (thiếu/thừa chi tiết), color (màu chỉ — CHỈ khi ghi chú/dữ liệu có thông tin màu chỉ hoặc mã chỉ; không có thì CAN_CHECK_LAI), size (kích thước — chỉ khi có số đo rõ, nếu không thì CAN_CHECK_LAI), ty_le (tỷ lệ/biến dạng so với Design: bị kéo dãn, bóp méo, phóng to/thu nhỏ sai từng phần), position (vị trí trên áo so với vi_tri_theu/ghi chú/mockup — File thêu không thể hiện vị trí thì CAN_CHECK_LAI), huong (xoay/lật ngược/đối xứng gương), design_mockup (Design và Mockup có nhất quán không: PASS nếu không mâu thuẫn; mâu thuẫn mà ghi chú không nói rõ bên nào đúng -> CAN_CHECK_LAI).',
    '4. Nếu Design và Mockup khác nhau: nêu rõ khác biệt, xem ghi chú để biết bên nào là yêu cầu chính thức; không tự ý chọn 1 nguồn khi chưa đủ căn cứ. Nhiều ảnh cùng có thể là Design mà không xác định được ảnh chính -> CAN_CHECK_LAI.',
    '5. Chỉ FAIL khi thấy RÕ lỗi. Ảnh mờ, bị cắt, không đủ để kết luận -> CAN_CHECK_LAI. Không kết luận kiểu "nhìn khá giống", không suy đoán kích thước/màu khi không có dữ liệu.',
    '6. result tổng: FAIL nếu có lỗi rõ ràng; PASS chỉ khi xác định được Design, và design, text, chi_tiet, huong, design_mockup đều PASS; còn lại CAN_CHECK_LAI.',
    '7. confidence từ 0 đến 1. issues và reason viết tiếng Việt, ngắn gọn, nêu cụ thể (vd ký tự nào sai, chi tiết nào thiếu, File thêu nào).',
  ].join('\n'),
};

const chayQc2 = sttKey => chayDoiChieu(sttKey, QC2);
const chayQc1 = sttKey => chayDoiChieu(sttKey, QC1);

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
    if (ketQua.reason) dong.push(`Lý do: ${escTg(ketQua.reason)}`);
    const vanDe = (ketQua.issues || []).slice(0, 8);
    if (vanDe.length) dong.push('Vấn đề:', ...vanDe.map(v => `• ${escTg(v)}`));
  }
  dong.push(`${model ? `Model: ${escTg(model)} · ` : 'Không gọi AI · '}Người chạy: ${escTg(nguoiChay)}`);
  return dong.join('\n');
}
function canhBaoTelegram(thongTin) {
  const chatId = caiDatDbService.layChatIdQc();
  if (!chatId) return;
  telegramService.guiTinNhan(chatId, taoTinCanhBao(thongTin)).catch(() => {});
}
async function guiThuTelegram() {
  const chatId = caiDatDbService.layChatIdQc();
  if (!chatId) throw loiNghiepVu('Chưa lưu Chat ID Telegram.');
  const kq = await telegramService.guiTinNhan(chatId, '✅ Thử cảnh báo AI QC — Chat ID này sẽ nhận cảnh báo FAIL / CẦN CHECK LẠI / LỖI API.');
  if (!kq || !kq.ok) throw loiNghiepVu((kq && kq.loi) || 'Gửi Telegram thất bại.');
}

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
    canhBaoTelegram({ loai, sttKey, model, nguoiChay: user.ten, loi: err.message });
    return { id, loai, sttKey, model, anh: [], ketQua: null, loi: err.message };
  }
  const k = kq.ketQua;
  const id = nhatKyDbService.ghiQcLog({
    ...dong, Model: kq.daGoiAi ? model : '',
    AnhDaDung: kq.anh.join('\n'), FileTheu: (kq.fileTheu || []).join('\n'), DesignFile: k.design_file || '', MockupFile: k.mockup_file || '',
    KetQua: k.result, DoTinCay: k.confidence, LyDo: k.reason,
    ChiTiet: JSON.stringify({ ket_qua: k, ai_goc: kq.aiGoc || null }),
  });
  if (k.result !== 'PASS') canhBaoTelegram({ loai, sttKey, model: kq.daGoiAi ? model : '', nguoiChay: user.ten, ketQua: k });
  return { id, loai, sttKey, model: kq.daGoiAi ? model : '', anh: kq.anh, ketQua: k, loi: null };
}

async function thuKetNoi(loai, nhaCungCap) {
  if (!LOAI_QC[loai]) throw loiNghiepVu('Loại QC không hợp lệ — chỉ QC1, QC2, QC3.');
  const ch = layCauHinh(loai, nhaCungCap);
  await aiProvider.thuKetNoi(ch, ch.nhaCungCap);
}

module.exports = { LOAI_QC, LOAI_DA_TRIEN_KHAI, MODEL_MAC_DINH, NHA_CUNG_CAP, layCauHinh, chayQc, thuKetNoi, guiThuTelegram, taoTinCanhBao, hoanThienKetQua3, hoanThienKetQuaDoiChieu, chuanHoaMa, khopMa };
