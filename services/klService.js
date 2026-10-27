// Tích hợp KL Logistics (api.klportal.com) — 22/10/2026, theo yêu cầu người dùng. CHỈ phần gọi API + chuẩn bị dữ liệu; luồng mua / in label
// ở services/trackingKlService.js. Theo tài liệu "KL Logistics API Doc" + người dùng xác nhận 22/10/2026:
//   - Xác thực: header "Authorization: Bearer <token>" — token = API key tạo trên trang KL (không có bước đăng nhập như GKE).
//   - Tạo đơn = mua tracking: POST /api/v1/orders -> { status: "success", barcode (= mã tracking), shipping_partner ("1" USPS, "5" DHL),
//     sid (mã đơn KL), usd, vnd (phí) }. weight tính bằng GRAM. country chỉ nhận "US".
//   - KL KHÔNG cho tạo 2 đơn cùng orderNumber (báo trên hệ thống); GET /api/v1/orders?filter=<orderNumber> khớp ĐÚNG -> trước khi tạo luôn
//     tra theo mã đơn: đã có thì dùng lại / báo lỗi, KHÔNG tạo lần 2.
//   - Label: GET /api/v1/orders/labels/<sid> trả PDF (người dùng xác nhận, chưa có file mẫu) — nhận khác PDF thì báo lỗi kèm nội dung đầu
//     để chỉnh code khi có mẫu, KHÔNG đoán định dạng khác.
//   - Tracking: GET /api/v1/tracking?filter=<barcode> -> mảng sự kiện { description, eventTime, location, trackingComplete }.
//   - CHƯA BIẾT (người dùng chưa xác nhận được với KL): tạo đơn thất bại trả HTTP lỗi hay 200 + status "failed", có tính phí không ->
//     xử lý CẢ 2 dạng; không bao giờ tự thử lại lệnh tạo đơn.
// Log: mọi bước in "[KL] [bước] ..." (console + mảng nhatKy cho cột ChiTiet LogsTracking) — KHÔNG BAO GIỜ in token.
const caiDatDbService = require('./caiDatDbService');

const BASE_URL = 'https://api.klportal.com';
const TIMEOUT_MS = 45000;
// Cột KL_DANG_TAO (trangThaiDbService) ghi lúc gửi NGAY TRƯỚC lệnh tạo đơn KL — mất phản hồi (quá giờ, mất mạng, máy chủ khởi động lại) vẫn
// biết là ĐÃ GỬI; lượt sau tra lại trên KL trước. Job tự mua GKE / nút mua GKE / xuất Excel GKE bỏ qua đơn này (không mua cả 2 hãng).
const dangTaoDonKl = r => !!(r && r.KL_DANG_TAO);
const DON_VI_KL = 'KL';
const GIOI_HAN = { orderNumber: 14, name: 30, phone: 80, address1: 40, address2: 40, city: 40 };

const loiChung = msg => Object.assign(new Error(msg), { loiChung: true });
const ghi = (nhatKy, dong) => { console.log(dong); if (nhatKy) nhatKy.push(dong); };

// ---- Tài khoản theo Xưởng (cùng khuôn gkeService.layCauHinhGkeChoDon) ----
// (1) tài khoản ĐÃ tạo đơn KL (TAI_KHOAN_KL) — lấy label / tra trạng thái dùng đúng tài khoản đó; (2) chưa tạo -> tài khoản gán cho Xưởng.
// Không xác định được -> lỗi rõ ràng, KHÔNG dùng tài khoản Xưởng khác.
function layCauHinhKlChoDon(row) {
  let id = row.TAI_KHOAN_KL;
  if (!id) {
    if (!row.XUONG) throw loiChung(`[tài khoản KL] Đơn ${row.STT_Key} chưa gán Xưởng — không xác định được tài khoản KL.`);
    id = caiDatDbService.layGanTaiKhoanKl()[row.XUONG];
    if (!id) throw loiChung(`[tài khoản KL] Xưởng "${row.XUONG}" chưa được gán tài khoản KL — vào Settings > Tài khoản KL để gán.`);
  }
  const dong = caiDatDbService.layTaiKhoanKl(id);
  if (!dong) throw loiChung(`[tài khoản KL] Tài khoản KL #${id} (dùng cho đơn ${row.STT_Key}) không còn tồn tại — kiểm tra lại ở Settings.`);
  if (!dong.Token) throw loiChung(`[tài khoản KL] Tài khoản "${dong.Ten}" chưa có token — cập nhật ở Settings.`);
  return { id: String(dong.id), ten: dong.Ten, token: dong.Token };
}

