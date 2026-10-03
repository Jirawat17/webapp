const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');
const db = require('./thuVienDbService');
const storageService = require('../storageService');
const { taiAnh, nhanDangKieuAnh } = require('../anhNguonService');
const { layFolderIdTuLinkDrive, layFileIdTuLinkDrive, layChiTietAnhThuMucDrive, layThongTinFileDrive, taiFileDriveTheoId } = require('../driveService');
const { laLinkChiaSeGemini } = require('../trangWebService');

// ============================================================
// Bộ xử lý thư viện "Tìm ảnh" (03/10/2026) — spec docs/superpowers/specs/2026-10-03-thu-vien-tim-anh-design.md mục 8.
// 1 việc tại 1 thời điểm (PNG thiết kế có thể rất lớn). Mọi nguồn (Excel, sau này cron DUONG_DAN_URL và upload tay) đều
// lưu qua luuMotFile(). Chống nghẽn (rà soát 03/10/2026, spec mục 21d): xử lý ảnh (sharp) ở TIẾN TRÌNH CON, bộ canh
// hàng chờ kẹt, tự tạm dừng khi lỗi hệ thống liên tiếp.
// ============================================================
const PREFIX = 'thu-vien/';
const KICH_THUOC_TOI_DA = 30 * 1024 * 1024;
// Lần lỗi thứ n (1..5) -> hẹn thử lại sau LICH[n-1] phút; lỗi lần thứ 6 (= đã thử lại đủ 5 lần) -> LOI_CUOI.
const LICH_THU_LAI_PHUT = [5, 20, 60, 180, 480];
const SO_LAN_THU_TOI_DA = LICH_THU_LAI_PHUT.length + 1;
const DUOI_THEO_KIEU = { 'image/png': '.png', 'image/jpeg': '.jpg' };
const DIEM_DO_SO_FILE = 200; // điểm dừng đo dung lượng — chỉ 1 lần duy nhất (spec mục 8)
// Không bước nào hợp lệ chạy quá vài phút (tải: Drive 20s, link thường 60s, Gemini ~1-2 phút; ghi MinIO 20s; xử lý ảnh 60s)
// -> 10 phút không tiến triển = chắc chắn đang treo ở đâu đó (thư viện mạng/trình duyệt ảo không có timeout).
const NGUONG_KET_MS = Number(process.env.THU_VIEN_NGUONG_KET_MS) || 10 * 60000;
const THOI_GIAN_TOI_DA_XU_LY_ANH_MS = Number(process.env.THU_VIEN_XU_LY_ANH_MS) || 60000;
const THOI_GIAN_GIU_TIEN_TRINH_CON_MS = 2 * 60000; // rảnh quá 2 phút thì tắt tiến trình con cho nhẹ RAM, cần thì tạo lại
const SO_LOI_LIEN_TIEP_DE_DUNG = 5;
// Lỗi không phụ thuộc từng link (MinIO, mạng, tài khoản/quota Google) — gặp liên tiếp là cả hệ thống đang có sự cố.
const LA_LOI_HE_THONG = /MinIO|quota|rate ?limit|invalid_grant|credential|GOOGLE_SERVICE_ACCOUNT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i;

const laLink = s => /^https?:\/\//i.test(s) || String(s).startsWith('/api/photos/file/');
// Ô Excel/Sheet có thể chứa nhiều link cách nhau bởi khoảng trắng/xuống dòng (URL không chứa khoảng trắng).
// Dấu phẩy/chấm phẩy dính cuối link (dán kiểu "link1, link2") bị bỏ.
const tachLink = giaTri => String(giaTri || '').split(/\s+/).map(s => s.trim().replace(/[,;]+$/, '')).filter(Boolean);
// STT_Key -> đoạn key MinIO, ĐƠN ÁNH (2 mã khác nhau không bao giờ ra cùng key — bản cũ đổi mọi ký tự lạ thành '_' nên
// '9U121.2' và '9U121_2' trùng thư mục, file đơn sau ghi đè đơn trước). Giữ nguyên chữ/số/-_. ; ký tự khác mã hoá
// %XX rồi đổi '%' -> '~' ('~' gốc cũng bị mã hoá nên không lẫn). Mã thường gặp (10LH72, 9U121.2) giữ nguyên.
const lamSachKey = s => encodeURIComponent(String(s))
  .replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%/g, '~');
