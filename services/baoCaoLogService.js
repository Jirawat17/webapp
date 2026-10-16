// Báo cáo logs hằng ngày qua Telegram (15/10/2026, theo yêu cầu người dùng) — superadmin đặt ở Settings: giờ gửi (HH:MM, giờ VN; trống =
// tắt), Chat ID riêng, Bot Token riêng (trống = TELEGRAM_BOT_TOKEN trong .env). Mỗi ngày 1 lần, tới giờ đó gửi: 1 tin tóm tắt + file
// log server .txt + file Logs_UploadAnh .csv của 24 giờ gần nhất. Lưu trong bảng cai_dat_van_hanh (khoá BAO_CAO_LOG_*).
// Bổ sung 16/10/2026 (services/baoCaoVanHanhService.js): tin tóm tắt có thêm phiên bản app + các lần khởi động/deploy trong 24 giờ +
// số đo tốc độ các thao tác chính; sau 2 file gửi thêm danh sách lỗi dữ liệu cần Seller sửa (theo Team, có file Excel). Báo cáo vận
// hành TUẦN gửi 7 giờ sáng thứ 7 vào cùng chat (chỉ cần Chat ID + token, không phụ thuộc giờ gửi hằng ngày).
const cron = require('node-cron');
const caiDat = require('./caiDatDbService');
const nhatKy = require('./nhatKyDbService');
const telegramService = require('./telegramService');
const { docDongTu } = require('./logCapture');
const { thoiGianVNISOString } = require('./dateUtils');
const phienBan = require('./phienBanService');
const baoCaoVanHanh = require('./baoCaoVanHanhService');

const KHOA = { GIO: 'BAO_CAO_LOG_GIO', CHAT: 'BAO_CAO_LOG_CHAT', TOKEN: 'BAO_CAO_LOG_TOKEN', NGAY_CUOI: 'BAO_CAO_LOG_NGAY_CUOI', TUAN_NGAY_CUOI: 'BAO_CAO_TUAN_NGAY_CUOI' };
const GIO_BAO_CAO_TUAN = '07:00'; // thứ 7 (người dùng chốt 16/10/2026)
const THU_BAO_CAO_TUAN = 6; // getUTCDay của giờ VN: 0 = Chủ nhật ... 6 = thứ 7
const MOT_NGAY_MS = 24 * 3600 * 1000;

function layCauHinh() {
  const l = caiDat.layCaiDatVanHanh();
  return { gio: l[KHOA.GIO] || '', chat: l[KHOA.CHAT] || '', token: l[KHOA.TOKEN] || '', ngayCuoi: l[KHOA.NGAY_CUOI] || '' };
}
const tokenDung = ch => ch.token || process.env.TELEGRAM_BOT_TOKEN || '';

// Lưu cấu hình. Đặt/đổi giờ sang mốc ĐÃ QUA trong hôm nay -> coi hôm nay đã gửi (lần đầu là ngày mai, không gửi bù ngay lúc lưu) —
// giống tổng kết QC (services/qc/qcTelegramService.js#luuCauHinhGop).
function luuCauHinh({ gio, chat, token }, bayGio = new Date()) {
  const cu = layCauHinh();
  const moi = { [KHOA.GIO]: gio, [KHOA.CHAT]: chat };
  if (token !== undefined) moi[KHOA.TOKEN] = token;
  const vn = thoiGianVNISOString(bayGio);
  if (gio && gio !== cu.gio && vn.slice(11, 16) >= gio) moi[KHOA.NGAY_CUOI] = vn.slice(0, 10);
  caiDat.datCaiDatVanHanh(moi);
}

// File log ghi giờ UTC "[2026-10-11T16:00:02.075Z]" — đổi sang giờ VN "[11/10/2026 23:00:02]" giống trang Logs (public/logs.html#gioVietNam).
const MAU_DAU_DONG = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\]/;
function gioVietNam(dong) {
  return dong.replace(MAU_DAU_DONG, (goc, iso) => {
    const t = new Date(Date.parse(iso) + 7 * 3600 * 1000);
    if (isNaN(t)) return goc;
    const h = n => String(n).padStart(2, '0');
    return `[${h(t.getUTCDate())}/${h(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${h(t.getUTCHours())}:${h(t.getUTCMinutes())}:${h(t.getUTCSeconds())}]`;
  });
}

