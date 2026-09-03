const { google } = require('googleapis');
const { getAuthClient } = require('../config/googleClients');

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

/**
 * Đọc bytes của 1 file Drive theo ID đã biết sẵn (dùng chung cho cả link file lẫn từng ảnh liệt kê
 * được trong 1 thư mục).
 */
async function taiFileDriveTheoId(fileId) {
  try {
    const drive = await getDriveReadClient();

    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    return Buffer.from(res.data);
  } catch (err) {
    console.error('[Drive] Không tải được file:', fileId, '-', err.message);
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
 */
async function layDsAnhTrongThuMucDrive(url) {
  const folderId = layFolderIdTuLinkDrive(url);
  if (!folderId) return null;

  try {
    const drive = await getDriveReadClient();
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'files(id, name)',
      orderBy: 'name',
      pageSize: 50,
    });

    const files = res.data.files || [];
    const buffers = await Promise.all(files.map(f => taiFileDriveTheoId(f.id)));
    return buffers.filter(Boolean);
  } catch (err) {
    console.error('[Drive] Không liệt kê được thư mục:', url, '-', err.message);
    return [];
  }
}

module.exports = {
  layFileIdTuLinkDrive,
  layFolderIdTuLinkDrive,
  taiAnhTuLinkDrive,
  layDsAnhTrongThuMucDrive,
};