const uuTienCuaLink = url => (laLinkChiaSeGemini(url) ? 1 : 0);

// Lọc theo thông tin Drive TRƯỚC khi tải (không tải 400MB chỉ để biết là PSD). -> lý do bỏ qua, hoặc '' nếu được tải.
// 'application/octet-stream' (Drive không đoán được loại) vẫn cho tải — magic bytes trong luuMotFile quyết định.
function lyDoBoQuaTheoDrive({ mimeType, kichThuoc }) {
  if (mimeType && mimeType !== 'application/octet-stream' && !DUOI_THEO_KIEU[mimeType]) return `không phải PNG/JPEG (${mimeType})`;
  if (kichThuoc && kichThuoc > KICH_THUOC_TOI_DA) return `quá 30MB (${(kichThuoc / 1048576).toFixed(1)}MB)`;
  return '';
}

// ---------- tiến trình con xử lý ảnh (xuLyAnhWorker.js) ----------
// Quá THOI_GIAN_TOI_DA_XU_LY_ANH_MS -> SIGKILL tiến trình con (sharp treo native không giữ lại luồng nào của server chính),
// mọi yêu cầu đang chờ trong tiến trình đó bị từ chối (-> file LOI_HASH, có nút Tính lại); lần sau tự tạo tiến trình mới.
let tienTrinhCon = null;
let henTatTienTrinhCon = null;
let soYeuCauAnh = 0;
const choKetQuaAnh = new Map(); // id -> { con, xong, loi }

function layTienTrinhCon() {
  if (tienTrinhCon && tienTrinhCon.connected) return tienTrinhCon;
  const con = fork(path.join(__dirname, 'xuLyAnhWorker.js'), [], { serialization: 'advanced' });
  con.on('message', m => {
    const cho = choKetQuaAnh.get(m.id);
    if (cho) { choKetQuaAnh.delete(m.id); cho.xong(m); }
  });
  con.on('exit', (ma, tinHieu) => {
    if (tienTrinhCon === con) tienTrinhCon = null;
    for (const [id, cho] of choKetQuaAnh) {
      if (cho.con === con) { choKetQuaAnh.delete(id); cho.loi(new Error(`tiến trình xử lý ảnh đã dừng (${tinHieu || ma})`)); }
    }
  });
  con.on('error', err => console.error('[ThuVien] Tiến trình xử lý ảnh lỗi:', err.message));
  tienTrinhCon = con;
  return con;
}

// Bỏ tham chiếu TRƯỚC khi kill: từ lúc kill tới lúc 'exit' tới, con.connected vẫn có thể là true -> yêu cầu kế tiếp gửi vào
// tiến trình đang chết và hỏng oan (file thành LOI_HASH, bị đếm vào lỗi liên tiếp).
function dungTienTrinhCon(con, tinHieu) {
  if (tienTrinhCon === con) tienTrinhCon = null;
  con.kill(tinHieu);
}

function xuLyAnhOTienTrinhCon(buffer, { khongThumb = false } = {}) {
  clearTimeout(henTatTienTrinhCon);
  return new Promise((resolve, reject) => {
    const con = layTienTrinhCon();
    const id = ++soYeuCauAnh;
    const hen = setTimeout(() => {
      console.error(`[ThuVien] Xử lý ảnh quá ${THOI_GIAN_TOI_DA_XU_LY_ANH_MS / 1000}s — dừng hẳn tiến trình con, tạo lại ở lần sau.`);
      dungTienTrinhCon(con, 'SIGKILL');
    }, THOI_GIAN_TOI_DA_XU_LY_ANH_MS);
    const ketThuc = () => {
      clearTimeout(hen);
      if (!choKetQuaAnh.size) {
        henTatTienTrinhCon = setTimeout(() => { if (tienTrinhCon && !choKetQuaAnh.size) dungTienTrinhCon(tienTrinhCon); }, THOI_GIAN_GIU_TIEN_TRINH_CON_MS);
        henTatTienTrinhCon.unref();
      }
    };
    choKetQuaAnh.set(id, {
      con,
      xong: m => { ketThuc(); if (m.loi) reject(new Error(m.loi)); else resolve(m); },
      loi: err => { ketThuc(); reject(err); },
    });
    try {
      con.send({ id, buffer, khongThumb });
    } catch (err) { // tiến trình con không tạo được / vừa chết — không để yêu cầu nằm chờ mãi
      choKetQuaAnh.delete(id);
      ketThuc();
      reject(err);
    }
  });
}