// -> { dong[] (giờ VN), soLoi, soCanhBao, nhomLoi [[mẫu, số lần]] top 5, thieuTuLuc, cacLanKhoiDong [{ luc, moTa }] }. Log lưu theo ngày
// (services/logCapture.js, 30 ngày): dòng có giờ ĐẦU TIÊN đọc được đã mới hơn mốc 24 giờ (máy chủ mới cài / thiếu file) -> thieuTuLuc =
// giờ dòng đó (tin tóm tắt báo rõ); null = đủ 24 giờ. Dòng không có giờ (stack trace) đi theo dòng trước.
function docLogServer(bayGio) {
  const moc = bayGio - MOT_NGAY_MS;
  const tatCa = docDongTu(moc);
  const batDau = tatCa.findIndex(d => { const m = d.match(MAU_DAU_DONG); return m && Date.parse(m[1]) >= moc; });
  const dong = batDau < 0 ? [] : tatCa.slice(batDau);
  let soLoi = 0, soCanhBao = 0;
  const nhom = new Map();
  for (const d of dong) {
    if (/^\[[^\]]+\] \[WARN\]/.test(d)) soCanhBao++;
    if (!/^\[[^\]]+\] \[ERROR\]/.test(d)) continue;
    soLoi++;
    // Gộp lỗi cùng loại: bỏ giờ + mức, thay mọi "từ" có chữ số (mã đơn, số đo, URL có tham số...) bằng #.
    const mau = d.replace(/^\[[^\]]+\] \[ERROR\] /, '').replace(/\S*\d\S*/g, '#').slice(0, 120);
    nhom.set(mau, (nhom.get(mau) || 0) + 1);
  }
  let dauFile = null;
  for (const d of tatCa) { dauFile = d.match(MAU_DAU_DONG); if (dauFile) break; }
  const tuLucFile = dauFile ? Date.parse(dauFile[1]) : null;
  // Các lần khởi động (deploy / khởi động lại) trong 24 giờ — dòng "[PhienBan] Khởi động: ..." của server.js.
  const cacLanKhoiDong = [];
  for (const d of dong) {
    const m = d.match(/^\[([^\]]+)\] \[LOG\] \[PhienBan\] Khởi động: (.+)$/);
    if (m) cacLanKhoiDong.push({ luc: Date.parse(m[1]), moTa: m[2] });
  }
  return {
    dong: dong.map(gioVietNam), soLoi, soCanhBao,
    nhomLoi: [...nhom].sort((a, b) => b[1] - a[1]).slice(0, 5),
    thieuTuLuc: tuLucFile !== null && tuLucFile > moc ? tuLucFile : null,
    cacLanKhoiDong,
  };
}

// CSV GIỐNG HỆT nút "Xuất CSV" ở trang Logs (public/logs.html#xuatCsvUploadAnh): có BOM, ô bắt đầu bằng = + - @ thêm ' (chống công thức Excel).
const COT_CSV = ['luc', 'nguoi', 'vai_tro', 'xuong', 'su_kien', 'che_do', 'stt_key', 'ket_qua', 'nhom_kq', 'loi', 'tong_ms', 'cham', 'he_dieu_hanh', 'trinh_duyet', 'may', 'phien_ban_app', 'chi_tiet', 'thong_tin'];
const taoCsv = ds => baoCaoVanHanh.taoCsv(COT_CSV, ds); // dùng chung quy tắc CSV (BOM, chống công thức Excel)

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ngayGio = ms => { const v = thoiGianVNISOString(new Date(ms)); return `${v.slice(8, 10)}/${v.slice(5, 7)} ${v.slice(11, 16)}`; }; // "15/10 22:30"
const tenTheoGio = ms => thoiGianVNISOString(new Date(ms)).slice(0, 16).replace(/[-:]/g, '').replace('T', '_');

