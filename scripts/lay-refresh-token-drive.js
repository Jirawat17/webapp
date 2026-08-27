// scripts/lay-refresh-token-drive.js
//
// CHẠY 1 LẦN DUY NHẤT — trên máy TÍNH CÁ NHÂN có trình duyệt (KHÔNG chạy trên VPS, vì cần mở trình
// duyệt để đăng nhập Google). Mục đích: lấy "refresh_token" cho phép server sau này tạo file mới
// trên Drive BẰNG CHÍNH TÀI KHOẢN GMAIL CÁ NHÂN của bạn (không phải service account) — vì service
// account không có dung lượng lưu trữ Drive riêng, xem giải thích trong config/googleClients.js.
//
// CHUẨN BỊ TRƯỚC KHI CHẠY (làm trên Google Cloud Console, cùng project đang chứa service account):
//   1. Vào "APIs & Services" → "OAuth consent screen":
//      - Chọn "External", điền tên app bất kỳ (vd "HanhPhuc99 Drive Upload").
//      - Ở mục "Test users", thêm ĐÚNG địa chỉ Gmail cá nhân bạn muốn dùng để lưu ảnh.
//   2. Vào "APIs & Services" → "Credentials" → "Create Credentials" → "OAuth client ID":
//      - Application type: chọn "Web application".
//      - Ở "Authorized redirect URIs", thêm CHÍNH XÁC: http://localhost:4321/oauth2callback
//      - Bấm Create — Google cho ra "Client ID" và "Client secret", copy lại 2 giá trị này.
//   3. Đảm bảo API "Google Drive API" đã được BẬT (Enable) trong project (APIs & Services → Library).
//
// CÁCH CHẠY:
//   GOOGLE_OAUTH_CLIENT_ID="..." GOOGLE_OAUTH_CLIENT_SECRET="..." node scripts/lay-refresh-token-drive.js
//   (dán đúng Client ID / Client secret vừa lấy ở bước 2 vào 2 chỗ "...")
//
// Script sẽ in ra 1 đường link — mở link đó trên trình duyệt, đăng nhập ĐÚNG Gmail cá nhân đã thêm ở
// bước "Test users", bấm "Cho phép". Trình duyệt sẽ tự quay lại localhost và script tự in ra
// "refresh_token" — copy dòng đó dán vào file .env trên VPS (biến GOOGLE_OAUTH_REFRESH_TOKEN), cùng
// với GOOGLE_OAUTH_CLIENT_ID và GOOGLE_OAUTH_CLIENT_SECRET đã dùng ở trên.
//
// Sau bước này KHÔNG cần chạy lại script nữa (trừ khi bạn tự thu hồi quyền truy cập trong phần
// "Ứng dụng của bên thứ ba có quyền truy cập tài khoản" của tài khoản Google đó).

const http = require('http');
const { google } = require('googleapis');

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/drive'];

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nThiếu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.');
  console.error('Chạy lại theo đúng cú pháp ở đầu file này (mục "CÁCH CHẠY").\n');
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline', // bắt buộc để Google trả về refresh_token, không chỉ access_token tạm thời
  prompt: 'consent',      // bắt buộc hỏi lại quyền mỗi lần — đảm bảo LUÔN nhận được refresh_token (nếu bỏ, lần chạy thứ 2 trở đi có thể không có)
  scope: SCOPES,
});

console.log('\n1. Mở đường link sau trên trình duyệt (đăng nhập ĐÚNG Gmail cá nhân bạn muốn dùng để lưu ảnh):\n');
console.log(authUrl + '\n');
console.log(`2. Đang chờ Google chuyển hướng về http://localhost:${PORT}/oauth2callback ...\n`);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) { res.end(); return; }

  const code = new URL(req.url, REDIRECT_URI).searchParams.get('code');
  if (!code) {
    res.end('Không nhận được mã xác thực. Đóng tab này và thử lại.');
    return;
  }

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    res.end('Đã lấy được refresh token! Quay lại cửa sổ dòng lệnh (terminal) để xem kết quả. Có thể đóng tab này.');

    console.log('\n===== THÀNH CÔNG — dán 3 dòng sau vào file .env trên VPS =====\n');
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n================================================================\n');

    if (!tokens.refresh_token) {
      console.log('CẢNH BÁO: không thấy refresh_token trong kết quả trả về — thường do tài khoản này đã');
      console.log('từng cấp quyền cho app này trước đó. Vào https://myaccount.google.com/permissions,');
      console.log('gỡ quyền truy cập của app vừa tạo, rồi chạy lại script này từ đầu.\n');
    }
  } catch (err) {
    res.end('Lỗi khi đổi mã lấy token: ' + err.message);
    console.error('\nLỗi khi đổi mã lấy token:', err.message, '\n');
  }

  setTimeout(() => { server.close(); process.exit(0); }, 500);
});

server.listen(PORT);
