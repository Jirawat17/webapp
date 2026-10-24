// Hỏi Trợ lý AI qua Telegram (23/10/2026, theo yêu cầu người dùng). Người dùng chốt: bot RIÊNG cho AI (token nhập ở Settings), CHỈ trả lời
// đúng 1 tài khoản Telegram đã liên kết (của superadmin), với quyền superadmin; người lạ nhắn -> im lặng bỏ qua.
// Nhận tin bằng long polling (getUpdates) — không cần mở cổng / webhook. Mỗi bot chỉ 1 chương trình được getUpdates: bot đang gắn
// webhook hoặc chạy ở nơi khác -> Telegram trả 409, hiện lỗi ở Settings (không tự gỡ webhook của bot).
// Liên kết: Settings tạo mã 6 số (hiệu lực 10 phút, trong bộ nhớ) -> nhắn "/lienket <mã>" cho bot -> lưu ID Telegram + tên tài khoản app.
// Lệnh: /moi (bắt đầu hội thoại mới), /start (hướng dẫn). Lưu ở cai_dat_van_hanh: TG_AI_TOKEN, TG_AI_USER_ID, TG_AI_APP_USER.
const crypto = require('crypto');
const caiDat = require('./caiDatDbService');
const troLy = require('./troLyAiService');
const taiKhoanService = require('./taiKhoanService');

const API = 'https://api.telegram.org';
const MA_HIEU_LUC_MS = 10 * 60 * 1000;
const DO_DAI_TIN = 3900; // Telegram tối đa 4096 ký tự / tin

const _tt = { dangChay: false, token: '', offset: 0, loi: '', botTen: '', lanNhanCuoi: '' };
let _maLienKet = null; // { ma, appUser, het }

function cauHinh() {
  const c = caiDat.layCaiDatVanHanh();
  return { token: c.TG_AI_TOKEN || '', userId: c.TG_AI_USER_ID || '', appUser: c.TG_AI_APP_USER || '' };
}

