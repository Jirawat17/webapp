const express = require('express');
const multer = require('multer');
const db = require('../services/thuVien/thuVienDbService');
const xuLy = require('../services/thuVien/xuLyService');
const { nhapExcel, guiFileKetQua } = require('../services/thuVien/nhapExcelService');
const { timTuongTu } = require('../services/thuVien/timKiemService');
const { taoTapMa, themMa, chuanHoaMa, khopSttKey } = require('../services/thuVien/khopTenFile');
const { nhanDangKieuAnh } = require('../services/anhNguonService');
const dongBoSheet = require('../services/thuVien/dongBoSheetService');
const nguongService = require('../services/thuVien/nguongService');
const { thongKeThuVien } = require('../services/thuVien/thongKeService');
const storageService = require('../services/storageService');
const orderService = require('../services/orderService');
const trangThaiDbService = require('../services/trangThaiDbService');
const taiKhoanService = require('../services/taiKhoanService');
const { ghiLog } = require('../services/logService');
const { requireLogin, requireRole, requireExactRole, laAdmin, laSuperAdmin } = require('../middleware/auth');

// Menu "Tìm ảnh" — thư viện thiết kế thêu (03/10/2026). Spec: docs/superpowers/specs/2026-10-03-thu-vien-tim-anh-design.md.
// Giai đoạn 1: hàng chờ + nhập Excel (superadmin), Cần xử lý (admin+), xem file/thumbnail.
// Giai đoạn 2: tra theo mã đơn, tìm theo ảnh, tải lên thư viện (PNG + EMB), EMB trong chi tiết đơn, ghi quyết định.
// Giai đoạn 3: bật/tắt + quét ngay DUONG_DAN_URL (superadmin). Giai đoạn 4: cặp ảnh đánh giá, gợi ý/lưu ngưỡng nhóm kết quả.
// Giai đoạn 5: thống kê thư viện (admin+, admin chỉ Xưởng mình).
const router = express.Router();
router.use(requireLogin);

// 3MB (03/10/2026, đo thật): exceljs đọc CẢ file vào RAM — xuất nguyên Don_Hang_ALL 50.000 dòng x 40 cột = 12,5MB làm RSS
// lên 1.136MB; chỉ 2 cột STT_Key + DUONG_DAN_URL thì 150.000 dòng = 2,4MB, RSS 363MB. Bản streaming của exceljs 4.4 lỗi
// với chính file nó tạo nên không dùng. 3MB ~ 180.000 dòng 2 cột.
const KICH_THUOC_EXCEL_TOI_DA = 3 * 1024 * 1024;
const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: KICH_THUOC_EXCEL_TOI_DA, files: 1 } });
const uploadFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: xuLy.KICH_THUOC_TOI_DA, files: 1 } });
const VAI_TRO_MENU = ['ve_file']; // + admin/superadmin (requireRole tự cho qua)
const laVaiTroMenu = user => laAdmin(user.vaiTro) || VAI_TRO_MENU.includes(user.vaiTro);
const loi = (res, thongDiep, ma = 400) => res.status(ma).json({ error: thongDiep });
const tenGoc = f => Buffer.from(f.originalname, 'latin1').toString('utf8'); // multer đọc tên theo latin1
const LOAI_THEO_DUOI = { png: 'PNG', jpg: 'PNG', jpeg: 'PNG', emb: 'EMB' };
const loaiTheoTen = ten => LOAI_THEO_DUOI[((String(ten).match(/\.([^.\/\\]+)$/) || [])[1] || '').toLowerCase()] || '';
// STT_Key gõ tay: chữ/số đầu, sau đó chữ/số . _ - (đủ cho mọi mã thật, chặn ký tự lạ/đường dẫn)
const MA_GO_TAY_HOP_LE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,49}$/u;
const QUYET_DINH_HOP_LE = ['DA_KIEM', 'TAI_SU_DUNG', 'VE_MOI'];

// Phạm vi đơn (spec mục 15): superadmin + ve_file thấy mọi đơn; vai trò khác theo Xưởng được phân công.
// Lấy MỌI mã của (các) Xưởng được phân công bằng 1 truy vấn (lần đầu cần tới) rồi tra trong Set — cùng điều kiện với
// orderService.phamViDon nhưng phamViDon tra SQLite TỪNG mã (~16µs/mã, đo 03/10/2026): tìm kiếm / chọn cặp ảnh của admin Xưởng
// nhỏ phải xét cả thư viện (~60.000 mã) ≈ 1 giây chặn cả server.
const xemTatCa = user => laSuperAdmin(user.vaiTro) || user.vaiTro === 've_file';
function duocXemDon(user) {
  if (xemTatCa(user)) return () => true;
  let tap = null;
  return sttKey => {
    if (!tap) tap = new Set(trangThaiDbService.dsKeyTheoXuong(taiKhoanService.cacXuongCuaNguoiDung(user)));
    return tap.has(String(sttKey ?? '').trim());
  };
}