// Gửi NGAY báo cáo 24 giờ tính tới bayGio -> { ok, loi }. Dùng cho lịch hằng ngày lẫn nút "Gửi ngay" ở Settings.
async function guiBaoCao(bayGio = new Date()) {
  const ch = layCauHinh();
  const token = tokenDung(ch);
  if (!ch.chat) return { ok: false, loi: 'Chưa có Chat ID nhận báo cáo logs.' };
  if (!token) return { ok: false, loi: 'Chưa có Bot Token (nhập ở Settings hoặc TELEGRAM_BOT_TOKEN trong .env).' };

  const ms = +bayGio;
  const log = docLogServer(ms);
  const dsUA = nhatKy.dsLogsUploadAnh({ tuLuc: thoiGianVNISOString(new Date(ms - MOT_NGAY_MS)), gioiHan: 20000 });
  const dem = k => dsUA.filter(r => r.nhom_kq === k).length;
  const soChupOk = dsUA.filter(r => r.su_kien === 'CHUP_ANH' && r.ket_qua === 'OK').length;

  const dong = [`📋 <b>Báo cáo logs 24 giờ</b> (${ngayGio(ms - MOT_NGAY_MS)} → ${ngayGio(ms)})`];
  dong.push(`<b>Phiên bản:</b> ${esc(phienBan.moTa)} (chạy từ ${ngayGio(phienBan.khoiDongLuc)})`);
  if (log.cacLanKhoiDong.length) dong.push(`Khởi động / deploy trong 24 giờ: ${log.cacLanKhoiDong.map(k => `${ngayGio(k.luc)} (${esc(k.moTa)})`).join(', ')}`);
  dong.push(`<b>Log server:</b> ${log.dong.length} dòng · ${log.soLoi} ERROR · ${log.soCanhBao} WARN`);
  if (log.thieuTuLuc) dong.push(`⚠️ Log chỉ có từ ${ngayGio(log.thieuTuLuc)} (máy chủ mới cài hoặc thiếu file log).`);
  if (log.nhomLoi.length) dong.push('Lỗi nhiều nhất:', ...log.nhomLoi.map(([mau, n]) => `• ${n}× ${esc(mau)}`));
  dong.push(`<b>Logs_UploadAnh:</b> ${dsUA.length} dòng${dsUA.length >= 20000 ? ' (đã cắt ở 20000 dòng mới nhất)' : ''} · chụp OK ${soChupOk} · lỗi kỹ thuật ${dem('KY_THUAT')} · nghiệp vụ ${dem('NGHIEP_VU')} · bỏ ngang ${dem('BO_NGANG')}`);
  const tocDo = baoCaoVanHanh.thongKeTocDo(ms);
  if (tocDo.length) dong.push('<b>Tốc độ</b> (số lượt · giữa · 90% lượt nhanh hơn; <i>hôm trước</i>):', ...tocDo);
  const mang = baoCaoVanHanh.thongKeMang(ms);
  dong.push(...mang.dong);

  const kqTin = await baoCaoVanHanh.guiTinDai(telegramService.guiTinNhan, ch.chat, dong.join('\n'), token);
  if (!kqTin.ok) return kqTin;
  const dsLoi = [];
  if (log.dong.length) {
    const kq = await telegramService.guiFile(ch.chat, `Logs_server_${tenTheoGio(ms)}.txt`, log.dong.join('\n'), token);
    if (!kq.ok) dsLoi.push('log server: ' + kq.loi);
  }
  if (dsUA.length) {
    const kq = await telegramService.guiFile(ch.chat, `Logs_UploadAnh_${tenTheoGio(ms)}.csv`, taoCsv(dsUA), token);
    if (!kq.ok) dsLoi.push('Logs_UploadAnh: ' + kq.loi);
  }
  if (mang.ds.length) { // log chi tiết từng lần đo mạng (16/10/2026)
    const kq = await telegramService.guiFile(ch.chat, `DoMang_${tenTheoGio(ms)}.csv`, baoCaoVanHanh.taoCsvDoMang(mang.ds), token);
    if (!kq.ok) dsLoi.push('đo mạng: ' + kq.loi);
  }
  try {
    const kq = await baoCaoVanHanh.guiLoiDuLieu({ chat: ch.chat, token, guiTinNhan: telegramService.guiTinNhan, guiFile: telegramService.guiFile }, ms);
    if (!kq.ok) dsLoi.push('danh sách lỗi dữ liệu: ' + kq.loi);
  } catch (err) {
    dsLoi.push('danh sách lỗi dữ liệu: ' + err.message);
  }
  return dsLoi.length ? { ok: false, loi: 'Đã gửi tin tóm tắt nhưng lỗi gửi file — ' + dsLoi.join('; ') } : { ok: true };
}

// Chỉ danh sách lỗi dữ liệu, gửi NGAY (nút ở Settings) -> { ok, loi, soLoi }. Không có lỗi -> không gửi gì (soLoi 0).
async function guiLoiDuLieuNgay(bayGio = new Date()) {
  const ch = layCauHinh();
  const token = tokenDung(ch);
  if (!ch.chat) return { ok: false, loi: 'Chưa có Chat ID nhận báo cáo logs.' };
  if (!token) return { ok: false, loi: 'Chưa có Bot Token (nhập ở Settings hoặc TELEGRAM_BOT_TOKEN trong .env).' };
  return baoCaoVanHanh.guiLoiDuLieu({ chat: ch.chat, token, guiTinNhan: telegramService.guiTinNhan, guiFile: telegramService.guiFile }, +bayGio);
}

