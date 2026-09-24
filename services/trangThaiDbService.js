const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ============================================================
// Lưu các cột APP TỰ GHI của Don_Hang_ALL (trạng thái, hash ảnh, nhóm hàng loạt, tracking...) — TÁCH
// KHỎI Google Sheets, ghi theo SQLite bằng SQLite thay vì số dòng vật lý (bổ sung 18/09/2026, xem
// docs/superpowers/specs/2026-09-18-chuyen-cot-app-ghi-sang-sqlite-design.md).
//
// ROOT CAUSE (đã xác nhận với người dùng — xem
// docs/superpowers/specs/2026-09-17-sua-loi-ghi-lech-dong-vstack-design.md): cột "gốc" của Don_Hang_ALL
// (STT_Key, tên khách, link ảnh...) là công thức QUERY(VSTACK(...)) SỐNG, ghép từ ~19 sheet con — vị
// trí DÒNG VẬT LÝ của 1 đơn có thể đổi bất cứ lúc nào công thức tính lại, kể cả không ai đụng trực tiếp
// vào Don_Hang_ALL. Trước đây các cột app tự ghi (TRANG_THAI_XUONG, HASH_ANH_MAU...) là cột TĨNH nằm
// CHUNG sheet đó — dù app ghi ĐÚNG dòng tại thời điểm ghi (đã sửa 17/09/2026), dữ liệu ĐÃ ghi đúng vẫn
// có thể bị "lạc chủ" SAU ĐÓ nếu dòng xáo trộn (Sheets không có khái niệm "ô này thuộc đơn nào", chỉ có
// số dòng vật lý). Chuyển hẳn sang SQLite, ghi theo KHOÁ (stt_key) — không còn khái niệm "dòng vật lý"
// nên xoá được toàn bộ lớp rủi ro này, không chỉ tại thời điểm ghi mà cả VỀ SAU.
//
// Toàn bộ cột dưới đây đã xác nhận với người dùng là CHỈ app ghi — không cột nào nằm trong vùng công
// thức sống (A:AM của Don_Hang_ALL sau khi người dùng cấu trúc lại Sheet 18/09/2026). DUONG_DAN_URL/
// MOCKUP KHÔNG có trong danh sách này dù trước đây app có ghi (routes/photos.js mốc 'mau'/'mockup') —
// 2 mốc đó đã bị xoá hẳn (người dùng chọn: 2 ảnh này từ giờ CHỈ nhập tay ở sheet RAW lúc lên đơn, app
// chỉ đọc không ghi nữa).
const CAC_COT = [
  'TRANG_THAI_PHOI', 'TRANG_THAI_VE_FILE', 'QUOC_GIA', 'MA_CODE_STT', 'MA_KHACH_HANG', 'NGUOI_VAN_HANH',
  // Anh_File_Theu_URL_2/_3 (bổ sung 24/09/2026, theo yêu cầu người dùng — cho phép tải ảnh file thêu
  // THỨ 2 và THỨ 3, độc lập với nhau, xem routes/photos.js COT_ANH_THEO_MOC) — tự thêm cột qua cơ chế
  // bên dưới, không cần migrate tay.
  'Anh_File_Theu_URL', 'Anh_File_Theu_URL_2', 'Anh_File_Theu_URL_3', 'Anh_Da_San_Xuat_URL', 'TRONG_LUONG', 'TRANG_THAI_XUONG', 'Anh_Da_Dan_Tem_URL',
  'NGUOI_VE_FILE', 'GHI_CHU_VE_FILE', 'NGUOI_CHAY_MAY', 'GHI_CHU_CHAY_MAY', 'HASH_ANH_MAU', 'NHOM_HANG_LOAT',
  'AUTO_TRACKING', 'THOI_GIAN_IN_MA', 'IN_LABEL', 'THOI_GIAN_IN_LABEL', 'DON_UU_TIEN', 'TAM_THOI',
  'HANG_VAN_CHUYEN', 'TRACKING_ID', 'TRANG_THAI_TRACKING', 'THOI_GIAN_CAP_NHAT_TRACKING',
  // MA_NODE_TRACKING/MA_TRANG_THAI_NODE_TRACKING (bổ sung 21/09/2026, theo yêu cầu người dùng — xem
  // services/trackingAutoService.js#daGiaoThanhCongGke): lưu song song mã "order_node"/"node_status"
  // GỐC của GKE (không phải chuỗi mô tả tiếng Việt TRANG_THAI_TRACKING) — dùng để nhận diện đơn đã giao
  // xong THẬT (tránh quét GKE dư), vì node_status="000" một mình KHÔNG có nghĩa "xong" (nhiều bước đầu
  // của pipeline cũng có node_status="000") — phải xét đúng cặp với order_node.
  'MA_NODE_TRACKING', 'MA_TRANG_THAI_NODE_TRACKING', 'KHACH_HANG',
  'XUONG', 'NguoiCapNhatCuoi', 'ThoiGianCapNhatCuoi',
  // CanhBaoDaGui: không nằm trong danh sách 31 cột người dùng liệt kê (có thể chỉ là sót khi liệt kê) —
  // nhưng rà code xác nhận đây CŨNG là cột app tự ghi (services/canhBaoJob.js, cờ chống spam Telegram),
  // không thuộc RAW/A:AM lẫn AN:BR người dùng mô tả. Xếp vào đây theo đúng tiêu chí "app tự ghi" đã
  // thống nhất — nếu không đúng ý người dùng, dễ dàng bỏ khỏi danh sách này sau.
  'CanhBaoDaGui',
  // DA_XOA (bổ sung 20/09/2026, cho nút "Xoá dữ liệu đơn hàng" CHỈ superadmin — xem
  // services/xoaDuLieuDonService.js): KHÔNG bao giờ tồn tại trong Sheets (cột thuần app-nội-bộ, khác mọi
  // cột khác trong danh sách này vốn từng là cột tĩnh trong Don_Hang_ALL trước 18/09/2026) — dùng để ẨN
  // VĨNH VIỄN 1 đơn khỏi mọi danh sách trong app (orderService.js#getAll lọc bỏ) vì KHÔNG có cách xoá
  // thật dòng RAW gốc trên Sheets (xem services/xoaDuLieuDonService.js để biết lý do đầy đủ).
  'DA_XOA',
];

