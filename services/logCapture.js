const fs = require('fs');
const path = require('path');

// Ghi log server ra file (bổ sung 23/09/2026, theo yêu cầu người dùng — superadmin xem được log qua
// web, không cần SSH vào VPS đọc `docker logs` nữa, xem routes/logs.js + public/logs.html). "Chặn"
// console.log/warn/error NGAY LÚC require file này (không phải hàm batDau() gọi sau — phải có hiệu lực
// TRƯỚC dòng console.* đầu tiên trong server.js, require() SỚM NHẤT có thể là cách chắc chắn duy nhất).
// data/ đã là volume mount sẵn trên Docker VPS (xem docker-compose.yml) — log sống sót qua redeploy,
// không cần thêm volume mới.
// LOG THEO NGÀY (16/10/2026, người dùng chốt giữ 30 ngày): mỗi ngày (giờ VN) 1 file data/logs/server-YYYY-MM-DD.log, thay cho 1 file
// server.log tự cắt nửa khi vượt 5MB (ngày nhiều việc bị mất log buổi sáng -> báo cáo 24 giờ thiếu). File quá 30 ngày tự xoá. File
// server.log cũ (trước khi đổi) vẫn được đọc như phần cũ nhất, quá 30 ngày không ghi thêm thì tự xoá.
// SERVER_LOG_PATH (môi trường thử): thư mục log = <thư mục của đường dẫn đó>/logs.
const DUONG_DAN_LOG_CU = process.env.SERVER_LOG_PATH || path.join(__dirname, '..', 'data', 'server.log');
const THU_MUC_LOG = path.join(path.dirname(DUONG_DAN_LOG_CU), 'logs');
fs.mkdirSync(THU_MUC_LOG, { recursive: true });
const SO_NGAY_GIU_LOG = 30;
// ponytail: chặn ghi thêm khi 1 file ngày vượt 200MB (log lặp vô hạn do lỗi) — giữ an toàn đĩa; ghi 1 dòng báo rồi thôi tới hết ngày.
const NGUONG_FILE_NGAY_BYTES = 200 * 1024 * 1024;
const ngayVN = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 10); // VN không đổi giờ mùa hè -> +7 cố định
const fileNgay = ngay => path.join(THU_MUC_LOG, `server-${ngay}.log`);
const MAU_TEN_FILE = /^server-(\d{4}-\d{2}-\d{2})\.log$/;

function donLogCu() {
  const moc = ngayVN(Date.now() - SO_NGAY_GIU_LOG * 86400000);
  try {
    for (const f of fs.readdirSync(THU_MUC_LOG)) {
      const m = f.match(MAU_TEN_FILE);
      if (m && m[1] < moc) fs.unlinkSync(path.join(THU_MUC_LOG, f));
    }
    if (fs.existsSync(DUONG_DAN_LOG_CU) && fs.statSync(DUONG_DAN_LOG_CU).mtimeMs < Date.now() - SO_NGAY_GIU_LOG * 86400000) fs.unlinkSync(DUONG_DAN_LOG_CU);
  } catch (e) { /* dọn lỗi lần này thì lần đổi ngày sau dọn tiếp */ }
}

let _ngayDangGhi = '', _soLanGhi = 0, _daVuotNguong = false;
function ghi(dong) {
  try {
    const ngay = ngayVN(Date.now());
    if (ngay !== _ngayDangGhi) { _ngayDangGhi = ngay; _daVuotNguong = false; donLogCu(); }
    if (_daVuotNguong) return;
    const f = fileNgay(ngay);
    if (++_soLanGhi % 500 === 0) { // kiểm tra dung lượng thưa thôi (stat mỗi dòng là thừa)
      let kichThuoc = 0;
      try { kichThuoc = fs.statSync(f).size; } catch (e) { /* chưa có file */ }
      if (kichThuoc > NGUONG_FILE_NGAY_BYTES) {
        _daVuotNguong = true;
        fs.appendFileSync(f, `[${new Date().toISOString()}] [ERROR] [Log] File log hôm nay vượt ${NGUONG_FILE_NGAY_BYTES / 1048576}MB — NGỪNG ghi thêm tới hết ngày (kiểm tra log lặp).\n`);
        return;
      }
    }
    fs.appendFileSync(f, dong + '\n');
  } catch (e) { /* lỗi ghi log KHÔNG được làm hỏng luồng chính — im lặng bỏ qua, console gốc vẫn đã in ra */ }
}

