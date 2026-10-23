// Trang "Trợ lý" (chatbot.html) — Trợ lý AI Claude, CHỈ superadmin (23/10/2026). Hội thoại do MÁY CHỦ nhớ (services/troLyAiService.js);
// sessionStorage ở đây chỉ để vẽ lại các dòng đã hỏi khi tải lại trang. "Hội thoại mới" = máy chủ quên hội thoại cũ.
function layLichSuChat() {
  try { return JSON.parse(sessionStorage.getItem('chatbotLichSu') || '[]'); }
  catch (e) { return []; }
}
function luuLichSuChat(ls) {
  try { sessionStorage.setItem('chatbotLichSu', JSON.stringify(ls.slice(-40))); } catch (e) { /* bỏ */ }
}

function themDongChat(vaiTro, noiDung) {
  const el = document.getElementById('chatbot-messages-page');
  const dong = document.createElement('div');
  dong.className = 'chatbot-msg chatbot-' + vaiTro;
  dong.textContent = noiDung; // textContent, KHÔNG dùng innerHTML — chống XSS từ câu trả lời AI
  el.appendChild(dong);
  el.scrollTop = el.scrollHeight;
  return dong;
}

async function guiCauHoiChat(e) {
  e.preventDefault();
  const input = document.getElementById('chatbot-input-page');
  const nutGui = document.getElementById('chatbot-nut-gui');
  const cauHoi = input.value.trim();
  if (!cauHoi) return;
  input.value = '';
  input.disabled = true;
  nutGui.disabled = true;
  nutGui.innerHTML = icon('spinner', { className: 'icon-spin' });

  themDongChat('user', cauHoi);
  const lichSu = layLichSuChat();
  lichSu.push({ role: 'user', content: cauHoi });

  const dongDangTra = themDongChat('bot', '');
  dongDangTra.innerHTML = '<span class="dang-go-cham"><span></span><span></span><span></span></span>'; // markup tĩnh do ta viết sẵn, an toàn
  dongDangTra.classList.add('chatbot-dang-go');

  try {
    const res = await apiFetch('/chatbot/hoi', { method: 'POST', body: JSON.stringify({ cauHoi }) });
    const traLoi = (res.moiBatDau && !res.loi ? '(Hội thoại mới — câu trước đã quá 20 lượt hoặc quá 2 giờ)\n' : '') + res.traLoi;
    dongDangTra.textContent = traLoi;
    dongDangTra.classList.remove('chatbot-dang-go');
    if (res.loi) dongDangTra.classList.add('chatbot-loi');
    lichSu.push({ role: 'assistant', content: traLoi });
    luuLichSuChat(lichSu);
  } catch (err) {
    dongDangTra.textContent = 'Lỗi: ' + err.message;
    dongDangTra.classList.remove('chatbot-dang-go');
    dongDangTra.classList.add('chatbot-loi');
  } finally {
    input.disabled = false;
    nutGui.disabled = false;
    nutGui.innerHTML = icon('send') + ' Gửi';
    input.focus();
  }
}

async function batDauHoiThoaiMoi() {
  try { await apiFetch('/chatbot/moi', { method: 'POST' }); } catch (e) { /* lần hỏi sau máy chủ vẫn tự xử lý */ }
  luuLichSuChat([]);
  document.getElementById('chatbot-messages-page').innerHTML = '';
  themDongChat('bot', 'Đã bắt đầu hội thoại mới. Hỏi tôi về đơn hàng, tracking, việc cần xử lý, tình hình mạng...');
  document.getElementById('chatbot-input-page').focus();
}

function initChatbotPage() {
  document.getElementById('chatbot-form-page').onsubmit = guiCauHoiChat;
  document.getElementById('chatbot-nut-gui').innerHTML = icon('send') + ' Gửi';
  document.getElementById('chatbot-nut-moi').onclick = batDauHoiThoaiMoi;

  const lichSu = layLichSuChat();
  if (lichSu.length === 0) {
    themDongChat('bot', 'Xin chào! Hỏi tôi về đơn hàng, tracking, việc cần xử lý, tình hình mạng... Tôi nhớ các câu hỏi trước trong cùng hội thoại.');
  } else {
    lichSu.forEach(m => themDongChat(m.role === 'user' ? 'user' : 'bot', m.content));
  }

  document.getElementById('chatbot-input-page').focus();
}
