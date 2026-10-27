// Tích hợp HPW / VNEpacket (api.vnepacket.com.vn) — 22/10/2026, theo yêu cầu người dùng. CHỈ phần gọi API + chuẩn bị dữ liệu; luồng mua /
// in label ở services/trackingHpwService.js. Theo tài liệu Postman "VNEpacket API Document" + người dùng xác nhận 22/10/2026:
//   - Đăng nhập: POST /me { username, password } -> access_token, gửi "Authorization: Bearer <token>". Tài liệu KHÔNG ghi hạn token ->
//     giữ trong bộ nhớ, bị từ chối (401/403) thì đăng nhập lại ĐÚNG 1 lần.
//   - Mua 2 bước: POST /shipment/create -> shipment.reference_id (trạng thái "pending", giá dự tính, address_suggestions); rồi
//     GET /shipment/buy-label/{reference_id} -> tracking_number, carrier, label_path (PDF 100x150mm), total.
//   - Gửi trùng ShippingReferenceId: HPW BÁO LỖI, không tạo lô mới (người dùng xác nhận). KHÔNG có API tìm lô theo mã đơn -> mã lô phải
//     lưu NGAY khi tạo xong (trackingHpwService).
//   - Đơn vị: cân nặng gram, kích thước cm, Price $ (người dùng xác nhận).
//   - CHƯA BIẾT: tạo lô / mua label lúc nào trừ tiền, hạn token, dạng lỗi (HTTP lỗi hay 200 + status khác "success") -> xử lý cả 2 dạng,
//     không bao giờ tự gửi lại lệnh tạo lô / mua label.
//   - GET /shipment/get/{ref} KHÔNG có ví dụ phản hồi -> đọc thận trọng (nhiều tên trường), thiếu thì xem thêm /tracking/get/{ref}.
// Log "[HPW] [bước] ..." (console + nhatKy) — KHÔNG BAO GIỜ in password / token.
const caiDatDbService = require('./caiDatDbService');

const BASE_URL = 'https://api.vnepacket.com.vn';
const TIMEOUT_MS = 45000;
const DON_VI_HPW = 'HPW';
const SDT_MAC_DINH_KHI_THIEU = '0000000000'; // HPW bắt buộc SĐT — như GKE: chỉ dùng cho lượt gửi, không ghi vào Sheet
// Đang mua HPW: đã gửi lệnh mà chưa rõ kết quả, hoặc đã tạo lô (có mã) mà chưa mua label (vd dừng vì gợi ý sửa địa chỉ). Mua GKE / KL,
// job tự mua GKE, xuất Excel GKE đều bỏ qua đơn này (1 đơn chỉ 1 hãng).
const dangMuaHpw = r => !!(r && (r.HPW_DANG_TAO || (r.HPW_REFERENCE_ID && !r.TRACKING_ID)));

const loiChung = msg => Object.assign(new Error(msg), { loiChung: true });
const { moTaLoiMang } = require('./loiMangUtils');
const ghi = (nhatKy, dong) => { console.log(dong); if (nhatKy) nhatKy.push(dong); };

// ---- Tài khoản theo Xưởng ----
function layCauHinhHpwChoDon(row) {
  let id = row.TAI_KHOAN_HPW;
  if (!id) {
    if (!row.XUONG) throw loiChung(`[tài khoản HPW] Đơn ${row.STT_Key} chưa gán Xưởng — không xác định được tài khoản HPW.`);
    id = caiDatDbService.layGanTaiKhoanHpw()[row.XUONG];
    if (!id) throw loiChung(`[tài khoản HPW] Xưởng "${row.XUONG}" chưa được gán tài khoản HPW — vào Settings > Tài khoản HPW để gán.`);
  }
  const d = caiDatDbService.layTaiKhoanHpw(id);
  if (!d) throw loiChung(`[tài khoản HPW] Tài khoản HPW #${id} (dùng cho đơn ${row.STT_Key}) không còn tồn tại — kiểm tra lại ở Settings.`);
  if (!d.Username || !d.Password) throw loiChung(`[tài khoản HPW] Tài khoản "${d.Ten}" chưa có username / password — cập nhật ở Settings.`);
  return {
    id: String(d.id), ten: d.Ten, username: d.Username, password: d.Password,
    labelServiceUs: d.LabelServiceUs, labelServiceUk: d.LabelServiceUk,
    daiCm: Number(d.DaiCm), rongCm: Number(d.RongCm), caoCm: Number(d.CaoCm), hsCode: d.HsCode, tenHang: d.TenHang, skuHang: d.SkuHang,
    giaHangUsd: Number(d.GiaHangUsd), canNangMoiAoGram: Number(d.CanNangMoiAoGram),
  };
}
const TRUONG_TK_HPW = [['ten', 'Ten'], ['username', 'Username'], ['labelServiceUs', 'LabelServiceUs'], ['labelServiceUk', 'LabelServiceUk'],
  ['daiCm', 'DaiCm'], ['rongCm', 'RongCm'], ['caoCm', 'CaoCm'], ['hsCode', 'HsCode'], ['tenHang', 'TenHang'], ['skuHang', 'SkuHang'],
  ['giaHangUsd', 'GiaHangUsd'], ['canNangMoiAoGram', 'CanNangMoiAoGram']];
