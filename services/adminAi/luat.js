// AdminAI — các LUẬT phát hiện vấn đề + SỐ LIỆU THỰC TẾ cho từng ngưỡng (03/10/2026, theo yêu cầu người dùng, CHỈ superadmin).
// Nguyên tắc (đã chốt với người dùng):
//  - Chỉ PHÁT HIỆN / CẢNH BÁO — không tự sửa đơn, không đổi trạng thái, không sửa địa chỉ, không mua tracking.
//  - KHÔNG có ngưỡng mặc định: luật cần ngưỡng chỉ chạy khi superadmin đã nhập; số liệu 30 ngày qua hiển thị để người dùng tự chọn.
//  - Mọi luật mặc định TẮT — superadmin tự bật ở menu AdminAI.
// Mỗi ngưỡng có hàm soLieu(ctx) -> { mau: [số] (lịch sử 30 ngày), hienTai: [{ gia, ... }] (đang diễn ra) } — luật dùng CHÍNH hienTai
// này để so ngưỡng, nên số liệu hiển thị và cảnh báo thật luôn khớp nhau.
const fs = require('fs');
const path = require('path');
const orderService = require('../orderService');
const trangThaiDbService = require('../trangThaiDbService');
const nhatKyDbService = require('../nhatKyDbService');
const caiDatDbService = require('../caiDatDbService');
const taiKhoanService = require('../taiKhoanService');
const donNhieuAoService = require('../donNhieuAoService');
const { chiSoTinhTrang, TRANG_THAI_KET_THUC } = require('../../data/pipelineTinhTrang');
const { thoiGianVNISOString } = require('../dateUtils');
const { khoangCachHamming } = require('../perceptualHashService');

const GIO = 3600000;
const NGAY = 24 * GIO;
const SO_NGAY_SO_LIEU = 30;
const tg = s => { const t = Date.parse(s); return Number.isNaN(t) ? null : t; };
const docJson = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const ngayVN = t => new Date(t + 7 * GIO).toISOString().slice(0, 10);
const gioVN = t => { const d = new Date(t + 7 * GIO); return d.getUTCHours() + d.getUTCMinutes() / 60; };
const hienGio = t => { const d = new Date(t + 7 * GIO).toISOString(); return `${d.slice(11, 16)} ${d.slice(8, 10)}/${d.slice(5, 7)}`; };
const lam1 = x => Math.round(x * 10) / 10;
const TRANG_THAI_LOI_SX = 'LỖI SẢN XUẤT CẦN LÀM LẠI';
const HANH_DONG_DOI_TRANG_THAI = ['QUET_KICH_BAN', 'QUET_KICH_BAN_HANG_LOAT', 'CHUYEN_TRANG_THAI_HANG_LOAT', 'CAP_NHAT_DON', 'UPLOAD_ANH', 'CHI_DINH_NGUOI_CHAY_MAY', 'CHI_DINH_NGUOI_VE_FILE'];
const HANH_DONG_SUA_TAY = ['CAP_NHAT_DON', 'CHUYEN_TRANG_THAI_HANG_LOAT'];
const COT_TRANG_THAI = ['TRANG_THAI_XUONG', 'TRANG_THAI_PHOI', 'TRANG_THAI_VE_FILE'];
const COT_ANH = { Anh_Da_San_Xuat_URL: 'ảnh đã sản xuất', Anh_Da_Dan_Tem_URL: 'ảnh dán tem' };
const COT_MOC_ANH = { Anh_Da_San_Xuat_URL: 'THOI_GIAN_SAN_XUAT', Anh_Da_Dan_Tem_URL: 'THOI_GIAN_DAN_TEM' };
// Trạng thái chung có ngưỡng "đơn kẹt" riêng. Không có "Chưa in mã" (không biết lúc đơn vào trạng thái này) và trạng thái kết thúc.
const TRANG_THAI_KET = ['Đã in mã', 'ĐÃ SẴN SÀNG CHẠY MÁY', 'Đang chạy máy', 'Đã sản xuất', TRANG_THAI_LOI_SX, 'ĐÃ DÁN TEM'];
const DUONG_DAN_LOG = process.env.SERVER_LOG_PATH || path.join(__dirname, '..', '..', 'data', 'server.log');

