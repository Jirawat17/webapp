// Máy chủ tự đo đường mạng qua Cloudflare mỗi phút (17/10/2026, theo yêu cầu người dùng — trình duyệt báo chậm trong khi speedtest trong nước
// nhanh: cần biết chậm ở đoạn nào). Độc lập người dùng (cả ban đêm), ghi bảng do_mang_may_chu (nhatKyDbService), báo cáo hằng ngày đọc.
// Mỗi lượt 2 request HTTPS tới CHÍNH tên miền app (đi qua Cloudflare như người dùng), kết nối MỚI để đo đủ DNS / TCP / TLS:
//   1. GET  /cdn-cgi/trace — Cloudflare tự trả lời, không vào máy chủ: ms_cf = 1 vòng Máy chủ -> Cloudflare (+ trạm colo máy chủ đi qua)
//   2. POST /api/ping      — đi vòng Cloudflare -> vào lại máy chủ này (chưa đăng nhập -> 401 ngay, không ghi gì):
//                            ms_cf_may_chu = byte đầu (2) - byte đầu (1) - thời gian app xử lý (Server-Timing) = đoạn Cloudflare <-> máy chủ
// Tên miền: TEN_MIEN_APP trong .env, không có thì tự lấy từ lượt truy cập đầu tiên đi qua Cloudflare (header cf-ray — routes/doMang.js).
// Chưa biết tên miền (vd chạy thử trên máy, không có Cloudflare) -> không đo.
const https = require('https');
const nhatKy = require('./nhatKyDbService');
const { thoiGianVNISOString } = require('./dateUtils');

const CHU_KY_MS = 60 * 1000;
const HAN_MS = 10000;
const UA_DO_MANG = 'xuong-theu-do-mang'; // logCapture.js bỏ qua lượt 401 của chính máy chủ đo (không thành 1 dòng WARN mỗi phút)
const MAU_TEN_MIEN = /^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i; // tên miền, không nhận IP / localhost
let tenMien = MAU_TEN_MIEN.test(process.env.TEN_MIEN_APP || '') ? process.env.TEN_MIEN_APP.toLowerCase() : '';

function hocTenMien(req) {
  if (tenMien || !req.headers['cf-ray']) return;
  const h = String(req.hostname || '').toLowerCase();
  if (!MAU_TEN_MIEN.test(h)) return;
  tenMien = h;
  console.log(`[DoMang] Máy chủ tự đo mạng qua Cloudflare tới https://${h} (tên miền lấy từ lượt truy cập — đặt TEN_MIEN_APP trong .env để cố định).`);
}

// 1 request HTTPS trên kết nối MỚI. -> { batDau, lookup, connect, tls, byteDau, status, headers, body }
function goi(path, method) {
  return new Promise((xong, loi) => {
    const t = { batDau: performance.now() };
    const req = https.request({
      host: tenMien, path, method, agent: false, timeout: HAN_MS,
      headers: { 'User-Agent': UA_DO_MANG, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    }, res => {
      t.byteDau = performance.now();
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (body.length < 4000) body += c; });
      res.on('end', () => xong({ ...t, status: res.statusCode, headers: res.headers, body }));
      res.on('error', loi);
    });
    req.on('socket', s => {
      s.once('lookup', () => { t.lookup = performance.now(); });
      s.once('connect', () => { t.connect = performance.now(); });
      s.once('secureConnect', () => { t.tls = performance.now(); });
    });
    req.on('timeout', () => req.destroy(new Error(`quá ${HAN_MS / 1000} giây`)));
    req.on('error', loi);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}
const tron = v => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
const ttfb = r => tron(r.byteDau - (r.tls || r.connect || r.batDau)); // gửi xong (sau bắt tay) -> byte đầu tiên

let dangDo = false;
async function doMotLan() {
  if (!tenMien || dangDo) return;
  dangDo = true;
  const d = { luc: thoiGianVNISOString() };
  try {
    const tr = await goi('/cdn-cgi/trace', 'GET');
    d.colo = ((tr.body.match(/colo=([A-Z]+)/) || [])[1] || '');
    d.msDns = tr.lookup ? tron(tr.lookup - tr.batDau) : null;
    d.msTcp = tr.connect ? tron(tr.connect - (tr.lookup || tr.batDau)) : null;
    d.msTls = tr.tls && tr.connect ? tron(tr.tls - tr.connect) : null;
    d.msCF = ttfb(tr);
    if (tr.status !== 200 || !d.colo) d.loi = `Cloudflare trả ${tr.status} cho /cdn-cgi/trace`;
    else {
      try {
        const pg = await goi('/api/ping', 'POST');
        const app = Number((String(pg.headers['server-timing'] || '').match(/app;dur=([\d.]+)/) || [])[1]);
        d.msApp = Number.isFinite(app) ? tron(app) : null;
        // 401 = đúng như mong đợi (chưa đăng nhập). Không có Server-Timing = trả lời không phải từ app (Cloudflare chặn / trang lỗi 5xx)
        // -> ghi lỗi, KHÔNG tính số đoạn (thời gian của trang lỗi không phải đường tới máy chủ).
        if (pg.status !== 401 || d.msApp == null) d.loi = `Cloudflare -> máy chủ: trả ${pg.status}${d.msApp == null ? ' (không phải từ app)' : ''}`;
        else d.msCFMayChu = tron(ttfb(pg) - d.msCF - d.msApp);
      } catch (err) {
        d.loi = `Cloudflare -> máy chủ: ${err.message}`;
      }
    }
  } catch (err) {
    d.loi = `Máy chủ -> Cloudflare: ${err.message}`;
  }
  try { nhatKy.ghiDoMangMayChu(d); } catch (err) { console.error('[DoMang] Lỗi lưu số đo máy chủ:', err.message); }
  dangDo = false;
}

function batDauDoMangMayChu() {
  setTimeout(doMotLan, 20 * 1000).unref(); // lần đầu sau khi khởi động 20 giây
  setInterval(doMotLan, CHU_KY_MS).unref();
}

module.exports = { batDauDoMangMayChu, hocTenMien, doMotLan, UA_DO_MANG };
