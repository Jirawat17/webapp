// Máy chủ tự đo đường mạng qua Cloudflare mỗi phút (17/10/2026, theo yêu cầu người dùng — trình duyệt báo chậm trong khi speedtest trong nước
// nhanh: cần biết chậm ở đoạn nào). Độc lập người dùng (cả ban đêm), ghi bảng do_mang_may_chu (nhatKyDbService), báo cáo hằng ngày đọc.
// Mỗi lượt 2 request HTTPS tới CHÍNH tên miền app (đi qua Cloudflare như người dùng), kết nối MỚI để đo đủ DNS / TCP / TLS:
//   1. GET  /cdn-cgi/trace — Cloudflare tự trả lời, không vào máy chủ: ms_cf = 1 vòng Máy chủ -> Cloudflare (+ trạm colo máy chủ đi qua)
//   2. POST /api/ping      — đi vòng Cloudflare -> vào lại máy chủ này (chưa đăng nhập -> 401 ngay, không ghi gì):
//                            ms_cf_may_chu = byte đầu (2) - byte đầu (1) - thời gian app xử lý (Server-Timing) = đoạn Cloudflare <-> máy chủ
// Tên miền: TEN_MIEN_APP trong .env, không có thì tự lấy từ lượt truy cập đầu tiên đi qua Cloudflare (header cf-ray — routes/doMang.js).
// Chưa biết tên miền (vd chạy thử trên máy, không có Cloudflare) -> không đo.
// Đo thêm (21/10/2026, theo yêu cầu người dùng — log 19–20/10: chính máy chủ bắt tay tới Cloudflare chậm gấp ~9 lần giờ cao điểm), cùng lượt:
//   - ms_tcp_trong_nuoc / ms_tcp_quoc_te: thời gian mở kết nối TCP (không tính DNS) tới 1 đích trong nước và 1 đích quốc tế KHÔNG qua
//     Cloudflare (DO_MANG_DICH_TRONG_NUOC / DO_MANG_DICH_QUOC_TE trong .env, dạng host:cổng). Cả 2 cùng chậm = đường ra của máy chủ nghẽn
//     chung; chỉ quốc tế / Cloudflare chậm = đường quốc tế của nhà mạng nghẽn.
//   - tai_cpu (load 1 phút), cpu_ban / cpu_steal (% trong phút qua, steal = máy chủ vật lý lấy mất CPU), mang_vao_kbs / mang_ra_kbs (lưu
//     lượng card mạng của container trong phút qua — GỒM CẢ dữ liệu qua LAN tới MinIO, không chỉ đường internet; số cao mà đường internet
//     không chậm thì thường là MinIO): loại trừ khả năng máy chủ TỰ nghẽn (upload ảnh, file PDF lớn, sao lưu...). Chỉ có trên Linux (/proc).
const https = require('https');
const net = require('net');
const fs = require('fs');
const os = require('os');
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

const DICH_TRONG_NUOC = process.env.DO_MANG_DICH_TRONG_NUOC || 'vnexpress.net:443';
// Quốc tế: máy chủ thử tốc độ của OVH ở Pháp (đo 21/10/2026 từ VN ~200ms — chắc chắn ra nước ngoài). KHÔNG dùng 8.8.8.8: Google anycast có
// điểm phục vụ trong / sát Việt Nam (~30ms) nên không đại diện được đường quốc tế.
const DICH_QUOC_TE = process.env.DO_MANG_DICH_QUOC_TE || 'proof.ovh.net:80';
const HAN_TCP_MS = 5000;
// Thời gian mở kết nối TCP tới host:cổng (từ lúc có IP tới lúc kết nối xong — không tính DNS). Lỗi / quá hạn -> null (không ném lỗi).
function doTcp(dich) {
  const [host, cong] = String(dich).split(':');
  return new Promise(xong => {
    let tIp = null;
    const t0 = performance.now();
    const s = net.connect({ host, port: Number(cong) || 443, timeout: HAN_TCP_MS });
    s.once('lookup', () => { tIp = performance.now(); });
    s.once('connect', () => { const ms = performance.now() - (tIp || t0); s.destroy(); xong(tron(ms)); });
    s.once('timeout', () => { s.destroy(); xong(null); });
    s.once('error', () => { s.destroy(); xong(null); });
  });
}

