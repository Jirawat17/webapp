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

// Lỗi làm SẬP app (11/10/2026, theo yêu cầu người dùng): Node tự in ra stderr (không qua console.error) nên
// trước đây chỉ thấy trong `docker logs`. "Monitor" chỉ ĐỌC — không đổi hành vi: app vẫn sập + Docker vẫn tự
// khởi động lại như cũ. Bắt cả Promise bị reject không ai xử lý (origin 'unhandledRejection').
process.on('uncaughtExceptionMonitor', (err, origin) => {
  ghi(`[${new Date().toISOString()}] [FATAL] App bị sập (${origin}): ${(err && err.stack) || err}`);
});

// Ghi lượt gọi API bị TỪ CHỐI/LỖI (mã >= 400) hoặc CHẬM (> 3 giây), kèm người dùng + lý do (11/10/2026, theo yêu
// cầu người dùng). Không ghi lượt bình thường (các trang tự làm mới liên tục — log sẽ đầy, đẩy mất log quan trọng).
// Không ghi body request (có thể chứa mật khẩu). 401 "chưa đăng nhập" của tab mở sẵn sau khi hết phiên bỏ qua
// (tự làm mới liên tục -> rất nhiều dòng vô ích); đăng nhập sai (/api/auth) vẫn ghi.
// - 'close' (không phải 'finish'): bắt cả lượt người dùng bỏ đi giữa chừng (đóng/tải lại tab) — chỉ ghi khi đã quá
//   ngưỡng chậm (chuyển trang nhanh làm huỷ các lượt tự làm mới là bình thường).
// - Ảnh tải hàng loạt qua <img> (proxy ảnh ngoài, file MinIO): bỏ qua chậm/404 — 1 trang danh sách có thể ra 50+ dòng,
//   đẩy mất log quan trọng khi file xoay vòng; lỗi 5xx của chúng vẫn ghi.
// - Chỉ ghi đường dẫn + TÊN tham số (không ghi giá trị: ô tìm kiếm có thể chứa tên/địa chỉ khách).
// - Lỗi 500: server.js chuyển stack vào res.locals.loiStack để in CÙNG 1 lần với dòng [API] (không in 2 nơi).
const NGUONG_CHAM_MS = 3000;
const DUONG_DAN_ANH = ['/api/photos/file/', '/api/photos/anh-ngoai'];
const motDong = s => String(s).replace(/\s+/g, ' ').trim().slice(0, 300);
function ghiLuotApi(req, res, next) {
  const batDau = Date.now();
  res.locals.coGhiLuotApi = true;
  const jsonGoc = res.json.bind(res), sendGoc = res.send.bind(res);
  res.json = body => { if (body && typeof body.error === 'string') res.locals.loiApi = body.error; return jsonGoc(body); };
  res.send = body => { // route trả lỗi bằng res.send('chữ') cũng có lý do
    if (res.statusCode >= 400 && !res.locals.loiApi && typeof body === 'string') res.locals.loiApi = body;
    return sendGoc(body);
  };
  res.on('close', () => {
    const ms = Date.now() - batDau, xong = res.writableFinished, ma = res.statusCode;
    const cham = ms > NGUONG_CHAM_MS;
    if (xong ? (ma < 400 && !cham) : !cham) return;
    const duongDan = req.originalUrl.split('?')[0];
    if (ma < 500 && req.method === 'GET' && DUONG_DAN_ANH.some(p => duongDan.startsWith(p))) return;
    const u = req.session && req.session.user;
    if (ma === 401 && !u && !duongDan.startsWith('/api/auth')) return;
    const ai = u ? `${u.ten} (${u.vaiTro})` : 'chưa đăng nhập';
    const thamSo = Object.keys(req.query || {});
    const lyDo = res.locals.loiApi ? ` · ${motDong(res.locals.loiApi)}` : '';
    const dong = `[API] ${xong ? ma : '---'} ${req.method} ${duongDan.slice(0, 200)}${thamSo.length ? '?' + thamSo.map(k => k + '=…').join('&') : ''}`
      + ` · ${ms}ms · ${ai}${cham ? ' · CHẬM' : ''}${xong ? '' : ' · NGƯỜI DÙNG BỎ ĐI GIỮA CHỪNG'}${lyDo}`;
    if (res.locals.loiStack) console.error(dong + '\n' + res.locals.loiStack);
    else (xong && ma < 400 ? console.log : console.warn)(dong);
  });
  next();
}

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

module.exports = { docDongCuoi, DUONG_DAN_LOG, ghiLuotApi };
