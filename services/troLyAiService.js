// Trợ lý AI (Claude) — dùng chung cho menu "Trợ lý" (routes/chatbot.js) và Telegram (services/telegramAiService.js).
// 23/10/2026, theo yêu cầu người dùng: đổi từ LLM tương thích OpenAI (.env LLM_API_URL) sang Claude (SDK @anthropic-ai/sdk); CHỈ superadmin;
// nhớ hội thoại; thêm dữ liệu vận hành (Trung tâm hành động, mua tracking, mạng, QC); CHỈ ĐỌC — không công cụ nào ghi / mua / đổi trạng thái.
// Cấu hình (Settings, CHỈ superadmin) lưu ở cai_dat_van_hanh: AI_API_KEY (không bao giờ trả về giao diện), AI_MODEL.
// Hội thoại giữ trong bộ nhớ máy chủ theo khoá ("web:<tên>" / "tg:<id>"), CHỈ NỐI THÊM (không sửa / cắt lịch sử — model Claude mới từ
// chối lịch sử bị sửa); quá 20 lượt hỏi hoặc 2 giờ không hỏi -> tự bắt đầu hội thoại mới. Restart máy chủ = mất hội thoại (chấp nhận).
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod.default || AnthropicMod;
const caiDat = require('./caiDatDbService');
const orderService = require('./orderService');
const khachHangService = require('./khachHangService');
const taiKhoanService = require('./taiKhoanService');
const { ghiLog, layLichSuTheoDon, layHoatDongGanDay } = require('./logService');
const { parseNgay, thoiGianVNISOString } = require('./dateUtils');

const MODEL = {
  'claude-opus-5-5': 'Claude Opus 5.5 — mạnh nhất ($4 / $20 mỗi triệu token vào / ra)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 — cân bằng ($2 / $10)',
  'claude-haiku-5-5': 'Claude Haiku 5.5 — rẻ, nhanh ($0.10 / $0.50)',
};
const MODEL_MAC_DINH = 'claude-opus-5-5';
const CO_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']); // từ chối an toàn -> máy chủ Anthropic tự chạy lại bằng model khác
const TOI_DA_VONG = 8; // số lượt "gọi công cụ rồi hỏi tiếp" tối đa / câu hỏi
const TOI_DA_LUOT = 20; // số câu hỏi / hội thoại
const HET_HAN_MS = 2 * 60 * 60 * 1000;

// ---------- Cấu hình ----------
function layCauHinh() {
  const c = caiDat.layCaiDatVanHanh();
  return { apiKey: c.AI_API_KEY || '', model: MODEL[c.AI_MODEL] ? c.AI_MODEL : MODEL_MAC_DINH };
}
function thongTinCauHinh() {
  const { apiKey, model } = layCauHinh();
  return { coApiKey: !!apiKey, apiKeyCuoi: apiKey ? apiKey.slice(-4) : '', model, dsModel: Object.entries(MODEL).map(([id, ten]) => ({ id, ten })) };
}
// apiKey: undefined / '' = giữ key cũ; null = xoá.
function luuCauHinh({ apiKey, model }) {
  const ghi = {};
  if (model !== undefined) {
    if (!MODEL[model]) throw new Error('Model không hợp lệ');
    ghi.AI_MODEL = model;
  }
  if (apiKey === null) ghi.AI_API_KEY = '';
  else if (apiKey) {
    if (!/^sk-ant-[\w-]{20,}$/.test(String(apiKey).trim())) throw new Error('API key Anthropic phải bắt đầu bằng "sk-ant-"');
    ghi.AI_API_KEY = String(apiKey).trim();
  }
  caiDat.datCaiDatVanHanh(ghi);
  _client = null;
}
let _client = null, _keyClient = '';
function client(apiKey) {
  if (!_client || _keyClient !== apiKey) { _client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120 * 1000 }); _keyClient = apiKey; }
  return _client;
}

