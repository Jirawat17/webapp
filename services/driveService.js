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

module.exports = { getOrCreateFolder, uploadImageBuffer };
