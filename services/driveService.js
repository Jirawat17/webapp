const { google } = require('googleapis');
const { AsyncLocalStorage } = require('async_hooks');
const { getAuthClient } = require('../config/googleClients');

// Link THƯ MỤC dán dạng link file (12/11/2026 — vd "drive.google.com/open?id=<mã thư mục>"; log 10–12/11: 6 thư mục "Sweatshirt S/M/L…" bị tải
// như file, Google báo "Only files with binary content can be downloaded", thử lại tới 42 lần). Mọi nơi hỏi "link này là thư mục?"
// qua 1 hàm duy nhất xacDinhFolderId: link /folders/ -> có; link dạng file -> hỏi Google loại file 1 lần rồi NHỚ (trong bộ nhớ).
// In/xem ảnh (layDsAnhTrongThuMucDrive) không hỏi trước — chỉ hỏi khi tải như file thất bại, link ảnh thường không tốn thêm lượt gọi.
const MIME_THU_MUC = 'application/vnd.google-apps.folder';
const _laThuMucTheoId = new Map(); // fileId -> true (thư mục) | false (không phải). Ghi ở MỌI lần hỏi loại file (layThongTinFileDrive).
const GIOI_HAN_NHO_LOAI = 5000;    // vượt -> bỏ mục cũ nhất (Map giữ thứ tự thêm); mất nhớ chỉ tốn thêm 1 lượt hỏi Google
function nhoLoaiFile(fileId, laThuMuc) {
  _laThuMucTheoId.delete(fileId);
  _laThuMucTheoId.set(fileId, laThuMuc);
  if (_laThuMucTheoId.size > GIOI_HAN_NHO_LOAI) _laThuMucTheoId.delete(_laThuMucTheoId.keys().next().value);
}

// Mã đơn đang xử lý (12/11/2026) — ghi kèm vào log lỗi Drive để tra được link thuộc đơn nào. Nơi gọi biết mã đơn bọc bằng chayVoiMaDon.
const _maDon = new AsyncLocalStorage();
const chayVoiMaDon = (sttKey, fn) => _maDon.run(sttKey, fn);
const nhanMaDon = () => { const k = _maDon.getStore(); return k ? ` (đơn ${k})` : ''; };

/**
 * Drive client dùng Service Account.
 * Ảnh mới giờ lưu trên MinIO (xem storageService.js) — file Drive này chỉ còn
 * giữ chức năng ĐỌC ảnh cũ đã được share để báo cáo/khôi phục dữ liệu lịch sử.
 */
async function getDriveReadClient() {
  const auth = await getAuthClient();

  return google.drive({
    version: 'v3',
    auth,
  });
}

/**
 * Lấy file ID từ link Google Drive (link tới 1 FILE, không phải thư mục).
 */
function layFileIdTuLinkDrive(url) {
  if (!url) return null;

  const chuoi = String(url);

  const m1 = chuoi.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];

  const m2 = chuoi.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m2 ? m2[1] : null;
}

/**
 * Lấy folder ID từ link Google Drive dạng thư mục (.../drive/folders/FOLDER_ID) — khác hẳn link file
 * ở trên (layFileIdTuLinkDrive không nhận diện được dạng link này, và ngược lại).
 */