// Settings (CHỈ superadmin): token KHÔNG trả về giao diện — chỉ báo đã có + 4 ký tự cuối; lưu với token rỗng = giữ token cũ.
function layDanhSachTaiKhoanKl() {
  return {
    taiKhoan: caiDatDbService.layDanhSachTaiKhoanKl().map(d => ({
      id: String(d.id), ten: d.Ten, coToken: !!d.Token, duoiToken: d.Token ? d.Token.slice(-4) : '',
      soSku: d.SoSku, skuNapLuc: d.SkuNapLuc, skuNapBoi: d.SkuNapBoi,
    })),
    danhSachXuong: caiDatDbService.layDanhSachXuong(),
    ganXuong: caiDatDbService.layGanTaiKhoanKl(),
  };
}
// SKU / cân nặng không còn nhập tay (28/10/2026) — nạp file Item Declarations (luuDanhSachSkuKl); cột SkuNumber / CanNangMoiAoGram cũ giữ nguyên.
function luuTaiKhoanKl(id, giaTri) {
  const ghiDb = { Ten: String(giaTri.ten ?? '').trim() };
  const token = String(giaTri.token ?? '').trim();
  if (token) ghiDb.Token = token;
  if (!ghiDb.Ten) throw new Error('Thiếu tên tài khoản');
  if (id && !caiDatDbService.layTaiKhoanKl(id)) throw new Error('Không tìm thấy tài khoản');
  if (!id && !token) throw new Error('Thiếu token (API key KL)');
  return String(caiDatDbService.ghiTaiKhoanKl(id, ghiDb));
}
function xoaTaiKhoanKl(id) {
  const dangGan = Object.entries(caiDatDbService.layGanTaiKhoanKl()).filter(([, v]) => v === String(id)).map(([x]) => x);
  if (dangGan.length) throw new Error(`Tài khoản đang được gán cho Xưởng: ${dangGan.join(', ')} — bỏ gán trước khi xoá.`);
  caiDatDbService.xoaTaiKhoanKl(id);
}
function ganTaiKhoanKlChoXuong(xuong, id) {
  if (!caiDatDbService.layDanhSachXuong().includes(xuong)) throw new Error(`Xưởng không hợp lệ: "${xuong}"`);
  if (id && !caiDatDbService.layTaiKhoanKl(id)) throw new Error('Không tìm thấy tài khoản');
  caiDatDbService.ganTaiKhoanKlChoXuong(xuong, id);
}