// ---------------- Ngữ cảnh 1 lượt quét: đọc dữ liệu 1 lần, các luật/số liệu dùng chung ----------------
async function taoNguCanh(bayGio = Date.now()) {
  const { rows } = await orderService.getAll(); // cache 10 giây của orderService là đủ — không ép đọc Sheets mỗi lượt
  const tu = bayGio - (SO_NGAY_SO_LIEU + 1) * NGAY;
  const tuIso = thoiGianVNISOString(new Date(tu));
  const vaiTro = new Map(taiKhoanService.layTatCa().map(u => [u.Ten, u.VaiTro]));
  // Người làm thao tác cần theo dõi: không phải hệ thống, không phải superadmin (chủ xưởng tự sửa không phải "lỗi do con người" cần báo).
  const laNhanVien = ten => !!ten && ten !== 'Hệ thống' && vaiTro.get(ten) !== 'superadmin';
  const logs = [];
  // Từ mốc có lịch sử chính xác trở đi KHÔNG lấy chuyển trạng thái từ nhật ký nữa — trộn 2 nguồn cho cùng 1 lần đổi (lệch vài ms, nhật ký
  // còn ghi bước trung gian khi hệ thống tự chuyển tiếp) sinh ra chuyển qua-lại giả.
  const mocChinhXac = tg(trangThaiDbService.mocBatDauLichSuDoi()) ?? Infinity;
  const chuyen = new Map(); // STT_Key -> [{ t, sang, nguoi, tu? }] trạng thái chung, cũ trước
  const themChuyen = (k, t, sang, nguoi, tuGt) => {
    if (!k || !sang || t === null) return;
    if (!chuyen.has(k)) chuyen.set(k, []);
    chuyen.get(k).push({ t, sang, nguoi: nguoi || '', tu: tuGt });
  };
  for (const r of nhatKyDbService.layTatCaLichSuHoatDong()) {
    const t = tg(r.ThoiGian);
    if (t === null || (t < tu && t >= mocChinhXac)) continue; // dòng cũ sau mốc lịch sử chính xác: không dùng cho gì — khỏi parse JSON
    const ct = docJson(r.ChiTiet);
    if (t < mocChinhXac && HANH_DONG_DOI_TRANG_THAI.includes(r.HanhDong) && ct && typeof ct === 'object') {
      const cot = ct.cot || 'TRANG_THAI_XUONG';
      const sang = r.HanhDong === 'CAP_NHAT_DON' ? ct.TRANG_THAI_XUONG : cot === 'TRANG_THAI_XUONG' ? ct.sang : undefined;
      themChuyen(r.STT_Key, t, sang, r.NguoiDung, r.HanhDong === 'CAP_NHAT_DON' ? (ct._truocKhiSua || {}).TRANG_THAI_XUONG : ct.tu);
      if (ct.tuDongChuyenTinhTrangSang) themChuyen(r.STT_Key, t, ct.tuDongChuyenTinhTrangSang, r.NguoiDung);
    }
    if (t >= tu) logs.push({ ...r, t, ct });
  }
  logs.sort((a, b) => a.t - b.t); // câu đọc nhật ký không có ORDER BY (dữ liệu cũ chuyển từ Sheets) — các luật cần thứ tự thời gian
  // Lịch sử chính xác (có giá trị cũ, kể cả tự chuyển) — chỉ có từ khi deploy AdminAI.
  const doiChinhXac = trangThaiDbService.layLichSuDoiTrangThaiTu(tuIso).map(d => ({ ...d, t: tg(d.ThoiGian) }));
  for (const d of doiChinhXac) if (d.Cot === 'TRANG_THAI_XUONG') themChuyen(d.STT_Key, d.t, d.Sang, d.Nguoi, d.Tu);
  // Sắp xếp + bỏ dòng liền kề cùng giá trị "sang" (nhật ký có thể ghi lại đúng giá trị cũ); "tu" thiếu thì lấy từ dòng trước.
  for (const [k, ds] of chuyen) {
    ds.sort((a, b) => a.t - b.t);
    const gon = [];
    for (const d of ds) {
      const truoc = gon[gon.length - 1];
      if (truoc && truoc.sang === d.sang) continue;
      gon.push({ ...d, tu: d.tu || (truoc ? truoc.sang : '') });
    }
    chuyen.set(k, gon);
  }
  const theoKey = new Map(rows.map(r => [r.STT_Key, r]));
  const banDoNhom = donNhieuAoService.xayDungBanDoNhom(rows);
  // Đơn thuộc nhóm DonNhieuAo nhưng KHÔNG phải đơn in label của nhóm -> không có label riêng, bỏ qua ở các luật label.
  const khongInRieng = r => { const n = banDoNhom.get(r.STT_Key); return !!n && (!n.donIn || n.donIn.STT_Key !== r.STT_Key); };
  return { bayGio, tu, tuIso, rows, theoKey, logs, chuyen, doiChinhXac, laNhanVien, banDoNhom, khongInRieng, cache: {} };
}
const conHoatDong = r => r && !TRANG_THAI_KET_THUC.includes(r.TRANG_THAI_XUONG);
const nho = (ctx, ten, fn) => (ctx.cache[ten] ??= fn());

// Lần in label (nhật ký IN_LABEL, có từ 27/09/2026) theo đơn — cũ trước.
const lanInLabel = ctx => nho(ctx, 'inLabel', () => {
  const m = new Map();
  for (const r of ctx.logs) if (r.HanhDong === 'IN_LABEL') { if (!m.has(r.STT_Key)) m.set(r.STT_Key, []); m.get(r.STT_Key).push(r.t); }
  return m;
});
// Lần mua tracking thành công (logs_tracking, không tính "In label"/"Dùng chung") theo đơn — cũ trước.
const lanMuaTracking = ctx => nho(ctx, 'mua', () => {
  const m = new Map();
  for (const r of nhatKyDbService.layTatCaLogsTracking()) {
    const t = tg(r.ThoiGian);
    if (t === null || t < ctx.tu || r.KetQua !== 'Thành công' || r.Nguon === 'In label' || r.Nguon === 'DonNhieuAo') continue;
    if (!m.has(r.STT_Key)) m.set(r.STT_Key, []);
    m.get(r.STT_Key).push(t);
  }
  for (const ds of m.values()) ds.sort((a, b) => a - b);
  return m;
});
const qcLogs = ctx => nho(ctx, 'qc', () => nhatKyDbService.layQcLogTu(ctx.tuIso).map(r => ({ ...r, t: tg(r.ThoiGian) })));
// Lần QC MỚI NHẤT (không tính LỖI API) theo "đơn|loại".
const qcMoiNhat = ctx => nho(ctx, 'qcMoi', () => {
  const m = new Map();
  for (const r of qcLogs(ctx)) if (r.KetQua !== 'LOI') m.set(`${r.STT_Key}|${r.LoaiQc}`, r);
  return m;
});
// Mốc đơn VÀO trạng thái chung hiện tại: lịch sử chuyển -> mốc đổi trạng thái gần nhất (nếu lần đó đổi trạng thái chung) -> cột mốc riêng.
function mocVaoTrangThai(ctx, r) {
  const ds = ctx.chuyen.get(r.STT_Key) || [];
  const cuoi = ds[ds.length - 1];
  if (cuoi && cuoi.sang === r.TRANG_THAI_XUONG) return cuoi.t;
  const truoc = docJson(r.TRANG_THAI_TRUOC_DO);
  if (truoc && Object.hasOwn(truoc, 'TRANG_THAI_XUONG') && tg(r.THOI_GIAN_DOI_TRANG_THAI)) return tg(r.THOI_GIAN_DOI_TRANG_THAI);
  const cotRieng = { 'Đã in mã': 'THOI_GIAN_IN_MA', 'Đã sản xuất': 'THOI_GIAN_SAN_XUAT', 'ĐÃ DÁN TEM': 'THOI_GIAN_DAN_TEM' }[r.TRANG_THAI_XUONG];
  return cotRieng ? tg(r[cotRieng]) : null;
}

// ---------------- Số liệu cho từng ngưỡng ----------------
// Thao tác đổi trạng thái của nhân viên (để đếm ngoài giờ / sửa tay) trong 31 ngày.
// Chỉ dòng THẬT SỰ đổi trạng thái: sửa đơn có cột trạng thái, hoặc dòng có "sang"/tự chuyển (tải ảnh không chuyển trạng thái thì không tính).
const coDoiTrangThai = r => !!r.ct && (r.HanhDong === 'CAP_NHAT_DON' ? COT_TRANG_THAI.some(c => Object.hasOwn(r.ct, c)) : !!(r.ct.sang || r.ct.tuDongChuyenTinhTrangSang));
const thaoTacNhanVien = (ctx, dsHanhDong) => ctx.logs.filter(r => dsHanhDong.includes(r.HanhDong) && ctx.laNhanVien(r.NguoiDung) && coDoiTrangThai(r));

