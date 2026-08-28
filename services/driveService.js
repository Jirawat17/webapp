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
 * Lấy file ID từ link Google Drive.
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
 * Đọc bytes của ảnh Drive cũ (trước khi chuyển sang MinIO).
 */
async function taiAnhTuLinkDrive(url) {
  const fileId = layFileIdTuLinkDrive(url);
  if (!fileId) return null;

  try {
    const drive = await getDriveReadClient();

    const res = await drive.files.get(
      {
        fileId,
        alt: 'media',
      },
      {
        responseType: 'arraybuffer',
      }
    );

    return Buffer.from(res.data);
  } catch (err) {
    console.error(
      '[Drive] Không tải được ảnh:',
      url,
      '-',
      err.message
    );

    return null;
  }
}

module.exports = {
  layFileIdTuLinkDrive,
  taiAnhTuLinkDrive,
};
