const { google } = require('googleapis');
const path = require('path');

const SERVICE_ACCOUNT_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

let cachedServiceAccountAuth = null;
let cachedDriveOAuth = null;

/**
 * Service Account:
 * - Dùng cho Google Sheets
 * - Có thể dùng để đọc các file Drive đã được share quyền
 * - KHÔNG dùng để tạo file/folder mới trên My Drive cá nhân
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

/**
 * OAuth Gmail cá nhân:
 * - Dùng cho Drive khi tạo folder/file mới
 * - File được tính vào quota của Gmail thật
 */
async function getDriveAuthClient() {
  if (cachedDriveOAuth) return cachedDriveOAuth;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Thiếu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN trong .env'
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  // Test token ngay lần đầu, tránh tới lúc upload mới phát hiện lỗi.
  const token = await oauth2Client.getAccessToken();

  if (!token || !token.token) {
    throw new Error('Không lấy được access token từ GOOGLE_OAUTH_REFRESH_TOKEN');
  }

  cachedDriveOAuth = oauth2Client;
  return cachedDriveOAuth;
}

module.exports = {
  getAuthClient,
  getDriveAuthClient,
};