// Route "chuyển hàng loạt" cũng là luồng CHÍNH THỨC của vài việc — không phải sửa tay: san_xuat nhận chạy máy (my-orders.html,
// nút BẮT ĐẦU CHẠY MÁY), ve_file nhận vẽ / đánh dấu Đã vẽ file (my-orders-ve-file.html), nút ở Chi tiết đơn + hệ thống huỷ theo
// nhóm (có lyDo). Còn lại (orders.html chuyển hàng loạt, ô sửa trạng thái thủ công) mới là sửa tay.
const laLuongChinhThuc = r => r.HanhDong === 'CHUYEN_TRANG_THAI_HANG_LOAT' && !!r.ct && (!!r.ct.lyDo
  || (r.VaiTro === 'san_xuat' && r.ct.sang === 'Đang chạy máy')
  || (r.VaiTro === 've_file' && r.ct.cot === 'TRANG_THAI_VE_FILE' && ['Đang vẽ file', 'Đã vẽ file'].includes(r.ct.sang)));
function soLieuSuaTay(ctx) {
  const dem = new Map(); // "người|ngày" -> Set đơn
  for (const r of thaoTacNhanVien(ctx, HANH_DONG_SUA_TAY).filter(x => !laLuongChinhThuc(x))) {
    const k = `${r.NguoiDung}|${ngayVN(r.t)}`;
    if (!dem.has(k)) dem.set(k, new Set());
    dem.get(k).add(r.STT_Key);
  }
  const homNay = ngayVN(ctx.bayGio);
  const mau = [], hienTai = [];
  for (const [k, ds] of dem) {
    const [nguoi, ngay] = k.split('|');
    if (ngay === homNay) hienTai.push({ gia: ds.size, nguoi, ngay, ds: [...ds] });
    else mau.push(ds.size);
  }
  return { mau, hienTai, ghiChu: 'Mỗi mẫu = số đơn 1 nhân viên sửa tay trạng thái (ô sửa trạng thái thủ công / chuyển hàng loạt ở trang Đơn hàng) trong 1 ngày. Không tính quét QR, chụp ảnh, nhận chạy máy, nhận / xong vẽ file, nút ở Chi tiết đơn, hệ thống, superadmin.' };
}
function soLieuGioLam(ctx) {
  const theoGio = Array(24).fill(0);
  for (const r of thaoTacNhanVien(ctx, HANH_DONG_DOI_TRANG_THAI)) if (r.t >= ctx.bayGio - SO_NGAY_SO_LIEU * NGAY) theoGio[Math.floor(gioVN(r.t))]++;
  return { theoGio, mau: [], hienTai: [], ghiChu: 'Số thao tác đổi trạng thái của nhân viên theo từng giờ (giờ VN) trong 30 ngày qua.' };
}
function soLieuInLabelLap(ctx) {
  const mau = [], hienTai = [];
  for (const [k, ds] of lanInLabel(ctx)) {
    mau.push(ds.length);
    hienTai.push({ gia: ds.length, sttKey: k, lan: ds });
  }
  return { mau, hienTai, ghiChu: 'Mỗi mẫu = số lần in label của 1 đơn có in label trong 30 ngày qua.' };
}
function soLieuMuaChuaIn(ctx) {
  const inLabel = lanInLabel(ctx), mua = lanMuaTracking(ctx);
  const mau = [], hienTai = [];
  // Lịch sử: lần in ĐẦU của mỗi đơn — tính từ lúc đơn vừa đủ điều kiện in (đã sản xuất VÀ đã có tracking).
  for (const [k, ds] of inLabel) {
    const lanIn = ds[0];
    const sx = (ctx.chuyen.get(k) || []).filter(c => c.sang === 'Đã sản xuất' && c.t <= lanIn).map(c => c.t).pop();
    const lanMua = (mua.get(k) || []).filter(t => t <= lanIn).pop();
    if (sx === undefined && lanMua === undefined) continue;
    mau.push(lam1((lanIn - Math.max(sx ?? 0, lanMua ?? 0)) / GIO));
  }
  for (const r of ctx.rows) {
    if (r.TRANG_THAI_XUONG !== 'Đã sản xuất' || !r.TRACKING_ID || ctx.khongInRieng(r)) continue;
    const batDau = Math.max(tg(r.THOI_GIAN_SAN_XUAT) ?? 0, (mua.get(r.STT_Key) || []).at(-1) ?? 0);
    if (!batDau) continue; // không rõ lúc đủ điều kiện in — không đoán
    if ((tg(r.THOI_GIAN_IN_LABEL) ?? 0) >= batDau) continue; // đã in sau mốc đó
    hienTai.push({ gia: lam1((ctx.bayGio - batDau) / GIO), sttKey: r.STT_Key, batDau });
  }
  return { mau, hienTai, ghiChu: 'Số giờ từ lúc đơn "Đã sản xuất" và có tracking đến lần in label đầu tiên. Bỏ qua đơn kiện gom không in label riêng.' };
}
function soLieuInChuaDan(ctx) {
  const inLabel = lanInLabel(ctx);
  const mau = [], hienTai = [];
  for (const [k, ds] of ctx.chuyen) {
    for (const c of ds) {
      if (c.sang !== 'ĐÃ DÁN TEM' || c.t < ctx.bayGio - SO_NGAY_SO_LIEU * NGAY) continue;
      const lanIn = (inLabel.get(k) || []).filter(t => t <= c.t).pop();
      if (lanIn !== undefined) mau.push(lam1((c.t - lanIn) / GIO));
    }
  }
  for (const r of ctx.rows) {
    if (r.TRANG_THAI_XUONG !== 'Đã sản xuất' || ctx.khongInRieng(r)) continue;
    const lanIn = tg(r.THOI_GIAN_IN_LABEL);
    if (!lanIn || lanIn < (tg(r.THOI_GIAN_SAN_XUAT) ?? 0)) continue;
    hienTai.push({ gia: lam1((ctx.bayGio - lanIn) / GIO), sttKey: r.STT_Key, lanIn });
  }
  return { mau, hienTai, ghiChu: 'Số giờ từ lần in label gần nhất đến lúc đơn chuyển "ĐÃ DÁN TEM".' };
}
function soLieuKet(trangThai) {
  return ctx => {
    const mau = [], hienTai = [];
    const tuMau = ctx.bayGio - SO_NGAY_SO_LIEU * NGAY;
    for (const ds of ctx.chuyen.values()) {
      for (let i = 0; i < ds.length - 1; i++) if (ds[i].sang === trangThai && ds[i + 1].t >= tuMau) mau.push(lam1((ds[i + 1].t - ds[i].t) / GIO));
    }
    for (const r of ctx.rows) {
      if (r.TRANG_THAI_XUONG !== trangThai) continue;
      const vao = mocVaoTrangThai(ctx, r);
      if (vao) hienTai.push({ gia: lam1((ctx.bayGio - vao) / GIO), sttKey: r.STT_Key, vao });
    }
    return { mau, hienTai, ghiChu: `Số giờ đơn nằm ở "${trangThai}" (từ lúc vào đến lúc chuyển sang trạng thái khác).` };
  };
}
function soLieuQc3ChuaChay(ctx) {
  const mocQc = tg(caiDatDbService.layMocApDungAutoQc()) ?? ctx.bayGio;
  const qc3 = new Map();
  for (const r of qcLogs(ctx)) if (r.LoaiQc === 'QC3' && r.KetQua !== 'LOI') { if (!qc3.has(r.STT_Key)) qc3.set(r.STT_Key, []); qc3.get(r.STT_Key).push(r.t); }
  const mau = [], hienTai = [];
  for (const r of ctx.rows) {
    const dan = tg(r.THOI_GIAN_DAN_TEM);
    if (!dan || dan < Math.max(mocQc, ctx.tu)) continue; // chỉ đơn dán tem từ khi có AI QC
    const lanQc = (qc3.get(r.STT_Key) || []).find(t => t >= dan);
    if (lanQc !== undefined) mau.push(lam1((lanQc - dan) / GIO));
    else if (r.TRANG_THAI_XUONG === 'ĐÃ DÁN TEM') hienTai.push({ gia: lam1((ctx.bayGio - dan) / GIO), sttKey: r.STT_Key, dan });
  }
  return { mau, hienTai, ghiChu: 'Số giờ từ lúc đơn "ĐÃ DÁN TEM" đến lần QC3 đầu tiên (không tính chạy thử, lỗi API). Chỉ đơn dán tem từ khi có AI QC.' };
}
function soLieuCclChuaDanhGia(ctx) {
  const mau = [], hienTai = [];
  for (const r of qcLogs(ctx)) if (r.KetQua === 'CAN_CHECK_LAI' && r.DanhGiaThucTe && tg(r.DanhGiaThoiGian)) mau.push(lam1((tg(r.DanhGiaThoiGian) - r.t) / GIO));
  for (const r of qcMoiNhat(ctx).values()) {
    if (r.KetQua !== 'CAN_CHECK_LAI' || r.DanhGiaThucTe || !conHoatDong(ctx.theoKey.get(r.STT_Key))) continue;
    hienTai.push({ gia: lam1((ctx.bayGio - r.t) / GIO), sttKey: r.STT_Key, loaiQc: r.LoaiQc, logId: r.id });
  }
  return { mau, hienTai, ghiChu: 'Số giờ từ lần QC ra "Cần check lại" đến lúc được đánh giá thực tế ở menu QC.' };
}
// Log server: dòng [ERROR], gộp theo nhãn [Xxx] đầu tiên trong nội dung (không có nhãn: 60 ký tự đầu, số thay bằng #).
function docLoiLog() {
  let noiDung = '';
  try { noiDung = fs.readFileSync(DUONG_DAN_LOG, 'utf8'); } catch (e) { return []; }
  const ds = [];
  for (const dong of noiDung.split('\n')) {
    const m = /^\[([^\]]+)\] \[ERROR\] (.*)$/.exec(dong);
    if (!m) continue;
    const t = tg(m[1]);
    if (t === null) continue;
    const nhan = /\[([^\]]{1,40})\]/.exec(m[2]);
    ds.push({ t, nhom: nhan ? `[${nhan[1]}]` : m[2].slice(0, 60).replace(/\d+/g, '#'), noiDung: m[2].slice(0, 300) });
  }
  return ds;
}
function soLieuLoiLog(ctx) {
  const ds = nho(ctx, 'loiLog', docLoiLog);
  const theoGio = new Map(); // "nhóm|giờ" -> số lỗi
  const gan = new Map(); // nhóm -> lỗi trong 60 phút qua
  for (const l of ds) {
    const k = `${l.nhom}|${Math.floor(l.t / GIO)}`;
    theoGio.set(k, (theoGio.get(k) || 0) + 1);
    if (l.t >= ctx.bayGio - GIO) { if (!gan.has(l.nhom)) gan.set(l.nhom, []); gan.get(l.nhom).push(l); }
  }
  return {
    mau: [...theoGio.values()],
    hienTai: [...gan].map(([nhom, ls]) => ({ gia: ls.length, nhom, viDu: ls[ls.length - 1].noiDung })),
    ghiChu: 'Mỗi mẫu = số lỗi của 1 nhóm lỗi trong 1 giờ (chỉ tính giờ có lỗi), lấy từ log server hiện có.',
  };
}
function soLieuODia() {
  try {
    const s = fs.statfsSync(path.dirname(DUONG_DAN_LOG));
    const phanTram = lam1(((s.blocks - s.bavail) / s.blocks) * 100);
    return { mau: [], hienTai: [{ gia: phanTram, trong: Math.round((s.bavail * s.bsize) / 1024 / 1024) }], ghiChu: 'Phần trăm dung lượng ổ đĩa chứa dữ liệu app (data/) đã dùng.' };
  } catch (e) {
    return { mau: [], hienTai: [], ghiChu: `Không đọc được dung lượng ổ đĩa: ${e.message}` };
  }
}
// Chi phí AI theo ngày (USD) = token QC + token AdminAI x giá đã nhập ở menu QC. Model chưa có giá -> không tính được, ghi rõ.
function chiPhiTheoNgay(tuIso) {
  const gia = Object.fromEntries(caiDatDbService.layGiaTokenQc().map(g => [g.Model, g]));
  const ngay = new Map();
  for (const d of [...nhatKyDbService.thongKeTokenQc(tuIso, 'NGAY'), ...nhatKyDbService.thongKeTokenAdminAi(tuIso)]) {
    if (!ngay.has(d.Ky)) ngay.set(d.Ky, { chiPhi: 0, chuaCoGia: new Set() });
    const g = gia[d.Model];
    if (g) ngay.get(d.Ky).chiPhi += (d.tokenVao * Number(g.GiaVao) + d.tokenRa * Number(g.GiaRa)) / 1e6;
    else ngay.get(d.Ky).chuaCoGia.add(d.Model);
  }
  return ngay;
}
function soLieuChiPhi(ctx) {
  const ngay = chiPhiTheoNgay(ctx.tuIso);
  const homNay = ngayVN(ctx.bayGio);
  const mau = [], hienTai = [];
  for (const [k, v] of ngay) {
    if (k === homNay) hienTai.push({ gia: Math.round(v.chiPhi * 100) / 100, ngay: k, chuaCoGia: [...v.chuaCoGia] });
    else mau.push(Math.round(v.chiPhi * 100) / 100);
  }
  return { mau, hienTai, ghiChu: 'Chi phí AI mỗi ngày (USD) = QC + AdminAI, theo giá token đã nhập ở menu QC. Model chưa nhập giá không được tính.' };
}
// Ảnh trùng: các cặp ảnh của 2 đơn KHÁC nhau (không cùng nhóm DonNhieuAo). ponytail: so mọi cặp O(n²) — vài nghìn ảnh / 30 ngày
// vẫn dưới 1 giây; nếu nhiều hơn hẳn thì cần chỉ so ảnh mới với ảnh cũ.
function capAnh(ctx) {
  return nho(ctx, 'capAnh', () => {
    // Chỉ ảnh của đơn có mốc (sản xuất / dán tem) trong 30 ngày — bảng băm tăng mãi theo thời gian, so mọi cặp sẽ chậm dần.
    const tuMoc = ctx.bayGio - SO_NGAY_SO_LIEU * NGAY;
    const ds = nhatKyDbService.layTatCaAnhHash().filter(a => {
      const r = a.Hash && ctx.theoKey.get(a.STT_Key);
      return r && r[a.Cot] === a.Url && (tg(r[COT_MOC_ANH[a.Cot]]) ?? 0) >= tuMoc;
    });
    const nhomCua = k => { const n = ctx.banDoNhom.get(k); return n ? n.goc : k; };
    const gan = ds.map(() => Infinity);
    const cap = [];
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        if (nhomCua(ds[i].STT_Key) === nhomCua(ds[j].STT_Key)) continue;
        const kc = khoangCachHamming(ds[i].Hash, ds[j].Hash);
        if (kc < gan[i]) gan[i] = kc;
        if (kc < gan[j]) gan[j] = kc;
        if (kc <= 32) cap.push({ a: ds[i], b: ds[j], kc });
      }
    }
    return { ds, gan, cap, soBit: ds.length ? ds[0].Hash.length * 4 : 0 };
  });
}
function soLieuAnhTrung(ctx) {
  const { gan, cap, soBit } = capAnh(ctx);
  return {
    mau: gan.filter(Number.isFinite),
    hienTai: cap.map(c => ({ gia: c.kc, ...c })),
    ghiChu: `Mỗi mẫu = độ khác biệt nhỏ nhất (số bit khác, trên ${soBit || '?'} bit) giữa 1 ảnh và ảnh GẦN GIỐNG NHẤT của 1 đơn khác. Càng nhỏ càng giống; 0 = như nhau.`,
  };
}