// Tập mã để khớp tên file = mã trong Sheet (Don_Hang_ALL, qua getAll có cache sẵn) ∪ mã đã có trong thư viện (spec mục 7).
// Giữ 30 giây (1 thư mục lớn gửi xem trước nhiều đợt). Không đọc được Sheet -> dùng tạm danh sách Sheet lần đọc được gần nhất
// (maSheetCu = true, maSheetLuc = lúc đọc được — các trang báo rõ "danh sách đơn đọc lúc ..."), chưa đọc được lần nào thì chỉ
// khớp với mã trong thư viện và báo rõ.
// Chờ Sheet tối đa 15 giây: Sheets treo thì tra mã / xem trước / tải lên / thống kê vẫn trả lời (trước đây treo theo).
const THOI_GIAN_CHO_SHEET_MS = 15000;
let tapMaCache = null, dangDungTapMa = null;
async function docMaSheet() {
  let henGio;
  try {
    const { rows } = await Promise.race([
      orderService.getAll(),
      new Promise((_, reject) => { henGio = setTimeout(() => reject(new Error(`quá ${THOI_GIAN_CHO_SHEET_MS / 1000} giây`)), THOI_GIAN_CHO_SHEET_MS); }),
    ]);
    return { maSheet: new Set(rows.map(r => String(r.STT_Key || '').trim()).filter(Boolean)), maSheetLuc: Date.now(), maSheetCu: false };
  } catch (err) {
    console.error('[ThuVien] Không đọc được danh sách đơn từ Sheet để khớp tên file:', err.message);
    if (tapMaCache && tapMaCache.maSheet) return { maSheet: tapMaCache.maSheet, maSheetLuc: tapMaCache.maSheetLuc, maSheetCu: true };
    return { maSheet: null, maSheetLuc: 0, maSheetCu: false };
  } finally {
    clearTimeout(henGio);
  }
}
function layTapMa() {
  if (tapMaCache && Date.now() - tapMaCache.luc < 30000) return Promise.resolve(tapMaCache);
  if (!dangDungTapMa) { // nhiều yêu cầu cùng lúc dùng chung 1 lượt đọc Sheet
    dangDungTapMa = docMaSheet().then(({ maSheet, maSheetLuc, maSheetCu }) => {
      const maThuVien = db.dsMaTrongThuVien();
      tapMaCache = { luc: Date.now(), maSheet, maSheetLuc, maSheetCu, maThuVien: new Set(maThuVien), tap: taoTapMa([...(maSheet || []), ...maThuVien]) };
      return tapMaCache;
    }).finally(() => { dangDungTapMa = null; });
  }
  return dangDungTapMa;
}
const gioVN = ms => new Date(ms).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
// Gửi kèm kết quả: lúc đọc danh sách Sheet đang dùng nếu là danh sách CŨ (Sheet lúc này không đọc được), không thì null.
const sheetCuLuc = tapMa => (tapMa.maSheetCu ? tapMa.maSheetLuc : null);

// Vừa lưu file cho 1 mã: thêm thẳng vào tập đang giữ — xoá cả tập như trước thì tải lên 1 thư mục lớn dựng lại toàn bộ
// danh sách đơn sau MỖI file.
function ghiNhanMaMoi(sttKey) {
  if (!tapMaCache || tapMaCache.maThuVien.has(sttKey)) return;
  tapMaCache.maThuVien.add(sttKey);
  themMa(tapMaCache.tap, sttKey);
}

// Mã người dùng gõ (tra theo mã, đơn mới đang vẽ, bảng xem trước, chi tiết đơn) -> mã có thật trong Sheet ∪ thư viện.
// Khác chữ hoa/thường (hoặc NFC/NFD) với ĐÚNG 1 mã có thật -> dùng mã có thật: gõ "10lh72" vẫn ra đơn 10LH72 (không báo nhầm
// "chưa có PNG/EMB"), tải lên không tạo thư mục thứ 2 cho 1 đơn. -> { ma, biet, nhieu? }
function timMaCoThat(nhap, tap) {
  const ma = String(nhap || '').trim().normalize('NFC');
  const ungVien = ma ? tap.get(chuanHoaMa(ma)) : null;
  if (!ungVien) return { ma, biet: false };
  if (ungVien.has(ma)) return { ma, biet: true };
  if (ungVien.size === 1) return { ma: [...ungVien][0], biet: true };
  return { ma, biet: false, nhieu: [...ungVien] };
}
// Danh sách mã đưa vào thông báo: CHỈ mã người dùng được xem (admin không dò được mã đơn của Xưởng khác qua thông báo lỗi).
const dsMaThay = (dsMa, xem) => dsMa.filter(xem).join(', ');
const loiNhieuMa = (ma, dsMa, xem) => {
  const thay = dsMaThay(dsMa, xem);
  return `Mã "${ma}" trùng chữ (khác hoa/thường) với nhiều đơn${thay ? `: ${thay}` : ''} — gõ đúng từng chữ hoa/thường.`;
};

// Mã gõ tay (bảng xem trước) / mã từ trang chi tiết đơn -> mã chuẩn để lưu. Mã chưa biết (không có trong Sheet lẫn thư viện) ->
// canXacNhan; thông điệp nói rõ khi lý do là không đọc được Sheet / đang dùng danh sách Sheet cũ.
// -> { sttKey, loi?, canXacNhan? }
function xacDinhMa(nhap, tapMa, daXacNhan, xem) {
  const t = timMaCoThat(nhap, tapMa.tap);
  if (!t.ma) return { loi: 'Thiếu mã đơn.' };
  if (t.nhieu) return { loi: loiNhieuMa(t.ma, t.nhieu, xem) };
  if (t.biet) return { sttKey: t.ma };
  if (!MA_GO_TAY_HOP_LE.test(t.ma)) return { loi: `Mã đơn "${t.ma}" không hợp lệ.` };
  if (daXacNhan) return { sttKey: t.ma };
  const { maSheet } = tapMa;
  return {
    sttKey: t.ma,
    canXacNhan: !maSheet ? `Không đọc được Sheet lúc này để kiểm tra mã "${t.ma}" (mã cũng chưa có trong thư viện)`
      : tapMa.maSheetCu ? `Mã "${t.ma}" không có trong danh sách đơn đọc từ Sheet lúc ${gioVN(tapMa.maSheetLuc)} (Sheet lúc này không đọc được) và chưa có trong thư viện`
      : `Mã "${t.ma}" không có trong Sheet và chưa có trong thư viện`,
  };
}

