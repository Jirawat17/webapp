const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Mỗi tầng cảnh báo gửi tới 1 chat_id riêng (có thể trỏ cùng 1 group cho tất cả nếu muốn)
const CHAT_ID_THEO_MUC = {
  VANG: process.env.TELEGRAM_CHATID_VANG,
  CAM: process.env.TELEGRAM_CHATID_CAM,
  DO: process.env.TELEGRAM_CHATID_DO,
  NHAC_SHIP: process.env.TELEGRAM_CHATID_DONGGOI,
};

const NHAN_MUC = { VANG: '🟡 VÀNG', CAM: '🟠 CAM', DO: '🔴 ĐỎ', NHAC_SHIP: '📦 NHẮC SHIP' };

function guiTinNhan(chatId, text) {
  if (!BOT_TOKEN || !chatId) {
    console.log('[Telegram] Bỏ qua gửi tin — thiếu BOT_TOKEN hoặc chat_id.');
    return Promise.resolve();
  }

  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) console.error('[Telegram] Lỗi gửi tin:', res.statusCode, raw);
        resolve();
      });
    });
    req.on('error', (err) => { console.error('[Telegram] Lỗi kết nối:', err.message); resolve(); });
    req.write(body);
    req.end();
  });
}

async function guiCanhBao(muc, don) {
  const text =
    `${NHAN_MUC[muc] || muc} — Đơn <b>${don.STT_Key}</b>\n` +
    `Sản phẩm: ${don.Ten_San_Pham || ''}\n` +
    `Khách hàng: ${don.Ten_KH || ''}\n` +
    `Trạng thái: ${don.Trang_Thai || ''}\n` +
    `Ngày đặt: ${don.Ngay_Dat || ''}`;

  await guiTinNhan(CHAT_ID_THEO_MUC[muc], text);
}

module.exports = { guiCanhBao };
