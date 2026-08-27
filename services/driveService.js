const { google } = require('googleapis');
const { Readable } = require('stream');
const {
  getAuthClient,
  getDriveAuthClient,
} = require('../config/googleClients');

const ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID;

/**
 * Drive client dùng Service Account.
 * Chỉ dùng cho các thao tác đọc file cũ đã được share.
 */
async function getDriveReadClient() {
  const auth = await getAuthClient();

  return google.drive({
    version: 'v3',
    auth,
  });
}

/**
 * Drive client dùng OAuth Gmail cá nhân.
 * BẮT BUỘC dùng client này khi tạo folder/file mới.
 */
async function getDriveWriteClient() {
  const auth = await getDriveAuthClient();

  return google.drive({
    version: 'v3',
    auth,
  });
}

/**
 * Kiểm tra OAuth Drive hiện đang đăng nhập bằng user nào.
 * Có thể gọi khi debug/startup.
 */
async function getDriveOAuthInfo() {
  const drive = await getDriveWriteClient();

  const result = await drive.about.get({
    fields: 'user(emailAddress,displayName),storageQuota',
  });

  return result.data;
}

/**
 * Tìm folder con theo tên trong folder cha.
 * Nếu chưa tồn tại thì tạo bằng OAuth Gmail cá nhân.
 */
async function getOrCreateFolder(name, parentId = ROOT_FOLDER_ID) {
  if (!parentId) {
    throw new Error('Thiếu DRIVE_ROOT_FOLDER_ID trong .env');
  }

  const drive = await getDriveWriteClient();

  const safeName = String(name).replace(/'/g, "\\'");

  const q =
    `name='${safeName}' and ` +
    `'${parentId}' in parents and ` +
    `mimeType='application/vnd.google-apps.folder' and ` +
    `trashed=false`;

  const list = await drive.files.list({
    q,
    fields: 'files(id,name)',
    spaces: 'drive',
  });

  if (list.data.files && list.data.files.length > 0) {
    return list.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id,name',
  });

  return folder.data.id;
}

/**
 * Upload buffer ảnh từ multer memoryStorage.
 * Tạo file bằng OAuth Gmail cá nhân.
 */
async function uploadImageBuffer(
  buffer,
  fileName,
  folderId,
  mimeType = 'image/jpeg'
) {
  if (!buffer) {
    throw new Error('Buffer ảnh rỗng');
  }

  if (!folderId) {
    throw new Error('Thiếu folderId khi upload Drive');
  }

  const drive = await getDriveWriteClient();

  const stream = Readable.from(buffer);

  const file = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id,name,mimeType,size,webViewLink',
  });

  // Cho phép ai có link cũng xem được.
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return `https://drive.google.com/uc?export=view&id=${file.data.id}`;
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
 * Đọc bytes của ảnh Drive.
 *
 * Giữ Service Account cho tương thích với các file cũ đã share.
 * Nếu cần đọc file mới do Gmail OAuth tạo, file đã được set anyone-reader
 * nên phần hiển thị public vẫn hoạt động; trường hợp tải bằng API mà SA không
 * có quyền thì trả null như behavior cũ.
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
  getOrCreateFolder,
  uploadImageBuffer,
  layFileIdTuLinkDrive,
  taiAnhTuLinkDrive,
  getDriveOAuthInfo,
};
