const { google } = require('googleapis');
const path = require('path');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

let cachedAuth = null;

// Dùng chung 1 auth client cho cả Sheets và Drive, tránh khởi tạo lại mỗi lần gọi
async function getAuthClient() {
  if (cachedAuth) return cachedAuth;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) {
    throw new Error('Thiếu GOOGLE_SERVICE_ACCOUNT_KEY_PATH trong file .env');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(keyPath),
    scopes: SCOPES,
  });

  cachedAuth = await auth.getClient();
  return cachedAuth;
}

module.exports = { getAuthClient };