// Settings (CHỈ superadmin): password KHÔNG trả về giao diện; lưu password rỗng = giữ cũ.
function layDanhSachTaiKhoanHpw() {
  return {
    taiKhoan: caiDatDbService.layDanhSachTaiKhoanHpw().map(d => ({
      id: String(d.id), ...Object.fromEntries(TRUONG_TK_HPW.map(([k, c]) => [k, d[c]])), coPassword: !!d.Password,
    })),
    danhSachXuong: caiDatDbService.layDanhSachXuong(),
    ganXuong: caiDatDbService.layGanTaiKhoanHpw(),
  };
}
function luuTaiKhoanHpw(id, giaTri) {
  const ghiDb = Object.fromEntries(TRUONG_TK_HPW.map(([k, c]) => [c, String(giaTri[k] ?? '').trim()]));
  const password = String(giaTri.password ?? '').trim();
  if (password) ghiDb.Password = password;
  const thieu = [];
  if (!ghiDb.Ten) thieu.push('tên tài khoản');
  if (!ghiDb.Username) thieu.push('username');
  if (!ghiDb.LabelServiceUs) thieu.push('dịch vụ cho đơn US');
  if (!ghiDb.LabelServiceUk) thieu.push('dịch vụ cho đơn UK');
  if (!ghiDb.HsCode) thieu.push('HSCODE');
  if (!ghiDb.TenHang) thieu.push('tên hàng');
  if (!ghiDb.SkuHang) thieu.push('SKU');
  for (const [c, nhan] of [['DaiCm', 'dài (cm)'], ['RongCm', 'rộng (cm)'], ['CaoCm', 'cao (cm)'], ['GiaHangUsd', 'giá khai báo ($)'], ['CanNangMoiAoGram', 'cân nặng mỗi áo (gram)']]) {
    if (!(Number(ghiDb[c]) > 0)) thieu.push(`${nhan} phải là số > 0`);
  }
  if (thieu.length) throw new Error('Thiếu / sai: ' + thieu.join(', '));
  if (id && !caiDatDbService.layTaiKhoanHpw(id)) throw new Error('Không tìm thấy tài khoản');
  if (!id && !password) throw new Error('Thiếu password');
  const moiId = String(caiDatDbService.ghiTaiKhoanHpw(id, ghiDb));
  tokenCache.delete(moiId); // đổi username / password -> đăng nhập lại
  return moiId;
}
// Dịch vụ theo tài liệu HPW — chỉ để CẢNH BÁO (không chặn: HPW có thể xác nhận tên khác, vd cho đơn UK).
const DICH_VU_HPW = ['US Standard', 'US Premium', 'Outside US', 'US Oversize', 'US Defer', 'US Pre Track'];
function canhBaoDichVuHpw(giaTri) {
  const la = [['dịch vụ đơn US', giaTri.labelServiceUs], ['dịch vụ đơn UK', giaTri.labelServiceUk]]
    .filter(([, v]) => v && !DICH_VU_HPW.includes(String(v).trim()));
  return la.length ? `Lưu ý: ${la.map(([n, v]) => `${n} "${String(v).trim()}"`).join(', ')} không có trong danh sách tài liệu HPW (${DICH_VU_HPW.join(', ')}) — kiểm tra đúng chính tả / hoa thường, sai thì HPW sẽ từ chối khi mua.` : '';
}
function xoaTaiKhoanHpw(id) {
  const dangGan = Object.entries(caiDatDbService.layGanTaiKhoanHpw()).filter(([, v]) => v === String(id)).map(([x]) => x);
  if (dangGan.length) throw new Error(`Tài khoản đang được gán cho Xưởng: ${dangGan.join(', ')} — bỏ gán trước khi xoá.`);
  caiDatDbService.xoaTaiKhoanHpw(id);
  tokenCache.delete(String(id));
}
function ganTaiKhoanHpwChoXuong(xuong, id) {
  if (!caiDatDbService.layDanhSachXuong().includes(xuong)) throw new Error(`Xưởng không hợp lệ: "${xuong}"`);
  if (id && !caiDatDbService.layTaiKhoanHpw(id)) throw new Error('Không tìm thấy tài khoản');
  caiDatDbService.ganTaiKhoanHpwChoXuong(xuong, id);
}