const tenLuu = f => f.object_key.split('/').pop();
function hienThiFile(f) {
  return {
    id: f.id, loai: f.loai, so_thu_tu: f.so_thu_tu, la_ban_chinh: !!f.la_ban_chinh, ten: f.ten_file_goc || tenLuu(f), tenLuu: tenLuu(f),
    nguon: f.nguon, url_goc: f.url_goc, ngay_luu: f.ngay_luu, nguoi_tai_len: f.nguoi_tai_len, kich_thuoc: f.kich_thuoc,
    coThumb: !!f.thumb_key, trang_thai: f.trang_thai,
  };
}
// Ghép thông tin hiển thị cho kết quả tìm kiếm: file, EMB bản chính của đơn cũ, đơn còn trong Sheet không.
function boSungKetQua(ketQua, maSheet) {
  const theoId = new Map(db.layFileTheoIds(ketQua.map(r => r.id)).map(f => [f.id, f]));
  const emb = db.embChinhCuaCacDon(ketQua.map(r => r.stt_key));
  const nguong = nguongService.layNguong(); // null = chưa chọn ngưỡng -> chỉ nhóm Trùng file
  return ketQua.filter(r => theoId.has(r.id)).map(r => {
    const e = emb.get(r.stt_key);
    return {
      ...r, ...hienThiFile(theoId.get(r.id)), nhom: nguongService.phanNhom(r, nguong),
      emb: e ? { id: e.id, ten: e.ten_file_goc || `phiên bản ${e.so_thu_tu}`, so_thu_tu: e.so_thu_tu } : null,
      trongSheet: maSheet ? maSheet.has(r.stt_key) : null,
    };
  });
}

// ---------- tìm kiếm (ve_file, admin, superadmin) ----------
// Tra theo mã đơn: tình trạng PNG/EMB + file của đơn + thiết kế tương tự (so với MỌI PNG của đơn, bỏ chính đơn đó).
router.get('/don/:sttKey', requireRole(...VAI_TRO_MENU), async (req, res) => {
  const { maSheet, tap } = await layTapMa();
  const xem = duocXemDon(req.session.user);
  const t = timMaCoThat(req.params.sttKey, tap);
  if (!t.ma) return loi(res, 'Thiếu mã đơn.');
  if (t.nhieu) return loi(res, loiNhieuMa(t.ma, t.nhieu, xem));
  const sttKey = t.ma;
  if (!xem(sttKey)) return loi(res, 'Không tìm thấy đơn này trong phạm vi bạn được xem.', 404);
  const files = db.dsFileCuaDon(sttKey);
  const png = files.filter(f => f.loai === 'PNG');
  const emb = files.filter(f => f.loai === 'EMB').sort((a, b) => b.so_thu_tu - a.so_thu_tu);
  let tim = null;
  if (png.length) {
    const tenTheoId = new Map(png.map(f => [f.id, tenLuu(f)]));
    const mau = db.dsChiMucPng(png.map(f => f.id)).map(h => ({ sha256: h.sha256, dhash: h.dhash, dhashHinhDang: h.dhash_hinh_dang, nhan: tenTheoId.get(h.id) }));
    tim = timTuongTu({ mau, boQuaStt: new Set([sttKey]), duocXem: xem });
    console.log(`[ThuVien] Tìm tương tự cho đơn ${sttKey}: ${png.length} PNG mẫu, so ${tim.tongSoSanh} file, ${tim.ms}ms`);
  }
  res.json({
    sttKey,
    trongSheet: maSheet ? maSheet.has(sttKey) : null,
    png: png.map(hienThiFile),
    embChinh: emb[0] ? hienThiFile(emb[0]) : null,
    embCu: emb.slice(1).map(hienThiFile),
    soLinkDangCho: db.demViecChuaXongCuaDon(sttKey),
    quyetDinh: db.dsQuyetDinhCuaDon(sttKey),
    tuongTu: tim ? boSungKetQua(tim.ketQua, maSheet) : [],
    tongSoSanh: tim ? tim.tongSoSanh : 0,
    nguong: nguongService.layNguong(),
  });
});