// Số liệu máy chủ trong phút qua (so với lần đọc trước). Không phải Linux / không đọc được -> các ô null.
let _truoc = null;
function docHeThong() {
  const kq = { taiCpu: null, cpuBan: null, cpuSteal: null, mangVaoKbs: null, mangRaKbs: null };
  if (process.platform !== 'linux') return kq;
  try {
    kq.taiCpu = Math.round(os.loadavg()[0] * 100) / 100;
    // cpu  user nice system idle iowait irq softirq steal ...
    const cpu = fs.readFileSync('/proc/stat', 'utf8').split(/\r?\n/)[0].trim().split(/\s+/).slice(1).map(Number);
    const tong = cpu.slice(0, 8).reduce((a, b) => a + b, 0);
    const rang = cpu[3] + cpu[4];
    let vao = 0, ra = 0;
    for (const dong of fs.readFileSync('/proc/net/dev', 'utf8').split(/\r?\n/).slice(2)) {
      const [ten, sau] = dong.split(':');
      if (!sau || ten.trim() === 'lo') continue;
      const c = sau.trim().split(/\s+/).map(Number);
      vao += c[0]; ra += c[8];
    }
    const bay = { luc: Date.now(), tong, rang, steal: cpu[7] || 0, vao, ra };
    if (_truoc && bay.tong > _truoc.tong) {
      const dTong = bay.tong - _truoc.tong;
      kq.cpuBan = Math.round(100 * (1 - (bay.rang - _truoc.rang) / dTong));
      kq.cpuSteal = Math.round(1000 * (bay.steal - _truoc.steal) / dTong) / 10;
      const giay = (bay.luc - _truoc.luc) / 1000;
      if (giay > 0 && bay.vao >= _truoc.vao && bay.ra >= _truoc.ra) {
        kq.mangVaoKbs = Math.round((bay.vao - _truoc.vao) / 1024 / giay);
        kq.mangRaKbs = Math.round((bay.ra - _truoc.ra) / 1024 / giay);
      }
    }
    _truoc = bay;
  } catch { /* /proc không đọc được (container lạ) -> bỏ */ }
  return kq;
}
const ttfb = r => tron(r.byteDau - (r.tls || r.connect || r.batDau)); // gửi xong (sau bắt tay) -> byte đầu tiên

// 1 lượt mỗi phút: đo độ trễ (cần tên miền), rồi — nếu tới lượt — đo tốc độ (doTocDoMayChu). NỐI TIẾP trong cùng 1 khoá (22/10/2026): chạy
// cùng lúc thì lượt tải 1MB chiếm đường mạng nhà làm số độ trễ phút đó cao giả (và ngược lại), đúng vào giờ cao điểm cần phân tích. Đo tốc
// độ lâu (mạng nghẽn) thì các phút sau bỏ lượt — chấp nhận, đỡ hơn số đo sai.
let dangDo = false;
const KHOI_DONG = Date.now();
let lanTocDoCuoi = 0;
async function doMotLan() {
  if (dangDo) return;
  dangDo = true;
  try {
    if (tenMien) await doDoTre();
    const tocDoDenLuot = PHUT_TOC_DO > 0 && Date.now() - KHOI_DONG >= 2 * 60 * 1000 && Date.now() - lanTocDoCuoi >= PHUT_TOC_DO * 60 * 1000;
    if (tocDoDenLuot) { lanTocDoCuoi = Date.now(); await doTocDoMayChu(); }
  } finally {
    dangDo = false;
  }
}
// Tên miền đang để "DNS only" (mây xám, 23/10/2026 — xưởng kết nối thẳng về máy chủ): DNS trả IP nhà, máy chủ gọi ra IP công cộng của chính
// nhà thì router từ chối (không có NAT loopback) -> trước đây mỗi phút 1 dòng "lỗi Máy chủ -> Cloudflare: ECONNREFUSED" làm báo cáo trông như
// mạng hỏng. Giờ: IP của tên miền KHÔNG thuộc dải Cloudflare -> ghi duong_di 'thang', bỏ 2 phép đo qua Cloudflare (không có đoạn đó để đo),
// vẫn đo trong nước / quốc tế / CPU. Tốc độ đường đi thẳng thật xem ở số đo của điện thoại (nhà mạng "Mạng nội bộ").
// ponytail: dải IPv4 công bố của Cloudflare (cloudflare.com/ips-v4) viết cứng — đổi hiếm; sai thì chỉ nhầm nhãn đường đi, không hỏng đo.
const DAI_CLOUDFLARE = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14',
  '172.64.0.0/13', '131.0.72.0/22'];
