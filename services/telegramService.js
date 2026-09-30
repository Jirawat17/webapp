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

// don ở đây là 1 dòng Sheet gốc (từ orderService.getAll()), có thể kèm thêm TenKhachHang đã gán sẵn
// (xem services/canhBaoJob.js) — dùng đúng tên cột thật, KHÔNG dùng Ten_San_Pham/Ten_KH/Trang_Thai/
// Ngay_Dat (không tồn tại trong Sheet — lỗi cũ khiến tin Telegram gửi ra bị rỗng các dòng này).
async function guiCanhBao(muc, don) {
  const sanPham = [don.LOAI, don.KICH_THUOC, don.MAU_SAC].filter(Boolean).join(' · ');
  const text =
    `${NHAN_MUC[muc] || muc} — Đơn <b>${don.STT_Key}</b>\n` +
    `Sản phẩm: ${sanPham}\n` +
    `Khách hàng: ${don.TenKhachHang || don.MA_KHACH_HANG || ''}\n` +
    `Trạng thái: ${don.TRANG_THAI_XUONG || ''}\n` +
    `Ngày đặt: ${don.NGAY_LEN_DON || ''}`;

  await guiTinNhan(CHAT_ID_THEO_MUC[muc], text);
}

module.exports = { guiCanhBao, guiTinNhan };