// Danh sách file log, CŨ trước (file server.log cũ nhất, rồi theo ngày). tuNgay: bỏ các file ngày trước ngày đó.
function dsFileLog(tuNgay = '') {
  let ds = [];
  try { ds = fs.readdirSync(THU_MUC_LOG).map(f => f.match(MAU_TEN_FILE)).filter(m => m && m[1] >= tuNgay).map(m => m[1]).sort().map(fileNgay); } catch (e) { /* chưa có thư mục */ }
  return (fs.existsSync(DUONG_DAN_LOG_CU) ? [DUONG_DAN_LOG_CU] : []).concat(ds);
}
const docFile = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } };

// Mọi dòng log từ NGÀY của tuMs trở đi (cũ trước) — báo cáo logs 24 giờ (services/baoCaoLogService.js) tự lọc đúng mốc giờ.
function docDongTu(tuMs) {
  return dsFileLog(ngayVN(tuMs)).flatMap(docFile);
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
// Thao tác được đo MỌI lượt (16/10/2026) — "METHOD mẫu-đường-dẫn-route" -> tên hiện trong báo cáo hằng ngày (giữa / 90%, so với hôm
// trước). Chỉ vài thao tác người dùng chờ trực tiếp — không đo các lượt tự làm mới/ảnh (rất nhiều, làm phình bảng).
const THAO_TAC_DO = {
  'POST /api/photos/kiem-tra': 'Kiểm tra đơn trước khi chụp',
  'POST /api/photos/upload': 'Tải ảnh lên (máy chủ xử lý)',
  'POST /api/qr/kich-ban/:scenarioId/kiem-tra': 'Quét QR (kịch bản)',
  'POST /api/tracking/in-label': 'In tem',
  'POST /api/tracking/mua-va-in-label': 'Mua tracking + in tem',
  'POST /api/orders/:sttKey/so-mui-chi': 'Lưu số mũi chỉ',
  'GET /api/orders': 'Mở danh sách đơn hàng',
  'GET /api/orders/:sttKey': 'Mở chi tiết đơn',
  'GET /api/reports/pdf': 'In phiếu đơn',
};
function ghiThoiGianNeuCanDo(req, ms, ma) {
  if (!req.route) return;
  const thaoTac = THAO_TAC_DO[`${req.method} ${req.baseUrl || ''}${req.route.path === '/' ? '' : req.route.path}`];
  if (!thaoTac) return;
  try {
    require('./nhatKyDbService').ghiThoiGianApi(require('./dateUtils').thoiGianVNISOString(), thaoTac, ms, ma);
  } catch (e) { /* đo lỗi không được làm hỏng lượt gọi */ }
}
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
    if (xong) ghiThoiGianNeuCanDo(req, ms, ma);
    // Lượt đo mạng (/api/ping) chậm là chuyện của MẠNG, đã lưu chi tiết ở bảng do_mang — không ghi "CHẬM" vào log (mạng yếu sẽ ra hàng loạt dòng).
    // Lượt 401 của chính máy chủ tự đo mỗi phút (services/doMangMayChuService.js, User-Agent riêng) cũng không ghi.
    if (req.originalUrl.startsWith('/api/ping') && (ma < 400 || req.get('user-agent') === 'xuong-theu-do-mang')) return;
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

// Đọc N dòng cuối — dùng bởi routes/logs.js. Đọc file MỚI NHẤT trước, thiếu thì lùi dần sang ngày trước.
function docDongCuoi(soDong = 500) {
  let dong = [];
  for (const f of dsFileLog().reverse()) {
    dong = docFile(f).concat(dong);
    if (dong.length >= soDong) break;
  }
  return dong.slice(-soDong).join('\n');
}

module.exports = { docDongCuoi, docDongTu, THU_MUC_LOG, ghiLuotApi };