// ---- Gọi API ----
const tokenCache = new Map(); // id tài khoản -> access_token
async function fetchHpw(buoc, method, url, { headers = {}, body, nhatKy } = {}) {
  const huy = new AbortController();
  const hen = setTimeout(() => huy.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method, signal: huy.signal, headers, body });
  } catch (err) {
    const quaGio = err.name === 'AbortError';
    const loiMang = moTaLoiMang(err);
    ghi(nhatKy, `[HPW] [${buoc}] ${quaGio ? `Quá thời gian chờ (${TIMEOUT_MS / 1000}s)` : `Lỗi mạng: ${loiMang}`}`);
    throw Object.assign(new Error(`[${buoc}] ${quaGio ? `HPW không trả lời trong ${TIMEOUT_MS / 1000} giây` : `Lỗi kết nối tới HPW: ${loiMang}`}`), { khongRoKetQua: true });
  } finally {
    clearTimeout(hen);
  }
}
const docJson = async res => { const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* không phải JSON */ } return { data, text }; };
const lyDoLoi = (data, text, res) => {
  const d = data && typeof data === 'object' ? data : {};
  const ds = Array.isArray(d.errors) ? d.errors.map(e => (typeof e === 'string' ? e : e.message || JSON.stringify(e))).join('; ') : '';
  return String(d.message || d.error || ds || d.detail || (text || '').slice(0, 200) || `HTTP ${res.status}`);
};
const thanhCong = data => !!data && String(data.status || '').toLowerCase() === 'success';

async function layToken(ch, nhatKy, { lamMoi = false } = {}) {
  if (!lamMoi && tokenCache.has(ch.id)) return tokenCache.get(ch.id);
  ghi(nhatKy, `[HPW] [đăng nhập] Tài khoản "${ch.ten}" (id ${ch.id})`);
  const res = await fetchHpw('đăng nhập', 'POST', `${BASE_URL}/me`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ch.username, password: ch.password }), nhatKy });
  const { data, text } = await docJson(res);
  if (!res.ok || !thanhCong(data) || !data.access_token) throw loiChung(`[đăng nhập] Đăng nhập HPW thất bại: ${lyDoLoi(data, text, res)}`);
  tokenCache.set(ch.id, data.access_token);
  return data.access_token;
}
// Gọi API có token; bị từ chối 401/403 -> đăng nhập lại và thử ĐÚNG 1 lần (chưa có thay đổi gì phía HPW vì yêu cầu bị từ chối).
async function goi(buoc, method, path, ch, { body, nhatKy } = {}, daThuLai = false) {
  const token = await layToken(ch, nhatKy, { lamMoi: daThuLai });
  ghi(nhatKy, `[HPW] [${buoc}] Gọi ${method} ${path}`);
  const res = await fetchHpw(buoc, method, BASE_URL + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, nhatKy,
  });
  if ((res.status === 401 || res.status === 403) && !daThuLai) {
    ghi(nhatKy, `[HPW] [${buoc}] Token bị từ chối (HTTP ${res.status}) — đăng nhập lại, thử 1 lần`);
    return goi(buoc, method, path, ch, { body, nhatKy }, true);
  }
  const { data, text } = await docJson(res);
  ghi(nhatKy, `[HPW] [${buoc}] Phản hồi: HTTP ${res.status}${data && data.status ? `, status=${data.status}` : ''}${data === null && text ? ' (không phải JSON)' : ''}`);
  return { res, data, text };
}

