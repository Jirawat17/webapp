// Tra NHÀ MẠNG của người dùng từ IP (21/10/2026, theo yêu cầu người dùng — log đo mạng: cần biết người chậm dùng Viettel/VNPT/FPT/di động
// nào, nhà mạng nào hay bị Cloudflare đẩy sang trạm châu Âu). Tra TRÊN MÁY CHỦ bằng file dữ liệu miễn phí iptoasn.com (người dùng chọn):
// không gửi IP người dùng cho bên thứ ba, log chỉ lưu tên nhà mạng — KHÔNG lưu IP.
// File gốc (~7MB gz, mọi dải IP thế giới) tải 1 lần/tuần; chỉ giữ dải IP Việt Nam (vài nghìn dòng) vào data/nha_mang_vn.json.
// IP không thuộc dải Việt Nam (VPN, roaming...) -> "Ngoài Việt Nam / không rõ"; chưa tải được file -> '' (đo mạng vẫn chạy bình thường).
// Định dạng mỗi dòng (TSV): range_start  range_end  AS_number  country_code  AS_description — IPv4 lẫn IPv6.
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const net = require('net');
const readline = require('readline');
const { Readable } = require('stream');

const URL_DU_LIEU = process.env.IP2ASN_URL || 'https://iptoasn.com/data/ip2asn-combined.tsv.gz';
const DUONG_DAN = process.env.NHA_MANG_PATH || path.join(__dirname, '..', 'data', 'nha_mang_vn.json');
const TUOI_TOI_DA_MS = 7 * 24 * 3600 * 1000;
const HAN_TAI_MS = 120 * 1000;
const SO_DONG_VN_TOI_THIEU = 100; // file tải về lỗi/cắt ngang -> ít dòng VN bất thường -> không thay file cũ

// IP -> BigInt (v4 và v6 chung 1 trục: v4 đặt trong dải ::ffff:0:0/96 để không trùng v6). null = không phải IP.
function ipThanhSo(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:') && net.isIPv4(s.slice(7))) s = s.slice(7);
  if (net.isIPv4(s)) return (0xffffn << 32n) | BigInt(s.split('.').reduce((a, b) => a * 256 + Number(b), 0));
  if (!net.isIPv6(s)) return null;
  const [dau, cuoi = ''] = s.split('::');
  const a = dau ? dau.split(':') : [];
  const b = s.includes('::') ? (cuoi ? cuoi.split(':') : []) : [];
  if (b.length && net.isIPv4(b[b.length - 1])) { // dạng ...:1.2.3.4
    const p = b.pop().split('.').map(Number);
    b.push(((p[0] << 8) | p[1]).toString(16), ((p[2] << 8) | p[3]).toString(16));
  }
  const nhom = s.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  if (nhom.length !== 8) return null;
  return nhom.reduce((acc, h) => (acc << 16n) | BigInt(parseInt(h || '0', 16)), 0n);
}

// Tên ngắn dễ đọc: "AS7552 VIETEL-AS-AP Viettel Group" -> "Viettel (AS7552)". Không nhận ra -> mô tả gốc (cắt 40 ký tự).
const TEN_GON = [[/viettel|vietel/i, 'Viettel'], [/vnpt|vietnam posts/i, 'VNPT'], [/fpt/i, 'FPT'], [/cmc/i, 'CMC'], [/mobifone/i, 'MobiFone'],
  [/vietnamobile/i, 'Vietnamobile'], [/sctv/i, 'SCTV'], [/netnam/i, 'NetNam'], [/superdata|super data/i, 'Superdata']];
const tenGon = (asn, moTa) => `${(TEN_GON.find(([re]) => re.test(moTa)) || [])[1] || String(moTa || '').slice(0, 40)} (AS${asn})`;

let bang = null; // [{ tu: BigInt, den: BigInt, ten }] sắp theo tu
// Nạp lỗi (file thiếu / hỏng) -> KHÔNG đọc lại ở mỗi lượt ping (mỗi người 30 giây 1 lần — từng làm tràn log nếu file hỏng); chỉ thử lại khi
// capNhatNeuCu chạy (mỗi ngày) hoặc vừa tải file mới.
let napLoi = false;
function napBang() {
  try {
    const goc = JSON.parse(fs.readFileSync(DUONG_DAN, 'utf8'));
    bang = goc.ds.map(([tu, den, ten]) => ({ tu: BigInt(tu), den: BigInt(den), ten })).sort((x, y) => (x.tu < y.tu ? -1 : x.tu > y.tu ? 1 : 0));
    napLoi = false;
    return true;
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[NhaMang] Không đọc được', DUONG_DAN, '-', err.message);
    bang = null;
    napLoi = true;
    return false;
  }
}