function layFolderIdTuLinkDrive(url) {
  if (!url) return null;
  const m = String(url).match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Mã thư mục của link, hoặc null. Link dạng file (open?id=, /d/) cũng có thể là thư mục: hỏi Google loại file (nhớ kết quả).
// hoiGoogle = false: chỉ dùng điều đã biết, không gọi thêm. Hỏi lỗi (không có quyền, mạng...) -> null, nơi gọi xử lý như file.
async function xacDinhFolderId(url, { hoiGoogle = true } = {}) {
  const folderId = layFolderIdTuLinkDrive(url);
  if (folderId) return folderId;
  const fileId = layFileIdTuLinkDrive(url);
  return fileId && await laThuMucTheoId(fileId, hoiGoogle) ? fileId : null;
}
async function laThuMucTheoId(fileId, hoiGoogle = true) {
  if (!_laThuMucTheoId.has(fileId) && hoiGoogle) {
    try { await layThongTinFileDrive(fileId); } catch (e) { return false; }
  }
  return _laThuMucTheoId.get(fileId) === true;
}

// googleapis (gaxios) mặc định KHÔNG có timeout nào — nếu Google tạm chậm/kết nối đứng giữa chừng,
// promise treo VÔ THỜI HẠN thay vì throw (bổ sung 17/09/2026, xem
// docs/superpowers/specs/2026-09-17-sua-loi-treo-quet-hang-loat-design.md — cùng dạng lỗi với MinIO ở
// storageService.js#getObjectBuffer). Đồng bộ mức với timeout MinIO ở đó.
const THOI_GIAN_CHO_TOI_DA_MS = 20000;

/**
 * Đọc bytes của 1 file Drive theo ID đã biết sẵn (dùng chung cho cả link file lẫn từng ảnh liệt kê
 * được trong 1 thư mục).
 */
async function taiFileDriveTheoId(fileId, { timeoutMs = THOI_GIAN_CHO_TOI_DA_MS } = {}) {
  try {
    const drive = await getDriveReadClient();

    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer', timeout: timeoutMs }
    );

    return Buffer.from(res.data);
  } catch (err) {
    // "Only files with binary content..." = mã này không phải file thường -> hỏi loại 1 lần; là thư mục thì nhớ lại (không ghi lỗi).
    if (/only files with binary content/i.test(err.message || '') && await laThuMucTheoId(fileId)) return null;
    console.error(`[Drive] Không tải được file: ${fileId}${nhanMaDon()} - ${err.message}`);
    return null;
  }
}

/**
 * Đọc bytes của ảnh Drive cũ (trước khi chuyển sang MinIO) — url là link tới 1 FILE cụ thể.
 */
async function taiAnhTuLinkDrive(url) {
  const fileId = layFileIdTuLinkDrive(url);
  if (!fileId) return null;
  return taiFileDriveTheoId(fileId);
}

/**
 * Liệt kê + tải TẤT CẢ ảnh bên trong 1 thư mục Drive (bổ sung 04/09/2026, theo yêu cầu người dùng —
 * một số đơn dán nhầm link cả thư mục thay vì link 1 ảnh cụ thể; thay vì bỏ qua hoàn toàn, lấy hết
 * ảnh trong thư mục đó ra dùng). Trả về:
 *   - null nếu url KHÔNG PHẢI link thư mục (để nơi gọi biết mà thử các nguồn ảnh khác)
 *   - mảng Buffer (có thể rỗng nếu thư mục không có ảnh nào / lỗi liệt kê) nếu ĐÚNG là link thư mục
 * Sắp theo TÊN FILE (orderBy: 'name') để thứ tự ổn định, dễ đoán giữa các lần in. Giới hạn 50 ảnh/thư
 * mục — đủ dùng thực tế, tránh 1 thư mục quá nhiều ảnh làm chậm/nặng file in không cần thiết.
 *
 * `tuyChon.gioiHan` (bổ sung 13/09/2026, theo yêu cầu người dùng — hiển thị TỐI ĐA 2 ảnh đại diện cho 1
 * đơn, xem routes/photos.js#GET /anh-ngoai): cắt danh sách file CÒN TRƯỚC KHI TẢI, không phải sau — nơi
 * gọi chỉ cần 2 ảnh đầu thì KHÔNG tải hết cả thư mục (có thể tới 50 ảnh) rồi bỏ phần thừa, tránh lãng
 * phí lượt gọi Drive API + băng thông không cần thiết. Không truyền = giữ nguyên hành vi cũ (tải hết,
 * dùng cho tính năng IN ĐƠN/quét hàng loạt vốn cần đủ ảnh để chọn/so khớp).
 */
