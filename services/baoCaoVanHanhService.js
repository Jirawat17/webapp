// Báo cáo vận hành qua Telegram (16/10/2026, theo yêu cầu người dùng) — gửi vào chat "Báo cáo logs hằng ngày" (Settings), dùng chung
// Chat ID + Bot Token. 3 phần:
//   (2) thongKeTocDo     — số đo tốc độ các thao tác chính trong 24 giờ (giữa / 90%), so với 24 giờ trước — nằm trong tin tóm tắt hằng ngày.
//   (7) loi dữ liệu      — danh sách lỗi dữ liệu cần Seller sửa, chia theo Team (tin tóm tắt + file Excel mỗi Team 1 sheet) — hằng ngày.
//                          CHỈ LIỆT KÊ, app không tự sửa dữ liệu.
//   (6) báo cáo tuần     — thời gian từng khâu sản xuất, số đơn qua các mốc, đơn kẹt, QC, mua tracking thủ công; toàn xưởng + từng Xưởng.
// Lịch gửi: services/baoCaoLogService.js.
const ExcelJS = require('exceljs');
const nhatKy = require('./nhatKyDbService');
const trangThaiDbService = require('./trangThaiDbService');
const orderService = require('./orderService');
const donNhieuAoService = require('./donNhieuAoService');
const { thoiGianVNISOString } = require('./dateUtils');
const { TRANG_THAI_KET_THUC } = require('../data/pipelineTinhTrang');