// Tạo lô hàng. -> { referenceId, total, goiY: [chuỗi địa chỉ gợi ý] }. Mất phản hồi / 5xx -> err.khongRoKetQua. KHÔNG thử lại.
async function taoLoHang(body, ch, nhatKy) {
  ghi(nhatKy, `[HPW] [tạo lô hàng] Body: ${JSON.stringify(body)}`);
  const { res, data, text } = await goi('tạo lô hàng', 'POST', '/shipment/create', ch, { body, nhatKy });
  const sh = data && data.shipment;
  if (res.ok && thanhCong(data) && sh && sh.reference_id) {
    const goiY = (Array.isArray(data.address_suggestions) ? data.address_suggestions : [])
      .map(g => (g && (g.FullAddress || [g.StreetLine, g.Secondary, g.City, g.State, g.ZipCode].filter(Boolean).join(' '))) || '').filter(Boolean);
    return { referenceId: String(sh.reference_id), total: sh.total ?? null, goiY };
  }
  if ((res.ok && thanhCong(data)) || res.status >= 500) {
    throw Object.assign(new Error(`[tạo lô hàng] ${res.ok ? 'HPW báo thành công nhưng thiếu mã lô hàng' : `HPW lỗi máy chủ (HTTP ${res.status}): ${lyDoLoi(data, text, res)}`}`), { khongRoKetQua: true });
  }
  throw new Error(`[tạo lô hàng] HPW từ chối: ${lyDoLoi(data, text, res)}`);
}

// Mua label cho lô đã tạo (CÓ THỂ trừ tiền). -> { tracking, carrier, labelPath, total }. KHÔNG thử lại.
async function muaLabel(referenceId, ch, nhatKy) {
  const { res, data, text } = await goi('mua label', 'GET', `/shipment/buy-label/${encodeURIComponent(referenceId)}`, ch, { nhatKy });
  const sh = data && data.shipment;
  if (res.ok && thanhCong(data) && sh && sh.tracking_number) {
    return { tracking: String(sh.tracking_number), carrier: sh.carrier ? String(sh.carrier) : '', labelPath: sh.label_path ? String(sh.label_path) : '', total: sh.total ?? null };
  }
  if ((res.ok && thanhCong(data)) || res.status >= 500) {
    throw Object.assign(new Error(`[mua label] ${res.ok ? 'HPW báo thành công nhưng thiếu mã tracking' : `HPW lỗi máy chủ (HTTP ${res.status}): ${lyDoLoi(data, text, res)}`}`), { khongRoKetQua: true });
  }
  throw new Error(`[mua label] HPW từ chối: ${lyDoLoi(data, text, res)}`);
}