const DUONG_DAN_DB = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'trang_thai_don.db');

fs.mkdirSync(path.dirname(DUONG_DAN_DB), { recursive: true });

const db = new Database(DUONG_DAN_DB);
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS trang_thai_don (
  stt_key TEXT PRIMARY KEY,
  ${CAC_COT.map(c => `${c} TEXT NOT NULL DEFAULT ''`).join(',\n  ')}
)`);

// Tự thêm cột MỚI vào bảng ĐÃ TỒN TẠI (bổ sung 20/09/2026, khi thêm cột DA_XOA) — CREATE TABLE IF NOT
// EXISTS ở trên là NO-OP nếu bảng đã tồn tại (trường hợp DB thật trên VPS, đã tạo từ lần migrate
// 18/09/2026), KHÔNG tự thêm cột mới cho bảng cũ. Thiếu bước này, thêm 1 cột vào CAC_COT mà chưa xoá +
// tạo lại DB thật sẽ khiến MỌI câu SELECT/INSERT tham chiếu CAC_COT lỗi "no such column" ngay khi
// deploy. Tự dò + ALTER TABLE cho từng cột còn thiếu — an toàn/idempotent, tự chạy lại vô hại nếu cột
// đã có sẵn, và tự lo cho MỌI cột mới thêm sau này, không chỉ riêng DA_XOA.
const cacCotHienCo = new Set(db.prepare(`PRAGMA table_info(trang_thai_don)`).all().map(c => c.name));
for (const cot of CAC_COT) {
  if (!cacCotHienCo.has(cot)) {
    db.exec(`ALTER TABLE trang_thai_don ADD COLUMN ${cot} TEXT NOT NULL DEFAULT ''`);
  }
}

// 2 cột "trạng thái 2 nấc" (TRANG_THAI_PHOI/TRANG_THAI_VE_FILE) LUÔN có 1 giá trị nghiệp vụ thật theo
// pipeline (data/pipelineTinhTrang.js) — không có khái niệm "chưa biết"/trống hợp lệ như các cột khác
// trong CAC_COT (vd GHI_CHU_VE_FILE, NGUOI_VAN_HANH... trống nghĩa là "chưa có", vẫn hợp lệ). '' cho
// riêng 2 cột này CHỈ phát sinh do kỹ thuật lưu trữ — SQL DEFAULT '' khi cột chưa từng được ghi (đơn đã
// có dòng trong bảng vì lý do khác nhưng chưa từng đụng tới cột này), hoặc đơn CHƯA TỪNG có dòng nào
// (RONG_MAC_DINH bên dưới) — KHÔNG PHẢI 1 trạng thái nghiệp vụ thật.
//
// Bổ sung 22/09/2026, theo yêu cầu người dùng — trước đây route quét QR (routes/qr.js) so khớp CHÍNH
// XÁC requireStatus === 'Chưa lấy phôi', nên đơn có TRANG_THAI_PHOI === '' (đơn cũ từ trước ngày
// chuyển cột này sang SQLite 18/09/2026, hoặc đơn có dòng SQLite vì lý do khác nhưng chưa từng đụng
// TRANG_THAI_PHOI) bị từ chối OAN dù bản chất nghiệp vụ đúng là "chưa lấy phôi". Sửa TẬN GỐC ở tầng đọc
// (layTheoKey/layTatCa dưới đây) thay vì vá riêng từng route đang so khớp requireStatus — mọi nơi đọc
// qua 2 hàm này (và getAll() dùng RONG_MAC_DINH khi đơn chưa từng có dòng nào) đều thấy đúng giá trị
// nghiệp vụ, không cần sửa lại nếu sau này có route/kịch bản mới cũng đọc 2 cột này.
// orderService.js#tinhPhoiVeFileTuDongKhiInMa() vẫn giữ nguyên, không bị thay thế — hàm đó GHI tường
// minh 2 giá trị này vào SQLite đúng lúc đơn chuyển "Đã in mã" (bổ trợ, không trùng lặp): lớp ở ĐÂY chỉ
// xử lý tầng ĐỌC, không ghi gì, nên không giúp được cho ai đọc thẳng SQLite mà không qua 2 hàm dưới đây.
const MAC_DINH_THAT_THEO_COT = { TRANG_THAI_PHOI: 'Chưa lấy phôi', TRANG_THAI_VE_FILE: 'Chưa vẽ file' };
function apDungMacDinhThat(row) {
  for (const cot in MAC_DINH_THAT_THEO_COT) {
    if (row[cot] === '') row[cot] = MAC_DINH_THAT_THEO_COT[cot];
  }
  return row;
}

// Object rỗng mặc định cho STT_Key chưa từng có dòng nào trong DB (đơn mới) — TRẢ VỀ DẠNG GIỐNG HỆT 1
// dòng SQLite thật (mọi cột = '', trừ TRANG_THAI_PHOI/TRANG_THAI_VE_FILE ở trên) để nơi gọi
// (orderService.js#getAll) gộp vào row Sheets mà không cần phân biệt "có/chưa có trong DB" — đúng hành
// vi hiện tại của Sheets (ô trống = '', không phải undefined) cho MỌI cột trừ 2 cột nghiệp vụ ở trên.
const RONG_MAC_DINH = Object.freeze({ ...Object.fromEntries(CAC_COT.map(c => [c, ''])), ...MAC_DINH_THAT_THEO_COT });

function chuanHoaKey(sttKey) {
  return String(sttKey).trim();
}

// CHỈ SELECT đúng CAC_COT (không SELECT *) — tránh lẫn cột khoá kỹ thuật `stt_key` (chữ thường) vào
// object trả về, nơi gọi (orderService.js) gộp thẳng object này vào row Sheets nên không được lẫn field lạ.
const DS_COT_SELECT = CAC_COT.join(', ');

const cauLayTheoKey = db.prepare(`SELECT ${DS_COT_SELECT} FROM trang_thai_don WHERE stt_key = ?`);
function layTheoKey(sttKey) {
  const row = cauLayTheoKey.get(chuanHoaKey(sttKey));
  return apDungMacDinhThat(row ? { ...RONG_MAC_DINH, ...row } : { ...RONG_MAC_DINH });
}

// Toàn bộ dòng trong DB, kèm stt_key riêng để làm khoá Map — dùng cho orderService.js#getAll() gộp vào
// TOÀN BỘ Don_Hang_ALL đọc từ Sheets. Đọc cả bảng mỗi lần gọi (không lọc theo danh sách key) — SQLite
// đọc vài trăm nghìn dòng ngắn vẫn ở mức mili-giây, không đáng lo ở quy mô đơn hàng của 1 xưởng.
const cauLayTatCa = db.prepare(`SELECT stt_key, ${DS_COT_SELECT} FROM trang_thai_don`);
function layTatCa() {
  const ketQua = new Map();
  for (const { stt_key, ...conLai } of cauLayTatCa.iterate()) ketQua.set(stt_key, apDungMacDinhThat(conLai));
  return ketQua;
}

// Cache prepared statement theo TỔ HỢP CỘT (bổ sung 22/09/2026, theo yêu cầu người dùng cải thiện hiệu
// năng) — ghiDe() là hàm ghi TRUNG TÂM cho MỌI cập nhật trạng thái đơn (mỗi lượt quét QR, mỗi đơn trong
// vòng lặp hàng loạt, job cảnh báo...), nhưng câu SQL phụ thuộc DANH SÁCH CỘT trong `updates` nên trước
// đây phải biên dịch lại (db.prepare()) MỖI LẦN gọi. Số TỔ HỢP CỘT thực tế mà app dùng là CỐ ĐỊNH/nhỏ
// (mỗi nơi gọi luôn truyền đúng 1 bộ cột quen thuộc) nên cache theo tổ hợp không phình bộ nhớ.
// QUAN TRỌNG: `cot` PHẢI được SẮP XẾP trước khi dùng làm khoá cache VÀ trước khi build câu SQL/tham số
// — nếu không, 2 lệnh gọi truyền CÙNG 1 bộ cột nhưng KHÁC thứ tự (thứ tự khoá trong object `updates`
// không đảm bảo cố định) sẽ tra trúng CHUNG 1 prepared statement đã biên dịch theo thứ tự của lệnh gọi
// ĐẦU TIÊN, trong khi tham số truyền vào lại theo thứ tự MỚI — ghi nhầm giá trị sang cột khác.
const _cachePreparedGhiDe = new Map(); // "cot1,cot2,..." (đã sort) -> Statement đã prepare sẵn
function layPreparedGhiDe(cotDaSort) {
  const khoa = cotDaSort.join(',');
  let stmt = _cachePreparedGhiDe.get(khoa);
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO trang_thai_don (stt_key, ${cotDaSort.join(', ')})
      VALUES (?, ${cotDaSort.map(() => '?').join(', ')})
      ON CONFLICT(stt_key) DO UPDATE SET ${cotDaSort.map(c => `${c} = excluded.${c}`).join(', ')}
    `);
    _cachePreparedGhiDe.set(khoa, stmt);
  }
  return stmt;
}