const MOT_NGAY_MS = 24 * 3600 * 1000;
const vn = ms => thoiGianVNISOString(new Date(ms));
const ngayGio = ms => { const v = vn(ms); return `${v.slice(8, 10)}/${v.slice(5, 7)} ${v.slice(11, 16)}`; }; // "15/10 22:30"
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const phanVi = (ds, p) => { if (!ds.length) return null; const s = [...ds].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const giay = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')}s`);
const thoiLuong = ms => {
  if (ms == null) return '—';
  const gio = ms / 3600000;
  if (gio < 1) return `${Math.max(1, Math.round(ms / 60000))} phút`;
  if (gio < 48) return `${gio.toFixed(1).replace('.', ',')} giờ`;
  return `${(gio / 24).toFixed(1).replace('.', ',')} ngày`;
};
const daKetThuc = r => TRANG_THAI_KET_THUC.includes(r.TRANG_THAI_XUONG);
const teamCua = sttKey => donNhieuAoService.layTeam(sttKey) || '(không rõ Team)';

// ======================= (2) Tốc độ thao tác =======================
// Máy chủ: bảng thoi_gian_api (logCapture.js đo mọi lượt của vài thao tác chính, chỉ tính lượt thành công < 400).
// Điện thoại (Logs_UploadAnh): cả lượt chụp + tải ảnh, mở camera — đo phía người dùng, gồm cả mạng.
const SU_KIEN_UA = { CHUP_ANH: 'Chụp + tải ảnh (cả lượt, đo trên điện thoại)', MO_CAMERA: 'Mở camera quét (đo trên điện thoại)' };
function gomSoDo(tuMs, denMs) {
  const m = new Map();
  const them = (ten, ms) => { if (Number.isFinite(ms)) (m.get(ten) || m.set(ten, []).get(ten)).push(ms); };
  for (const r of nhatKy.layThoiGianApi(vn(tuMs), vn(denMs))) if (r.ma < 400) them(r.thao_tac, r.ms);
  for (const r of nhatKy.layDoLogsUploadAnh(vn(tuMs), vn(denMs))) if (r.ket_qua === 'OK' && SU_KIEN_UA[r.su_kien]) them(SU_KIEN_UA[r.su_kien], Number(r.tong_ms));
  return m;
}
// -> các dòng HTML cho tin tóm tắt hằng ngày (mỗi thao tác 1 dòng, nhiều lượt trước).
function thongKeTocDo(ms) {
  const nay = gomSoDo(ms - MOT_NGAY_MS, ms), truoc = gomSoDo(ms - 2 * MOT_NGAY_MS, ms - MOT_NGAY_MS);
  const ten = [...new Set([...nay.keys(), ...truoc.keys()])].sort((a, b) => (nay.get(b) || []).length - (nay.get(a) || []).length);
  return ten.map(t => {
    const a = nay.get(t) || [], b = truoc.get(t) || [];
    const soNay = a.length ? `${a.length} lượt · giữa ${giay(phanVi(a, 0.5))} · 90% ≤ ${giay(phanVi(a, 0.9))}` : 'không có lượt nào';
    return `• ${esc(t)}: ${soNay}${b.length ? ` <i>(hôm trước ${giay(phanVi(b, 0.5))} / ${giay(phanVi(b, 0.9))})</i>` : ''}`;
  });
}
// Dọn số đo cũ (gọi mỗi ngày từ lịch báo cáo) — giữ 35 ngày, đủ so sánh tuần/tháng.
const donSoDoCu = (ms = Date.now()) => {
  const moc = vn(ms - 35 * MOT_NGAY_MS);
  nhatKy.xoaThoiGianApiTruoc(moc); nhatKy.xoaDoMangTruoc(moc); nhatKy.xoaDoMangMayChuTruoc(moc);
};

// ======================= Mạng tới máy chủ (đo từ trình duyệt mỗi 30 giây — routes/doMang.js) =======================
const msChu = ms => (ms == null ? '—' : ms < 1000 ? `${ms}ms` : giay(ms));
function tomTatMang(ds) {
  const coSo = ds.filter(d => d.ms != null).map(d => d.ms);
  return { n: ds.length, giua: phanVi(coSo, 0.5), p90: phanVi(coSo, 0.9), soLoi: ds.length - coSo.length };
}
const dongMang = t => `${t.n} lần · giữa ${msChu(t.giua)} · 90% ≤ ${msChu(t.p90)} · mất kết nối ${tyLe(t.soLoi, t.n)}`;
// -> { dong: [HTML], ds: các lần đo 24 giờ (cho file CSV chi tiết) }. Theo người + máy: 6 nhóm chậm nhất (≥ 10 lần đo).
function thongKeMang(ms) {
  const ds = nhatKy.layDoMang(vn(ms - MOT_NGAY_MS), vn(ms));
  if (!ds.length) return { dong: [], ds };
  const truoc = nhatKy.layDoMang(vn(ms - 2 * MOT_NGAY_MS), vn(ms - MOT_NGAY_MS));
  const tTruoc = tomTatMang(truoc);
  const dong = [`<b>Mạng tới máy chủ</b> (trình duyệt đo mỗi 30 giây): ${dongMang(tomTatMang(ds))}${truoc.length ? ` <i>(hôm trước giữa ${msChu(tTruoc.giua)} / 90% ${msChu(tTruoc.p90)})</i>` : ''}`];
  const nhom = new Map();
  for (const d of ds) {
    const k = [d.nguoi, [d.he_dieu_hanh, d.may || d.trinh_duyet].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
    (nhom.get(k) || nhom.set(k, []).get(k)).push(d);
  }
  const xep = [...nhom].map(([k, v]) => [k, tomTatMang(v)]).filter(([, t]) => t.n >= 10)
    .sort((a, b) => ((b[1].giua ?? Infinity) - (a[1].giua ?? Infinity)) || (b[1].soLoi / b[1].n - a[1].soLoi / a[1].n));
  for (const [k, t] of xep.slice(0, 6)) dong.push(`• ${esc(k)}: ${dongMang(t)}`);
  dong.push(...dongTachDoan(ds));
  return { dong, ds };
}

// ---- Tách đoạn (17/10/2026): trình duyệt (cột ms_cf...) + máy chủ tự đo mỗi phút (bảng do_mang_may_chu) ----
const giuaP90 = v => (v.length ? `${msChu(phanVi(v, 0.5))} / ${msChu(phanVi(v, 0.9))}` : '—');
const cot = (ds, k) => ds.map(d => d[k]).filter(v => v != null);
const tramCF = ds => {
  const dem = new Map();
  for (const d of ds) if (d.colo) dem.set(d.colo, (dem.get(d.colo) || 0) + 1);
  const tong = [...dem.values()].reduce((a, b) => a + b, 0);
  return [...dem].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${tyLe(n, tong)}`).join(', ');
};
// Giờ chậm nhất (giữa lớn nhất, ≥ 10 lần đo) + tách đoạn của giờ đó — thấy ngay buổi tối chậm vì đoạn nào.
function gioChamNhat(ds, kTong) {
  const theoGio = new Map();
  for (const d of ds) { const g = String(d.luc).slice(11, 13); (theoGio.get(g) || theoGio.set(g, []).get(g)).push(d); }
  let tot = null;
  for (const [g, v] of theoGio) {
    const t = cot(v, kTong);
    if (t.length >= 10 && (!tot || phanVi(t, 0.5) > tot.giua)) tot = { g, v, giua: phanVi(t, 0.5) };
  }
  return tot;
}
function dongTachDoan(ds) {
  const dong = [];
  const coDoan = ds.filter(d => d.ms_cf != null || d.ms_xep_hang != null);
  if (coDoan.length) {
    const moTa = v => `Máy→Cloudflare ${giuaP90(cot(v, 'ms_cf'))} · Cloudflare→máy chủ ${giuaP90(cot(v, 'ms_cf_may_chu'))} · máy chủ xử lý ${giuaP90(cot(v, 'ms_app'))}`
      + ` · chờ trong trình duyệt ${giuaP90(cot(v, 'ms_xep_hang'))}`;
    dong.push(`<b>Tách đoạn</b> (trình duyệt, giữa / 90%): ${moTa(coDoan)}${tramCF(coDoan) ? ` · trạm Cloudflare: ${esc(tramCF(coDoan))}` : ''}`);
    const g = gioChamNhat(coDoan, 'ms');
    if (g) dong.push(`• Giờ chậm nhất ${g.g}h (giữa ${msChu(g.giua)}): ${moTa(g.v)}`);
  }
  return dong;
}
// -> { dong: [HTML], ds } — số đo máy chủ tự làm mỗi phút trong 24 giờ.
function thongKeMangMayChu(ms) {
  const ds = nhatKy.layDoMangMayChu(vn(ms - MOT_NGAY_MS), vn(ms));
  if (!ds.length) return { dong: [], ds };
  const soLoi = ds.filter(d => d.loi).length;
  const moTa = v => `Máy chủ→Cloudflare ${giuaP90(cot(v, 'ms_cf'))} · Cloudflare→máy chủ ${giuaP90(cot(v, 'ms_cf_may_chu'))}`;
  const dong = [`<b>Máy chủ tự đo mỗi phút</b> (${ds.length} lần, lỗi ${tyLe(soLoi, ds.length)}): ${moTa(ds)}${tramCF(ds) ? ` · trạm Cloudflare: ${esc(tramCF(ds))}` : ''}`];
  const g = gioChamNhat(ds, 'ms_cf_may_chu');
  if (g) dong.push(`• Giờ chậm nhất ${g.g}h: ${moTa(g.v)}`);
  const loiNhieu = new Map();
  for (const d of ds) if (d.loi) loiNhieu.set(d.loi, (loiNhieu.get(d.loi) || 0) + 1);
  for (const [l, n] of [...loiNhieu].sort((a, b) => b[1] - a[1]).slice(0, 3)) dong.push(`• ${n}× ${esc(l)}`);
  return { dong, ds };
}
const COT_CSV_MANG_MAY_CHU = ['luc', 'colo', 'ms_dns', 'ms_tcp', 'ms_tls', 'ms_cf', 'ms_cf_may_chu', 'ms_app', 'loi'];
const taoCsvDoMangMayChu = ds => taoCsv(COT_CSV_MANG_MAY_CHU, ds);
const COT_CSV_MANG = ['luc', 'nguoi', 'vai_tro', 'xuong', 'trang', 'ms', 'loi', 'loai_mang', 'mbps', 'rtt', 'he_dieu_hanh', 'trinh_duyet', 'may',
  'ms_cf', 'ms_cf_may_chu', 'ms_app', 'ms_xep_hang', 'ms_ket_noi', 'colo'];
// CSV có BOM (Excel đọc đúng tiếng Việt); ô bắt đầu bằng = + - @ thêm ' (chống công thức Excel) — cùng quy tắc file Logs_UploadAnh.
const oCsv = v => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
const taoCsv = (cot, ds) => '﻿' + [cot.join(','), ...ds.map(r => cot.map(k => oCsv(r[k])).join(','))].join('\r\n');
const taoCsvDoMang = ds => taoCsv(COT_CSV_MANG, ds);

// ======================= (7) Lỗi dữ liệu cần Seller sửa =======================
// Phân loại lỗi mua tracking GKE — CHỈ lỗi do dữ liệu đơn (lỗi kỹ thuật: mạng, token... không thuộc việc của Seller -> bỏ).
// Thứ tự = ưu tiên (mẫu đầu tiên khớp). 16/10/2026: "[chuẩn bị dữ liệu] ... thiếu cột MA_ZIPCODE" (ô ZIP TRỐNG) và "city, zip code, and state
// verification failed" (ZIP hợp lệ nhưng không khớp thành phố/bang) từng bị xếp nhầm vào "ZIP sai định dạng" vì chứa chữ "zip".
const LOI_MUA_THEO_MAU = [
  [/\[chuẩn bị dữ liệu\]|thiếu cột/i, 'Mua tracking GKE: thiếu thông tin người nhận', 'Seller bổ sung đủ tên / thành phố / ZIP / quốc gia.'],
  [/p\.?\s*o\.?\s*box/i, 'Mua tracking GKE: địa chỉ PO Box', 'GKE không nhận PO Box — Seller xin khách địa chỉ nhận hàng khác.'],
  [/postal code not in service|无服务|未匹配到路由/i, 'Mua tracking GKE: ZIP / quốc gia ngoài vùng phục vụ', 'GKE không phục vụ ZIP này — Seller kiểm tra lại ZIP + địa chỉ; nếu đúng thì cần gửi bằng hãng khác.'],
  [/city, zip code,? and state|城市、邮编、州/i, 'Mua tracking GKE: ZIP / thành phố / bang không khớp', 'Seller kiểm tra lại ZIP, thành phố và bang có khớp nhau không rồi sửa ô sai.'],
  [/postcode|邮编|zip/i, 'Mua tracking GKE: ZIP sai định dạng', 'ZIP Mỹ phải đủ 5 số (vd 03217), postcode UK đúng dạng (vd TR15 2SX) — Seller sửa ô ZIP.'],
];
// gkeService báo "thiếu cột X" cả khi cột CÓ mà ô TRỐNG (!donHang[X]) — trong báo cáo ghi đúng là ô trống.
const chiTietLoiMua = s => String(s).replace(/thiếu cột ([A-Z0-9_, ]+?) —/, 'để trống ô $1 —').slice(0, 300);
const TRUONG_DIA_CHI = { TEN: 'Tên', DIA_CHI_TEN_DUONG: 'Địa chỉ 1', DIA_CHI_TEN_DUONG_2: 'Địa chỉ 2', DIA_CHI_TEN_TP: 'Thành phố', DIA_CHI_BANG: 'Bang', MA_ZIPCODE: 'ZIP' };
const hienKyTu = s => String(s).replace(/\r/g, '').replace(/\n/g, '⏎').replace(/\t/g, '⇥').replace(/^ +| +$/g, m => '·'.repeat(m.length)); // cho thấy ký tự ẩn
const laUS = r => /^(us|usa|united states( of america)?)$/i.test(String(r.DIA_CHI_NUOC || '').trim());
const NHAN_LOAI_SELLER = { GHI_CHU: 'Ghi chú xưởng', TRACKING: 'Tracking', DELIVERED: 'Delivered', SO_MUI: 'Số mũi chỉ' };

// -> [{ team, sttKey, loai, nhom (nhãn ngắn để đếm), chiTiet, giaTri, cachSua }]
async function danhSachLoiDuLieu() {
  const { rows } = await orderService.getAll();
  const ds = [];
  const them = (r, nhom, loai, chiTiet, giaTri, cachSua) => ds.push({ team: teamCua(r.STT_Key), sttKey: r.STT_Key, nhom, loai, chiTiet, giaTri, cachSua });
  const chuaXong = rows.filter(r => !daKetThuc(r));

  // a. Mua tracking GKE lỗi do dữ liệu (đang thử tự động lại hoặc đã chuyển mua thủ công)
  for (const r of chuaXong) {
    if (r.TRACKING_ID || !r.TU_MUA_LOI_GAN_NHAT) continue;
    const mau = LOI_MUA_THEO_MAU.find(([re]) => re.test(r.TU_MUA_LOI_GAN_NHAT));
    if (mau) them(r, 'Mua tracking', mau[1], chiTietLoiMua(r.TU_MUA_LOI_GAN_NHAT), `ZIP "${r.MA_ZIPCODE || ''}" · ${r.DIA_CHI_NUOC || ''}`, mau[2]);
  }
  // b. Ghi Sheet Seller lỗi (đang chờ, chưa bị "Bỏ qua")
  for (const d of nhatKy.layLoiDongBoDangCho()) {
    const thieuCot = String(d.LyDo || '').match(/thiếu cột:\s*([^.]+)/i);
    const cachSua = thieuCot ? `Thêm cột "${thieuCot[1].trim()}" vào DÒNG 1 của tab "${d.Tab}", rồi báo xưởng bấm "Đẩy lại" ở Trung tâm hành động.`
      : /quyền|permission|403/i.test(d.LyDo || '') ? 'Chia sẻ quyền CHỈNH SỬA Sheet cho email dịch vụ của app (xem Settings > Sheet Seller).'
      : 'Kiểm tra tab / tiêu đề cột trong Sheet Seller.';
    // gop: lỗi CÙNG nguyên nhân (cùng loại + tab + lý do không nhắc mã đơn — vd tab thiếu cột, Sheet chưa có tab tháng) -> file Excel gộp 1 dòng.
    const lyDo = String(d.LyDo || '');
    ds.push({ team: teamCua(d.STT_Key), sttKey: d.STT_Key, nhom: 'Sheet Seller', loai: `Ghi Sheet Seller lỗi (${NHAN_LOAI_SELLER[d.Loai] || d.Loai})`,
      chiTiet: lyDo.slice(0, 300), giaTri: d.Tab ? `Tab ${d.Tab}` : '', cachSua, gop: lyDo.includes(d.STT_Key) ? '' : `${d.Loai}|${d.Tab || ''}|${lyDo}` });
  }
  // c. Tên / địa chỉ có ký tự lạ, ZIP Mỹ 4 số, PO Box — đơn CHƯA có tracking (dữ liệu còn dùng để mua tracking)
  for (const r of chuaXong) {
    if (r.TRACKING_ID) continue;
    const loiTruong = [];
    for (const [cot, nhan] of Object.entries(TRUONG_DIA_CHI)) {
      const v = String(r[cot] ?? '');
      if (!v) continue;
      const loai = [/[\r\n\t]/.test(v) && 'xuống dòng/tab', (/^\s|\s$/.test(v.replace(/[\r\n\t]/g, '')) || / {2,}/.test(v)) && 'dấu cách thừa'].filter(Boolean);
      if (loai.length) loiTruong.push({ nhan, loai, v });
    }
    if (loiTruong.length) {
      them(r, 'Ký tự lạ', 'Tên/địa chỉ có ký tự lạ', loiTruong.map(x => `${x.nhan}: ${x.loai.join(', ')}`).join('; '),
        loiTruong.map(x => `${x.nhan} "${hienKyTu(x.v)}"`).join(' | '), 'Xoá ký tự xuống dòng (⏎) / dấu cách thừa (·) trong các ô tương ứng.');
    }
    const zip = String(r.MA_ZIPCODE || '').trim();
    if (laUS(r) && /^\d{4}(-\d{4})?$/.test(zip)) {
      them(r, 'ZIP 4 số', 'ZIP Mỹ thiếu số 0 đầu', 'ZIP Mỹ chỉ có 4 số', `ZIP "${zip}"`,
        `Định dạng ô ZIP là Văn bản (Text) rồi nhập đủ 5 số (vd 0${zip}) — app đã tự thêm số 0 khi gửi GKE nhưng Sheet vẫn sai.`);
    }
    if (/\bp\.?\s*o\.?\s*box\b/i.test(`${r.DIA_CHI_TEN_DUONG || ''} ${r.DIA_CHI_TEN_DUONG_2 || ''}`)) {
      them(r, 'PO Box', 'Địa chỉ PO Box', 'GKE từng báo "Po Box not supported"', `${r.DIA_CHI_TEN_DUONG || ''} ${r.DIA_CHI_TEN_DUONG_2 || ''}`.trim(),
        'Seller xin khách địa chỉ nhận hàng không phải PO Box.');
    }
  }
  // d. Tra tracking GKE lỗi (LOI_TRA_TRACKING — trackingAutoService.capNhatTrangThaiTrackingChoDon): tracking Seller GKE không tra được,
  //    hoặc vận đơn GKE "không có thông tin / đã huỷ". Lỗi kỹ thuật (mạng...) bỏ qua.
  for (const r of chuaXong) {
    if (!r.TRACKING_ID || !r.LOI_TRA_TRACKING) continue;
    const [luc, ...phan] = String(r.LOI_TRA_TRACKING).split('|');
    const lyDo = phan.join('|');
    if (!/Không có thông tin|bị hủy|không có vận đơn/i.test(lyDo)) continue;
    const laSeller = r.NGUON_TRACKING === orderService.NGUON_TRACKING_SELLER;
    them(r, 'Tra tracking', laSeller ? 'Tracking Seller: GKE không tra được' : 'Tracking GKE: không có thông tin / đã huỷ', `${lyDo.slice(0, 250)} (lần tra ${luc.slice(0, 16).replace('T', ' ')})`,
      `Tracking ${r.TRACKING_ID}${r.HANG_VAN_CHUYEN ? ' · ' + r.HANG_VAN_CHUYEN : ''}`,
      laSeller ? 'Seller kiểm tra lại mã tracking / hãng vận chuyển đã điền.' : 'Kiểm tra vận đơn trên trang GKE (có thể đã bị huỷ) — báo xưởng nếu cần mua lại.');
  }
  return ds;
}

const tenSheet = team => String(team).replace(/[[\]*?/\\:]/g, '').slice(0, 31) || 'Khac';
// Gộp các dòng cùng `gop` (≥ 2 đơn) thành 1 dòng: "Mã đơn" = "N đơn", "Giá trị hiện tại" = tab + danh sách mã đơn (16/10/2026, theo yêu cầu
// người dùng — file 16/10: Team V 80 dòng thực chất chỉ là 2 cột thiếu ở tab T9.2026).
function gopDongCungNguyenNhan(ds) {
  const theoKhoa = new Map();
  for (const d of ds) if (d.gop) (theoKhoa.get(d.gop) || theoKhoa.set(d.gop, []).get(d.gop)).push(d);
  const daGop = new Set();
  const kq = [];
  for (const d of ds) {
    const nhom = d.gop ? theoKhoa.get(d.gop) : null;
    if (!nhom || nhom.length < 2) { kq.push(d); continue; }
    if (daGop.has(d.gop)) continue;
    daGop.add(d.gop);
    const ma = [...new Set(nhom.map(x => x.sttKey))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    kq.push({ ...d, sttKey: `${ma.length} đơn`, giaTri: `${d.giaTri ? d.giaTri + ' — ' : ''}đơn: ${ma.join(', ')}` });
  }
  return kq;
}
async function taoFileLoiDuLieu(ds) {
  const wb = new ExcelJS.Workbook();
  const theoTeam = new Map();
  for (const d of ds) (theoTeam.get(d.team) || theoTeam.set(d.team, []).get(d.team)).push(d);
  for (const [team, dsTeam] of [...theoTeam].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    const sh = wb.addWorksheet(tenSheet(team));
    sh.columns = [
      { header: 'Mã đơn', key: 'sttKey', width: 14 }, { header: 'Loại lỗi', key: 'loai', width: 38 }, { header: 'Chi tiết', key: 'chiTiet', width: 60 },
      { header: 'Giá trị hiện tại', key: 'giaTri', width: 45 }, { header: 'Cách sửa', key: 'cachSua', width: 60 },
    ];
    sh.getRow(1).font = { bold: true };
    sh.views = [{ state: 'frozen', ySplit: 1 }];
    gopDongCungNguyenNhan(dsTeam).sort((a, b) => a.loai.localeCompare(b.loai) || String(a.sttKey).localeCompare(String(b.sttKey))).forEach(d => sh.addRow(d));
    sh.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true }; });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Gửi danh sách lỗi dữ liệu (không có lỗi -> không gửi gì). -> { ok, loi, soLoi }
async function guiLoiDuLieu({ chat, token, guiTinNhan, guiFile }, ms = Date.now()) {
  const ds = await danhSachLoiDuLieu();
  if (!ds.length) return { ok: true, soLoi: 0 };
  const theoTeam = new Map();
  for (const d of ds) {
    const t = theoTeam.get(d.team) || theoTeam.set(d.team, { don: new Set(), nhom: new Map() }).get(d.team);
    t.don.add(d.sttKey); t.nhom.set(d.nhom, (t.nhom.get(d.nhom) || 0) + 1);
  }
  const soDon = new Set(ds.map(d => d.sttKey)).size;
  const dong = [`🧾 <b>Lỗi dữ liệu cần Seller sửa</b> (${ngayGio(ms)}) — ${soDon} đơn / ${ds.length} lỗi`];
  for (const [team, t] of [...theoTeam].sort((a, b) => b[1].don.size - a[1].don.size)) {
    dong.push(`• <b>${esc(team)}</b>: ${t.don.size} đơn (${[...t.nhom].map(([n, c]) => `${esc(n)} ${c}`).join(' · ')})`);
  }
  dong.push('File Excel kèm theo: mỗi Team 1 sheet (mã đơn, loại lỗi, giá trị hiện tại, cách sửa) — chuyển cho từng Seller.');
  const kqTin = await guiTinNhan(chat, dong.join('\n'), token);
  if (!kqTin.ok) return { ...kqTin, soLoi: ds.length };
  const kqFile = await guiFile(chat, `LoiDuLieu_${vn(ms).slice(0, 10).replace(/-/g, '')}.xlsx`, await taoFileLoiDuLieu(ds), token);
  return { ...kqFile, soLoi: ds.length };
}

// ======================= (6) Báo cáo vận hành tuần =======================
const KHAU = [
  { ten: 'Chuẩn bị (in mã → sẵn sàng chạy máy)', tu: 'Đã in mã', den: 'ĐÃ SẴN SÀNG CHẠY MÁY' },
  { ten: 'Chờ máy (sẵn sàng → bắt đầu chạy)', tu: 'ĐÃ SẴN SÀNG CHẠY MÁY', den: 'Đang chạy máy' },
  { ten: 'Chạy máy (→ đã sản xuất)', tu: 'Đang chạy máy', den: 'Đã sản xuất' },
  { ten: 'Dán tem (đã sản xuất → dán tem)', tu: 'Đã sản xuất', den: 'ĐÃ DÁN TEM' },
];
const TONG = { ten: 'Tổng (in mã → dán tem)', tu: 'Đã in mã', den: 'ĐÃ DÁN TEM' };
const MOC_DEM = [['Đã in mã', 'in mã'], ['Đã sản xuất', 'sản xuất'], ['ĐÃ DÁN TEM', 'dán tem'], ['LỖI SẢN XUẤT CẦN LÀM LẠI', 'làm lại'], ['CANCELLED_Đã hủy', 'huỷ']];
const TONG_XUONG = '__TOAN_XUONG__';

// -> { tuMs, denMs, nhom: Map(xưởng -> { vao, khau, keT, qc }) } — tính thuần từ dữ liệu (dễ kiểm thử).
function tinhBaoCaoTuan({ ms, rows, lichSu, qcLog, mucCanhBao, donNhanQuaLau, donMuaThuCong }) {
  const tuMs = ms - 7 * MOT_NGAY_MS;
  const xuongCua = new Map(rows.map(r => [r.STT_Key, r.XUONG || '(chưa gán Xưởng)']));
  const nhom = new Map();
  const lay = x => nhom.get(x) || nhom.set(x, { vao: {}, khau: {}, ket: { DO: 0, CAM: 0, VANG: 0, nhanLau: 0, muaThuCong: 0 }, qc: {} }).get(x);
  const cacNhom = key => [lay(TONG_XUONG), lay(xuongCua.get(key) || '(không rõ Xưởng)')];

  // Thời gian từng khâu: phát lại nhật ký đổi TRANG_THAI_XUONG (cũ trước); mỗi lần đơn VÀO trạng thái đích trong tuần, lấy mốc đơn vào
  // trạng thái nguồn GẦN NHẤT trước đó. Nhật ký lấy từ trước tuần 30 ngày để có mốc nguồn của đơn vào khâu từ tuần trước.
  const mocVao = new Map();
  for (const l of lichSu) {
    if (l.Cot !== 'TRANG_THAI_XUONG') continue;
    const t = Date.parse(l.ThoiGian);
    if (!Number.isFinite(t) || t >= ms) continue;
    const m = mocVao.get(l.STT_Key) || mocVao.set(l.STT_Key, {}).get(l.STT_Key);
    if (t >= tuMs) {
      for (const g of cacNhom(l.STT_Key)) {
        g.vao[l.Sang] = (g.vao[l.Sang] || 0) + 1;
        for (const k of [...KHAU, TONG]) if (k.den === l.Sang && m[k.tu] != null && m[k.tu] <= t) (g.khau[k.ten] = g.khau[k.ten] || []).push(t - m[k.tu]);
      }
    }
    m[l.Sang] = t;
  }
  for (const r of rows) {
    const muc = mucCanhBao(r);
    if (muc) for (const g of cacNhom(r.STT_Key)) g.ket[muc]++;
  }
  for (const k of donNhanQuaLau) for (const g of cacNhom(k)) g.ket.nhanLau++;
  for (const k of donMuaThuCong) for (const g of cacNhom(k)) g.ket.muaThuCong++;
  for (const q of qcLog) {
    for (const g of cacNhom(q.STT_Key)) {
      const c = g.qc[q.LoaiQc] || (g.qc[q.LoaiQc] = { tong: 0, FAIL: 0, CAN_CHECK_LAI: 0 });
      c.tong++;
      if (c[q.KetQua] !== undefined) c[q.KetQua]++;
    }
  }
  return { tuMs, denMs: ms, nhom };
}

const tyLe = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
function dongQc(qc) {
  const ds = Object.entries(qc).sort((a, b) => a[0].localeCompare(b[0]));
  return ds.length ? ds.map(([loai, c]) => `${esc(loai)} ${c.tong} lượt · FAIL ${tyLe(c.FAIL, c.tong)} · cần check lại ${tyLe(c.CAN_CHECK_LAI, c.tong)}`).join('\n   ') : 'không có lượt QC nào';
}
const dongVao = g => MOC_DEM.map(([tt, nhan]) => `${nhan} ${g.vao[tt] || 0}`).join(' · ');
const dongKhau = (k, ds) => `${k}: ${ds && ds.length ? `giữa ${thoiLuong(phanVi(ds, 0.5))} · 90% ≤ ${thoiLuong(phanVi(ds, 0.9))} (${ds.length} đơn)` : '—'}`;
const dongKet = k => `Đỏ ${k.DO} · Cam ${k.CAM} · Vàng ${k.VANG} · nhận quá lâu ${k.nhanLau} · chờ mua tracking thủ công ${k.muaThuCong}`;

function vanBanBaoCaoTuan({ tuMs, denMs, nhom }, moTaPhienBan) {
  const tong = nhom.get(TONG_XUONG) || { vao: {}, khau: {}, ket: { DO: 0, CAM: 0, VANG: 0, nhanLau: 0, muaThuCong: 0 }, qc: {} };
  const dong = [
    `📊 <b>Báo cáo vận hành tuần</b> (${ngayGio(tuMs)} → ${ngayGio(denMs)})`,
    `<i>Phiên bản: ${esc(moTaPhienBan)}</i>`,
    '',
    '<b>TOÀN XƯỞNG</b>',
    `• Đơn vào các mốc trong tuần: ${dongVao(tong)}`,
    '• Thời gian từng khâu (giữa / 90% đơn xong trong khoảng):',
    ...[...KHAU, TONG].map(k => `   ${dongKhau(esc(k.ten), tong.khau[k.ten])}`),
    `• Đang kẹt lúc gửi: ${dongKet(tong.ket)}`,
    `• QC trong tuần:\n   ${dongQc(tong.qc)}`,
  ];
  const cacXuong = [...nhom.keys()].filter(x => x !== TONG_XUONG).sort((a, b) => String(a).localeCompare(String(b)));
  for (const x of cacXuong) {
    const g = nhom.get(x);
    dong.push('', `<b>${esc(x)}</b>`, `• ${dongVao(g)}`, `• ${dongKhau(esc(TONG.ten), g.khau[TONG.ten])}`, `• Kẹt: ${dongKet(g.ket)}`, `• QC: ${dongQc(g.qc)}`);
  }
  return dong.join('\n');
}

async function taoBaoCaoTuan(ms = Date.now()) {
  const { rows } = await orderService.getAll();
  const alertService = require('./alertService');
  const vanHanhService = require('./vanHanhService');
  const trackingAutoService = require('./trackingAutoService');
  const cauHinhCanhBao = alertService.layCauHinhCanhBao();
  const conLai = rows.filter(r => !daKetThuc(r));
  const duLieu = tinhBaoCaoTuan({
    ms, rows,
    lichSu: trangThaiDbService.layLichSuDoiTrangThaiTu(vn(ms - 37 * MOT_NGAY_MS)),
    qcLog: nhatKy.layQcLogTrongKhoang(vn(ms - 7 * MOT_NGAY_MS), vn(ms)),
    mucCanhBao: r => (daKetThuc(r) ? null : alertService.tinhMucCanhBao(r, cauHinhCanhBao)),
    donNhanQuaLau: vanHanhService.donDangNhan(conLai, vanHanhService.layCauHinh().y6).filter(d => d.quaHan).map(d => d.sttKey),
    donMuaThuCong: (await trackingAutoService.layDonChuyenThuCong({ vaiTro: 'superadmin' })).map(d => d.sttKey),
  });
  return vanBanBaoCaoTuan(duLieu, require('./phienBanService').moTa);
}

// Tin dài hơn giới hạn Telegram (4096 ký tự) -> tách theo dòng thành nhiều tin.
async function guiTinDai(guiTinNhan, chat, text, token) {
  const phan = [];
  let hienTai = '';
  for (const d of text.split('\n')) {
    if (hienTai && (hienTai.length + d.length + 1) > 3800) { phan.push(hienTai); hienTai = ''; }
    hienTai += (hienTai ? '\n' : '') + d;
  }
  if (hienTai) phan.push(hienTai);
  for (const p of phan) {
    const kq = await guiTinNhan(chat, p, token);
    if (!kq.ok) return kq;
  }
  return { ok: true };
}

module.exports = { thongKeTocDo, donSoDoCu, thongKeMang, taoCsvDoMang, thongKeMangMayChu, taoCsvDoMangMayChu, taoCsv, danhSachLoiDuLieu, taoFileLoiDuLieu, guiLoiDuLieu, tinhBaoCaoTuan, vanBanBaoCaoTuan, taoBaoCaoTuan, guiTinDai };
