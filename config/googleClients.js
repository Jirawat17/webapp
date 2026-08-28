const { google } = require('googleapis');
const path = require('path');

const SERVICE_ACCOUNT_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

let cachedServiceAccountAuth = null;

/**
 * Service Account:
 * - Dùng cho Google Sheets
 * - Dùng để đọc các file Drive cũ đã được share quyền (ảnh lịch sử trước khi chuyển sang MinIO)
 */
async function getAuthClient() {
  if (cachedServiceAccountAuth) return cachedServiceAccountAuth;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

  if (!keyPath) {
    throw new Error(
      'Thiếu GOOGLE_SERVICE_ACCOUNT_KEY_PATH trong file .env'
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(keyPath),
    scopes: SERVICE_ACCOUNT_SCOPES,
  });

  cachedServiceAccountAuth = await auth.getClient();
  return cachedServiceAccountAuth;
}

module.exports = {
  getAuthClient,
};