// ---------- tự tạm dừng khi lỗi hệ thống liên tiếp ----------
const loiLienTiep = { HE_THONG: 0, XU_LY_ANH: 0 };
function ghiNhanLoiLienTiep(loai, coLoi, moTa) {
  if (!coLoi) { loiLienTiep[loai] = 0; return; }
  if (++loiLienTiep[loai] < SO_LOI_LIEN_TIEP_DE_DUNG) return;
  loiLienTiep[loai] = 0;
  db.datCaiDat('hang_cho_tam_dung', '1');
  db.datCaiDat('ly_do_tam_dung', moTa);
  console.error('[ThuVien] TỰ TẠM DỪNG hàng chờ —', moTa);
}

// Hash + thumbnail cho 1 file PNG ĐÃ nằm trên MinIO. Thiếu bất kỳ phần nào -> LOI_HASH (file vẫn tải được, có nút Tính lại).
async function tinhChiMuc(fileId, buffer, sha256, { demLoiLienTiep = false } = {}) {
  let kq = {};
  try { kq = await xuLyAnhOTienTrinhCon(buffer); } catch (err) { console.error('[ThuVien] Không xử lý được ảnh file', fileId, '-', err.message); }
  const dhash = kq.dhash || '';
  const dhashHinhDang = kq.dhashHinhDang || '';
  let thumbKey = db.thumbCuaSha(sha256);
  if (!thumbKey && kq.thumb) {
    try {
      const key = `${PREFIX}_thumb/${sha256}.webp`;
      await storageService.uploadImageBuffer(Buffer.from(kq.thumb.buffer, kq.thumb.byteOffset, kq.thumb.byteLength), key, 'image/webp');
      thumbKey = key;
    } catch (err) {
      console.error('[ThuVien] Không ghi được thumbnail file', fileId, '-', err.message);
    }
  }
  const trangThai = dhash && dhashHinhDang && thumbKey ? 'XONG' : 'LOI_HASH';
  db.capNhatFile(fileId, { dhash, dhash_hinh_dang: dhashHinhDang, thumb_key: thumbKey, trang_thai: trangThai });
  if (demLoiLienTiep) {
    ghiNhanLoiLienTiep('XU_LY_ANH', trangThai === 'LOI_HASH',
      `${SO_LOI_LIEN_TIEP_DE_DUNG} file liên tiếp không tính được hash/thumbnail — xem Logs (dòng [ThuVien]); file vẫn đã lưu, sửa xong bấm Chạy tiếp rồi "Tính lại" ở mục Cần xử lý.`);
  }
  return trangThai;
}