// Truy cập không qua Cloudflare (mở thẳng địa chỉ LAN, cổng Docker...) -> IP nội bộ: ghi rõ, không lẫn vào "Ngoài Việt Nam".
const NOI_BO = new net.BlockList();
for (const [dc, n] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16]]) NOI_BO.addSubnet(dc, n, 'ipv4');
for (const [dc, n] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]]) NOI_BO.addSubnet(dc, n, 'ipv6');
const MANG_NOI_BO = 'Mạng nội bộ (không qua Cloudflare)';
function laNoiBo(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:') && net.isIPv4(s.slice(7))) s = s.slice(7);
  const loai = net.isIPv4(s) ? 'ipv4' : net.isIPv6(s) ? 'ipv6' : null;
  return !!loai && NOI_BO.check(s, loai);
}

// IP -> tên nhà mạng ('' = không tra được). Tìm nhị phân dải có tu <= ip.
function traNhaMang(ip) {
  const so = ipThanhSo(ip);
  if (so === null) return '';
  if (laNoiBo(ip)) return MANG_NOI_BO;
  if (bang === null && (napLoi || !napBang())) return '';
  let lo = 0, hi = bang.length - 1, kq = -1;
  while (lo <= hi) {
    const giua = (lo + hi) >> 1;
    if (bang[giua].tu <= so) { kq = giua; lo = giua + 1; } else hi = giua - 1;
  }
  if (kq >= 0 && so <= bang[kq].den) return bang[kq].ten;
  return 'Ngoài Việt Nam / không rõ';
}

// Đọc file .tsv.gz -> chỉ dòng VN. Giải nén + đọc TỪNG DÒNG theo luồng (không gunzipSync + split cả ~30MB một lượt — từng chặn máy chủ
// 1–3 giây sau mỗi lần khởi động): mỗi khúc dữ liệu xử lý xong là trả lượt cho các request khác.
async function locDongVietNam(bufferGz) {
  const ds = [];
  const dongDoc = readline.createInterface({ input: Readable.from([bufferGz]).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const dong of dongDoc) {
    const [tu, den, asn, nuoc, moTa] = dong.split('\t');
    if (nuoc !== 'VN' || !asn || asn === '0') continue;
    const a = ipThanhSo(tu), b = ipThanhSo(den);
    if (a !== null && b !== null) ds.push([a.toString(), b.toString(), tenGon(asn, (moTa || '').trim())]);
  }
  return ds;
}

function taiFile(url) {
  return new Promise((xong, loi) => {
    const req = https.get(url, { timeout: HAN_TAI_MS }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return taiFile(new URL(res.headers.location, url).href).then(xong, loi); }
      if (res.statusCode !== 200) { res.resume(); return loi(new Error(`HTTP ${res.statusCode}`)); }
      const phan = [];
      res.on('data', c => phan.push(c));
      res.on('end', () => xong(Buffer.concat(phan)));
      res.on('error', loi);
    });
    req.on('timeout', () => req.destroy(new Error(`quá ${HAN_TAI_MS / 1000} giây`)));
    req.on('error', loi);
  });
}

let dangTai = false;
async function capNhatNeuCu() {
  if (dangTai) return;
  try { if (Date.now() - fs.statSync(DUONG_DAN).mtimeMs < TUOI_TOI_DA_MS) { if (!bang) napBang(); return; } } catch { /* chưa có file */ }
  dangTai = true;
  try {
    const ds = await locDongVietNam(await taiFile(URL_DU_LIEU));
    if (ds.length < SO_DONG_VN_TOI_THIEU) throw new Error(`chỉ có ${ds.length} dải IP Việt Nam — file có vẻ lỗi, giữ bản cũ`);
    const tam = DUONG_DAN + '.tam';
    fs.writeFileSync(tam, JSON.stringify({ luc: new Date().toISOString(), nguon: URL_DU_LIEU, ds }));
    fs.renameSync(tam, DUONG_DAN);
    napBang();
    console.log(`[NhaMang] Đã cập nhật dữ liệu nhà mạng: ${ds.length} dải IP Việt Nam.`);
  } catch (err) {
    console.warn('[NhaMang] Không cập nhật được dữ liệu nhà mạng (đo mạng vẫn chạy, cột nhà mạng để trống):', err.message);
  } finally {
    dangTai = false;
  }
}

function batDauCapNhatNhaMang() {
  setTimeout(capNhatNeuCu, 60 * 1000).unref(); // sau khởi động 1 phút — không tranh tài nguyên lúc vừa chạy
  setInterval(capNhatNeuCu, 24 * 3600 * 1000).unref(); // mỗi ngày xem file đã quá 7 ngày chưa
}

module.exports = { traNhaMang, batDauCapNhatNhaMang, capNhatNeuCu, locDongVietNam, ipThanhSo, napBang };
