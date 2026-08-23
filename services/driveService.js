const { google } = require('googleapis');
const { Readable } = require('stream');
const { getAuthClient } = require('../config/googleClients');

const ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID;

async function getDriveClient() {
  const auth = await getAuthClient();
  return google.drive({ version: 'v3', auth });
}

// Tìm folder con theo tên trong 1 folder cha, tạo mới nếu chưa có (dùng cho folder theo ngày)
async function getOrCreateFolder(name, parentId = ROOT_FOLDER_ID) {
  const drive = await getDriveClient();
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents ` +
            `and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const list = await drive.files.list({ q, fields: 'files(id, name)' });
  if (list.data.files.length > 0) return list.data.files[0].id;

  const folder = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return folder.data.id;
}

// Upload buffer ảnh (từ multer memoryStorage) lên Drive, trả về link xem trực tiếp
async function uploadImageBuffer(buffer, fileName, folderId, mimeType = 'image/jpeg') {
  const drive = await getDriveClient();
  const stream = Readable.from(buffer);

  const file = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: stream },
    fields: 'id',
  });

  // Cho phép ai có link cũng xem được — cần thiết để hiển thị ảnh trong web app / trình duyệt
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return `https://drive.google.com/uc?export=view&id=${file.data.id}`;
}

// Trích mã file Drive từ 1 link chia sẻ bất kỳ (dạng .../file/d/{ID}/view..., hoặc ...?id={ID}...)
function layFileIdTuLinkDrive(url) {
  if (!url) return null;
  const chuoi = String(url);
  const m1 = chuoi.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = chuoi.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m2 ? m2[1] : null;
}

// Tải NỘI DUNG THẬT (bytes ảnh) của 1 file Drive theo link chia sẻ — dùng để nhúng ảnh thật vào
// báo cáo Excel/PDF (không chỉ chèn link). LƯU Ý: các link này thường do hệ thống cũ tạo ra
// (không qua tài khoản dịch vụ của app hiện tại), nên tài khoản dịch vụ CHƯA CHẮC có quyền xem —
// nếu vậy hàm này trả về null (không ném lỗi), nơi gọi tự xử lý hiển thị "Không tải được ảnh".
async function taiAnhTuLinkDrive(url) {
  const fileId = layFileIdTuLinkDrive(url);
  if (!fileId) return null;
  try {
    const drive = await getDriveClient();
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  } catch (err) {
    console.error('[Drive] Không tải được ảnh (có thể chưa cấp quyền cho service account):', url, '-', err.message);
    return null;
  }
}

module.exports = { getOrCreateFolder, uploadImageBuffer, layFileIdTuLinkDrive, taiAnhTuLinkDrive };
