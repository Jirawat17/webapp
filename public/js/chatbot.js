// Chatbot giờ là 1 trang riêng (menu "Trợ lý", giống "Đơn hàng"/"Quét QR") — không còn bong bóng nổi
// che nội dung các trang khác. Gọi initChatbotPage() từ chatbot.html sau khi đã renderNav().
function layLichSuChat() {
  try { return JSON.parse(sessionStorage.getItem('chatbotLichSu') || '[]'); }
  catch (e) { return []; }
}
function luuLichSuChat(ls) {
  sessionStorage.setItem('chatbotLichSu', JSON.stringify(ls.slice(-12)));
}

function themDongChat(vaiTro, noiDung) {
  const el = document.getElementById('chatbot-messages-page');
  const dong = document.createElement('div');
  dong.className = 'chatbot-msg chatbot-' + vaiTro;
  dong.textContent = noiDung; // textContent, KHÔNG dùng innerHTML — chống XSS từ câu trả lời LLM
  el.appendChild(dong);
  el.scrollTop = el.scrollHeight;
  return dong;
}

async function guiCauHoiChat(e) {
  e.preventDefault();
  const input = document.getElementById('chatbot-input-page');
  const cauHoi = input.value.trim();
  if (!cauHoi) return;
  input.value = '';
  input.disabled = true;

  themDongChat('user', cauHoi);
  const lichSu = layLichSuChat();
  lichSu.push({ role: 'user', content: cauHoi });

  const dongDangTra = themDongChat('bot', 'Đang trả lời...');
  dongDangTra.classList.add('chatbot-dang-go');

  try {
    const res = await apiFetch('/chatbot/hoi', {
      method: 'POST',
      body: JSON.stringify({ cauHoi, lichSuHoiThoai: lichSu.slice(0, -1) }),
    });
    dongDangTra.textContent = res.traLoi;
    dongDangTra.classList.remove('chatbot-dang-go');
    lichSu.push({ role: 'assistant', content: res.traLoi });
    luuLichSuChat(lichSu);
  } catch (err) {
    dongDangTra.textContent = 'Lỗi: ' + err.message;
    dongDangTra.classList.remove('chatbot-dang-go');
    dongDangTra.classList.add('chatbot-loi');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

function initChatbotPage() {
  document.getElementById('chatbot-form-page').onsubmit = guiCauHoiChat;

  const lichSu = layLichSuChat();
  if (lichSu.length === 0) {
    themDongChat('bot', 'Xin chào! Hỏi tôi về đơn hàng, deadline, hoặc trạng thái sản xuất nhé.');
  } else {
    lichSu.forEach(m => themDongChat(m.role === 'user' ? 'user' : 'bot', m.content));
  }

  document.getElementById('chatbot-input-page').focus();
}
