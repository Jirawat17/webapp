// Phiên bản app đang chạy (16/10/2026, theo yêu cầu người dùng) — để log / báo cáo Telegram ghi rõ số liệu thuộc bản nào khi so trước-sau
// mỗi lần sửa. Docker KHÔNG chép .git vào image (.dockerignore) nên không có mã commit: người dùng chốt cách TỰ ĐỘNG, không đổi lệnh deploy:
//   phienBanApp — số v= của /js/api.js trong scan.html (cùng số các trang đang nạp; nhatKyQuet.js dùng để nhắc "có bản mới").
//   maCode      — 8 ký tự "dấu vân tay" (sha1) của toàn bộ code app: server.js, routes, services, config, data/*.js, public. Code đổi
//                 -> mã đổi, kể cả lần sửa không tăng v=. Tính 1 lần lúc khởi động (~vài chục ms).
//   khoiDongLuc — lúc tiến trình khởi động (ms).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GOC = path.join(__dirname, '..');
const THU_MUC_CODE = ['routes', 'services', 'config', 'data', 'public'];
const DUOI_CODE = /\.(js|html|css|json)$/;

function dsFileCode() {
  const ds = ['server.js'];
  const duyet = thuMuc => {
    let ten = [];
    try { ten = fs.readdirSync(path.join(GOC, thuMuc), { withFileTypes: true }); } catch (e) { return; }
    for (const d of ten) {
      const rel = path.join(thuMuc, d.name);
      if (d.isDirectory()) duyet(rel);
      // data/: chỉ file .js (định nghĩa pipeline...), KHÔNG đọc CSDL/log/ảnh nằm cùng thư mục.
      else if (DUOI_CODE.test(d.name) && (!rel.startsWith('data' + path.sep) || d.name.endsWith('.js'))) ds.push(rel);
    }
  };
  THU_MUC_CODE.forEach(duyet);
  return ds.sort();
}

function tinhMaCode() {
  const bam = crypto.createHash('sha1');
  for (const rel of dsFileCode()) {
    bam.update(rel.split(path.sep).join('/'));
    try { bam.update(fs.readFileSync(path.join(GOC, rel))); } catch (e) { /* file vừa mất — bỏ */ }
  }
  return bam.digest('hex').slice(0, 8);
}

let phienBanApp = '';
try { phienBanApp = (fs.readFileSync(path.join(GOC, 'public', 'scan.html'), 'utf8').match(/\/js\/api\.js\?v=(\d+)/) || [])[1] || ''; } catch (e) { /* không có scan.html */ }
const maCode = tinhMaCode();
const khoiDongLuc = Date.now();
const moTa = `v${phienBanApp || '?'} · mã ${maCode}`;

module.exports = { phienBanApp, maCode, khoiDongLuc, moTa };