// Tìm theo 1 ảnh tải lên — ảnh chỉ nằm trong bộ nhớ, KHÔNG lưu vào thư viện. sttKeyMoi (tuỳ chọn): đơn mới đang vẽ — bỏ đơn
// đó khỏi kết quả và dùng để ghi quyết định.
router.post('/tim-theo-anh', requireRole(...VAI_TRO_MENU), uploadFile.single('anh'), async (req, res) => {
  if (!req.file) return loi(res, 'Chưa chọn ảnh.');
  if (!nhanDangKieuAnh(req.file.buffer)) return loi(res, 'Chỉ nhận ảnh PNG hoặc JPEG.');
  const tapMa = await layTapMa();
  const xem = duocXemDon(req.session.user);
  const t = timMaCoThat(req.body?.sttKeyMoi, tapMa.tap);
  if (t.nhieu) return loi(res, loiNhieuMa(t.ma, t.nhieu, xem));
  const sttKeyMoi = t.ma;
  if (sttKeyMoi && !xem(sttKeyMoi)) return loi(res, 'Mã đơn ngoài phạm vi bạn được xem.', 404);
  let h;
  try { h = await xuLy.tinhHashAnhTam(req.file.buffer); } catch (err) { return loi(res, 'Không xử lý được ảnh: ' + err.message, 500); }
  const tim = timTuongTu({ mau: [{ ...h, nhan: tenGoc(req.file) }], boQuaStt: new Set(sttKeyMoi ? [sttKeyMoi] : []), duocXem: xem });
  console.log(`[ThuVien] Tìm theo ảnh "${tenGoc(req.file)}": so ${tim.tongSoSanh} file, ${tim.ms}ms`);
  res.json({
    sttKeyMoi, tuongTu: boSungKetQua(tim.ketQua, tapMa.maSheet), tongSoSanh: tim.tongSoSanh,
    khongTinhDuocHash: !h.dhash && !h.dhashHinhDang, // ảnh trống/không đọc được — chỉ còn so trùng file
    nguong: nguongService.layNguong(),
    quyetDinh: sttKeyMoi ? db.dsQuyetDinhCuaDon(sttKeyMoi) : [],
  });
});

// Ghi quyết định của người vẽ cho 1 thiết kế cũ — CHỈ ghi nhận, không đổi đơn hay file nào.
router.post('/quyet-dinh', requireRole(...VAI_TRO_MENU), async (req, res) => {
  const { sttKeyMoi, fileId, quyetDinh } = req.body || {};
  const ghiChu = String(req.body?.ghiChu || '').trim().slice(0, 500);
  const xem = duocXemDon(req.session.user);
  const t = timMaCoThat(sttKeyMoi, (await layTapMa()).tap);
  if (t.nhieu) return loi(res, loiNhieuMa(t.ma, t.nhieu, xem));
  const moi = t.ma;
  if (!moi) return loi(res, 'Cần nhập mã đơn mới để ghi quyết định.');
  if (!QUYET_DINH_HOP_LE.includes(quyetDinh)) return loi(res, 'Quyết định không hợp lệ.');
  const f = db.layFile(Number(fileId));
  if (!f || !xem(f.stt_key) || !xem(moi)) return loi(res, 'Không tìm thấy file hoặc đơn.', 404);
  db.themQuyetDinh({ sttKeyMoi: moi, fileId: f.id, quyetDinh, ghiChu, nguoi: req.session.user.ten });
  ghiLog({ nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: 'Tìm ảnh: ghi quyết định', sttKey: moi, chiTiet: { quyetDinh, donCu: f.stt_key, file: tenLuu(f), ghiChu } });
  res.json({ quyetDinh: db.dsQuyetDinhCuaDon(moi) });
});

// ---------- tải lên thư viện (ve_file, admin, superadmin) ----------
// Xem trước: CHỈ metadata (chưa gửi file) -> bảng khớp từng file. Tối đa 500 file/lần (trình duyệt chia đợt — body JSON của
// app giới hạn 100KB).
router.post('/xem-truoc', requireRole(...VAI_TRO_MENU), async (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : null;
  if (!files || !files.length) return loi(res, 'Không có file nào.');
  if (files.length > 500) return loi(res, 'Tối đa 500 file mỗi lần xem trước.');
  const tapMa = await layTapMa();
  const { maSheet, maThuVien, tap } = tapMa;
  const xem = duocXemDon(req.session.user);
  const ketQua = files.map(f => {
    const ten = String(f?.ten || '').slice(0, 300);
    const duongDan = String(f?.duongDan || ten).slice(0, 1000);
    const loai = loaiTheoTen(ten);
    const dong = { ten, duongDan, loai };
    if (!loai) return { ...dong, trangThai: 'KHONG_HO_TRO' };
    if (Number(f?.kichThuoc) > xuLy.KICH_THUOC_TOI_DA) return { ...dong, trangThai: 'QUA_LON' };
    const k = khopSttKey(duongDan, tap);
    // ứng viên / mã ngoài phạm vi KHÔNG gửi về (admin không dò được mã đơn của Xưởng khác qua tên file)
    if (k.ketQua === 'NHIEU') return { ...dong, trangThai: 'NHIEU', ungVien: k.ungVien.filter(xem) };
    if (k.ketQua !== 'KHOP') return { ...dong, trangThai: 'KHONG_KHOP' };
    if (!xem(k.sttKey)) return { ...dong, trangThai: 'KHONG_QUYEN' };
    const thongTin = { ...dong, sttKey: k.sttKey, theo: k.theo, ngoaiSheet: maSheet ? !maSheet.has(k.sttKey) : null };
    if (/^[0-9a-f]{64}$/.test(f?.sha256 || '') && db.timFileTheoSha(k.sttKey, loai, f.sha256)) return { ...thongTin, trangThai: 'TRUNG' };
    return { ...thongTin, trangThai: 'KHOP' };
  });
  res.json({ ketQua, khongDocDuocSheet: !maSheet, sheetCuLuc: sheetCuLuc(tapMa), soMaThuVien: maThuVien.size });
});

