const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { ghiLog } = require('../services/logService');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

const LLM_URL = process.env.LLM_API_URL;
const LLM_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash-lite';
const LLM_MODEL_MANH = process.env.LLM_MODEL_MANH; // tuỳ chọn — model mạnh hơn cho câu hỏi phức tạp

// Giữ đúng quy ước quota cũ: câu hỏi có từ khoá "phân tích/tổng hợp..." mới dùng model mạnh hơn (nếu có cấu hình)
const TU_KHOA_PHUC_TAP = ['phân tích', 'tổng hợp', 'so sánh', 'dự đoán', 'đánh giá'];

// Rút gọn dữ liệu đơn hàng thành ngữ cảnh cho LLM — chỉ lấy cột cần thiết, giới hạn số dòng để không vượt token
function taoBoiCanh(rows) {
  const rutGon = rows.slice(0, 200).map(r => ({
    ma: r.STT_Key,
    kh: r.Ten_KH,
    sp: r.Ten_San_Pham,
    sl: r.So_Luong,
    ngayDat: r.Ngay_Dat,
    deadline: r.Ngay_Giao_Du_Kien,
    trangThai: r.Trang_Thai,
    team: r.Team_San_Xuat,
    coPhoi: r.Co_Phoi,
    coFile: r.Co_File_Ve,
  }));
  return JSON.stringify(rutGon);
}

router.post('/hoi', async (req, res) => {
  const { cauHoi, lichSuHoiThoai } = req.body;
  const user = req.session.user;

  if (!cauHoi || !cauHoi.trim()) return res.status(400).json({ error: 'Thiếu câu hỏi' });
  if (!LLM_URL || !LLM_KEY) {
    return res.status(500).json({ error: 'Chatbot chưa được cấu hình — thiếu LLM_API_URL hoặc LLM_API_KEY trong .env' });
  }

  const { rows } = await orderService.getAll();
  // Chatbot chỉ trả lời trong phạm vi đơn mà vai trò của user được thấy — không lộ dữ liệu ngoài quyền hạn
  const duLieuChoPhep = orderService.filterForRole(rows, user);
  const boiCanh = taoBoiCanh(duLieuChoPhep);

  const messages = [
    {
      role: 'system',
      content:
        'Bạn là trợ lý của xưởng thêu, trả lời bằng tiếng Việt, ngắn gọn, chỉ dựa trên dữ liệu đơn hàng dạng JSON ' +
        'được cung cấp dưới đây (mỗi đơn có: ma, kh, sp, sl, ngayDat, deadline, trangThai, team, coPhoi, coFile). ' +
        'Không bịa số liệu ngoài dữ liệu này. Nếu không tìm thấy thông tin phù hợp, nói rõ là không có.\n\n' +
        'Dữ liệu:\n' + boiCanh,
    },
    ...(Array.isArray(lichSuHoiThoai) ? lichSuHoiThoai.slice(-6) : []),
    { role: 'user', content: cauHoi },
  ];

  const dungModelManh = LLM_MODEL_MANH && TU_KHOA_PHUC_TAP.some(tk => cauHoi.toLowerCase().includes(tk));

  const llmRes = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: dungModelManh ? LLM_MODEL_MANH : LLM_MODEL,
      messages,
      max_tokens: 600,
    }),
  });

  if (!llmRes.ok) {
    const chiTietLoi = await llmRes.text();
    throw new Error('Lỗi gọi LLM (' + llmRes.status + '): ' + chiTietLoi.slice(0, 200));
  }

  const data = await llmRes.json();
  const traLoi = data.choices?.[0]?.message?.content || 'Xin lỗi, tôi chưa có câu trả lời cho câu hỏi này.';

  await ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CHATBOT_HOI',
    chiTiet: { cauHoi, traLoi: traLoi.slice(0, 300) },
  });

  res.json({ traLoi });
});

module.exports = router;