async function goi(token, phuongThuc, body, msChoToiDa = 20000) {
  const res = await fetch(`${API}/bot${token}/${phuongThuc}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(msChoToiDa),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.description || `HTTP ${res.status}`), { ma: j.error_code || res.status });
  return j.result;
}

// Gửi chữ thường (không parse_mode — không phải thoát ký tự), tự cắt tin dài.
async function guiChu(token, chatId, chu) {
  const s = String(chu || '(trống)');
  for (let i = 0; i < s.length; i += DO_DAI_TIN) await goi(token, 'sendMessage', { chat_id: chatId, text: s.slice(i, i + DO_DAI_TIN) });
}

async function xuLyTin(token, m) {
  if (!m || !m.text || !m.chat || m.chat.type !== 'private' || !m.from) return;
  const ch = cauHinh(), tuId = String(m.from.id), chu = m.text.trim();
  _tt.lanNhanCuoi = new Date().toISOString();

  const lk = chu.match(/^\/lienket(?:@\w+)?\s+(\d{6})$/);
  if (lk) {
    if (!_maLienKet || Date.now() > _maLienKet.het || !crypto.timingSafeEqual(Buffer.from(lk[1]), Buffer.from(_maLienKet.ma))) return; // sai / hết hạn: im lặng
    caiDat.datCaiDatVanHanh({ TG_AI_USER_ID: tuId, TG_AI_APP_USER: _maLienKet.appUser });
    console.log(`[TelegramAI] Đã liên kết Telegram ${tuId} với tài khoản ${_maLienKet.appUser}.`);
    _maLienKet = null;
    await guiChu(token, m.chat.id, 'Đã liên kết. Gửi câu hỏi bất kỳ cho Trợ lý AI; gõ /moi để bắt đầu hội thoại mới.');
    return;
  }
  if (!ch.userId || tuId !== ch.userId) return; // người lạ: im lặng

  const tk = taiKhoanService.layTheoTen(ch.appUser);
  if (!tk || tk.VaiTro !== 'superadmin' || String(tk.KichHoat).toUpperCase() !== 'TRUE') {
    await guiChu(token, m.chat.id, `Tài khoản app "${ch.appUser}" không còn là superadmin đang hoạt động — liên kết lại ở Settings.`);
    return;
  }
  const khoa = 'tg:' + tuId;
  if (/^\/(moi|new)\b/.test(chu)) { troLy.batDauLai(khoa); await guiChu(token, m.chat.id, 'Đã bắt đầu hội thoại mới.'); return; }
  if (/^\/start\b/.test(chu)) { await guiChu(token, m.chat.id, 'Gửi câu hỏi về đơn hàng, tracking, việc cần xử lý, mạng... Gõ /moi để bắt đầu hội thoại mới.'); return; }

  // "đang soạn..." — Telegram tự tắt sau ~5 giây nên nhắc lại tới khi có câu trả lời.
  const danhMay = () => goi(token, 'sendChatAction', { chat_id: m.chat.id, action: 'typing' }).catch(() => {});
  danhMay();
  const hen = setInterval(danhMay, 4500);
  let kq;
  try { kq = await troLy.hoi({ user: { ten: tk.Ten, vaiTro: tk.VaiTro, xuong: '' }, cauHoi: chu, khoa, nguon: 'telegram' }); }
  finally { clearInterval(hen); }
  await guiChu(token, m.chat.id, (kq.moiBatDau && !kq.loi ? '(Hội thoại mới)\n' : '') + kq.traLoi);
}

async function vongNhan() {
  for (;;) {
    const { token } = cauHinh();
    if (!token) { _tt.token = ''; _tt.botTen = ''; _tt.loi = ''; await new Promise(r => setTimeout(r, 30000)); continue; }
    if (token !== _tt.token) { _tt.token = token; _tt.offset = 0; _tt.botTen = ''; }
    try {
      if (!_tt.botTen) _tt.botTen = (await goi(token, 'getMe')).username || '';
      const ds = await goi(token, 'getUpdates', { offset: _tt.offset, timeout: 50, allowed_updates: ['message'] }, 65000);
      _tt.loi = '';
      for (const u of ds) {
        _tt.offset = u.update_id + 1;
        xuLyTin(token, u.message).catch(err => console.error('[TelegramAI] Lỗi xử lý tin:', err.message));
      }
    } catch (err) {
      _tt.loi = err.ma === 409 ? 'Bot đang được chương trình khác nhận tin (webhook / getUpdates) — dùng bot riêng cho Trợ lý AI.'
        : err.ma === 401 ? 'Bot token không đúng.' : `Lỗi kết nối Telegram: ${err.message}`;
      if (err.ma === 401) _tt.botTen = '';
      await new Promise(r => setTimeout(r, err.ma === 409 || err.ma === 401 ? 60000 : 10000));
    }
  }
}

function batDau() {
  if (_tt.dangChay) return;
  _tt.dangChay = true;
  vongNhan().catch(err => { _tt.dangChay = false; console.error('[TelegramAI] Vòng nhận tin dừng:', err.message); });
  console.log('[TelegramAI] Đã bật nhận câu hỏi Trợ lý AI qua Telegram (chỉ chạy khi có bot token ở Settings).');
}

// ---- Settings (CHỈ superadmin) ----
function trangThai() {
  const ch = cauHinh();
  return { coToken: !!ch.token, tokenCuoi: ch.token ? ch.token.slice(-4) : '', botTen: _tt.botTen, loi: _tt.loi,
    daLienKet: !!ch.userId, telegramId: ch.userId, appUser: ch.appUser, lanNhanCuoi: _tt.lanNhanCuoi,
    maDangCho: _maLienKet && Date.now() < _maLienKet.het ? { ma: _maLienKet.ma, het: new Date(_maLienKet.het).toISOString() } : null };
}
// token: '' / undefined = giữ; null = xoá (kèm huỷ liên kết).
function luuToken(token) {
  if (token === null) { caiDat.datCaiDatVanHanh({ TG_AI_TOKEN: '', TG_AI_USER_ID: '', TG_AI_APP_USER: '' }); return; }
  if (!token) return;
  if (!/^\d{5,}:[\w-]{30,}$/.test(String(token).trim())) throw new Error('Bot token không đúng dạng (vd 123456789:AAE...)');
  caiDat.datCaiDatVanHanh({ TG_AI_TOKEN: String(token).trim(), TG_AI_USER_ID: '', TG_AI_APP_USER: '' }); // bot mới -> liên kết lại
}
function taoMaLienKet(appUser) {
  _maLienKet = { ma: String(crypto.randomInt(100000, 1000000)), appUser, het: Date.now() + MA_HIEU_LUC_MS };
  return trangThai();
}
function huyLienKet() { caiDat.datCaiDatVanHanh({ TG_AI_USER_ID: '', TG_AI_APP_USER: '' }); }

// Tin hệ thống tự gửi (24/10/2026 — tóm tắt buổi sáng, báo cáo tuần theo người): chỉ tới đúng tài khoản Telegram đã liên kết.
// -> { ok, loi }. Chat riêng với bot có chat_id = ID người dùng.
async function guiRieng(chu) {
  const ch = cauHinh();
  if (!ch.token || !ch.userId) return { ok: false, loi: 'Chưa có bot Trợ lý AI hoặc chưa liên kết Telegram (Settings > Trợ lý AI).' };
  try { await guiChu(ch.token, ch.userId, chu); return { ok: true }; }
  catch (err) { return { ok: false, loi: 'Gửi Telegram lỗi: ' + err.message }; }
}
// Tài khoản app (superadmin, đang hoạt động) đã liên kết — tin tự gửi dùng quyền của tài khoản này. null = không dùng được.
function nguoiLienKet() {
  const ch = cauHinh();
  const tk = ch.userId ? taiKhoanService.layTheoTen(ch.appUser) : null;
  return tk && tk.VaiTro === 'superadmin' && String(tk.KichHoat).toUpperCase() === 'TRUE' ? { ten: tk.Ten, vaiTro: tk.VaiTro, xuong: '' } : null;
}

module.exports = { batDau, trangThai, luuToken, taoMaLienKet, huyLienKet, guiRieng, nguoiLienKet, _xuLyTin: xuLyTin };