// ---- Danh sách SKU (file "Item Declarations" xuất ở trang KL) ----
// SKU đã chuẩn hoá để so khớp: NFC (dấu tiếng Việt gõ / xuất khác kiểu), bỏ khoảng trắng 2 đầu, gộp khoảng trắng. PHÂN BIỆT hoa/thường — 2 SKU
// KL chỉ khác hoa/thường là 2 SKU khác nhau (timSkuKl mới thử không phân biệt, khi khớp DUY NHẤT 1 SKU).
const chuanSku = s => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
// Giá trị ô ExcelJS -> chuỗi: richText / hyperlink (text) / công thức (result); ô lỗi (#N/A…), ô trống, giá trị lạ -> ''.
const giaTriO = v => {
  let x = v;
  if (v && typeof v === 'object' && !(v instanceof Date)) x = v.richText ? v.richText.map(t => t.text).join('') : v.text ?? v.result;
  return x == null || (typeof x === 'object' && !(x instanceof Date)) ? '' : String(x);
};
// buffer .xlsx -> { ds: [{ khoa, sku, ten, canNangGram }], canhBao: [] }. Cần cột skuNumber + itemWeight (gram) ở dòng tiêu đề. Có dòng sai
// (thiếu / cân nặng không phải số > 0 / SKU trùng khác cân nặng) -> lỗi cả file, liệt kê dòng — KHÔNG nạp 1 phần.
async function docFileSkuKl(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (err) { throw new Error('Không đọc được file Excel (.xlsx) — chọn đúng file Item Declarations xuất từ trang KL'); }
  const ws = wb.worksheets.find(w => w.rowCount > 0);
  if (!ws) throw new Error('File không có dữ liệu');
  const tieuDe = ws.getRow(1).values.map(v => String(giaTriO(v)).trim().toLowerCase());
  const cot = ten => tieuDe.indexOf(ten.toLowerCase());
  const [cSku, cTen, cNang] = [cot('skuNumber'), cot('name'), cot('itemWeight')];
  if (cSku < 0 || cNang < 0) throw new Error('Dòng 1 phải có cột "skuNumber" và "itemWeight" (file Item Declarations xuất từ trang KL)');
  const theoKhoa = new Map(), loi = [], canhBao = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const sku = String(giaTriO(r.getCell(cSku).value)); // giữ NGUYÊN chuỗi KL khai báo (gửi lên KL); chỉ khoá so khớp mới chuẩn hoá
    if (!sku.trim()) return;
    const gram = Number(giaTriO(r.getCell(cNang).value));
    if (!(gram > 0)) { loi.push(`dòng ${i} (${sku}): itemWeight "${giaTriO(r.getCell(cNang).value)}" không phải số gram > 0`); return; }
    const khoa = chuanSku(sku);
    const cu = theoKhoa.get(khoa);
    if (cu && cu.canNangGram !== gram) { loi.push(`dòng ${i}: SKU "${sku}" trùng dòng trước nhưng khác cân nặng (${cu.canNangGram} g / ${gram} g)`); return; }
    if (cu) canhBao.push(`dòng ${i}: SKU "${sku}" lặp lại — bỏ qua`);
    else theoKhoa.set(khoa, { khoa, sku, ten: cTen > 0 ? String(giaTriO(r.getCell(cTen).value)).trim() : '', canNangGram: gram });
  });
  if (loi.length) throw new Error(`File có ${loi.length} dòng sai — chưa nạp gì: ${loi.slice(0, 10).join('; ')}${loi.length > 10 ? '; …' : ''}`);
  if (!theoKhoa.size) throw new Error('File không có SKU nào');
  return { ds: [...theoKhoa.values()], canhBao };
}
// Nạp (thay toàn bộ) danh sách SKU của 1 tài khoản KL. -> { soSku, canhBao }
async function luuDanhSachSkuKl(id, buffer, user) {
  if (!caiDatDbService.layTaiKhoanKl(id)) throw new Error('Không tìm thấy tài khoản');
  const { ds, canhBao } = await docFileSkuKl(buffer);
  caiDatDbService.thayDanhSachSkuKl(id, ds, new Date().toISOString(), user.ten);
  return { soSku: ds.length, canhBao };
}
// SKU KL của 1 đơn: "US" + LOAI + KICH_THUOC (người dùng xác nhận 28/10/2026 — cùng cách đặt tên trên trang KL, vd "USHoodie2XL").
const maSkuCuaDon = d => `US${String(d.LOAI ?? '').trim()}${String(d.KICH_THUOC ?? '').trim()}`;
// Tìm SKU trong danh sách đã nạp (Map khoa -> sku): đúng khoá trước; không có thì thử không phân biệt hoa/thường — CHỈ nhận khi khớp đúng
// 1 SKU (vd Sheet ghi "hoodie" mà KL là "Hoodie"); khớp nhiều SKU -> coi như không thấy (không đoán).
function timSkuKl(dsSku, ma) {
  const khoa = chuanSku(ma);
  if (dsSku.has(khoa)) return dsSku.get(khoa);
  const thuong = khoa.toLowerCase();
  const khop = [...dsSku.values()].filter(x => chuanSku(x.sku).toLowerCase() === thuong);
  return khop.length === 1 ? khop[0] : null;
}
// Dự đoán SKU cho khối KL ở Chi tiết đơn (28/10/2026): chưa mua đã biết đơn nào thiếu SKU. dsDon: các đơn trong kiện (như taoBodyDonKl).
// -> { taiKhoan, soSku, ds: [{ sttKey, ma, sku, canNangGram, soLuong, thieu }] } | { loi }
function duDoanSkuKl(row, dsDon) {
  let cauHinh;
  try { cauHinh = layCauHinhKlChoDon(row); } catch (err) { return { loi: err.message }; }
  const dsSku = caiDatDbService.layDanhSachSkuKl(cauHinh.id);
  return {
    taiKhoan: cauHinh.ten, soSku: dsSku.size,
    ds: dsDon.map(d => {
      const ma = maSkuCuaDon(d);
      const thieu = !String(d.LOAI ?? '').trim() || !String(d.KICH_THUOC ?? '').trim();
      const sku = thieu ? null : timSkuKl(dsSku, ma);
      return { sttKey: d.STT_Key, ma, sku: sku ? sku.sku : '', canNangGram: sku ? sku.canNangGram : null, soLuong: Number(d.SO_LUONG) || 1, thieu };
    }),
  };
}