// Tải lên 1 file. Server KHỚP LẠI theo tên/đường dẫn — không tin mã từ trình duyệt; chỉ dùng sttKeyGoTay khi tên không khớp
// được (người dùng gõ ở bảng xem trước). Mã gõ tay không có trong Sheet (hoặc không đọc được Sheet) phải kèm xacNhanNgoaiSheet=1.
router.post('/upload', requireRole(...VAI_TRO_MENU), uploadFile.single('file'), async (req, res) => {
  if (!req.file) return loi(res, 'Chưa có file.');
  const ten = tenGoc(req.file);
  const loai = loaiTheoTen(ten);
  if (!loai) return loi(res, 'Chỉ nhận .png, .jpg, .jpeg hoặc .emb.');
  const tapMa = await layTapMa();
  const xem = duocXemDon(req.session.user);
  const k = khopSttKey(String(req.body?.duongDan || ten), tapMa.tap);
  let sttKey = k.ketQua === 'KHOP' ? k.sttKey : '';
  if (!sttKey) {
    const goTay = String(req.body?.sttKeyGoTay || '').trim();
    const thay = k.ketQua === 'NHIEU' ? dsMaThay(k.ungVien, xem) : '';
    if (!goTay) return loi(res, k.ketQua === 'NHIEU' ? `Tên file khớp nhiều đơn${thay ? ` (${thay})` : ''} — gõ mã đơn đúng.` : 'Không xác định được đơn từ tên file — gõ mã đơn.');
    const m = xacDinhMa(goTay, tapMa, req.body?.xacNhanNgoaiSheet === '1', xem);
    if (m.loi) return loi(res, m.loi);
    if (m.canXacNhan) return loi(res, `${m.canXacNhan} — cần tick xác nhận lưu.`);
    sttKey = m.sttKey;
  }
  if (!xem(sttKey)) return loi(res, `Đơn ${sttKey} ngoài phạm vi Xưởng của bạn.`, 403);
  let kq;
  try {
    const chung = { buffer: req.file.buffer, sttKey, tenFileGoc: ten, nguoiTaiLen: req.session.user.ten };
    kq = loai === 'PNG' ? await xuLy.luuMotFile({ ...chung, nguon: 'UPLOAD' }) : await xuLy.luuEmb(chung);
  } catch (err) {
    console.error('[ThuVien] Tải lên thất bại:', ten, '-', err.message);
    return loi(res, err.message, 502);
  }
  if (kq.ketQua === 'DA_LUU') {
    ghiNhanMaMoi(sttKey);
    ghiLog({ nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: `Tìm ảnh: tải lên ${loai}`, sttKey, chiTiet: { ten } });
  }
  res.json({ ketQua: kq.ketQua, lyDo: kq.lyDo || '', sttKey, loai, id: kq.id || null });
});

// ---------- EMB của 1 đơn (chi tiết đơn) ----------
// Xem trạng thái: ai xem được đơn (theo Xưởng) đều thấy; tải về / tải lên: ve_file, admin, superadmin.
router.get('/emb/:sttKey', (req, res) => {
  const sttKey = String(req.params.sttKey || '').trim();
  if (!sttKey || !duocXemDon(req.session.user)(sttKey)) return loi(res, 'Không tìm thấy đơn.', 404);
  const emb = db.dsFileCuaDon(sttKey).filter(f => f.loai === 'EMB').sort((a, b) => b.so_thu_tu - a.so_thu_tu);
  const duocThaoTac = laVaiTroMenu(req.session.user);
  res.json({
    chinh: emb[0] ? hienThiFile(emb[0]) : null,
    cu: emb.slice(1).map(hienThiFile),
    duocTai: duocThaoTac, duocTaiLen: duocThaoTac,
  });
});

router.post('/emb/:sttKey', requireRole(...VAI_TRO_MENU), uploadFile.single('file'), async (req, res) => {
  if (!req.file) return loi(res, 'Chưa chọn file EMB.');
  const ten = tenGoc(req.file);
  if (loaiTheoTen(ten) !== 'EMB') return loi(res, 'Chỉ nhận file .emb.');
  // Cùng quy tắc mã với tải lên ở menu: mã chưa có trong Sheet lẫn thư viện phải xác nhận (trang hỏi rồi gửi lại).
  const xem = duocXemDon(req.session.user);
  const m = xacDinhMa(req.params.sttKey, await layTapMa(), req.body?.xacNhanNgoaiSheet === '1', xem);
  if (m.loi) return loi(res, m.loi);
  const sttKey = m.sttKey;
  if (!xem(sttKey)) return loi(res, 'Không tìm thấy đơn.', 404);
  if (m.canXacNhan) return res.json({ ketQua: 'CAN_XAC_NHAN', lyDo: `${m.canXacNhan}.` });
  let kq;
  try { kq = await xuLy.luuEmb({ buffer: req.file.buffer, sttKey, tenFileGoc: ten, nguoiTaiLen: req.session.user.ten }); } catch (err) {
    console.error('[ThuVien] Tải lên EMB thất bại:', sttKey, '-', err.message);
    return loi(res, err.message, 502);
  }
  if (kq.ketQua === 'DA_LUU') {
    ghiNhanMaMoi(sttKey);
    ghiLog({ nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: 'Tìm ảnh: tải lên EMB', sttKey, chiTiet: { ten } });
  }
  res.json({ ketQua: kq.ketQua, lyDo: kq.lyDo || '', sttKey });
});

