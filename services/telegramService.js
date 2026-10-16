const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Luôn resolve (không reject) -> { ok, loi } — nơi cần biết kết quả (nút "Gửi thử" ở menu QC) đọc, nơi khác bỏ qua.
// botToken: mặc định TELEGRAM_BOT_TOKEN (.env); cảnh báo AI QC truyền token riêng nhập ở menu QC nếu có.
function guiTinNhan(chatId, text, botToken = BOT_TOKEN) {
  if (!botToken || !chatId) {
    console.log('[Telegram] Bỏ qua gửi tin — thiếu BOT_TOKEN hoặc chat_id.');
    return Promise.resolve({ ok: false, loi: !botToken ? 'Chưa có Bot Token Telegram (nhập ở menu QC hoặc TELEGRAM_BOT_TOKEN trong .env).' : 'Chưa có Chat ID.' });
  }

  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          console.error('[Telegram] Lỗi gửi tin:', res.statusCode, raw);
          let moTa = raw.slice(0, 200);
          try { moTa = JSON.parse(raw).description || moTa; } catch (e) { /* giữ raw */ }
          return resolve({ ok: false, loi: `Telegram báo lỗi (HTTP ${res.statusCode}): ${moTa}` });
        }
        resolve({ ok: true });
      });
    });
    req.on('error', (err) => { console.error('[Telegram] Lỗi kết nối:', err.message); resolve({ ok: false, loi: `Lỗi kết nối Telegram: ${err.message}` }); });
    req.write(body);
    req.end();
  });
}

// Gửi 1 file đính kèm (sendDocument) — báo cáo logs hằng ngày (services/baoCaoLogService.js, 15/10/2026). Luôn resolve -> { ok, loi }.
// Telegram nhận file tới 50MB; log server tự cắt ở 5MB (services/logCapture.js) nên dư sức. Lỗi KHÔNG in token (nằm trong URL).
async function guiFile(chatId, tenFile, noiDung, botToken = BOT_TOKEN) {
  if (!botToken || !chatId) return { ok: false, loi: !botToken ? 'Chưa có Bot Token Telegram.' : 'Chưa có Chat ID.' };
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([noiDung]), tenFile);
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
    if (res.ok) return { ok: true };
    const raw = await res.text();
    let moTa = raw.slice(0, 200);
    try { moTa = JSON.parse(raw).description || moTa; } catch (e) { /* giữ raw */ }
    console.error('[Telegram] Lỗi gửi file:', res.status, moTa);
    return { ok: false, loi: `Telegram báo lỗi (HTTP ${res.status}): ${moTa}` };
  } catch (err) {
    console.error('[Telegram] Lỗi kết nối khi gửi file:', err.message);
    return { ok: false, loi: `Lỗi kết nối Telegram: ${err.message}` };
  }
}

module.exports = { guiTinNhan, guiFile };
