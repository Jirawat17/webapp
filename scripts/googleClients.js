const { google } = require('googleapis');
const path = require('path');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

let cachedAuth = null;

// Dùng CHUNG 1 auth client (service account) cho Sheets VÀ cho các thao tác Drive KHÔNG tạo file
// mới (đọc, tạo permission trên file đã tồn tại...).
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

let cachedDriveOAuth = null;

// Auth RIÊNG cho việc TẠO FILE MỚI trên Drive (routes/photos.js -> services/driveService.js).
// LÝ DO CẦN TÁCH RIÊNG (bổ sung 26/08/2026): Service Account không có dung lượng lưu trữ Drive
// riêng (0 byte) — mọi lần drive.files.create() bằng auth service account sẽ bị Google từ chối với
// lỗi "Service Accounts do not have storage quota..." NGAY CẢ KHI thư mục đích đã share quyền
// Editor cho service account (Google đổi hành vi này từ ~2020, file luôn được coi là "của" service
// account, không tính vào quota của chủ thư mục nữa). 2 cách Google đề xuất để sửa: (1) Shared
// Drive — CHỈ có ở Google Workspace, người dùng hiện dùng Gmail cá nhân nên không có; (2) OAuth
// delegation — dùng OAuth2 với chính tài khoản Gmail thật, file tạo ra sẽ tính vào quota của tài
// khoản đó (bình thường, không có gì đặc biệt). Đây là lựa chọn (2), refresh token lấy 1 LẦN DUY
// NHẤT bằng scripts/lay-refresh-token-drive.js, lưu vào .env, dùng lại mãi về sau (không cần đăng
// nhập lại trừ khi tự thu hồi quyền truy cập trong tài khoản Google).
// Sheets KHÔNG bị ảnh hưởng bởi vấn đề này (vẫn dùng getAuthClient() ở trên) vì đó là SỬA NỘI DUNG
// 1 file đã tồn tại (Google Sheet đã tạo sẵn, share Editor cho service account từ trước) — không
// phải TẠO FILE MỚI nên không đụng tới quota.
async function getDriveAuthClient() {
  if (cachedDriveOAuth) return cachedDriveOAuth;

  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN) {
    throw new Error(
      'Thiếu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN trong .env — ' +
      'chạy `node scripts/lay-refresh-token-drive.js` 1 lần để lấy các giá trị này (xem hướng dẫn trong file đó).'
    );
  }

  const oAuth2Client = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET);
  oAuth2Client.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN });
  cachedDriveOAuth = oAuth2Client;
  return cachedDriveOAuth;
}

module.exports = { getAuthClient, getDriveAuthClient };