// ---------- Mô tả nghiệp vụ (system prompt CỐ ĐỊNH — để cache; dữ liệu thay đổi đi kèm câu hỏi) ----------
const SYSTEM = [
  'Bạn là trợ lý dữ liệu của xưởng thêu (đơn thêu áo bán cho khách Mỹ / Anh), trả lời người quản lý bằng tiếng Việt, ngắn gọn, chính xác.',
  'Bạn CHỈ ĐỌC dữ liệu qua công cụ; không có công cụ nào mua tracking, đổi trạng thái hay sửa dữ liệu. Nếu được nhờ làm việc đó, nói rõ là phải làm trên app.',
  'Khi cần số liệu cụ thể, PHẢI gọi công cụ để lấy dữ liệu thật — không đoán, không bịa. Tra xong vẫn không thấy thì nói rõ là không tìm thấy.',
  'Câu trả lời có thể đọc trên điện thoại (Telegram): dùng câu ngắn, gạch đầu dòng khi liệt kê, không dùng bảng Markdown.',
  '',
  'Tiến trình đơn: 3 cột riêng — TRANG_THAI_XUONG (chung), TRANG_THAI_PHOI (lấy phôi), TRANG_THAI_VE_FILE (vẽ file); lấy phôi và vẽ file làm song song.',
  'TRANG_THAI_XUONG theo thứ tự: Chưa in mã → Đã in mã → ĐÃ SẴN SÀNG CHẠY MÁY (tự chuyển khi đã lấy phôi VÀ đã vẽ file) → Đang chạy máy → Đã sản xuất → ĐÃ DÁN TEM → DELIVERED_Đã giao đến khách.',
  'Nhánh rẽ: LỖI SẢN XUẤT CẦN LÀM LẠI, CANCELLED_Đã hủy, REFUNDED_Hoàn đơn. TRANG_THAI_PHOI: Chưa lấy phôi / Đã lấy phôi. TRANG_THAI_VE_FILE: Chưa vẽ file / Đang vẽ file / Đã vẽ file.',
  'Tracking: mua qua hãng GKE (mặc định), KL hoặc HPW; hệ thống tự mua GKE sau khi đơn "Đã sản xuất" đủ giờ, thử tối đa 10 lần rồi chuyển "mua thủ công".',
  'Mỗi đơn thuộc 1 Xưởng (HN, BN...). Đơn nhiều áo cùng khách (DonNhieuAo) có mã .1, .2... dùng chung 1 tracking của đơn .1.',
].join('\n');

