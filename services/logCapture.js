const fs = require('fs');
const path = require('path');

// Ghi log server ra file (bổ sung 23/09/2026, theo yêu cầu người dùng — superadmin xem được log qua
// web, không cần SSH vào VPS đọc `docker logs` nữa, xem routes/logs.js + public/logs.html). "Chặn"
// console.log/warn/error NGAY LÚC require file này (không phải hàm batDau() gọi sau — phải có hiệu lực
// TRƯỚC dòng console.* đầu tiên trong server.js, require() SỚM NHẤT có thể là cách chắc chắn duy nhất).
// data/ đã là volume mount sẵn trên Docker VPS (xem docker-compose.yml) — log sống sót qua redeploy,
// không cần thêm volume mới.
const DUONG_DAN_LOG = process.env.SERVER_LOG_PATH || path.join(__dirname, '..', 'data', 'server.log');
fs.mkdirSync(path.dirname(DUONG_DAN_LOG), { recursive: true });

// ponytail: giới hạn 5MB rồi cắt giữ nửa sau — đọc/ghi lại TOÀN BỘ file mỗi lần vượt ngưỡng (O(n)), đủ
// dùng ở quy mô vài chục dòng log/phút hiện tại; nếu sau này log dày hơn hẳn, cần xoay vòng nhiều file
// thật (kiểu logrotate) thay vì cắt 1 file duy nhất.
const NGUONG_XOAY_VONG_BYTES = 5 * 1024 * 1024;

function ghi(dong) {
  try {
    let kichThuoc = 0;
    try { kichThuoc = fs.statSync(DUONG_DAN_LOG).size; } catch (e) { /* chưa có file — bình thường lúc mới cài */ }
    if (kichThuoc > NGUONG_XOAY_VONG_BYTES) {
      const noiDung = fs.readFileSync(DUONG_DAN_LOG, 'utf8');
      fs.writeFileSync(DUONG_DAN_LOG, noiDung.slice(Math.floor(noiDung.length / 2)));
    }
    fs.appendFileSync(DUONG_DAN_LOG, dong + '\n');
  } catch (e) { /* lỗi ghi log KHÔNG được làm hỏng luồng chính — im lặng bỏ qua, console gốc vẫn đã in ra */ }
}

function dinhDangDong(method, args) {
  const noiDung = args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' ');
  return `[${new Date().toISOString()}] [${method.toUpperCase()}] ${noiDung}`;
}

['log', 'warn', 'error'].forEach(method => {
  const hamGoc = console[method].bind(console);
  console[method] = (...args) => {
    hamGoc(...args);
    ghi(dinhDangDong(method, args));
  };
});

// Đọc N dòng cuối — dùng bởi routes/logs.js. Đọc lại TOÀN BỘ file rồi cắt (đơn giản, đủ nhanh ở quy mô
// tối đa ~5MB/NGUONG_XOAY_VONG_BYTES ở trên) thay vì đọc ngược từ cuối file theo byte.
function docDongCuoi(soDong = 500) {
  try {
    const noiDung = fs.readFileSync(DUONG_DAN_LOG, 'utf8');
    const dong = noiDung.split('\n').filter(Boolean);
    return dong.slice(-soDong).join('\n');
  } catch (e) {
    return '';
  }
}

module.exports = { docDongCuoi, DUONG_DAN_LOG };