// ---- Gọi API ----
const { moTaLoiMang } = require('./loiMangUtils');
// Đọc dạng text rồi mới thử JSON (giống gkeService.fetchJson). Lỗi mạng / quá giờ -> err.khongRoKetQua = true: với lệnh TẠO ĐƠN nghĩa là
// KHÔNG BIẾT KL đã tạo hay chưa — nơi gọi giữ dấu KL_DANG_TAO, lượt sau tra lại.
async function goi(buoc, method, path, cauHinh, { body, nhatKy, nhiPhan = false } = {}) {
  const huy = new AbortController();
  const hen = setTimeout(() => huy.abort(), TIMEOUT_MS);
  ghi(nhatKy, `[KL] [${buoc}] Gọi ${method} ${path} (tài khoản "${cauHinh.ten}")`);
  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method, signal: huy.signal,
      headers: { Authorization: `Bearer ${cauHinh.token}`, Accept: nhiPhan ? 'application/pdf, */*' : 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const quaGio = err.name === 'AbortError';
    const loiMang = moTaLoiMang(err);
    ghi(nhatKy, `[KL] [${buoc}] ${quaGio ? `Quá thời gian chờ (${TIMEOUT_MS / 1000}s)` : `Lỗi mạng: ${loiMang}`}`);
    throw Object.assign(new Error(`[${buoc}] ${quaGio ? `KL không trả lời trong ${TIMEOUT_MS / 1000} giây` : `Lỗi kết nối tới KL: ${loiMang}`}`), { khongRoKetQua: true });
  } finally {
    clearTimeout(hen);
  }
  if (nhiPhan) {
    const buf = Buffer.from(await res.arrayBuffer());
    ghi(nhatKy, `[KL] [${buoc}] Phản hồi: HTTP ${res.status}, ${res.headers.get('content-type') || '?'}, ${buf.length} byte`);
    return { res, buf };
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* không phải JSON */ }
  ghi(nhatKy, `[KL] [${buoc}] Phản hồi: HTTP ${res.status}${data && data.status ? `, status=${data.status}` : ''}${data === null && text ? ' (không phải JSON)' : ''}`);
  return { res, data, text };
}
const lyDoLoi = (data, text, res) => {
  const d = data && typeof data === 'object' ? data : {};
  return String(d.reason || d.Reason || d.message || d.error || d.detail || (text || '').slice(0, 200) || `HTTP ${res.status}`);
};