// Lưu 1 file PNG vào thư viện. -> { ketQua: 'DA_LUU' | 'TRUNG' | 'BO_QUA', lyDo?, id? }
// Lỗi tạm thời (MinIO không ghi được) -> THROW để việc được thử lại; lỗi vĩnh viễn (sai định dạng, quá lớn) -> BO_QUA.
// demLoiLienTiep: CHỈ hàng chờ (xuLyViec) bật — file người dùng tự tải lên lỗi hash không được làm tự tạm dừng hàng chờ, và tải
// lên thành công cũng không được xoá bộ đếm lỗi của hàng chờ.
async function luuMotFile({ buffer, sttKey, nguon, tenFileGoc = '', urlGoc = '', driveFileId = '', nguoiTaiLen = '', demLoiLienTiep = false }) {
  const batDau = Date.now();
  if (!buffer || !buffer.length) return { ketQua: 'BO_QUA', lyDo: 'File rỗng' };
  if (buffer.length > KICH_THUOC_TOI_DA) return { ketQua: 'BO_QUA', lyDo: `Quá 30MB (${(buffer.length / 1048576).toFixed(1)}MB)` };
  const contentType = nhanDangKieuAnh(buffer);
  if (!contentType) return { ketQua: 'BO_QUA', lyDo: 'Không phải ảnh PNG/JPEG' };

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const daCo = db.timFileTheoSha(sttKey, 'PNG', sha256);
  if (daCo) return { ketQua: 'TRUNG', lyDo: `Trùng file đã có (${daCo.object_key.split('/').pop()})`, id: daCo.id };

  const k = lamSachKey(sttKey);
  const { id, objectKey } = giuChoHoacTrung(
    { loai: 'PNG', sttKey, tenFileGoc, nguon, urlGoc, driveFileId, sha256, kichThuoc: buffer.length, nguoiTaiLen },
    n => `${PREFIX}${k}/${k}_${n}${DUOI_THEO_KIEU[contentType]}`
  );
  if (!id) return { ketQua: 'TRUNG', lyDo: 'Trùng file vừa được lưu (cùng lúc từ nơi khác)' };
  try {
    await storageService.uploadImageBuffer(buffer, objectKey, contentType);
  } catch (err) {
    db.xoaFileDangLuu(id);
    throw new Error('Không ghi được lên MinIO: ' + err.message);
  }
  // Đã có trên MinIO — từ đây là file thật (không còn DANG_LUU). DANG_TINH = đang tính hash/thumbnail: KHÔNG dùng LOI_HASH làm trạng
  // thái tạm như bản đầu (thống kê/Cần xử lý đếm nhầm file đang xử lý dở là lỗi — gặp khi thử 03/10/2026).
  db.capNhatFile(id, { trang_thai: 'DANG_TINH' });
  await tinhChiMuc(id, buffer, sha256, { demLoiLienTiep });
  db.capNhatFile(id, { ms_xu_ly: Date.now() - batDau });
  baoHoatDong();
  kiemTraDiemDo();
  return { ketQua: 'DA_LUU', id };
}

// Giữ chỗ số thứ tự; 2 nơi cùng lưu đúng 1 file cho 1 đơn cùng lúc (upload tay + hàng chờ) -> ràng buộc UNIQUE(stt_key,
// loai, sha256) chặn bản thứ 2 -> coi là trùng (trả {}), không phải lỗi để thử lại.
function giuChoHoacTrung(thongTin, taoObjectKey) {
  try {
    return db.giuChoFile(thongTin, taoObjectKey);
  } catch (err) {
    if (String(err.code).startsWith('SQLITE_CONSTRAINT') && db.timFileTheoSha(thongTin.sttKey, thongTin.loai, thongTin.sha256)) return {};
    throw err;
  }
}

// Lưu 1 file EMB (giai đoạn 2, spec mục 13). Mỗi phiên bản 1 object RIÊNG, không bao giờ ghi đè: thu-vien/<k>/<k>_v<n>.emb;
// bản mới nhất là bản chính (la_ban_chinh = 1), các bản trước giữ làm lịch sử. Tải về luôn đặt tên <STT_Key>.emb.
// (Bản thiết kế đầu: bản chính ở <k>.emb + chép bản cũ sang _v<n> — đổi sang key bất biến cho đơn giản và không cần key tạm.)
async function luuEmb({ buffer, sttKey, tenFileGoc = '', nguoiTaiLen = '' }) {
  if (!buffer || !buffer.length) return { ketQua: 'BO_QUA', lyDo: 'File rỗng' };
  if (buffer.length > KICH_THUOC_TOI_DA) return { ketQua: 'BO_QUA', lyDo: `Quá 30MB (${(buffer.length / 1048576).toFixed(1)}MB)` };
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const daCo = db.timFileTheoSha(sttKey, 'EMB', sha256);
  if (daCo) return { ketQua: 'TRUNG', lyDo: `Trùng EMB đã có (phiên bản ${daCo.so_thu_tu})`, id: daCo.id };
  const k = lamSachKey(sttKey);
  const { id, objectKey } = giuChoHoacTrung(
    { loai: 'EMB', sttKey, tenFileGoc, nguon: 'UPLOAD', sha256, kichThuoc: buffer.length, nguoiTaiLen },
    n => `${PREFIX}${k}/${k}_v${n}.emb`
  );
  if (!id) return { ketQua: 'TRUNG', lyDo: 'Trùng EMB vừa được lưu (cùng lúc từ nơi khác)' };
  try {
    await storageService.uploadImageBuffer(buffer, objectKey, 'application/octet-stream');
  } catch (err) {
    db.xoaFileDangLuu(id);
    throw new Error('Không ghi được lên MinIO: ' + err.message);
  }
  db.datBanChinhEmb(sttKey, id);
  return { ketQua: 'DA_LUU', id };
}