// Ngưỡng: soSanh = điều kiện BÁO khi giá trị hiện tại so với ngưỡng (">" vượt quá, ">=" từ ngưỡng trở lên, "<=" từ ngưỡng trở xuống).
const NGUONG = {
  SUA_TAY_NGAY: { ten: 'Số đơn 1 nhân viên sửa tay trạng thái trong 1 ngày', donVi: 'đơn', soSanh: '>', soLieu: soLieuSuaTay },
  GIO_LAM_TU: { ten: 'Giờ bắt đầu làm việc (giờ VN, vd 7.5 = 7:30)', donVi: 'giờ', gioiHan: [0, 24], soLieu: soLieuGioLam },
  GIO_LAM_DEN: { ten: 'Giờ kết thúc làm việc (giờ VN, vd 22 = 22:00)', donVi: 'giờ', gioiHan: [0, 24], soLieu: soLieuGioLam },
  IN_LABEL_LAP: { ten: 'Số lần in label của 1 đơn', donVi: 'lần', soSanh: '>=', soLieu: soLieuInLabelLap },
  GIO_MUA_CHUA_IN: { ten: 'Đã sản xuất + có tracking mà chưa in label', donVi: 'giờ', soSanh: '>', soLieu: soLieuMuaChuaIn },
  GIO_IN_CHUA_DAN: { ten: 'Đã in label mà chưa "ĐÃ DÁN TEM"', donVi: 'giờ', soSanh: '>', soLieu: soLieuInChuaDan },
  ...Object.fromEntries(TRANG_THAI_KET.map(s => [`KET:${s}`, { ten: `Đơn nằm ở "${s}"`, donVi: 'giờ', soSanh: '>', soLieu: soLieuKet(s) }])),
  GIO_QC3_CHUA_CHAY: { ten: 'ĐÃ DÁN TEM mà chưa có QC3', donVi: 'giờ', soSanh: '>', soLieu: soLieuQc3ChuaChay },
  GIO_CCL_CHUA_DANH_GIA: { ten: '"Cần check lại" chưa được đánh giá', donVi: 'giờ', soSanh: '>', soLieu: soLieuCclChuaDanhGia },
  LOI_LOG_GIO: { ten: 'Số lỗi cùng nhóm trong 60 phút', donVi: 'lỗi', soSanh: '>=', soLieu: soLieuLoiLog },
  O_DIA_PT: { ten: 'Ổ đĩa đã dùng', donVi: '%', gioiHan: [1, 100], soSanh: '>=', soLieu: soLieuODia },
  CHI_PHI_NGAY: { ten: 'Chi phí AI trong ngày', donVi: 'USD', soSanh: '>=', soLieu: soLieuChiPhi },
  ANH_TRUNG_KC: { ten: 'Độ khác biệt tối đa để coi là ảnh trùng', donVi: 'bit', gioiHan: [0, 32], soSanh: '<=', soLieu: soLieuAnhTrung },
};
const vuot = (soSanh, gia, nguong) => (soSanh === '>' ? gia > nguong : soSanh === '>=' ? gia >= nguong : gia <= nguong);
const loc = (ctx, khoa, nguong) => nho(ctx, 'sl:' + khoa, () => NGUONG[khoa].soLieu(ctx)).hienTai.filter(x => vuot(NGUONG[khoa].soSanh, x.gia, nguong[khoa]));