// Tra đơn trên KL theo orderNumber (khớp ĐÚNG). -> đơn hoặc null. Lỗi -> ném (nơi gọi KHÔNG tạo đơn khi chưa tra được: tránh tạo trùng).
// Đọc HẾT các trang (filter có thể khớp nhiều đơn — vd "10U1" nếu KL lọc theo chứa): chưa đọc hết thì không được kết luận "chưa có đơn"
// (sẽ gửi lệnh tạo). Quá SO_TRANG_TOI_DA trang -> báo lỗi, không tạo.
const KICH_THUOC_TRANG = 50, SO_TRANG_TOI_DA = 10;
async function timDonTheoMa(orderNumber, cauHinh, nhatKy) {
  const ds = [];
  for (let trang = 0; ; trang++) {
    if (trang >= SO_TRANG_TOI_DA) throw new Error(`[tra đơn] KL trả quá nhiều đơn khớp "${orderNumber}" (hơn ${SO_TRANG_TOI_DA * KICH_THUOC_TRANG}) — không xác định được, kiểm tra trên trang KL.`);
    const { res, data, text } = await goi('tra đơn', 'GET', `/api/v1/orders?filter=${encodeURIComponent(orderNumber)}&page=${trang}&page_size=${KICH_THUOC_TRANG}`, cauHinh, { nhatKy });
    if (!res.ok) throw new Error(`[tra đơn] KL từ chối: ${lyDoLoi(data, text, res)}`);
    const trangNay = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : null);
    if (!trangNay) throw new Error('[tra đơn] KL trả dữ liệu không đúng định dạng (thiếu danh sách đơn)');
    ds.push(...trangNay);
    const tong = data && Number(data.total);
    // Hết khi: trả mảng thuần (không phân trang) / trang thiếu / đã đủ total.
    if (Array.isArray(data) || trangNay.length < KICH_THUOC_TRANG || (Number.isFinite(tong) && ds.length >= tong)) break;
  }
  const khop = ds.filter(d => d && String(d.orderNumber) === String(orderNumber));
  if (khop.length > 1) ghi(nhatKy, `[KL] [tra đơn] CÓ ${khop.length} đơn cùng mã ${orderNumber} trên KL — dùng đơn thành công đầu tiên.`);
  const chon = khop.find(laDonThanhCong) || khop.find(laDonChoCapMa) || khop[0] || null; // đơn dùng được > đơn đang chờ cấp mã > đơn lỗi
  // 28/10/2026: phản hồi thật khác tài liệu (không có "sid") — ghi TÊN các trường + các mã định danh (không ghi địa chỉ / tên khách) để biết
  // KL dùng trường nào làm mã đơn cho API label.
  if (chon) ghi(nhatKy, `[KL] [tra đơn] Đơn khớp ${orderNumber}: trường [${Object.keys(chon).join(', ')}] · sid=${chon.sid ?? '-'} · vendor_sid=${chon.vendor_sid ?? '-'} · id=${chon.id ?? '-'} · status=${chon.status ?? '-'}`);
  return chon;
}
// Đơn KL dùng được = có barcode + sid và KHÔNG ở trạng thái lỗi / cảnh báo. KL dùng CẢ mã số (tài liệu: -1 Warning, 5 Failed, 6 Order Failed)
// lẫn chữ ("failed", "success", status_text) -> xét cả 2; trạng thái lỗi / cảnh báo KHÔNG tự nhận (người dùng kiểm tra trên trang KL).
const TRANG_THAI_KL_LOI = new Set(['-1', '5', '6']);
// 27/10/2026: thêm chữ huỷ / xoá / từ chối — tài liệu KL không liệt kê mã của các trạng thái này; đơn huỷ không được coi là "đang chờ cấp mã".
// So NGUYÊN TỪ, chỉ trạng thái ĐÃ xảy ra: "Refund requested", "Cancel requested", "Cancellation pending"… vẫn là đơn còn hiệu lực, không
// bị coi là lỗi (không được khuyên xoá).
const MAU_TRANG_THAI_LOI = /\b(fail|failed|failure|warn|warning|canceled|cancelled|deleted|voided|rejected)\b/i;
const laTrangThaiKlLoi = d => TRANG_THAI_KL_LOI.has(String(d.status).trim()) || MAU_TRANG_THAI_LOI.test(`${d.status || ''} ${d.status_text || ''}`);
// "status – status_text" của đơn KL để báo lỗi ('' nếu trống) — dùng chung mọi câu báo.
const moTaTrangThaiKl = d => [d.status, d.status_text].filter(v => v != null && v !== '').join(' – ');
// Đơn KL dùng được = có barcode, không lỗi. sid KHÔNG bắt buộc (28/10/2026: phản hồi thật có thể không có "sid") — thiếu sid vẫn nhận tracking
// (để không mua thêm hãng khác), chỉ chưa lấy được label KL.
const laDonThanhCong = d => !!(d && d.barcode && !laTrangThaiKlLoi(d));
// KL có đơn, KHÔNG lỗi nhưng chưa có barcode (27/10/2026): đơn có thể hợp lệ, đã trừ phí — KHÔNG được khuyên xoá; chờ KL cấp mã.
const laDonChoCapMa = d => !!(d && !laTrangThaiKlLoi(d) && !laDonThanhCong(d));

// Chi tiết 1 đơn KL (GET /api/v1/orders/<sid>) — dùng khi DÙNG LẠI đơn tìm được qua tra theo mã: danh sách có thể thiếu shipping_partner /
// usd / vnd (ví dụ tài liệu: "shipping_partner": null). Lỗi -> ném (nơi gọi tự quyết dùng dữ liệu đang có).
async function layDonKl(sid, cauHinh, nhatKy) {
  const { res, data, text } = await goi('chi tiết đơn', 'GET', `/api/v1/orders/${encodeURIComponent(sid)}`, cauHinh, { nhatKy });
  if (!res.ok || !data || typeof data !== 'object') throw new Error(`[chi tiết đơn] KL từ chối: ${lyDoLoi(data, text, res)}`);
  return data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : data;
}