// Hash của 1 ảnh tải lên để TÌM (không lưu) — chạy ở tiến trình con như lúc lưu. -> { sha256, dhash, dhashHinhDang }
async function tinhHashAnhTam(buffer) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const kq = await xuLyAnhOTienTrinhCon(buffer, { khongThumb: true });
  return { sha256, dhash: kq.dhash || '', dhashHinhDang: kq.dhashHinhDang || '' };
}

// Đếm PNG do hàng chờ tải (không tính EMB / file tải tay) — điểm dừng để đo dung lượng của chính những ảnh hàng chờ sẽ tải tiếp.
function kiemTraDiemDo() {
  if (db.layCaiDat('da_qua_diem_do') === '1') return;
  if (db.thongKePngHangCho().soFile < DIEM_DO_SO_FILE) return;
  db.datCaiDat('da_qua_diem_do', '1');
  db.datCaiDat('hang_cho_tam_dung', '1');
  db.datCaiDat('dung_tai_diem_do', '1'); // giao diện chỉ hiện thông báo "điểm dừng đo" khi dừng VÌ lý do này (bấm tay thì không)
  console.log(`[ThuVien] Hàng chờ đã lưu ${DIEM_DO_SO_FILE} PNG đầu tiên — tạm dừng để đo dung lượng (superadmin bấm Chạy tiếp ở menu Tìm ảnh).`);
}

// Tính lại hash/thumbnail cho file LOI_HASH (đọc lại từ MinIO).
async function tinhLaiFile(fileId) {
  const f = db.layFile(fileId);
  if (!f || f.trang_thai !== 'LOI_HASH') return null;
  const buffer = await storageService.getObjectBuffer(f.object_key);
  return tinhChiMuc(f.id, buffer, f.sha256);
}

// Ghi việc lỗi theo lịch thử lại (dùng chung: lỗi tải, lỗi bất thường, bộ canh phát hiện treo).
function danhDauLoi(viec, loi, them = {}) {
  const soLanThu = viec.so_lan_thu + 1;
  const cuoi = soLanThu >= SO_LAN_THU_TOI_DA;
  console.error(`[ThuVien] Lỗi tải ${viec.stt_key} (lần ${soLanThu}/${SO_LAN_THU_TOI_DA}${cuoi ? ', dừng thử lại' : ''}): ${viec.url} — ${loi}`);
  db.capNhatViec(viec.id, {
    ...them, trang_thai: cuoi ? 'LOI_CUOI' : 'LOI', so_lan_thu: soLanThu, loi_cuoi: loi,
    thu_lai_luc: cuoi ? 0 : Date.now() + LICH_THU_LAI_PHUT[soLanThu - 1] * 60000,
  });
}