// Báo cáo vận hành TUẦN gửi NGAY (7 ngày tính tới bayGio) -> { ok, loi }. Lịch thứ 7 + nút "Gửi ngay" ở Settings.
async function guiBaoCaoTuan(bayGio = new Date()) {
  const ch = layCauHinh();
  const token = tokenDung(ch);
  if (!ch.chat) return { ok: false, loi: 'Chưa có Chat ID nhận báo cáo logs.' };
  if (!token) return { ok: false, loi: 'Chưa có Bot Token (nhập ở Settings hoặc TELEGRAM_BOT_TOKEN trong .env).' };
  return baoCaoVanHanh.guiTinDai(telegramService.guiTinNhan, ch.chat, await baoCaoVanHanh.taoBaoCaoTuan(+bayGio), token);
}

// Lịch: kiểm tra mỗi phút; tới hạn và hôm nay chưa gửi -> gửi. Lỗi -> thử lại sau 10 phút, tối đa 3 lần/ngày (không nhắn lỗi mỗi phút
// khi token/chat sai). Chỉ ghi "đã gửi hôm nay" khi gửi thành công; máy chủ khởi động lại sau giờ hẹn thì gửi bù trong ngày.
// Dùng chung cho báo cáo hằng ngày và báo cáo tuần (mỗi loại 1 khoá "ngày đã gửi" + bộ đếm lỗi riêng).
function taoLich(ten, khoaNgayCuoi, denHan, gui) {
  let loiHomNay = { ngay: '', soLan: 0, luc: 0 };
  let dangGui = false;
  const ghiLoi = (ngay, bayGio, loi) => {
    loiHomNay = { ngay, soLan: (loiHomNay.ngay === ngay ? loiHomNay.soLan : 0) + 1, luc: +bayGio };
    console.error(`[BaoCaoLog] Gửi ${ten} lỗi (lần ${loiHomNay.soLan}/3 hôm nay):`, loi);
  };
  return async function chay(bayGio = new Date()) {
    if (dangGui) return;
    const vn = thoiGianVNISOString(bayGio);
    const ngay = vn.slice(0, 10);
    if (!denHan(vn, bayGio) || caiDat.layCaiDatVanHanh()[khoaNgayCuoi] === ngay) return;
    if (loiHomNay.ngay === ngay && (loiHomNay.soLan >= 3 || bayGio - loiHomNay.luc < 10 * 60000)) return;
    dangGui = true;
    try {
      const kq = await gui(bayGio);
      if (kq.ok) caiDat.datCaiDatVanHanh({ [khoaNgayCuoi]: ngay });
      else ghiLoi(ngay, bayGio, kq.loi);
    } catch (err) {
      ghiLoi(ngay, bayGio, err.message);
    } finally {
      dangGui = false;
    }
  };
}
const chayLuot = taoLich('báo cáo logs', KHOA.NGAY_CUOI, vn => {
  const ch = layCauHinh();
  return !!(ch.gio && ch.chat) && vn.slice(11, 16) >= ch.gio;
}, guiBaoCao);
const thuVN = bayGio => new Date(+bayGio + 7 * 3600000).getUTCDay();
const chayLuotTuan = taoLich('báo cáo vận hành tuần', KHOA.TUAN_NGAY_CUOI,
  (vn, bayGio) => !!layCauHinh().chat && thuVN(bayGio) === THU_BAO_CAO_TUAN && vn.slice(11, 16) >= GIO_BAO_CAO_TUAN, guiBaoCaoTuan);

function batDauLichBaoCaoLog() {
  cron.schedule('* * * * *', () => { chayLuot(); chayLuotTuan(); });
  // Dọn số đo tốc độ / đo mạng quá 35 ngày — 3 giờ sáng mỗi ngày, KHÔNG phụ thuộc báo cáo có bật/gửi được hay không (bảng do_mang
  // nhận số đo mỗi 30 giây của mọi tab đang mở; chưa cấu hình Telegram mà không dọn thì phình mãi).
  // Dọn thêm 1 lần sau khi khởi động 1 phút — máy chủ tắt / đang deploy đúng lúc 3 giờ thì lượt đó bị bỏ qua.
  const donSoDoCu = () => {
    try { baoCaoVanHanh.donSoDoCu(); } catch (err) { console.error('[BaoCaoLog] Dọn số đo cũ lỗi:', err.message); }
  };
  cron.schedule('0 3 * * *', donSoDoCu, { timezone: 'Asia/Ho_Chi_Minh' });
  setTimeout(donSoDoCu, 60 * 1000).unref();
  console.log('[BaoCaoLog] Đã bật lịch gửi báo cáo logs hằng ngày (giờ gửi ở Settings) + báo cáo vận hành tuần (7 giờ sáng thứ 7) qua Telegram.');
}

module.exports = { layCauHinh, luuCauHinh, tokenDung, guiBaoCao, guiBaoCaoTuan, guiLoiDuLieuNgay, chayLuot, chayLuotTuan, docLogServer, batDauLichBaoCaoLog };
