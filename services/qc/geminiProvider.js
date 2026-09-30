// Gemini Provider cho AI QC (30/09/2026, theo yêu cầu người dùng) — gọi THẲNG REST Google Generative Language API
// (generateContent), không qua SDK (không thêm dependency) và không qua cổng LLM của Chatbot. API key + model do
// superadmin nhập ở menu QC (caiDatDbService.js#layCauHinhQc). Trả JSON có cấu trúc qua responseSchema.
const DIA_CHI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const THOI_GIAN_CHO_MS = 90 * 1000;

// Schema dạng JSON Schema chung (type chữ thường, nullable) -> dạng Gemini (type CHỮ HOA). Chỉ đổi `type`, giữ nguyên phần khác.
function sangSchemaGemini(s) {
  if (Array.isArray(s)) return s.map(sangSchemaGemini);
  if (!s || typeof s !== 'object') return s;
  const kq = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type' && typeof v === 'string') kq.type = v.toUpperCase();
    else if (k === 'properties') kq.properties = Object.fromEntries(Object.entries(v).map(([ten, con]) => [ten, sangSchemaGemini(con)]));
    else if (k === 'items') kq.items = sangSchemaGemini(v);
    else kq[k] = v;
  }
  return kq;
}

// Lỗi có loiApi: true — lỗi gọi API (key sai, model không tồn tại, hết quota, mạng...), khác lỗi nghiệp vụ QC.
const loiApi = thongBao => Object.assign(new Error(thongBao), { loiApi: true });

async function goi({ apiKey, model, body }) {
  if (!apiKey) throw loiApi('Chưa nhập API key Gemini ở menu QC.');
  if (!model) throw loiApi('Chưa chọn model Gemini ở menu QC.');
  const controller = new AbortController();
  const hen = setTimeout(() => controller.abort(), THOI_GIAN_CHO_MS);
  let res;
  try {
    res = await fetch(`${DIA_CHI_API}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw loiApi(err.name === 'AbortError' ? `Gemini quá thời gian chờ (${THOI_GIAN_CHO_MS / 1000}s).` : `Lỗi kết nối tới Gemini: ${err.message}`);
  } finally {
    clearTimeout(hen);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw loiApi(`Gemini trả về dữ liệu không hợp lệ (HTTP ${res.status}).`); }
  if (!res.ok) throw loiApi(`Gemini báo lỗi (HTTP ${res.status}${data.error && data.error.status ? ' ' + data.error.status : ''}): ${(data.error && data.error.message) || text.slice(0, 200)}`);
  if (data.promptFeedback && data.promptFeedback.blockReason) throw loiApi(`Gemini từ chối xử lý (${data.promptFeedback.blockReason}).`);
  const ungVien = (data.candidates || [])[0];
  const traLoi = ungVien && ungVien.content && (ungVien.content.parts || []).map(p => p.text || '').join('');
  if (!traLoi) throw loiApi(`Gemini không trả nội dung (finishReason: ${(ungVien && ungVien.finishReason) || 'không rõ'}).`);
  return traLoi;
}

// anh: [{ mime, data: Buffer, ten }] — mỗi ảnh kèm 1 dòng tên ngay trước để model tham chiếu đúng file.
// -> object JSON đã parse (throw loiApi nếu không parse được).
async function phanTichAnh({ apiKey, model, prompt, anh = [], schema }) {
  const parts = [{ text: prompt }];
  for (const a of anh) {
    parts.push({ text: `Ảnh: ${a.ten}` });
    parts.push({ inline_data: { mime_type: a.mime, data: a.data.toString('base64') } });
  }
  const traLoi = await goi({
    apiKey, model,
    body: {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(schema ? { responseSchema: sangSchemaGemini(schema) } : {}) },
    },
  });
  try {
    return JSON.parse(traLoi);
  } catch (e) {
    throw loiApi(`Gemini trả về không phải JSON hợp lệ: ${traLoi.slice(0, 200)}`);
  }
}

// "Thử kết nối" ở menu QC — 1 lượt gọi nhỏ, chỉ kiểm tra key + model dùng được.
async function thuKetNoi({ apiKey, model }) {
  // Không đặt maxOutputTokens: model 2.5 dùng chung hạn mức cho bước "suy nghĩ" -> hạn thấp có thể trả rỗng, báo lỗi oan.
  await goi({ apiKey, model, body: { contents: [{ role: 'user', parts: [{ text: 'Trả lời đúng 1 chữ: OK' }] }] } });
}

module.exports = { phanTichAnh, thuKetNoi, sangSchemaGemini };