// Tạo đơn (MUA tracking — có thể phát sinh phí). KHÔNG thử lại. -> { barcode, sid, shipping_partner, usd, vnd }.
// "KL từ chối" (nơi gọi bỏ dấu đang tạo -> job GKE được mua): HTTP 4xx thường (kể cả trang lỗi không phải JSON — vd 401/403 token bị thu hồi,
// chặn ở biên: KL chưa tạo gì), hoặc 2xx kèm JSON có status khác "success". Còn lại là CHƯA RÕ -> khongRoKetQua: giữ dấu, lượt sau tra KL theo
// mã đơn trước: 2xx không phải JSON / thiếu status (trang bảo trì của proxy), 408 quá giờ, 409 trùng (có thể đơn đã có), 425/429, 5xx
// (27/10/2026, rà soát thiết kế KL).
const HTTP_KHONG_RO = new Set([408, 409, 425, 429]);
async function taoDonKl(body, cauHinh, nhatKy) {
  ghi(nhatKy, `[KL] [tạo đơn] Body: ${JSON.stringify(body)}`);
  const { res, data, text } = await goi('tạo đơn', 'POST', '/api/v1/orders', cauHinh, { body, nhatKy });
  const coJson = !!data && typeof data === 'object';
  // Phản hồi CÓ barcode = KL ĐÃ tạo đơn (28/10/2026 — phản hồi thật: {"status":0,"barcode":"9214…","shipping_partner":"USPS",
  // "account_sid":…,"vendor_sid":…} — status là SỐ, không có "sid"). KHÔNG BAO GIỜ coi là từ chối (từng bỏ dấu đang mua -> nguy cơ mua thêm GKE).
  // Không có trạng thái lỗi -> trả về (thiếu sid thì nơi gọi tra lại KL để bổ sung); trạng thái lỗi -> chưa rõ (giữ dấu, lượt sau tra KL).
  if (coJson && data.barcode) {
    if (laTrangThaiKlLoi(data)) throw Object.assign(new Error(`[tạo đơn] KL tạo đơn (barcode ${data.barcode}) nhưng ở trạng thái lỗi "${moTaTrangThaiKl(data)}"`), { khongRoKetQua: true });
    return data;
  }
  if (res.ok && coJson && String(data.status).toLowerCase() === 'success') {
    // Thành công nhưng thiếu barcode/sid: KHÔNG ghi tracking rỗng; giữ dấu đang tạo (nơi gọi) -> lượt sau tra lại theo mã đơn.
    throw Object.assign(new Error('[tạo đơn] KL báo thành công nhưng thiếu barcode / sid'), { khongRoKetQua: true });
  }
  const loi4xx = res.status >= 400 && res.status < 500 && !HTTP_KHONG_RO.has(res.status);
  if (!loi4xx && (!coJson || res.status >= 500 || HTTP_KHONG_RO.has(res.status) || (res.ok && data.status == null))) {
    throw Object.assign(new Error(`[tạo đơn] KL trả phản hồi không rõ kết quả (HTTP ${res.status}${coJson ? '' : ', không phải JSON'}): ${lyDoLoi(data, text, res)}`), { khongRoKetQua: true });
  }
  throw new Error(`[tạo đơn] KL từ chối: ${lyDoLoi(data, text, res)}`);
}

// Label PDF (base64). Nhận không phải PDF -> lỗi kèm loại + 200 ký tự đầu (để chỉnh khi có mẫu thật).
async function layLabelKl(sid, cauHinh, nhatKy) {
  const { res, buf } = await goi('lấy label', 'GET', `/api/v1/orders/labels/${encodeURIComponent(sid)}`, cauHinh, { nhatKy, nhiPhan: true });
  const loai = res.headers.get('content-type') || '?';
  if (res.ok && buf.slice(0, 5).toString('latin1') === '%PDF-') return buf.toString('base64');
  const dau = buf.slice(0, 200).toString('utf8').replace(/\s+/g, ' ');
  ghi(nhatKy, `[KL] [lấy label] Không phải PDF — loại ${loai}, đầu nội dung: ${dau}`);
  throw new Error(res.ok ? `[lấy label] KL trả label không phải PDF (${loai}) — cần file mẫu để cập nhật cách đọc label` : `[lấy label] KL từ chối (HTTP ${res.status}): ${dau || loai}`);
}