// Xem lô hàng đã có tracking (đã mua label) chưa — trước khi mua label (tránh mua 2 lần sau lần mất phản hồi) và khi gắn mã lô tay.
// /shipment/get KHÔNG có mẫu phản hồi -> đọc nhiều tên trường; chưa thấy tracking thì xem /tracking/get (có mẫu). -> { tonTai, tracking,
// carrier, labelPath, total, trangThai }. Không xác định được (lỗi cả 2) -> ném lỗi (nơi gọi KHÔNG mua tiếp).
const lay = (o, ...k) => { for (const x of k) if (o && o[x] != null && o[x] !== '') return o[x]; return null; };
async function xemLoHang(referenceId, ch, nhatKy) {
  const kq = { tonTai: false, tracking: '', carrier: '', labelPath: '', total: null, trangThai: '', maGui: '' };
  let loi1 = null;
  try {
    const { res, data, text } = await goi('xem lô hàng', 'GET', `/shipment/get/${encodeURIComponent(referenceId)}`, ch, { nhatKy });
    // Lỗi chỉ khi "status" là trạng thái LỖI của gói phản hồi — "cancelled" / "pending"... ở phản hồi phẳng là trạng thái LÔ, vẫn đọc tiếp.
    if (res.ok && data && typeof data === 'object' && !/^(error|fail|failed)$/i.test(String(data.status || ''))) {
      // Phản hồi phẳng (không bọc shipment / data): "status" có thể là trạng thái GÓI phản hồi (success / error) hoặc trạng thái LÔ (pending,
      // cancelled...) — chỉ bỏ khi là trạng thái gói.
      const laTrangThaiGoi = /^(success|error|fail|failed|ok)$/i.test(String(data.status || ''));
      const o = (data.shipment && typeof data.shipment === 'object' && data.shipment) || (data.data && typeof data.data === 'object' && data.data)
        || (laTrangThaiGoi ? { ...data, status: undefined } : data);
      Object.assign(kq, {
        tonTai: true,
        tracking: String(lay(o, 'tracking_number', 'TrackingNumber', 'trackingNumber') || ''),
        carrier: String(lay(o, 'carrier', 'Carrier') || ''),
        labelPath: String(lay(o, 'label_path', 'LabelPath', 'labelPath') || ''),
        total: lay(o, 'total', 'Total'),
        trangThai: String(lay(o, 'shipment_status', 'ShipmentStatus', 'status') || ''),
        maGui: String(lay(o, 'ShippingReferenceId', 'shipping_reference_id', 'shippingReferenceId') || ''), // mã đơn của mình trên lô (nếu HPW trả)
      });
      if (kq.tracking) return kq;
    } else {
      loi1 = `HTTP ${res.status}: ${lyDoLoi(data, text, res)}`;
    }
  } catch (err) {
    loi1 = err.message;
  }
  try {
    const { res, data, text } = await goi('xem tracking', 'GET', `/tracking/get/${encodeURIComponent(referenceId)}`, ch, { nhatKy });
    const tr = data && data.tracking;
    if (res.ok && thanhCong(data) && tr) {
      kq.tonTai = true;
      if (tr.tracking_number) Object.assign(kq, { tracking: String(tr.tracking_number), carrier: kq.carrier || String(tr.carrier || ''), labelPath: kq.labelPath || String(tr.label_path || '') });
      return kq;
    }
    if (kq.tonTai) return kq; // /shipment/get đọc được (chưa có tracking), /tracking/get báo chưa có -> chưa mua label
    throw new Error(`HTTP ${res.status}: ${lyDoLoi(data, text, res)}`);
  } catch (err) {
    if (kq.tonTai) return kq;
    throw new Error(`[xem lô hàng] Không xác định được lô ${referenceId} trên HPW (${loi1 || '?'} / ${err.message})`);
  }
}