// ---------- giai đoạn 4: cặp ảnh đánh giá (ve_file, admin, superadmin) + ngưỡng (superadmin) ----------
function thongKeCap() {
  const ds = db.dsCapDanhGia();
  return { soCap: ds.length, soCung: ds.filter(c => c.ket_luan === 'CUNG').length, soKhac: ds.filter(c => c.ket_luan === 'KHAC').length };
}

router.get('/cap-danh-gia/moi', requireRole(...VAI_TRO_MENU), (req, res) => {
  res.json({ cap: nguongService.layCapMoi(duocXemDon(req.session.user)), thongKe: thongKeCap() });
});

router.post('/cap-danh-gia', requireRole(...VAI_TRO_MENU), (req, res) => {
  const { fileA, fileB, ketLuan } = req.body || {};
  if (!['CUNG', 'KHAC'].includes(ketLuan)) return loi(res, 'Kết luận phải là CUNG hoặc KHAC.');
  const xem = duocXemDon(req.session.user);
  const a = db.layFile(Number(fileA)), b = db.layFile(Number(fileB));
  if (!a || !b || a.id === b.id || a.loai !== 'PNG' || b.loai !== 'PNG' || !xem(a.stt_key) || !xem(b.stt_key)) return loi(res, 'Không tìm thấy cặp ảnh.', 404);
  db.luuCapDanhGia({ fileA: a.id, fileB: b.id, ketLuan, nguoi: req.session.user.ten });
  res.json({ thongKe: thongKeCap() });
});

// Danh sách cặp đã đánh giá (để superadmin rà và xoá cặp đánh giá nhầm).
router.get('/cap-danh-gia', requireExactRole('superadmin'), (req, res) => {
  const ds = db.dsCapDanhGia();
  res.json({ soCap: ds.length, ds: ds.slice(-300).reverse().map(c => ({ id: c.id, file_a: c.file_a, file_b: c.file_b, stt_a: c.stt_a, stt_b: c.stt_b, ket_luan: c.ket_luan, nguoi: c.nguoi, thoi_gian: c.thoi_gian })) });
});

router.delete('/cap-danh-gia/:id', requireExactRole('superadmin'), (req, res) => {
  if (!db.xoaCapDanhGia(Number(req.params.id))) return loi(res, 'Không tìm thấy cặp.', 404);
  res.json({ ok: true });
});

const docNguong = q => ({ anh: Number(q.anh), hinhDang: Number(q.hinhDang), xemTay: Number(q.xemTay) });
router.get('/nguong/goi-y', requireExactRole('superadmin'), (req, res) => {
  const coThu = req.query.anh !== undefined || req.query.hinhDang !== undefined || req.query.xemTay !== undefined;
  try { res.json(nguongService.goiYNguong(coThu ? docNguong(req.query) : null, { tinhLuoi: req.query.tinh === '1' })); } catch (err) {
    if (err.nghiepVu) return loi(res, err.message);
    throw err;
  }
});

router.post('/nguong', requireExactRole('superadmin'), (req, res) => {
  if (req.body?.xoa === true) {
    nguongService.xoaNguong();
    ghiLog({ nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: 'Tìm ảnh: xoá ngưỡng nhóm kết quả' });
    return res.json({ nguong: null });
  }
  const n = docNguong(req.body || {});
  const l = nguongService.kiemTraNguong(n);
  if (l) return loi(res, l);
  nguongService.luuNguong(n);
  ghiLog({ nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: 'Tìm ảnh: lưu ngưỡng nhóm kết quả', chiTiet: n });
  res.json({ nguong: nguongService.layNguong() });
});

// ---------- giai đoạn 3: tự động lấy link PNG từ cột DUONG_DAN_URL (superadmin) ----------
router.post('/tu-dong-sheet', requireExactRole('superadmin'), (req, res) => {
  if (typeof req.body?.bat !== 'boolean') return loi(res, 'Thiếu bat (true/false).');
  dongBoSheet.datBat(req.body.bat);
  ghiLog({ nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: req.body.bat ? 'Tìm ảnh: BẬT tự động lấy PNG từ Sheet' : 'Tìm ảnh: TẮT tự động lấy PNG từ Sheet' });
  res.json({ bat: dongBoSheet.dangBat() });
});

// Trả lời ngay, quét chạy nền (đọc Sheet có thể tới 2 phút — giữ request lâu vậy thì Cloudflare/trình duyệt cắt giữa chừng).
// Kết quả hiện ở dòng "Lần quét gần nhất" của khối hàng chờ (tự tải lại 5 giây/lần).
router.post('/tu-dong-sheet/quet-ngay', requireExactRole('superadmin'), (req, res) => {
  if (dongBoSheet.dangQuet()) return loi(res, 'Đang có 1 lượt quét chạy — kết quả sẽ hiện ở dòng "Lần quét gần nhất".', 409);
  // Công tắc TẮT vẫn quét được 1 lần, nhưng lượt này vẫn đưa link vào hàng chờ (chưa quét lần nào = TOÀN BỘ đơn) -> phải xác nhận.
  if (!dongBoSheet.dangBat() && req.body?.xacNhanKhiTat !== true) return loi(res, 'Tự động lấy PNG từ Sheet đang TẮT — cần xác nhận trước khi quét.');
  const { ten, vaiTro } = req.session.user;
  dongBoSheet.quetSheet({ bamTay: true })
    .then(kq => ghiLog({ nguoiDung: ten, vaiTro, hanhDong: 'Tìm ảnh: quét Sheet ngay', chiTiet: kq }))
    .catch(err => console.error('[ThuVien] Quét Sheet lỗi:', err.message));
  res.json({ batDau: true });
});

