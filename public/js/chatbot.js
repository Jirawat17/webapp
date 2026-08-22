(function () {
  function layLichSu() {
    try { return JSON.parse(sessionStorage.getItem('chatbotLichSu') || '[]'); }
    catch (e) { return []; }
  }
  function luuLichSu(ls) {
    sessionStorage.setItem('chatbotLichSu', JSON.stringify(ls.slice(-12)));
  }

  function themDong(vaiTro, noiDung) {
    const el = document.getElementById('chatbot-messages');
    const dong = document.createElement('div');
    dong.className = 'chatbot-msg chatbot-' + vaiTro;
    dong.textContent = noiDung; // textContent, KHÔNG dùng innerHTML — chống XSS từ câu trả lời LLM
    el.appendChild(dong);
    el.scrollTop = el.scrollHeight;
    return dong;
  }

  function hienLaiLichSu() {
    layLichSu().forEach(m => themDong(m.role === 'user' ? 'user' : 'bot', m.content));
  }

  async function guiCauHoi(e) {
    e.preventDefault();
    const input = document.getElementById('chatbot-input');
    const cauHoi = input.value.trim();
    if (!cauHoi) return;
    input.value = '';
    input.disabled = true;

    themDong('user', cauHoi);
    const lichSu = layLichSu();
    lichSu.push({ role: 'user', content: cauHoi });

    const dongDangTra = themDong('bot', 'Đang trả lời...');
    dongDangTra.classList.add('chatbot-dang-go');

    try {
      const res = await apiFetch('/chatbot/hoi', {
        method: 'POST',
        body: JSON.stringify({ cauHoi, lichSuHoiThoai: lichSu.slice(0, -1) }),
      });
      dongDangTra.textContent = res.traLoi;
      dongDangTra.classList.remove('chatbot-dang-go');
      lichSu.push({ role: 'assistant', content: res.traLoi });
      luuLichSu(lichSu);
    } catch (err) {
      dongDangTra.textContent = 'Lỗi: ' + err.message;
      dongDangTra.classList.remove('chatbot-dang-go');
      dongDangTra.classList.add('chatbot-loi');
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  function themWidget() {
    const wrap = document.createElement('div');
    wrap.id = 'chatbot-wrap';
    wrap.innerHTML = `
      <button id="chatbot-toggle" aria-label="Mở trợ lý xưởng thêu" aria-expanded="false">
        ${icon('chat', { size: 26 })}
      </button>
      <div id="chatbot-panel" role="dialog" aria-label="Trợ lý xưởng thêu" hidden>
        <div id="chatbot-header">
          <span>${icon('chat', { size: 18 })} Trợ lý xưởng thêu</span>
          <button id="chatbot-close" class="icon-btn" aria-label="Đóng cửa sổ chat">${icon('close', { size: 18 })}</button>
        </div>
        <div id="chatbot-messages"></div>
        <form id="chatbot-form">
          <label for="chatbot-input" class="sr-only">Nhập câu hỏi cho trợ lý</label>
          <input id="chatbot-input" placeholder="Hỏi về đơn hàng, deadline, số lượng..." autocomplete="off">
          <button type="submit" class="icon-btn" aria-label="Gửi câu hỏi">${icon('send', { size: 18 })}</button>
        </form>
      </div>`;
    document.body.appendChild(wrap);

    const panel = document.getElementById('chatbot-panel');
    const toggleBtn = document.getElementById('chatbot-toggle');

    toggleBtn.onclick = () => {
      const dangMo = !panel.hidden;
      panel.hidden = dangMo;
      toggleBtn.setAttribute('aria-expanded', String(!dangMo));
      if (!dangMo) document.getElementById('chatbot-input').focus();
    };
    document.getElementById('chatbot-close').onclick = () => {
      panel.hidden = true;
      toggleBtn.setAttribute('aria-expanded', 'false');
    };
    document.getElementById('chatbot-form').onsubmit = guiCauHoi;

    if (layLichSu().length === 0) {
      themDong('bot', 'Xin chào! Hỏi tôi về đơn hàng, deadline, hoặc trạng thái sản xuất nhé.');
    } else {
      hienLaiLichSu();
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const user = await apiFetch('/auth/hien-tai');
      if (user) themWidget();
    } catch (e) { /* chưa đăng nhập — không hiện widget */ }
  });
})();