const soIp = ip => ip.split('.').reduce((s, o) => s * 256 + Number(o), 0);
const laIpCloudflare = ip => DAI_CLOUDFLARE.some(dai => {
  const [goc, bit] = dai.split('/');
  const khoi = 2 ** (32 - Number(bit));
  return Math.floor(soIp(ip) / khoi) === Math.floor(soIp(goc) / khoi);
});
// -> 'cloudflare' | 'thang' | '' (không tra được DNS — để lượt đo tự báo lỗi như cũ).
async function duongDiTenMien() {
  try {
    const ds = await require('dns').promises.resolve4(tenMien);
    return ds.length && !ds.some(laIpCloudflare) ? 'thang' : 'cloudflare';
  } catch { return ''; }
}

async function doDoTre() {
  const d = { luc: thoiGianVNISOString(), ...docHeThong() };
  // 2 đích tham chiếu đo SONG SONG với lượt Cloudflare (đích chậm không kéo dài lượt đo; chỉ vài gói tin, không ảnh hưởng số đo Cloudflare).
  const thamChieu = Promise.all([doTcp(DICH_TRONG_NUOC), doTcp(DICH_QUOC_TE)]);
  d.duongDi = await duongDiTenMien();
  if (d.duongDi === 'thang') {
    [d.msTcpTrongNuoc, d.msTcpQuocTe] = await thamChieu;
    try { nhatKy.ghiDoMangMayChu(d); } catch (err) { console.error('[DoMang] Lỗi lưu số đo máy chủ:', err.message); }
    return;
  }
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
  [d.msTcpTrongNuoc, d.msTcpQuocTe] = await thamChieu;
  try { nhatKy.ghiDoMangMayChu(d); } catch (err) { console.error('[DoMang] Lỗi lưu số đo máy chủ:', err.message); }
}

function batDauDoMangMayChu() {
  setTimeout(doMotLan, 20 * 1000).unref(); // lần đầu sau khi khởi động 20 giây
  setInterval(doMotLan, CHU_KY_MS).unref();
}