// ---------- hàng chờ (superadmin) ----------
// Tổng file / dung lượng / ảnh mỗi link phải quét cả bảng (~70ms ở 200.000 file — đo 03/10/2026) mà trang gọi 5 giây/lần ->
// đọc lại tối đa 30 giây/lần. ponytail: số lệch tối đa 30 giây; cần tức thời thì đổi sang bộ đếm cập nhật lúc lưu file.
const TONG_HANG_CHO_MS = 30000;
let tongHangCho = null;
function layTongHangCho() {
  if (!tongHangCho || Date.now() - tongHangCho.luc >= TONG_HANG_CHO_MS) {
    tongHangCho = { luc: Date.now(), file: db.thongKeFile(), png: db.thongKePngHangCho(), xong: db.thongKeViecXong() };
  }
  return tongHangCho;
}

router.get('/hang-cho', requireExactRole('superadmin'), (req, res) => {
  const viec = db.demViecTheoTrangThai();
  const { file: { soFile, tongByte }, png, xong } = layTongHangCho();
  // ước tính dung lượng còn lại: số link còn chờ x số ảnh trung bình mỗi link ĐÃ XONG x dung lượng trung bình mỗi PNG hàng chờ đã
  // tải (không tính EMB / file tải tay — xem thongKePngHangCho). Ảnh/link chỉ lấy từ việc XONG — xem thongKeViecXong; tính cả
  // file của thư mục đang dở sẽ thổi phồng nhiều lần.
  const trungBinhByte = png.soFile ? png.tongByte / png.soFile : 0;
  const anhMoiLink = xong.soLink ? xong.soFile / xong.soLink : 0;
  const conCho = viec.CHO + viec.DANG_CHAY + viec.LOI;
  res.json({
    tamDung: xuLy.dangTamDung(),
    dungTaiDiemDo: xuLy.dangTamDung() && db.layCaiDat('dung_tai_diem_do') === '1',
    lyDoTamDung: xuLy.dangTamDung() ? db.layCaiDat('ly_do_tam_dung') : '', // tự tạm dừng vì lỗi hệ thống liên tiếp
    viec, soFile, tongByte, soPngHangCho: png.soFile, trungBinhByte, anhMoiLink, conCho,
    uocTinhConLaiByte: Math.round(conCho * anhMoiLink * trungBinhByte),
    fileMoiNhat: db.dsFileMoiNhat(12),
    tuDongSheet: { bat: dongBoSheet.dangBat(), dangQuet: dongBoSheet.dangQuet(), lanQuet: dongBoSheet.layLanQuet() },
  });
});

router.post('/hang-cho', requireExactRole('superadmin'), (req, res) => {
  if (typeof req.body?.tamDung !== 'boolean') return loi(res, 'Thiếu tamDung (true/false).');
  xuLy.datTamDung(req.body.tamDung);
  ghiLog({ nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: req.body.tamDung ? 'Tìm ảnh: tạm dừng hàng chờ' : 'Tìm ảnh: chạy tiếp hàng chờ' });
  if (!req.body.tamDung) xuLy.chayMotLuot().catch(err => console.error('[ThuVien] Vòng xử lý lỗi:', err.message));
  res.json({ tamDung: req.body.tamDung });
});

// ---------- nhập Excel (superadmin) ----------
router.post('/excel', requireExactRole('superadmin'), uploadExcel.single('file'), async (req, res) => {
  if (!req.file) return loi(res, 'Chưa chọn file Excel.');
  const tenFile = Buffer.from(req.file.originalname, 'latin1').toString('utf8'); // multer đọc tên theo latin1
  if (!/\.xlsx$/i.test(tenFile)) return loi(res, 'Chỉ nhận file .xlsx.');
  let kq;
  try { kq = await nhapExcel(req.file.buffer, tenFile, req.session.user.ten); } catch (err) { return loi(res, err.message); }
  ghiLog({ nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: 'Tìm ảnh: nhập Excel', chiTiet: { tenFile, ...kq } });
  xuLy.chayMotLuot().catch(err => console.error('[ThuVien] Vòng xử lý lỗi:', err.message));
  res.json(kq);
});

router.get('/excel', requireExactRole('superadmin'), (req, res) => {
  res.json(db.dsLoExcel(20));
});