// ---------- xử lý 1 việc (1 link) ----------
// conHieuLuc(): false khi bộ canh đã coi lượt chạy này là treo và bỏ qua — lượt treo nếu sau này chạy tiếp thì KHÔNG được
// ghi đè trạng thái việc (lượt mới đã xử lý). File đã lưu thì vẫn giữ (là file thật, chống trùng theo sha256).
async function xuLyViec(viec, conHieuLuc = () => true) {
  db.capNhatViec(viec.id, { trang_thai: 'DANG_CHAY' });
  let soLuu = 0;
  const boQua = [];   // vĩnh viễn — ghi chú, không thử lại
  const loiTam = [];  // tạm thời — thử lại cả việc (file đã lưu sẽ được nhận ra là trùng, không lưu lại)
  const chung = { sttKey: viec.stt_key, nguon: viec.nguon, urlGoc: viec.url, nguoiTaiLen: viec.nguoi, demLoiLienTiep: true };
  const ghiNhan = (ten, kq) => {
    if (kq.ketQua === 'DA_LUU') soLuu++;
    else if (kq.ketQua === 'BO_QUA') boQua.push(`${ten}: ${kq.lyDo}`);
  };

  let dungGiuaChung = false; // tạm dừng (bấm tay / điểm dừng đo / tự dừng) giữa 1 thư mục lớn -> việc về CHO
  try {
    if (layFolderIdTuLinkDrive(viec.url)) {
      const dsFile = await layChiTietAnhThuMucDrive(viec.url); // lỗi liệt kê -> throw (khác thư mục rỗng)
      if (!dsFile.length) boQua.push('Thư mục Drive không có ảnh nào');
      for (const f of dsFile) {
        if (!conHieuLuc()) return;
        if (dangTamDung()) { dungGiuaChung = true; break; }
        baoHoatDong();
        const lyDo = lyDoBoQuaTheoDrive(f);
        if (lyDo) { boQua.push(`${f.ten}: ${lyDo}`); continue; }
        if (db.daCoDriveFile(viec.stt_key, f.id)) continue;
        const buffer = await taiFileDriveTheoId(f.id);
        if (!buffer) { loiTam.push(`${f.ten}: không tải được từ Drive`); continue; }
        try { ghiNhan(f.ten, await luuMotFile({ ...chung, buffer, tenFileGoc: f.ten, driveFileId: f.id })); } catch (err) { loiTam.push(`${f.ten}: ${err.message}`); }
      }
    } else {
      // Cùng thứ tự nhận diện như anhNguonService.js#taiAnh: link MinIO trước, rồi mới tới link file Drive.
      const driveFileId = !storageService.proxyUrlToObjectKey(viec.url) && layFileIdTuLinkDrive(viec.url);
      if (driveFileId) {
        if (!db.daCoDriveFile(viec.stt_key, driveFileId)) {
          const tt = await layThongTinFileDrive(driveFileId); // không có quyền / không tồn tại -> throw, lý do của Google vào loiTam
          const lyDo = lyDoBoQuaTheoDrive(tt);
          if (lyDo) boQua.push(`${tt.ten}: ${lyDo}`);
          else {
            const buffer = await taiFileDriveTheoId(driveFileId);
            if (!buffer) loiTam.push(`${tt.ten}: không tải được từ Drive (xem Logs)`);
            else ghiNhan(tt.ten, await luuMotFile({ ...chung, buffer, tenFileGoc: tt.ten, driveFileId }));
          }
        }
      } else {
        const buffer = await taiAnh(viec.url);
        const doanCuoi = viec.url.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
        let ten = doanCuoi;
        try { ten = decodeURIComponent(doanCuoi); } catch (e) { /* %xx sai định dạng — giữ nguyên, không được làm hỏng cả việc */ }
        ten = ten.slice(0, 200);
        if (!buffer) loiTam.push('Không tải được ảnh từ link (link chết, chưa chia sẻ quyền, quá 50MB, quá 60 giây, hoặc lỗi mạng — xem Logs)');
        else ghiNhan(ten, await luuMotFile({ ...chung, buffer, tenFileGoc: ten }));
      }
    }
  } catch (err) {
    loiTam.push(err.message);
  }
  if (!conHieuLuc()) return;

  const soFile = viec.so_file + soLuu;
  const ghiChu = boQua.join('; ').slice(0, 2000);
  if (dungGiuaChung && !loiTam.length) {
    db.capNhatViec(viec.id, { trang_thai: 'CHO', so_file: soFile, ghi_chu: ghiChu });
    return;
  }
  if (!loiTam.length) {
    db.capNhatViec(viec.id, { trang_thai: 'XONG', so_file: soFile, ghi_chu: ghiChu, loi_cuoi: '' });
    ghiNhanLoiLienTiep('HE_THONG', false);
    return;
  }
  const loi = loiTam.join('; ').slice(0, 2000);
  danhDauLoi(viec, loi, { so_file: soFile, ghi_chu: ghiChu });
  // Lỗi riêng của từng link (link chết, chưa chia sẻ) KHÔNG tính; chỉ lỗi hệ thống mới dồn tới tự tạm dừng.
  if (loiTam.some(m => LA_LOI_HE_THONG.test(m))) {
    ghiNhanLoiLienTiep('HE_THONG', true,
      `${SO_LOI_LIEN_TIEP_DE_DUNG} link liên tiếp gặp lỗi hệ thống (vd: ${loi.slice(0, 200)}) — kiểm tra MinIO / mạng / tài khoản Google rồi bấm Chạy tiếp.`);
  }
}