// Ghi đè MỘT PHẦN (chỉ các cột thực sự có trong `updates`, đúng ngữ nghĩa updateCells cũ) — UPSERT
// theo stt_key, không quan tâm dòng đã tồn tại trong DB hay chưa (đơn mới tự động INSERT).
function ghiDe(sttKey, updates) {
  const key = chuanHoaKey(sttKey);
  // .sort() — xem lý do bắt buộc ở comment layPreparedGhiDe() trên.
  const cot = Object.keys(updates).filter(c => CAC_COT.includes(c)).sort();
  if (cot.length === 0) return; // updates chỉ đụng cột KHÔNG thuộc bảng này (vd cột RAW) — không có gì để ghi ở đây

  const giaTri = cot.map(c => (updates[c] === undefined || updates[c] === null) ? '' : String(updates[c]));
  layPreparedGhiDe(cot).run(key, ...giaTri);
}

// Đếm/đổi tên hàng loạt theo XUONG (bổ sung 24/09/2026, theo yêu cầu người dùng — CRUD Xưởng qua
// Settings, xem services/caiDatDbService.js#layDanhSachXuong/routes/orders.js). demTheoXuong() dùng để
// CHẶN xoá 1 Xưởng còn đơn đang gán (an toàn hơn xoá liều); doiTenXuongHangLoat() cascade đổi tên để
// đơn không bị "mất kết nối" với Xưởng sau khi đổi tên (đã xác nhận với người dùng).
function demTheoXuong(xuong) {
  return db.prepare(`SELECT COUNT(*) AS c FROM trang_thai_don WHERE XUONG = ?`).get(xuong).c;
}
function doiTenXuongHangLoat(tenCu, tenMoi) {
  db.prepare(`UPDATE trang_thai_don SET XUONG = ? WHERE XUONG = ?`).run(tenMoi, tenCu);
}

module.exports = { CAC_COT, RONG_MAC_DINH, layTheoKey, layTatCa, ghiDe, demTheoXuong, doiTenXuongHangLoat };