router.get('/excel/:loId/ket-qua.xlsx', requireExactRole('superadmin'), async (req, res) => {
  const lo = db.layLoExcel(Number(req.params.loId));
  if (!lo) return loi(res, 'Không tìm thấy lô nhập.', 404);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="KetQua_NhapExcel_${lo.id}.xlsx"`);
  try {
    await guiFileKetQua(lo.id, res); // ghi luồng từng trang — lô lớn không chặn cả server
  } catch (err) {
    console.error('[ThuVien] Lỗi tạo file kết quả lô', lo.id, '-', err.message);
    if (!res.headersSent) return loi(res, 'Không tạo được file kết quả.', 500);
    res.destroy();
  }
});

// ---------- thống kê (admin+) ----------
router.get('/thong-ke', requireRole(), async (req, res) => {
  const tapMa = await layTapMa();
  const kq = await thongKeThuVien({ duocXem: duocXemDon(req.session.user), maSheet: tapMa.maSheet });
  console.log(`[ThuVien] Thống kê (${req.session.user.ten}): ${kq.soDon} đơn, ${kq.ms}ms`);
  res.json({ ...kq, khongDocDuocSheet: !tapMa.maSheet, sheetCuLuc: sheetCuLuc(tapMa) });
});

// ---------- cần xử lý (admin+) ----------
// Admin: lọc theo Xưởng TRƯỚC rồi mới lấy 500 dòng — lấy 500 dòng đầu của mọi Xưởng rồi mới lọc thì Xưởng khác nhiều lỗi che hết.
router.get('/can-xu-ly', requireRole(), (req, res) => {
  const xem = duocXemDon(req.session.user);
  const soDoc = xemTatCa(req.session.user) ? 500 : 100000;
  res.json({
    viecLoi: db.dsViecLoi(soDoc).filter(v => xem(v.stt_key)).slice(0, 500),
    fileLoiHash: db.dsFileLoiHash(soDoc).filter(f => xem(f.stt_key)).slice(0, 500),
  });
});

router.post('/can-xu-ly/thu-lai', requireRole(), async (req, res) => {
  const xem = duocXemDon(req.session.user);
  const { viecIds, tatCa, fileId } = req.body || {};
  if (fileId !== undefined) {
    const f = db.layFile(Number(fileId));
    if (!f || !xem(f.stt_key)) return loi(res, 'Không tìm thấy file.', 404);
    let trangThai;
    try { trangThai = await xuLy.tinhLaiFile(f.id); } catch (err) { return loi(res, 'Không đọc lại được file từ MinIO: ' + err.message, 502); }
    return res.json({ trangThai: trangThai || f.trang_thai });
  }
  // admin chỉ thử lại được việc thuộc Xưởng mình — luôn lọc theo danh sách đang thấy, kể cả khi bấm "tất cả"
  const dsThay = new Set(db.dsViecLoi(100000).filter(v => xem(v.stt_key)).map(v => v.id));
  const ids = tatCa ? [...dsThay] : (Array.isArray(viecIds) ? viecIds.map(Number) : []).filter(id => dsThay.has(id));
  if (!ids.length) return loi(res, 'Không có việc nào để thử lại.');
  const soViec = db.thuLaiViec(ids);
  ghiLog({ nguoiDung: req.session.user.ten, vaiTro: req.session.user.vaiTro, hanhDong: 'Tìm ảnh: thử lại link lỗi', chiTiet: { soViec } });
  xuLy.chayMotLuot().catch(err => console.error('[ThuVien] Vòng xử lý lỗi:', err.message));
  res.json({ soViec });
});

// ---------- xem file / thumbnail (proxy, kiểm quyền — không bao giờ lộ link MinIO) ----------
async function phatObject(res, objectKey, tenTai) {
  // Không đặt Cache-Control max-age: máy dùng chung, đổi tài khoản thì trình duyệt sẽ phát lại ảnh đã cache mà không hỏi
  // server -> lọt qua kiểm tra quyền theo Xưởng (đã gặp khi thử 03/10/2026).
  const headers = { 'Cache-Control': 'no-store' };
  if (tenTai) headers['Content-Disposition'] = `attachment; filename="${tenTai}"`;
  try {
    await storageService.guiObjectQuaHttp(res, objectKey, { headers }); // timeout + đóng đúng kết nối khi MinIO đứt/treo giữa chừng
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return loi(res, 'Không tìm thấy file.', 404);
    console.error('[ThuVien] Đọc MinIO thất bại:', objectKey, '-', err.message);
    return loi(res, 'Đọc file từ kho lưu trữ thất bại.', 502);
  }
}

router.get('/file/:id', requireRole(...VAI_TRO_MENU), async (req, res) => {
  const f = db.layFile(Number(req.params.id));
  if (!f || !duocXemDon(req.session.user)(f.stt_key)) return loi(res, 'Không tìm thấy file.', 404);
  // EMB bản chính tải về đặt tên <STT_Key>.emb (spec mục 5); bản cũ giữ tên phiên bản <STT_Key>_v<n>.emb.
  const tenTai = f.loai === 'EMB' && f.la_ban_chinh ? `${xuLy.lamSachKey(f.stt_key)}.emb` : f.object_key.split('/').pop();
  await phatObject(res, f.object_key, req.query.tai || f.loai === 'EMB' ? tenTai : '');
});

router.get('/thumb/:id', requireRole(...VAI_TRO_MENU), async (req, res) => {
  const f = db.layFile(Number(req.params.id));
  if (!f || !f.thumb_key || !duocXemDon(req.session.user)(f.stt_key)) return loi(res, 'Không tìm thấy thumbnail.', 404);
  await phatObject(res, f.thumb_key, '');
});

// Lỗi multer (file quá lớn / quá nhiều file) -> 400 dễ hiểu.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code !== 'LIMIT_FILE_SIZE') return loi(res, err.message);
    return loi(res, req.path.startsWith('/excel')
      ? 'File Excel quá lớn (tối đa 3MB). Xoá các cột khác, chỉ giữ 2 cột STT_Key và DUONG_DAN_URL rồi xuất lại — 3MB đủ khoảng 180.000 dòng.'
      : 'File quá lớn (tối đa 30MB).');
  }
  next(err);
});

module.exports = router;