// ---------- vòng chạy nền + bộ canh treo ----------
let dangChay = false;
let luotHienTai = 0;      // tăng mỗi lượt chạy; bộ canh tăng thêm để "bỏ rơi" lượt đang treo
let hoatDongLuc = 0;
let viecDangChay = null;
const dangTamDung = () => db.layCaiDat('hang_cho_tam_dung') === '1';
function baoHoatDong() { hoatDongLuc = Date.now(); }

async function chayMotLuot() {
  if (dangChay) return;
  dangChay = true;
  const luot = ++luotHienTai;
  const conHieuLuc = () => luot === luotHienTai;
  try {
    let viec;
    while (conHieuLuc() && !dangTamDung() && (viec = db.layViecKeTiep(Date.now()))) {
      viecDangChay = viec;
      baoHoatDong();
      try { await xuLyViec(viec, conHieuLuc); } catch (err) {
        // không được để 1 việc lỗi bất ngờ làm kẹt vòng lặp ở DANG_CHAY mãi
        console.error('[ThuVien] Lỗi không mong đợi khi xử lý việc', viec.id, '-', err.message);
        if (conHieuLuc()) danhDauLoi(viec, err.message); // cùng giới hạn như lỗi thường — không thử lại vô hạn
      }
    }
  } finally {
    if (conHieuLuc()) { dangChay = false; viecDangChay = null; }
  }
}

// Gọi định kỳ: lượt chạy không tiến triển quá NGUONG_KET_MS (await nào đó treo vĩnh viễn) -> ghi lỗi việc đang chạy (theo
// lịch thử lại), bỏ rơi lượt đó và cho lượt mới chạy tiếp các việc khác. -> true nếu vừa xử lý 1 vụ treo.
function kiemTraKet() {
  if (!dangChay || Date.now() - hoatDongLuc < NGUONG_KET_MS) return false;
  const viec = viecDangChay;
  console.error(`[ThuVien] Hàng chờ KẸT: không có tiến triển ${Math.round(NGUONG_KET_MS / 1000)}s ở việc ${viec ? `${viec.id} (${viec.stt_key})` : '?'} — bỏ qua việc này, chạy tiếp việc khác.`);
  luotHienTai++;
  dangChay = false;
  viecDangChay = null;
  if (viec) danhDauLoi(viec, `Treo quá ${Math.round(NGUONG_KET_MS / 60000)} phút không có tiến triển (khi tải/xử lý) — tự bỏ qua, sẽ thử lại`);
  return true;
}

function batDauVongXuLy() {
  db.donDepKhiKhoiDong();
  setInterval(() => {
    kiemTraKet();
    chayMotLuot().catch(err => console.error('[ThuVien] Vòng xử lý lỗi:', err.message));
  }, 5000);
}

function datTamDung(tamDung) {
  db.datCaiDat('hang_cho_tam_dung', tamDung ? '1' : '0');
  db.datCaiDat('dung_tai_diem_do', '0'); // superadmin đã thao tác tay sau điểm dừng đo -> không còn hiện thông báo đó
  db.datCaiDat('ly_do_tam_dung', '');
  loiLienTiep.HE_THONG = 0;
  loiLienTiep.XU_LY_ANH = 0;
}

module.exports = {
  laLink, tachLink, uuTienCuaLink, lamSachKey, luuMotFile, luuEmb, tinhHashAnhTam, tinhLaiFile, DUOI_THEO_KIEU, xuLyViec, chayMotLuot, kiemTraKet, batDauVongXuLy,
  datTamDung, dangTamDung, KICH_THUOC_TOI_DA,
};