async function layDsAnhTrongThuMucDrive(url, { gioiHan, timeoutMs = THOI_GIAN_CHO_TOI_DA_MS, hoiGoogle = false } = {}) {
  const folderId = await xacDinhFolderId(url, { hoiGoogle });
  if (!folderId) return null;

  try {
    const drive = await getDriveReadClient();
    const res = await drive.files.list(
      {
        q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
        fields: 'files(id, name)',
        orderBy: 'name',
        pageSize: 50,
      },
      { timeout: timeoutMs }
    );

    let files = res.data.files || [];
    if (gioiHan) files = files.slice(0, gioiHan);
    const buffers = await Promise.all(files.map(f => taiFileDriveTheoId(f.id, { timeoutMs })));
    return buffers.filter(Boolean);
  } catch (err) {
    console.error('[Drive] Không liệt kê được thư mục:', url, '-', err.message);
    return [];
  }
}

// Bản ĐẦY ĐỦ cho PDF "THUÊ TEAM KHÁC" (bổ sung 28/09/2026, theo yêu cầu người dùng — "tuyệt đối không thiếu ảnh"):
// khác layDsAnhTrongThuMucDrive ở trên (IN ĐƠN, giữ nguyên) — đọc HẾT mọi trang (không dừng ở 50 file), lỗi liệt kê
// thư mục THROW thay vì trả [] (không lẫn với thư mục rỗng), và CHỈ trả danh sách file (KHÔNG tải sẵn) để nơi gọi tải +
// thu nhỏ từng ít ảnh một — tải hết 1 thư mục lớn vào RAM cùng lúc có thể làm sập container.
// -> null nếu url không phải thư mục; [{ id, ten, link }] nếu đúng (tải từng file bằng taiFileDriveTheoId).
async function layChiTietAnhThuMucDrive(url) {
  const folderId = await xacDinhFolderId(url); // link dạng file cũng hỏi loại (12/11/2026) — thư mục lấy đủ ảnh ngay lần đầu
  if (!folderId) return null;
  const drive = await getDriveReadClient();
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size)', orderBy: 'name', pageSize: 100, pageToken,
    }, { timeout: THOI_GIAN_CHO_TOI_DA_MS });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  // mimeType/kichThuoc (03/10/2026, thư viện "Tìm ảnh"): lọc file không phải PNG/JPEG hoặc quá lớn TRƯỚC khi tải — thư mục
  // thiết kế hay có PSD/TIFF hàng trăm MB (vẫn là image/*). kichThuoc null nếu Drive không trả (file Google Docs...).
  return files.map(f => ({ id: f.id, ten: f.name, link: `https://drive.google.com/file/d/${f.id}/view`, mimeType: f.mimeType || '', kichThuoc: f.size ? Number(f.size) : null }));
}

// Thông tin 1 file Drive (03/10/2026, thư viện "Tìm ảnh") — tên gốc + loại + dung lượng, để lọc trước khi tải và lưu đúng tên
// file. Lỗi (không có quyền / không tồn tại) -> THROW kèm thông điệp của Google, nơi gọi ghi lại làm lý do lỗi rõ ràng.
async function layThongTinFileDrive(fileId) {
  const drive = await getDriveReadClient();
  const res = await drive.files.get({ fileId, fields: 'name, mimeType, size' }, { timeout: THOI_GIAN_CHO_TOI_DA_MS });
  nhoLoaiFile(fileId, res.data.mimeType === MIME_THU_MUC);
  return { ten: res.data.name || '', mimeType: res.data.mimeType || '', kichThuoc: res.data.size ? Number(res.data.size) : null };
}

module.exports = {
  layChiTietAnhThuMucDrive,
  layThongTinFileDrive,
  layFileIdTuLinkDrive,
  layFolderIdTuLinkDrive,
  xacDinhFolderId,
  taiAnhTuLinkDrive,
  layDsAnhTrongThuMucDrive,
  chayVoiMaDon,
  taiFileDriveTheoId, // export thêm để test được trực tiếp phần xử lý timeout/lỗi — xem test-timeout-treo-tai-anh.js
};
