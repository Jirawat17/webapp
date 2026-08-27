// scripts/lay-refresh-token-drive.js
//
// Chạy 1 lần trên máy có trình duyệt.
// Google Cloud OAuth Client phải có redirect URI:
// http://localhost:3001/oauth2callback

const http = require('http');
const { google } = require('googleapis');

const PORT = 3001;
const REDIRECT_URI =
  `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
];

const CLIENT_ID =
  process.env.GOOGLE_OAUTH_CLIENT_ID;

const CLIENT_SECRET =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('');
  console.error(
    'Thiếu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.'
  );
  console.error('');
  console.error('Ví dụ:');
  console.error(
    'GOOGLE_OAUTH_CLIENT_ID="..." GOOGLE_OAUTH_CLIENT_SECRET="..." node scripts/lay-refresh-token-drive.js'
  );
  console.error('');
  process.exit(1);
}

const oauth2Client =
  new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

const authUrl =
  oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

console.log('');
console.log('==================================================');
console.log('GOOGLE DRIVE OAUTH REFRESH TOKEN TOOL');
console.log('==================================================');
console.log('');
console.log('Redirect URI:');
console.log(REDIRECT_URI);
console.log('');
console.log('Mở URL này trong Chrome:');
console.log('');
console.log(authUrl);
console.log('');
console.log('==================================================');

const server =
  http.createServer(async (req, res) => {
    const url =
      new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404, {
        'Content-Type':
          'text/plain; charset=utf-8',
      });
      res.end('Not found');
      return;
    }

    const oauthError =
      url.searchParams.get('error');

    if (oauthError) {
      res.writeHead(400, {
        'Content-Type':
          'text/plain; charset=utf-8',
      });
      res.end(
        'Google OAuth error: ' + oauthError
      );

      console.error(
        'Google OAuth error:',
        oauthError
      );

      return;
    }

    const code =
      url.searchParams.get('code');

    if (!code) {
      res.writeHead(400, {
        'Content-Type':
          'text/plain; charset=utf-8',
      });
      res.end(
        'Không nhận được authorization code.'
      );
      return;
    }

    try {
      const { tokens } =
        await oauth2Client.getToken(code);

      oauth2Client.setCredentials(tokens);

      const drive = google.drive({
        version: 'v3',
        auth: oauth2Client,
      });

      const about =
        await drive.about.get({
          fields:
            'user(emailAddress,displayName),storageQuota',
        });

      console.log('');
      console.log('==================================================');
      console.log('GOOGLE OAUTH SUCCESS');
      console.log('==================================================');
      console.log('');
      console.log(
        'Authenticated user:',
        about.data.user
      );
      console.log('');
      console.log(
        'Storage quota:',
        about.data.storageQuota
      );
      console.log('');

      if (!tokens.refresh_token) {
        throw new Error(
          'Google không trả refresh_token. Hãy revoke quyền OAuth của app trong Google Account rồi chạy lại.'
        );
      }

      console.log('Dán 3 dòng sau vào .env trên VPS:');
      console.log('');
      console.log(
        `GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}`
      );
      console.log(
        `GOOGLE_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}`
      );
      console.log(
        `GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`
      );
      console.log('');
      console.log('==================================================');

      res.writeHead(200, {
        'Content-Type':
          'text/html; charset=utf-8',
      });

      res.end(`
        <h2>OAuth thành công</h2>
        <p>Tài khoản: <b>${about.data.user?.emailAddress || ''}</b></p>
        <p>Refresh token đã được in trong terminal.</p>
        <p>Có thể đóng tab này.</p>
      `);

      setTimeout(() => {
        server.close();
      }, 500);
    } catch (err) {
      console.error(
        'OAuth callback error:',
        err
      );

      res.writeHead(500, {
        'Content-Type':
          'text/plain; charset=utf-8',
      });

      res.end(
        'OAuth failed: ' +
        (err.message || String(err))
      );
    }
  });

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log(
    `Đang chờ callback tại ${REDIRECT_URI}`
  );
});