// ---- Tốc độ đường mạng NHÀ (máy chủ) — 22/10/2026, theo yêu cầu người dùng ----
// Mỗi DO_TOC_DO_PHUT phút (mặc định 15, 0 = tắt): tải xuống rồi tải lên 1MB tới speed.cloudflare.com (máy chủ thử tốc độ của Cloudflare —
// KHÔNG qua app, dữ liệu ngẫu nhiên). Điện thoại ở xưởng đo chiều lên tới CÙNG đích này (api.js#doTocDoLen) -> so cùng giờ biết đường mạng
// nào nghẽn. ~2MB / lượt (~200MB / ngày). Ghi bảng do_toc_do (nguon 'may_chu').
const DICH_TOC_DO = 'speed.cloudflare.com';
const KB_TOC_DO = 1024;
const HAN_TOC_DO_MS = 60 * 1000;
const PHUT_TOC_DO = Number.isFinite(Number(process.env.DO_TOC_DO_PHUT)) && process.env.DO_TOC_DO_PHUT !== '' ? Number(process.env.DO_TOC_DO_PHUT) : 15;
// 1 lượt truyền trên kết nối MỚI. Thời gian tính SAU bắt tay (không lẫn DNS/TCP/TLS):
//   xuống: byte đầu -> byte cuối;  lên: bắt tay xong -> có phản hồi, TRỪ 1 vòng (ms_rtt = thời gian mở kết nối TCP) — phần chờ Cloudflare trả
//   lời không phải thời gian truyền; điện thoại cũng trừ y như vậy (api.js) để 2 bên so được.
// Hạn TỔNG HAN_TOC_DO_MS (option timeout của https chỉ là hạn "không có dữ liệu" — mạng nhỏ giọt thì 1 lượt có thể kéo dài cả chục phút).
function truyen(huong) {
  return new Promise(xongGoc => {
    let daXong = false;
    const xong = kq => { if (!daXong) { daXong = true; clearTimeout(henTong); xongGoc(kq); } };
    const henTong = setTimeout(() => { xong({ huong, loi: `quá ${HAN_TOC_DO_MS / 1000} giây` }); req.destroy(); }, HAN_TOC_DO_MS);
    const len = huong === 'len';
    const body = len ? require('crypto').randomBytes(KB_TOC_DO * 1024) : null;
    const t = {};
    let soByte = 0;
    const req = https.request({
      host: DICH_TOC_DO, method: len ? 'POST' : 'GET', agent: false, timeout: HAN_TOC_DO_MS,
      path: len ? '/__up' : `/__down?bytes=${KB_TOC_DO * 1024}`,
      headers: { 'User-Agent': UA_DO_MANG, ...(len ? { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length } : {}) },
    }, res => {
      t.phanHoi = performance.now();
      // Trạm Cloudflare: cf-meta-colo (có ở /__up) hoặc đuôi cf-ray "…-SIN" (/__down không có cf-meta-colo).
      const colo = String(res.headers['cf-meta-colo'] || String(res.headers['cf-ray'] || '').split('-')[1] || '').replace(/[^A-Z]/g, '').slice(0, 5);
      res.on('data', c => { if (t.byteDau == null) t.byteDau = performance.now(); soByte += c.length; });
      res.on('end', () => {
        const msRtt = t.ketNoi ? t.ketNoi - (t.timIp || t.batDau) : null;
        const ms = len ? t.phanHoi - (t.batTay || t.batDau) : performance.now() - (t.byteDau ?? t.phanHoi);
        const msTruyen = len && msRtt != null && ms - msRtt > 0 ? ms - msRtt : ms;
        if (res.statusCode !== 200 || (!len && soByte < KB_TOC_DO * 1024)) return xong({ huong, colo, loi: `HTTP ${res.statusCode}, nhận ${soByte} byte` });
        xong({ huong, colo, kb: KB_TOC_DO, ms: tron(ms), msRtt: tron(msRtt), kbs: msTruyen > 0 ? Math.round(KB_TOC_DO / (msTruyen / 1000)) : null });
      });
      res.on('error', err => xong({ huong, colo, loi: err.message }));
    });
    req.on('socket', s => {
      s.once('lookup', () => { t.timIp = performance.now(); });
      s.once('connect', () => { t.ketNoi = performance.now(); });
      s.once('secureConnect', () => { t.batTay = performance.now(); });
    });
    t.batDau = performance.now();
    req.on('timeout', () => req.destroy(new Error(`quá ${HAN_TOC_DO_MS / 1000} giây`)));
    req.on('error', err => xong({ huong, loi: String(err.message).slice(0, 60) }));
    req.end(body || undefined);
  });
}
// Gọi từ doMotLan (cùng khoá với đo độ trễ) khi tới lượt.
async function doTocDoMayChu() {
  try {
    const luc = thoiGianVNISOString();
    const ds = [await truyen('xuong'), await truyen('len')]; // lần lượt — chạy song song thì 2 chiều tranh nhau, số đo sai
    nhatKy.ghiNhieuTocDo(ds.map(d => ({ ...d, luc, nguon: 'may_chu', loi: d.loi || '' })));
  } catch (err) {
    console.error('[DoMang] Lỗi đo tốc độ máy chủ:', err.message);
  }
}

module.exports = { batDauDoMangMayChu, doTocDoMayChu, truyen, hocTenMien, doMotLan, UA_DO_MANG, doTcp, docHeThong, DICH_TRONG_NUOC, DICH_QUOC_TE };