// Lô đã huỷ (trạng thái lô có "cancel"). Trạng thái "success" của gói phản hồi KHÔNG phải trạng thái lô -> chỉ xét shipment_status.
const laLoDaHuy = lh => !!lh && !lh.tracking && /cancel/i.test(lh.trangThai || '');
// Lỗi "trùng mã đơn" (ShippingReferenceId đã tồn tại) — HPW không công bố mã lỗi, nhận theo chữ. CHẶT: chỉ "duplicate" / "already exists /
// used" / "đã tồn tại" / "trùng" — KHÔNG nhận "exist" đơn lẻ (lỗi dữ liệu kiểu "Postal code does not exist" không phải trùng mã).
const laLoiTrungMa = msg => {
  const s = String(msg || '');
  if (/not\s+exist|does\s+not|doesn't/i.test(s)) return false;
  return /duplicate|already\s+(exist|used|taken|been)|đã tồn tại|trùng/i.test(s);
};

async function huyLoHang(referenceId, ch, nhatKy) {
  const { res, data, text } = await goi('huỷ lô hàng', 'GET', `/shipment/cancel/${encodeURIComponent(referenceId)}`, ch, { nhatKy });
  if (!res.ok || !thanhCong(data)) throw new Error(`[huỷ lô hàng] HPW từ chối: ${lyDoLoi(data, text, res)}`);
}

// Label PDF (base64): ưu tiên label_path (link PDF HPW trả lúc mua label — chỉ gửi kèm token nếu link thuộc tên miền HPW), không được thì
// GET /download-label/{reference_id}. Không phải PDF -> lỗi kèm loại + nội dung đầu.
const laTenMienHpw = u => { try { return /(^|\.)vnepacket\.com\.vn$/i.test(new URL(u).hostname); } catch { return false; } };
async function layLabelHpw(referenceId, labelPath, ch, nhatKy) {
  const thu = [];
  if (labelPath && /^https:\/\//i.test(labelPath)) thu.push({ url: labelPath, coToken: laTenMienHpw(labelPath) });
  thu.push({ url: `${BASE_URL}/download-label/${encodeURIComponent(referenceId)}`, coToken: true });
  const loi = [];
  for (const { url, coToken } of thu) {
    try {
      const headers = coToken ? { Authorization: `Bearer ${await layToken(ch, nhatKy)}` } : {};
      ghi(nhatKy, `[HPW] [lấy label] Tải ${url.replace(/\?.*$/, '')}`);
      const res = await fetchHpw('lấy label', 'GET', url, { headers, nhatKy });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.slice(0, 5).toString('latin1') === '%PDF-') return buf.toString('base64');
      loi.push(`${url.includes('/download-label/') ? 'download-label' : 'label_path'}: HTTP ${res.status}, ${res.headers.get('content-type') || '?'}, ${buf.slice(0, 120).toString('utf8').replace(/\s+/g, ' ')}`);
    } catch (err) {
      loi.push(err.message);
    }
  }
  ghi(nhatKy, `[HPW] [lấy label] Không lấy được PDF: ${loi.join(' | ')}`);
  throw new Error(`[lấy label] Không lấy được label PDF từ HPW — ${loi.join(' | ')}`);
}

// Sự kiện tracking: mới nhất = ngày lớn nhất (không dựa vào thứ tự). Đã giao = mô tả có "DELIVERED" (không phải "NOT DELIVERED"/"UNDELIVERABLE").
async function layTrackingHpw(referenceId, ch, nhatKy) {
  const { res, data, text } = await goi('tra tracking', 'GET', `/tracking/get/${encodeURIComponent(referenceId)}`, ch, { nhatKy });
  if (!res.ok || !thanhCong(data)) throw new Error(`[tra tracking] HPW từ chối: ${lyDoLoi(data, text, res)}`);
  const ev = data.tracking && data.tracking.events;
  const ds = ev && Array.isArray(ev.statusDetails) ? ev.statusDetails : (Array.isArray(ev) ? ev : []);
  return ds.filter(e => e && e.description);
}
const suKienMoiNhat = ds => ds.reduce((a, b) => (!a || new Date(String(b.date).replace(' ', 'T')) > new Date(String(a.date).replace(' ', 'T')) ? b : a), null);
const laDaGiao = moTa => /\bDELIVERED\b/i.test(moTa || '') && !/NOT DELIVERED|UNDELIVER/i.test(moTa || '');

// ---- Chuẩn bị dữ liệu lô hàng ----
// maGui = ShippingReferenceId (STT_Key, hoặc STT_Key-2... sau khi huỷ lô). Chỉ US / UK (người dùng chốt). Kiểm tra đủ rồi báo 1 lần, không tự sửa.
const QUOC_GIA_HPW = ['US', 'GB']; // dùng cả ở trackingAutoService#ngoaiQuocGiaHang
function taoBodyHpw(row, dsDon, ch, maGui, { maQuocGia, maBangMy }) {
  const loi = [];
  const s = v => String(v ?? '').trim();
  let quocGia = null;
  try { quocGia = maQuocGia(row.DIA_CHI_NUOC); } catch { /* báo bên dưới */ }
  if (!QUOC_GIA_HPW.includes(quocGia)) loi.push(`HPW chỉ mua cho đơn giao tới Mỹ (US) hoặc Anh (UK) — đơn có quốc gia "${s(row.DIA_CHI_NUOC) || '(trống)'}"`);
  const name = s(row.TEN), address1 = s(row.DIA_CHI_TEN_DUONG || row.TEN_DIA_CHI), city = s(row.DIA_CHI_TEN_TP);
  if (!name) loi.push('thiếu tên người nhận (TEN)');
  if (!address1) loi.push('thiếu địa chỉ (DIA_CHI_TEN_DUONG)');
  if (!city) loi.push('thiếu thành phố (DIA_CHI_TEN_TP)');
  let state = '';
  if (quocGia === 'US') {
    state = maBangMy(row.DIA_CHI_BANG) || '';
    if (!state) loi.push(`bang (DIA_CHI_BANG) "${s(row.DIA_CHI_BANG) || '(trống)'}" không nhận ra được mã 2 chữ của Mỹ`);
  } else if (quocGia === 'GB') {
    state = s(row.DIA_CHI_BANG);
    if (!state) loi.push('đơn UK thiếu bang / hạt (DIA_CHI_BANG) — HPW bắt buộc'); // người dùng chốt: báo lỗi, không đoán
  }
  let postal = s(row.MA_ZIPCODE);
  if (quocGia === 'US' && /^\d{4}(-\d{4})?$/.test(postal)) postal = '0' + postal; // ZIP Mỹ mất số 0 đầu — như GKE / KL
  if (!postal) loi.push('thiếu mã bưu điện (MA_ZIPCODE)');
  const labelService = quocGia === 'GB' ? ch.labelServiceUk : ch.labelServiceUs;
  if (!labelService) loi.push(`tài khoản HPW "${ch.ten}" chưa chọn dịch vụ cho đơn ${quocGia === 'GB' ? 'UK' : 'US'}`);
  for (const [k, nhan] of [['daiCm', 'dài'], ['rongCm', 'rộng'], ['caoCm', 'cao'], ['giaHangUsd', 'giá khai báo'], ['canNangMoiAoGram', 'cân nặng mỗi áo']]) {
    if (!(ch[k] > 0)) loi.push(`tài khoản HPW "${ch.ten}" thiếu ${nhan}`);
  }
  if (loi.length) throw loiChung(`[chuẩn bị dữ liệu HPW] Đơn ${row.STT_Key}: ${loi.join('; ')}.`);

  // Cân nặng (gram): TRONG_LUONG (kg / áo) × SO_LUONG; thiếu -> cân nặng mỗi áo của tài khoản. 1 mục hàng cho cả kiện.
  let gram = 0, soAo = 0;
  for (const d of dsDon) {
    const sl = Number(d.SO_LUONG) || 1;
    const kg = Number(d.TRONG_LUONG);
    gram += sl * (kg > 0 ? kg * 1000 : ch.canNangMoiAoGram);
    soAo += sl;
  }
  gram = Math.max(1, Math.round(gram));
  return {
    ShippingReferenceId: maGui, ShippingName: name, ShippingPhone: s(row.SDT) || SDT_MAC_DINH_KHI_THIEU,
    ShippingAddress1: address1, ShippingAddress2: s(row.DIA_CHI_TEN_DUONG_2), ShippingCity: city, ShippingState: state,
    ShippingPostalCode: postal, ShippingCountry: quocGia, ShippingOverrideAddress: false,
    DimensionWeight: gram, DimensionHeight: ch.caoCm, DimensionWidth: ch.rongCm, DimensionLength: ch.daiCm,
    ShipmentItems: [{
      ItemName: ch.tenHang, ItemSKU: ch.skuHang, HSCODE: ch.hsCode,
      Weight: Math.max(1, Math.round(gram / soAo)), Quantity: soAo, Price: ch.giaHangUsd,
    }],
    LabelService: labelService,
  };
}
// Mã gửi kế tiếp sau khi huỷ lô: 10U5 -> 10U5-2 -> 10U5-3 ...
const maGuiKeTiep = (sttKey, maGuiCu) => {
  const m = String(maGuiCu || '').match(/-(\d+)$/);
  return `${sttKey}-${m && String(maGuiCu).startsWith(`${sttKey}-`) ? Number(m[1]) + 1 : 2}`;
};

module.exports = {
  DON_VI_HPW, BASE_URL, dangMuaHpw, QUOC_GIA_HPW,
  layCauHinhHpwChoDon, layDanhSachTaiKhoanHpw, luuTaiKhoanHpw, canhBaoDichVuHpw, DICH_VU_HPW, xoaTaiKhoanHpw, ganTaiKhoanHpwChoXuong,
  taoLoHang, muaLabel, xemLoHang, huyLoHang, laLoDaHuy, laLoiTrungMa, layLabelHpw, layTrackingHpw, suKienMoiNhat, laDaGiao, taoBodyHpw, maGuiKeTiep,
};