// ---------------- Luật ----------------
// tuDong: true = TÌNH TRẠNG (tự đóng khi hết) | false = SỰ KIỆN (đóng khi người dùng bấm Đã xem). nguong: khoá BẮT BUỘC có giá trị.
// Riêng DON_KET: chạy khi có ÍT NHẤT 1 ngưỡng KET:<trạng thái>, chỉ xét trạng thái đã có ngưỡng.
const LUAT = {
  CHUYEN_NGUOC: {
    giaiDoan: 1, ten: 'Chuyển ngược trạng thái', muc: 'CAO', tuDong: false, nguong: [],
    moTa: 'Nhân viên chuyển trạng thái chung LÙI bước (vd Đã sản xuất → Đang chạy máy). Không tính chuyển sang LỖI SẢN XUẤT / Huỷ. Chỉ có dữ liệu từ khi deploy AdminAI.',
    chay: ctx => ctx.doiChinhXac.filter(d => d.Cot === 'TRANG_THAI_XUONG' && d.t >= ctx.bayGio - 3 * NGAY && ctx.laNhanVien(d.Nguoi))
      .filter(d => chiSoTinhTrang(d.Tu) !== null && chiSoTinhTrang(d.Sang) !== null && chiSoTinhTrang(d.Sang) < chiSoTinhTrang(d.Tu))
      .map(d => ({ khoa: `${d.STT_Key}|${d.ThoiGian}`, sttKey: d.STT_Key, moTa: `${d.Nguoi} chuyển ${d.STT_Key}: "${d.Tu}" → "${d.Sang}" lúc ${hienGio(d.t)}.`, chiTiet: { nguoi: d.Nguoi, tu: d.Tu, sang: d.Sang } })),
  },
  SUA_TAY_NHIEU: {
    giaiDoan: 1, ten: 'Sửa tay trạng thái nhiều', muc: 'TB', tuDong: false, nguong: ['SUA_TAY_NGAY'],
    moTa: 'Một nhân viên sửa tay (sửa đơn / chuyển hàng loạt) trạng thái quá nhiều đơn trong ngày — thay vì quét QR / chụp ảnh.',
    chay: (ctx, ng) => loc(ctx, 'SUA_TAY_NGAY', ng).map(x => ({ khoa: `${x.nguoi}|${x.ngay}`, moTa: `${x.nguoi} sửa tay trạng thái ${x.gia} đơn ngày ${x.ngay} (ngưỡng ${ng.SUA_TAY_NGAY}).`, chiTiet: { nguoi: x.nguoi, ds: x.ds.slice(0, 100) } })),
  },
  NGOAI_GIO: {
    giaiDoan: 1, ten: 'Thao tác ngoài giờ', muc: 'THAP', tuDong: false, nguong: ['GIO_LAM_TU', 'GIO_LAM_DEN'],
    moTa: 'Nhân viên đổi trạng thái đơn ngoài khung giờ làm việc.',
    chay: (ctx, ng) => {
      const trongGio = h => (ng.GIO_LAM_TU <= ng.GIO_LAM_DEN ? h >= ng.GIO_LAM_TU && h < ng.GIO_LAM_DEN : h >= ng.GIO_LAM_TU || h < ng.GIO_LAM_DEN);
      const nhom = new Map();
      for (const r of thaoTacNhanVien(ctx, HANH_DONG_DOI_TRANG_THAI)) {
        if (r.t < ctx.bayGio - 2 * NGAY || trongGio(gioVN(r.t))) continue;
        const k = `${r.NguoiDung}|${ngayVN(r.t)}`;
        if (!nhom.has(k)) nhom.set(k, []);
        nhom.get(k).push(r);
      }
      return [...nhom].map(([k, ds]) => ({ khoa: k, moTa: `${ds[0].NguoiDung} đổi trạng thái ${new Set(ds.map(r => r.STT_Key)).size} đơn ngoài giờ ngày ${k.split('|')[1]} (${ds.slice(0, 5).map(r => hienGio(r.t).slice(0, 5)).join(', ')}${ds.length > 5 ? '…' : ''}).`, chiTiet: { nguoi: ds[0].NguoiDung, ds: [...new Set(ds.map(r => r.STT_Key))].slice(0, 100) } }));
    },
  },
  IN_LABEL_LAP: {
    giaiDoan: 1, ten: 'In label lặp', muc: 'TB', tuDong: false, nguong: ['IN_LABEL_LAP'],
    moTa: 'Một đơn bị in label nhiều lần — dễ dán nhầm / thừa tem.',
    chay: (ctx, ng) => loc(ctx, 'IN_LABEL_LAP', ng).map(x => ({ khoa: x.sttKey, sttKey: x.sttKey, moTa: `${x.sttKey} đã in label ${x.gia} lần (${x.lan.slice(-5).map(hienGio).join('; ')}).` })),
  },
  MUA_CHUA_IN: {
    giaiDoan: 1, ten: 'Có tracking mà chưa in label', muc: 'TB', tuDong: true, nguong: ['GIO_MUA_CHUA_IN'],
    moTa: 'Đơn đã sản xuất và đã có tracking nhưng quá lâu chưa in label.',
    chay: (ctx, ng) => loc(ctx, 'GIO_MUA_CHUA_IN', ng).map(x => ({ khoa: x.sttKey, sttKey: x.sttKey, moTa: `${x.sttKey} có tracking, đã sản xuất ${x.gia} giờ mà chưa in label (ngưỡng ${ng.GIO_MUA_CHUA_IN} giờ).` })),
  },
  IN_CHUA_DAN: {
    giaiDoan: 1, ten: 'In label rồi chưa dán tem', muc: 'TB', tuDong: true, nguong: ['GIO_IN_CHUA_DAN'],
    moTa: 'Đơn đã in label nhưng quá lâu chưa chụp ảnh "ĐÃ DÁN TEM".',
    chay: (ctx, ng) => loc(ctx, 'GIO_IN_CHUA_DAN', ng).map(x => ({ khoa: x.sttKey, sttKey: x.sttKey, moTa: `${x.sttKey} in label ${x.gia} giờ trước (${hienGio(x.lanIn)}) mà chưa "ĐÃ DÁN TEM" (ngưỡng ${ng.GIO_IN_CHUA_DAN} giờ).` })),
  },
  DON_KET: {
    giaiDoan: 1, ten: 'Đơn kẹt theo khâu', muc: 'TB', tuDong: true, nguong: TRANG_THAI_KET.map(s => `KET:${s}`), mot: true,
    moTa: 'Đơn nằm quá lâu ở 1 trạng thái chung — ngưỡng riêng từng trạng thái (để trống = không theo dõi trạng thái đó). Khác Cảnh báo trễ hạn (tính theo ngày lên đơn).',
    chay: (ctx, ng) => TRANG_THAI_KET.filter(s => ng[`KET:${s}`] !== undefined).flatMap(s => loc(ctx, `KET:${s}`, ng)
      .filter(x => conHoatDong(ctx.theoKey.get(x.sttKey)))
      .map(x => ({ khoa: `${x.sttKey}|${s}`, sttKey: x.sttKey, moTa: `${x.sttKey} nằm ở "${s}" ${x.gia} giờ (từ ${hienGio(x.vao)}, ngưỡng ${ng[`KET:${s}`]} giờ).` }))),
  },
  QC3_CHUA_CHAY: {
    giaiDoan: 1, ten: 'Dán tem chưa có QC3', muc: 'TB', tuDong: true, nguong: ['GIO_QC3_CHUA_CHAY'],
    moTa: 'Đơn "ĐÃ DÁN TEM" quá lâu mà chưa có lần QC3 nào (tự động hoặc tay).',
    chay: (ctx, ng) => loc(ctx, 'GIO_QC3_CHUA_CHAY', ng).map(x => ({ khoa: x.sttKey, sttKey: x.sttKey, moTa: `${x.sttKey} dán tem ${x.gia} giờ trước mà chưa có QC3 (ngưỡng ${ng.GIO_QC3_CHUA_CHAY} giờ).` })),
  },
  QC_FAIL_DI_TIEP: {
    giaiDoan: 1, ten: 'QC FAIL mà đơn vẫn đi tiếp', muc: 'CAO', tuDong: false, nguong: [],
    moTa: 'Lần QC mới nhất của đơn là FAIL (và superadmin không đánh giá lại là PASS), nhưng sau đó đơn vẫn được chuyển tiến lên.',
    chay: ctx => {
      const ra = [];
      for (const q of qcMoiNhat(ctx).values()) {
        if (q.KetQua !== 'FAIL' || q.DanhGiaThucTe === 'PASS') continue;
        // Chỉ bước tiến do NGƯỜI làm — hệ thống tự chuyển (vd tracking báo đã giao) và trạng thái kết thúc không tính.
        const tien = (ctx.chuyen.get(q.STT_Key) || []).find(c => c.t > q.t && c.nguoi && c.nguoi !== 'Hệ thống' && !TRANG_THAI_KET_THUC.includes(c.sang)
          && chiSoTinhTrang(c.sang) !== null && chiSoTinhTrang(c.tu) !== null && chiSoTinhTrang(c.sang) > chiSoTinhTrang(c.tu));
        if (tien) ra.push({ khoa: String(q.id), sttKey: q.STT_Key, moTa: `${q.LoaiQc} FAIL ${q.STT_Key} lúc ${hienGio(q.t)}, sau đó ${tien.nguoi || 'hệ thống'} vẫn chuyển "${tien.tu}" → "${tien.sang}" (${hienGio(tien.t)}).`, chiTiet: { logId: q.id, lyDo: String(q.LyDo || '').slice(0, 300) } });
      }
      return ra;
    },
  },
  CCL_CHUA_DANH_GIA: {
    giaiDoan: 1, ten: 'Cần check lại chưa ai xem', muc: 'THAP', tuDong: true, nguong: ['GIO_CCL_CHUA_DANH_GIA'],
    moTa: 'Lần QC mới nhất là "Cần check lại" mà quá lâu chưa được đánh giá thực tế ở menu QC.',
    chay: (ctx, ng) => loc(ctx, 'GIO_CCL_CHUA_DANH_GIA', ng).map(x => ({ khoa: `${x.sttKey}|${x.loaiQc}`, sttKey: x.sttKey, moTa: `${x.loaiQc} ${x.sttKey}: "Cần check lại" ${x.gia} giờ chưa được đánh giá (ngưỡng ${ng.GIO_CCL_CHUA_DANH_GIA} giờ).`, chiTiet: { logId: x.logId } })),
  },
  LOI_LOG: {
    giaiDoan: 1, ten: 'Lỗi hệ thống lặp lại', muc: 'CAO', tuDong: true, nguong: ['LOI_LOG_GIO'],
    moTa: 'Cùng 1 nhóm lỗi (GKE, Sheets, MinIO, AI...) xuất hiện nhiều lần trong 60 phút trong log server.',
    chay: (ctx, ng) => loc(ctx, 'LOI_LOG_GIO', ng).map(x => ({ khoa: x.nhom, moTa: `${x.nhom}: ${x.gia} lỗi trong 60 phút qua. Gần nhất: ${x.viDu.slice(0, 200)}` })),
  },
  O_DIA: {
    giaiDoan: 1, ten: 'Ổ đĩa sắp đầy', muc: 'CAO', tuDong: true, nguong: ['O_DIA_PT'],
    moTa: 'Ổ đĩa chứa dữ liệu app (CSDL, log, backup) dùng quá ngưỡng.',
    chay: (ctx, ng) => loc(ctx, 'O_DIA_PT', ng).map(x => ({ khoa: 'data', moTa: `Ổ đĩa đã dùng ${x.gia}% (còn trống ${x.trong} MB, ngưỡng ${ng.O_DIA_PT}%).` })),
  },
  CHI_PHI_AI: {
    giaiDoan: 1, ten: 'Chi phí AI vượt mức', muc: 'TB', tuDong: false, nguong: ['CHI_PHI_NGAY'],
    moTa: 'Chi phí AI (QC + AdminAI) trong ngày vượt mức — theo giá token đã nhập ở menu QC.',
    chay: (ctx, ng) => loc(ctx, 'CHI_PHI_NGAY', ng).map(x => ({ khoa: x.ngay, moTa: `Chi phí AI ngày ${x.ngay}: ${x.gia} USD (ngưỡng ${ng.CHI_PHI_NGAY} USD)${x.chuaCoGia.length ? `; chưa có giá: ${x.chuaCoGia.join(', ')}` : ''}.` })),
  },
  ANH_TRUNG: {
    giaiDoan: 2, ten: 'Ảnh trùng giữa 2 đơn', muc: 'CAO', tuDong: false, nguong: ['ANH_TRUNG_KC'],
    moTa: 'Ảnh đã sản xuất / ảnh dán tem của 2 đơn khác nhau gần như giống hệt (không tính đơn cùng kiện gom) — nghi dùng lại ảnh. Băm ảnh mới + ảnh 30 ngày trước khi bật.',
    chay: (ctx, ng) => loc(ctx, 'ANH_TRUNG_KC', ng).map(x => ({
      khoa: [`${x.a.STT_Key}:${x.a.Cot}`, `${x.b.STT_Key}:${x.b.Cot}`].sort().join('|'), sttKey: x.a.STT_Key,
      moTa: `${COT_ANH[x.a.Cot]} của ${x.a.STT_Key} gần giống ${COT_ANH[x.b.Cot]} của ${x.b.STT_Key} (khác ${x.kc} bit, ngưỡng ${ng.ANH_TRUNG_KC}).`,
      chiTiet: { anh: [{ sttKey: x.a.STT_Key, url: x.a.Url }, { sttKey: x.b.STT_Key, url: x.b.Url }] },
    })),
  },
  DIA_CHI: {
    giaiDoan: 2, ten: 'Dữ liệu giao hàng có vấn đề', muc: 'TB', tuDong: true, nguong: [],
    moTa: 'Đơn chưa mua tracking: kiểm tra giống bước Xuất Excel GKE (thiếu tên/ZIP/thành phố/địa chỉ, thiếu SĐT/bang, ZIP sai dạng, PO Box, cấu hình tài khoản GKE...). Không tự sửa.',
    chay: ctx => {
      const { kiemTraDon } = require('../trackingExcelGkeService');
      const ra = [];
      for (const r of ctx.rows) {
        if (!conHoatDong(r) || r.TRACKING_ID || r.TAM_THOI || r.TRANG_THAI_XUONG === donNhieuAoService.TRANG_THAI_HUY) continue;
        const nhom = ctx.banDoNhom.get(r.STT_Key);
        if (nhom && nhom.donMua && nhom.donMua.STT_Key !== r.STT_Key) continue; // cả nhóm mua 1 tracking ở đơn khác
        let k;
        try { k = kiemTraDon(r, ctx.rows, ctx.banDoNhom); } catch (e) { continue; }
        // Nước khác US/UK không mua tracking qua GKE — bỏ qua cả đơn (các lý do khác như cấu hình tài khoản GKE không liên quan tới đơn này).
        if (k.lyDo.some(l => /^Chỉ xuất đơn giao tới US hoặc UK/.test(l))) continue;
        const lyDo = k.lyDo;
        const canhBao = k.canhBao.filter(c => !/^Nhóm DonNhieuAo|^Đang dùng dữ liệu SỬA TAY|^Địa chỉ 2 trống/.test(c));
        const ds = [...lyDo, ...canhBao];
        if (ds.length) ra.push({ khoa: r.STT_Key, sttKey: r.STT_Key, muc: lyDo.length ? 'TB' : 'THAP', moTa: `${r.STT_Key}: ${ds.join(' ')}`, chiTiet: { chan: lyDo, canhBao } });
      }
      return ra;
    },
  },
};