// Sự kiện tracking (mảng, có thể rỗng). Mới nhất = eventTime lớn nhất (không dựa vào thứ tự KL trả).
async function layTrackingKl(barcode, cauHinh, nhatKy) {
  const { res, data, text } = await goi('tra tracking', 'GET', `/api/v1/tracking?filter=${encodeURIComponent(barcode)}`, cauHinh, { nhatKy });
  if (!res.ok) throw new Error(`[tra tracking] KL từ chối: ${lyDoLoi(data, text, res)}`);
  const ds = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  return ds.filter(e => e && e.description);
}
const suKienMoiNhat = ds => ds.reduce((a, b) => (!a || new Date(b.eventTime) > new Date(a.eventTime) ? b : a), null);

// Mã hãng giao KL -> tên. Mã lạ / trống -> '' (27/10/2026: không ghi mã số thô kiểu "3" sang Sheet Seller của khách — nơi gọi báo cảnh báo).
const TEN_HANG_KL = { 1: 'USPS', 5: 'DHL' };
// 28/10/2026: phản hồi thật trả TÊN hãng ("shipping_partner":"USPS") chứ không phải mã số như tài liệu -> chữ thì dùng nguyên (tên hãng).
const tenHangVanChuyen = ma => {
  const s = String(ma ?? '').trim();
  return TEN_HANG_KL[s] || (/^[A-Za-z][A-Za-z0-9 .&-]{1,30}$/.test(s) ? s : '');
};

// ---- Chuẩn bị dữ liệu đơn ----
const BANG_MY = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const MA_BANG = new Set(Object.values(BANG_MY));
// Tên bang đầy đủ hoặc mã 2 chữ -> mã 2 chữ; không nhận ra -> null (KHÔNG đoán).
function maBangMy(giaTri) {
  const s = String(giaTri || '').trim().replace(/\s+/g, ' ');
  if (/^[a-z]{2}$/i.test(s) && MA_BANG.has(s.toUpperCase())) return s.toUpperCase();
  return BANG_MY[s.toLowerCase()] || null;
}