// ---------- Công cụ (chỉ đọc) ----------
const CONG_CU = [
  { name: 'tra_cuu_don_hang', description: 'Chi tiết 1 đơn theo đúng mã đơn (STT_Key): khách, sản phẩm, trạng thái, Xưởng, tracking, hãng vận chuyển, trạng thái vận chuyển.',
    input_schema: { type: 'object', properties: { maDon: { type: 'string', description: 'Mã đơn (STT_Key), vd 10LH2216' } }, required: ['maDon'] } },
  { name: 'tim_don_hang', description: 'Tìm đơn theo điều kiện; trả tối đa 30 đơn gần nhất kèm tổng số khớp (nói rõ nếu còn nhiều hơn).',
    input_schema: { type: 'object', properties: {
      maKhachHang: { type: 'string', description: 'Mã hoặc tên khách, khớp gần đúng' },
      trangThai: { type: 'string', description: 'Đúng 1 giá trị TRANG_THAI_XUONG' },
      xuong: { type: 'string', description: 'Tên Xưởng, vd HN' },
      maDonChua: { type: 'string', description: 'Một phần mã đơn, vd "10SON"' },
      tuNgay: { type: 'string', description: 'Ngày lên đơn từ (YYYY-MM-DD)' },
      denNgay: { type: 'string', description: 'Ngày lên đơn đến (YYYY-MM-DD)' } } } },
  { name: 'thong_ke_don_hang', description: 'Đếm số đơn theo nhóm (trạng thái / khách hàng / loại sản phẩm / Xưởng), lọc được theo khoảng ngày lên đơn.',
    input_schema: { type: 'object', properties: {
      nhomTheo: { type: 'string', enum: ['trangThai', 'khachHang', 'loai', 'xuong'] },
      tuNgay: { type: 'string', description: 'YYYY-MM-DD' }, denNgay: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['nhomTheo'] } },
  { name: 'tra_cuu_khach_hang', description: 'Tìm khách hàng theo mã hoặc tên, khớp gần đúng.',
    input_schema: { type: 'object', properties: { tuKhoa: { type: 'string' } }, required: ['tuKhoa'] } },
  { name: 'tra_cuu_lich_su_don', description: 'Lịch sử thao tác / đổi trạng thái của 1 đơn (ai làm, lúc nào).',
    input_schema: { type: 'object', properties: { maDon: { type: 'string' } }, required: ['maDon'] } },
  { name: 'tra_cuu_nhan_vien', description: 'Danh sách nhân viên, vai trò, Xưởng.',
    input_schema: { type: 'object', properties: { vaiTro: { type: 'string', description: 'Lọc đúng 1 vai trò; bỏ trống = tất cả' } } } },
  { name: 'tra_cuu_hoat_dong_gan_day', description: 'Hoạt động gần đây trong toàn hệ thống, lọc được theo người dùng / loại hành động.',
    input_schema: { type: 'object', properties: { nguoiDung: { type: 'string' }, hanhDong: { type: 'string' }, gioiHan: { type: 'number', description: 'Tối đa 50' } } } },
  { name: 'trung_tam_hanh_dong', description: 'Các việc đang cần xử lý (như menu "Cần xử lý"): đơn ưu tiên chưa xử lý, lỗi sản xuất, đơn nhận quá lâu, vận chuyển bất thường, lỗi tracking, lỗi ghi Sheet Seller, đơn huỷ gần đây...',
    input_schema: { type: 'object', properties: {} } },
  { name: 'tinh_trang_mua_tracking', description: 'Tình trạng tự động mua tracking: số đơn theo trạng thái (đã mua, đến hạn, chuyển mua thủ công, GKE hết tiền, thiếu tài khoản...) và danh sách đơn.',
    input_schema: { type: 'object', properties: { trangThai: { type: 'string', description: 'Lọc 1 trạng thái, vd CHUYEN_THU_CONG, GKE_HET_TIEN, DEN_HAN_CHO_XU_LY' } } } },
  { name: 'tinh_hinh_mang_24h', description: 'Tốc độ mạng 24 giờ qua: độ trễ từ điện thoại ở xưởng, máy chủ tới Cloudflare, tốc độ gửi ảnh.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'ket_qua_qc', description: 'Kết quả AI QC (kiểm tra ảnh) gần nhất: của 1 đơn, hoặc lọc theo kết quả (PASS / FAIL / CAN_CHECK_LAI).',
    input_schema: { type: 'object', properties: { maDon: { type: 'string' }, ketQua: { type: 'string', enum: ['PASS', 'FAIL', 'CAN_CHECK_LAI', 'LOI'] }, gioiHan: { type: 'number', description: 'Tối đa 30' } } } },
];

function lamGonDon(r) {
  return {
    ma: r.STT_Key, maDonSan: r.MA_DON_HANG_ORDERID, kh: r.TenKhachHang || r.MA_KHACH_HANG,
    sanPham: r.TieuDeSanPham || orderService.tieuDeSanPham(r), viTriTheu: (r.ViTriTheu || orderService.danhSachViTriTheu(r) || []).join(', '),
    sl: r.SO_LUONG, ngayLenDon: r.NGAY_LEN_DON, xuong: r.XUONG, trangThai: r.TRANG_THAI_XUONG, phoi: r.TRANG_THAI_PHOI, veFile: r.TRANG_THAI_VE_FILE,
    tracking: r.TRACKING_ID, hangVanChuyen: r.HANG_VAN_CHUYEN, donViVanChuyen: r.DON_VI_VAN_CHUYEN || (r.TRACKING_ID ? 'GKE/Seller' : ''),
    trangThaiVanChuyen: r.TRANG_THAI_TRACKING, capNhatVanChuyen: r.THOI_GIAN_CAP_NHAT_TRACKING, nuoc: r.DIA_CHI_NUOC,
    ghiChu: r.GHI_CHU, ghiChuXuong: r.GHI_CHU_XUONG,
  };
}
function locTheoNgay(list, tuNgay, denNgay) {
  if (!tuNgay && !denNgay) return list;
  return list.filter(r => {
    const n = parseNgay(r.NGAY_LEN_DON);
    return n && !(tuNgay && n < parseNgay(tuNgay)) && !(denNgay && n > parseNgay(denNgay));
  });
}
const boHtml = s => String(s).replace(/<[^>]+>/g, '');
const catDs = (ds, n) => ({ tong: ds.length, ds: ds.slice(0, n) });

// ctx = { user, donTheoQuyen }
async function thucThi(ten, ts, ctx) {
  switch (ten) {
    case 'tra_cuu_don_hang': {
      const { row } = await orderService.getByKey(ts.maDon || '');
      if (!row || !orderService.coQuyenTheoXuong(ctx.user, row)) return { loi: `Không tìm thấy đơn "${ts.maDon}"` };
      const [r] = await orderService.ganTenKhachHang([row]);
      return lamGonDon(r);
    }
    case 'tim_don_hang': {
      let ds = ctx.donTheoQuyen;
      if (ts.maKhachHang) { const tk = String(ts.maKhachHang).toLowerCase(); ds = ds.filter(r => (r.MA_KHACH_HANG || '').toLowerCase().includes(tk) || (r.TenKhachHang || '').toLowerCase().includes(tk)); }
      if (ts.trangThai) ds = ds.filter(r => r.TRANG_THAI_XUONG === ts.trangThai);
      if (ts.xuong) ds = ds.filter(r => r.XUONG === ts.xuong);
      if (ts.maDonChua) { const m = String(ts.maDonChua).toUpperCase(); ds = ds.filter(r => String(r.STT_Key).toUpperCase().includes(m)); }
      ds = locTheoNgay(ds, ts.tuNgay, ts.denNgay);
      return { tongSoKhop: ds.length, ketQua: ds.slice(0, 30).map(lamGonDon) };
    }
    case 'thong_ke_don_hang': {
      const cot = { khachHang: 'TenKhachHang', loai: 'LOAI', xuong: 'XUONG' }[ts.nhomTheo] || 'TRANG_THAI_XUONG';
      const dem = {};
      locTheoNgay(ctx.donTheoQuyen, ts.tuNgay, ts.denNgay).forEach(r => { const v = r[cot] || '(Trống)'; dem[v] = (dem[v] || 0) + 1; });
      return dem;
    }
    case 'tra_cuu_khach_hang': {
      const tk = String(ts.tuKhoa || '').toLowerCase();
      return (await khachHangService.layDanhSachKhachHang()).filter(k => k.ma.toLowerCase().includes(tk) || k.ten.toLowerCase().includes(tk)).slice(0, 15);
    }
    case 'tra_cuu_lich_su_don': {
      const { row } = await orderService.getByKey(ts.maDon || '');
      if (!row || !orderService.coQuyenTheoXuong(ctx.user, row)) return { loi: `Không tìm thấy đơn "${ts.maDon}"` };
      return await layLichSuTheoDon(ts.maDon || '', ctx.user);
    }
    case 'tra_cuu_nhan_vien': {
      let ds = taiKhoanService.layTatCa().map(r => ({ ten: r.Ten, vaiTro: r.VaiTro, xuong: r.Xuong, kichHoat: r.KichHoat }));
      if (ts.vaiTro) ds = ds.filter(n => n.vaiTro === ts.vaiTro);
      return ds;
    }
    case 'tra_cuu_hoat_dong_gan_day':
      return await layHoatDongGanDay({ ...ts, gioiHan: Math.min(Number(ts.gioiHan) || 30, 50), locDon: orderService.phamViDon(ctx.user) });
    case 'trung_tam_hanh_dong': {
      const tt = await require('./actionCenterService').layTrungTamHanhDong(ctx.user);
      return Object.fromEntries(Object.entries(tt).map(([k, v]) => [k, Array.isArray(v) ? catDs(v, 15) : v]));
    }
    case 'tinh_trang_mua_tracking': {
      let ds = await require('./trackingAutoService').layDanhSachDonAutoTracking(ctx.user);
      const dem = {};
      ds.forEach(d => { dem[d.trangThai] = (dem[d.trangThai] || 0) + 1; });
      if (ts.trangThai) ds = ds.filter(d => d.trangThai === ts.trangThai);
      return { soDonTheoTrangThai: dem, ...catDs(ds.map(d => ({ ma: d.sttKey, trangThai: d.trangThai, tracking: d.trackingId, soLanThu: d.soLanThu, loiGanNhat: d.loiGanNhat })), 30) };
    }
    case 'tinh_hinh_mang_24h': {
      const bc = require('./baoCaoVanHanhService'), ms = Date.now();
      return { dienThoai: bc.thongKeMang(ms).dong.map(boHtml), mayChu: bc.thongKeMangMayChu(ms).dong.map(boHtml), duongTruyen: bc.thongKeDuongTruyen(ms).dong.map(boHtml) };
    }
    case 'ket_qua_qc': {
      const ds = require('./nhatKyDbService').layQcLog({ sttKey: ts.maDon || undefined, ketQua: ts.ketQua || undefined, gioiHan: Math.min(Number(ts.gioiHan) || 15, 30) });
      return ds.map(d => ({ luc: d.ThoiGian, ma: d.STT_Key, loai: d.LoaiQc, ketQua: d.KetQua, diem: d.Diem, lyDo: d.LyDo, danhGiaThucTe: d.DanhGiaThucTe }));
    }
    default:
      return { loi: 'Không có công cụ: ' + ten };
  }
}

// ---------- Hội thoại ----------
const _hoiThoai = new Map(); // khoa -> { messages, soLuot, lanCuoi }
const _dangTraLoi = new Set();
function batDauLai(khoa) { _hoiThoai.delete(khoa); }

const loiHienThi = err => {
  if (err instanceof Anthropic.AuthenticationError) return 'API key Anthropic không đúng hoặc đã bị thu hồi — kiểm tra ở Settings > Trợ lý AI.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'API key không có quyền dùng model này.';
  if (err instanceof Anthropic.RateLimitError) return 'Đang vượt giới hạn gọi API của Anthropic — thử lại sau ít phút.';
  if (err instanceof Anthropic.BadRequestError) return 'Anthropic từ chối yêu cầu: ' + err.message;
  if (err instanceof Anthropic.APIConnectionError) return 'Không kết nối được tới Anthropic (mạng quốc tế) — thử lại sau.';
  if (err instanceof Anthropic.APIError) return `Lỗi Anthropic (${err.status}): ${err.message}`;
  return 'Lỗi: ' + err.message;
};

// -> { traLoi, moiBatDau }. user = người hỏi (superadmin). nguon: 'web' | 'telegram' (ghi log).
async function hoi({ user, cauHoi, khoa, nguon }) {
  const cau = String(cauHoi || '').trim();
  if (!cau) throw new Error('Thiếu câu hỏi');
  const { apiKey, model } = layCauHinh();
  if (!apiKey) return { traLoi: 'Chưa có API key Anthropic — nhập ở Settings > Trợ lý AI.', moiBatDau: false };
  if (_dangTraLoi.has(khoa)) return { traLoi: 'Đang trả lời câu trước, đợi xong rồi hỏi tiếp nhé.', moiBatDau: false };
  _dangTraLoi.add(khoa);
  try {
    let ht = _hoiThoai.get(khoa);
    const moiBatDau = !!ht && (ht.soLuot >= TOI_DA_LUOT || Date.now() - ht.lanCuoi > HET_HAN_MS);
    if (!ht || moiBatDau) { ht = { messages: [], soLuot: 0, lanCuoi: 0 }; _hoiThoai.set(khoa, ht); }
    ht.soLuot++;
    ht.lanCuoi = Date.now();

    const { rows } = await orderService.getAll();
    const donTheoQuyen = await orderService.ganTenKhachHang(orderService.filterForRole(rows, user));
    const ctx = { user, donTheoQuyen };
    // Dữ liệu thay đổi theo lúc hỏi đi KÈM câu hỏi (không nằm trong system) — system + công cụ giữ nguyên để cache.
    const thongKe = {};
    donTheoQuyen.forEach(r => { const v = r.TRANG_THAI_XUONG || '(Trống)'; thongKe[v] = (thongKe[v] || 0) + 1; });
    ht.messages.push({ role: 'user', content: `[Lúc hỏi: ${thoiGianVNISOString().slice(0, 16).replace('T', ' ')} giờ VN. Số đơn theo trạng thái hiện tại: ${JSON.stringify(thongKe)}]\n\n${cau}` });

    let traLoi = '', tokVao = 0, tokRa = 0;
    for (let vong = 0; vong < TOI_DA_VONG; vong++) {
      const res = await client(apiKey).beta.messages.create({
        model, max_tokens: 16000, system: SYSTEM, tools: CONG_CU, messages: ht.messages,
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        ...(CO_FALLBACK.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      });
      tokVao += (res.usage.input_tokens || 0) + (res.usage.cache_read_input_tokens || 0) + (res.usage.cache_creation_input_tokens || 0);
      tokRa += res.usage.output_tokens || 0;
      if (res.stop_reason === 'refusal') {
        batDauLai(khoa); // không nối lượt bị từ chối vào lịch sử — hội thoại sau bắt đầu lại sạch
        traLoi = 'AI từ chối trả lời câu này. Hội thoại đã được bắt đầu lại.';
        break;
      }
      ht.messages.push({ role: 'assistant', content: res.content }); // nối NGUYÊN content (kể cả khối thinking)
      const chu = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (res.stop_reason === 'pause_turn') continue;
      const dsGoi = res.content.filter(b => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !dsGoi.length) {
        traLoi = chu + (res.stop_reason === 'max_tokens' ? '\n\n(Câu trả lời quá dài, đã bị cắt.)' : '');
        break;
      }
      const ketQua = await Promise.all(dsGoi.map(async g => {
        try { return { type: 'tool_result', tool_use_id: g.id, content: JSON.stringify(await thucThi(g.name, g.input || {}, ctx)) }; }
        catch (err) { return { type: 'tool_result', tool_use_id: g.id, is_error: true, content: 'Lỗi tra cứu: ' + err.message }; }
      }));
      ht.messages.push({ role: 'user', content: ketQua }); // mọi kết quả trong 1 lượt
    }
    if (!traLoi) {
      batDauLai(khoa); // lượt cuối còn đang chờ kết quả công cụ — lịch sử dở dang, bắt đầu lại cho sạch
      traLoi = 'Câu hỏi cần tra quá nhiều bước, chưa trả lời được — thử hỏi cụ thể hơn. Hội thoại đã được bắt đầu lại.';
    }
    await ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CHATBOT_HOI',
      chiTiet: { nguon, model, cauHoi: cau.slice(0, 500), traLoi: traLoi.slice(0, 300), tokenVao: tokVao, tokenRa: tokRa } });
    return { traLoi, moiBatDau };
  } catch (err) {
    batDauLai(khoa); // lịch sử có thể đang dở (đã nối câu hỏi / kết quả công cụ) — bắt đầu lại để lần sau không lỗi dây chuyền
    console.error(`[TroLyAi] Lỗi (${nguon}, ${user && user.ten}):`, err.message);
    return { traLoi: loiHienThi(err) + ' Hội thoại đã được bắt đầu lại.', moiBatDau: true, loi: true };
  } finally {
    _dangTraLoi.delete(khoa);
  }
}

module.exports = { hoi, batDauLai, thongTinCauHinh, luuCauHinh, CONG_CU, thucThi, MODEL };