// Cài đặt người dùng -> { [luật]: hoạt động? } và bộ ngưỡng đã làm sạch (số).
function docNguong(caiDat) {
  const ng = {};
  for (const [k, v] of Object.entries((caiDat && caiDat.nguong) || {})) if (NGUONG[k] && v !== '' && v !== null && Number.isFinite(Number(v))) ng[k] = Number(v);
  return ng;
}
function trangThaiLuat(caiDat) {
  const ng = docNguong(caiDat);
  return Object.fromEntries(Object.entries(LUAT).map(([ma, l]) => {
    const bat = !!((caiDat.luat || {})[ma]);
    const thieu = l.mot ? (l.nguong.some(k => ng[k] !== undefined) ? [] : l.nguong) : l.nguong.filter(k => ng[k] === undefined);
    return [ma, { bat, thieuNguong: thieu, hoatDong: bat && !thieu.length }];
  }));
}

// Chạy mọi luật đang hoạt động. -> { vanDe: [...], luatDaChay: [...] (gồm cả luật không chạy — để đóng vấn đề cũ), loi: { [luật]: thông báo } }
function chayLuat(ctx, caiDat) {
  const ng = docNguong(caiDat);
  const tt = trangThaiLuat(caiDat);
  const vanDe = [], luatDaChay = [], loi = {};
  for (const [ma, l] of Object.entries(LUAT)) {
    // Luật không chạy (tắt / thiếu ngưỡng) coi như không còn tình trạng nào -> vấn đề TỰ ĐỘNG đang mở của nó được đóng.
    if (!tt[ma].hoatDong) { luatDaChay.push(ma); continue; }
    try {
      for (const v of l.chay(ctx, ng)) vanDe.push({ luat: ma, muc: v.muc || l.muc, tuDong: l.tuDong, ...v, khoa: `${ma}|${v.khoa}` });
      luatDaChay.push(ma);
    } catch (err) {
      loi[ma] = err.message; // luật lỗi KHÔNG được đóng nhầm vấn đề đang mở của nó -> không đưa vào luatDaChay
      console.error(`[AdminAI] Luật ${ma} lỗi:`, err.message);
    }
  }
  return { vanDe, luatDaChay, loi };
}

const phanVi = (mau, p) => {
  if (!mau.length) return null;
  const s = [...mau].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
// Số liệu hiển thị cho 1 ngưỡng (route /so-lieu). hienTai chỉ trả giá trị (không trả chi tiết đơn) cho gọn.
function soLieuNguong(ctx, khoa) {
  const d = NGUONG[khoa].soLieu(ctx);
  return {
    khoa, ten: NGUONG[khoa].ten, donVi: NGUONG[khoa].donVi, soSanh: NGUONG[khoa].soSanh || '', ghiChu: d.ghiChu, theoGio: d.theoGio,
    soMau: d.mau.length, p50: phanVi(d.mau, 50), p75: phanVi(d.mau, 75), p90: phanVi(d.mau, 90), p95: phanVi(d.mau, 95),
    max: d.mau.length ? Math.max(...d.mau) : null, mau: d.mau, hienTai: d.hienTai.map(x => x.gia),
  };
}

module.exports = { LUAT, NGUONG, TRANG_THAI_KET, COT_ANH, COT_MOC_ANH, NGAY, GIO, taoNguCanh, chayLuat, trangThaiLuat, docNguong, soLieuNguong, chiPhiTheoNgay, ngayVN, hienGio, tg };