// dsDon: các đơn trong kiện (DonNhieuAo: mọi đơn chưa huỷ của nhóm; đơn thường: [row]). row = đơn mua (".1" nếu DonNhieuAo) — địa chỉ lấy
// từ đơn này. Kiểm tra ĐỦ mọi trường rồi mới báo lỗi 1 lần (liệt kê hết), KHÔNG tự cắt / tự sửa dữ liệu (người dùng chốt).
const QUOC_GIA_KL = ['US']; // dùng cả ở trackingAutoService#ngoaiQuocGiaHang
function taoBodyDonKl(row, dsDon, cauHinh, maQuocGia) {
  const loi = [];
  const s = v => String(v ?? '').trim();
  const kiemDai = (truong, nhan, gt, batBuoc) => {
    if (!gt) { if (batBuoc) loi.push(`thiếu ${nhan}`); return; }
    if (gt.length > GIOI_HAN[truong]) loi.push(`${nhan} dài ${gt.length} ký tự (KL tối đa ${GIOI_HAN[truong]})`);
  };
  const orderNumber = s(row.STT_Key);
  const name = s(row.TEN);
  const phone = s(row.SDT);
  const address1 = s(row.DIA_CHI_TEN_DUONG || row.TEN_DIA_CHI);
  const address2 = s(row.DIA_CHI_TEN_DUONG_2);
  const city = s(row.DIA_CHI_TEN_TP);
  kiemDai('orderNumber', 'mã đơn (STT_Key)', orderNumber, true);
  kiemDai('name', 'tên người nhận (TEN)', name, true);
  kiemDai('phone', 'SĐT', phone, false);
  kiemDai('address1', 'địa chỉ (DIA_CHI_TEN_DUONG)', address1, true);
  kiemDai('address2', 'địa chỉ dòng 2 (DIA_CHI_TEN_DUONG_2)', address2, false);
  kiemDai('city', 'thành phố (DIA_CHI_TEN_TP)', city, true);
  let quocGia = null;
  try { quocGia = maQuocGia(row.DIA_CHI_NUOC); } catch { /* báo bên dưới */ }
  if (!QUOC_GIA_KL.includes(quocGia)) loi.push(`KL chỉ nhận đơn giao tới Mỹ (US) — đơn có quốc gia "${s(row.DIA_CHI_NUOC) || '(trống)'}"`);
  const state = maBangMy(row.DIA_CHI_BANG);
  if (!state) loi.push(`bang (DIA_CHI_BANG) "${s(row.DIA_CHI_BANG) || '(trống)'}" không nhận ra được mã 2 chữ của Mỹ`);
  let postalCode = s(row.MA_ZIPCODE);
  if (/^\d{4}(-\d{4})?$/.test(postalCode)) postalCode = '0' + postalCode; // ZIP Mỹ mất số 0 đầu (Sheet đọc thành số) — giống GKE
  if (postalCode.length < 5 || postalCode.length > 11) loi.push(`mã ZIP (MA_ZIPCODE) "${postalCode || '(trống)'}" phải dài 5–11 ký tự`);
  // SKU + cân nặng theo TỪNG đơn trong kiện (28/10/2026, người dùng chốt): SKU = "US" + LOAI + KICH_THUOC tra trong danh sách SKU đã nạp của
  // tài khoản; cân nặng = cân nặng của SKU × SO_LUONG (KHÔNG dùng TRONG_LUONG). Không thấy SKU -> chặn, báo lỗi (không dùng SKU dự phòng).
  const dsSku = caiDatDbService.layDanhSachSkuKl(cauHinh.id);
  const theoSku = new Map(); // sku KL -> số lượng (đơn nhiều áo cùng SKU gộp 1 dòng)
  let weight = 0;
  if (!dsSku.size) loi.push(`tài khoản KL "${cauHinh.ten}" chưa nạp danh sách SKU — tải file Item Declarations ở Settings > Tài khoản KL`);
  else {
    // Kiện nhiều đơn (DonNhieuAo) mới ghi mã từng đơn — kiện 1 đơn thì mã đã có ở đầu câu báo ("Đơn X: …").
    const nhanDon = d => (dsDon.length > 1 ? `đơn ${s(d.STT_Key)}: ` : '');
    for (const d of dsDon) {
      const soLuong = Number(d.SO_LUONG) || 1;
      const ma = maSkuCuaDon(d);
      if (!s(d.LOAI) || !s(d.KICH_THUOC)) { loi.push(`${nhanDon(d)}thiếu LOAI / KICH_THUOC — không ghép được SKU`); continue; }
      const sku = timSkuKl(dsSku, ma);
      if (!sku) { loi.push(`${nhanDon(d)}không có SKU "${ma}" trong danh sách SKU KL của tài khoản "${cauHinh.ten}" (thêm SKU trên trang KL rồi nạp lại file)`); continue; }
      theoSku.set(sku.sku, (theoSku.get(sku.sku) || 0) + soLuong);
      weight += sku.canNangGram * soLuong;
    }
  }
  if (loi.length) throw loiChung(`[chuẩn bị dữ liệu KL] Đơn ${orderNumber}: ${loi.join('; ')}.`);

  return {
    orderNumber, name, ...(phone ? { phone } : {}), address1, ...(address2 ? { address2 } : {}), city, country: 'US', state, postalCode,
    weight: Math.max(1, Math.round(weight)),
    items: [...theoSku].map(([skuNumber, quantity]) => ({ skuNumber, quantity })),
    // route_shipping_partner: KHÔNG gửi — để KL tự chọn (người dùng chốt 22/10/2026).
  };
}

module.exports = {
  dangTaoDonKl, DON_VI_KL, BASE_URL, QUOC_GIA_KL,
  layCauHinhKlChoDon, layDanhSachTaiKhoanKl, luuTaiKhoanKl, xoaTaiKhoanKl, ganTaiKhoanKlChoXuong, docFileSkuKl, luuDanhSachSkuKl, maSkuCuaDon, chuanSku, timSkuKl, duDoanSkuKl,
  timDonTheoMa, laDonThanhCong, laDonChoCapMa, moTaTrangThaiKl, layDonKl, taoDonKl, layLabelKl, layTrackingKl, suKienMoiNhat, tenHangVanChuyen, maBangMy, taoBodyDonKl,
};
