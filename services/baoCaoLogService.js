// Báo cáo logs hằng ngày qua Telegram (15/10/2026, theo yêu cầu người dùng) — superadmin đặt ở Settings: giờ gửi (HH:MM, giờ VN; trống =
// tắt), Chat ID riêng, Bot Token riêng (trống = TELEGRAM_BOT_TOKEN trong .env). Mỗi ngày 1 lần, tới giờ đó gửi: 1 tin tóm tắt + file
// log server .txt + file Logs_UploadAnh .csv của 24 giờ gần nhất. Lưu trong bảng cai_dat_van_hanh (khoá BAO_CAO_LOG_*).
const fs = require('fs');
const cron = require('node-cron');
const caiDat = require('./caiDatDbService');
const nhatKy = require('./nhatKyDbService');
const telegramService = require('./telegramService');
const { DUONG_DAN_LOG } = require('./logCapture');
const { thoiGianVNISOString } = require('./dateUtils');

const KHOA = { GIO: 'BAO_CAO_LOG_GIO', CHAT: 'BAO_CAO_LOG_CHAT', TOKEN: 'BAO_CAO_LOG_TOKEN', NGAY_CUOI: 'BAO_CAO_LOG_NGAY_CUOI' };
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

// -> { dong[] (giờ VN), soLoi, soCanhBao, nhomLoi [[mẫu, số lần]] top 5, thieuTuLuc }. File log tự cắt nửa khi vượt 5MB
// (services/logCapture.js) nên có thể KHÔNG còn đủ 24 giờ: dòng có giờ ĐẦU TIÊN CỦA CẢ FILE đã mới hơn mốc 24 giờ -> thieuTuLuc = giờ dòng
// đó (tin tóm tắt báo rõ); null = đủ 24 giờ. Dòng không có giờ (stack trace) đi theo dòng trước.
function docLogServer(bayGio) {
  let noiDung = '';
  try { noiDung = fs.readFileSync(DUONG_DAN_LOG, 'utf8'); } catch (e) { /* chưa có file */ }
  const tatCa = noiDung.split('\n').filter(Boolean);
  const moc = bayGio - MOT_NGAY_MS;
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
  const dauFile = tatCa.map(d => d.match(MAU_DAU_DONG)).find(Boolean);
  const tuLucFile = dauFile ? Date.parse(dauFile[1]) : null;
  return {
    dong: dong.map(gioVietNam), soLoi, soCanhBao,
    nhomLoi: [...nhom].sort((a, b) => b[1] - a[1]).slice(0, 5),
    thieuTuLuc: tuLucFile !== null && tuLucFile > moc ? tuLucFile : null,
  };
}

// CSV GIỐNG HỆT nút "Xuất CSV" ở trang Logs (public/logs.html#xuatCsvUploadAnh): có BOM, ô bắt đầu bằng = + - @ thêm ' (chống công thức Excel).
const COT_CSV = ['luc', 'nguoi', 'vai_tro', 'xuong', 'su_kien', 'che_do', 'stt_key', 'ket_qua', 'nhom_kq', 'loi', 'tong_ms', 'cham', 'he_dieu_hanh', 'trinh_duyet', 'may', 'phien_ban_app', 'chi_tiet', 'thong_tin'];
const oCsv = v => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
const taoCsv = ds => '﻿' + [COT_CSV.join(','), ...ds.map(r => COT_CSV.map(k => oCsv(r[k])).join(','))].join('\r\n');

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
  dong.push(`<b>Log server:</b> ${log.dong.length} dòng · ${log.soLoi} ERROR · ${log.soCanhBao} WARN`);
  if (log.thieuTuLuc) dong.push(`⚠️ File log chỉ còn từ ${ngayGio(log.thieuTuLuc)} (file tự cắt khi vượt 5MB, hoặc máy chủ mới cài).`);
  if (log.nhomLoi.length) dong.push('Lỗi nhiều nhất:', ...log.nhomLoi.map(([mau, n]) => `• ${n}× ${esc(mau)}`));
  dong.push(`<b>Logs_UploadAnh:</b> ${dsUA.length} dòng${dsUA.length >= 20000 ? ' (đã cắt ở 20000 dòng mới nhất)' : ''} · chụp OK ${soChupOk} · lỗi kỹ thuật ${dem('KY_THUAT')} · nghiệp vụ ${dem('NGHIEP_VU')} · bỏ ngang ${dem('BO_NGANG')}`);

  const kqTin = await telegramService.guiTinNhan(ch.chat, dong.join('\n'), token);
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
  return dsLoi.length ? { ok: false, loi: 'Đã gửi tin tóm tắt nhưng lỗi gửi file — ' + dsLoi.join('; ') } : { ok: true };
}

// Lịch: kiểm tra mỗi phút; tới giờ và hôm nay chưa gửi -> gửi. Lỗi -> thử lại sau 10 phút, tối đa 3 lần/ngày (không nhắn lỗi mỗi phút
// khi token/chat sai). Chỉ ghi "đã gửi hôm nay" khi gửi thành công; máy chủ khởi động lại sau giờ hẹn thì gửi bù trong ngày.
let loiHomNay = { ngay: '', soLan: 0, luc: 0 };
let dangGui = false;
async function chayLuot(bayGio = new Date()) {
  const ch = layCauHinh();
  if (!ch.gio || !ch.chat || dangGui) return;
  const vn = thoiGianVNISOString(bayGio);
  const ngay = vn.slice(0, 10);
  if (vn.slice(11, 16) < ch.gio || ch.ngayCuoi === ngay) return;
  if (loiHomNay.ngay === ngay && (loiHomNay.soLan >= 3 || bayGio - loiHomNay.luc < 10 * 60000)) return;
  dangGui = true;
  try {
    const kq = await guiBaoCao(bayGio);
    if (kq.ok) caiDat.datCaiDatVanHanh({ [KHOA.NGAY_CUOI]: ngay });
    else {
      loiHomNay = { ngay, soLan: (loiHomNay.ngay === ngay ? loiHomNay.soLan : 0) + 1, luc: +bayGio };
      console.error(`[BaoCaoLog] Gửi báo cáo logs lỗi (lần ${loiHomNay.soLan}/3 hôm nay):`, kq.loi);
    }
  } catch (err) {
    loiHomNay = { ngay, soLan: (loiHomNay.ngay === ngay ? loiHomNay.soLan : 0) + 1, luc: +bayGio };
    console.error('[BaoCaoLog] Lỗi khi tạo báo cáo logs:', err.message);
  } finally {
    dangGui = false;
  }
}

function batDauLichBaoCaoLog() {
  cron.schedule('* * * * *', () => { chayLuot(); });
  console.log('[BaoCaoLog] Đã bật lịch gửi báo cáo logs hằng ngày qua Telegram (giờ gửi cấu hình ở Settings).');
}

module.exports = { layCauHinh, luuCauHinh, tokenDung, guiBaoCao, chayLuot, docLogServer, batDauLichBaoCaoLog };
