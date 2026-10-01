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

// Cùng khuôn request/response generateContent cho 2 đường gọi (khác địa chỉ, cùng header x-goog-api-key):
//  - AI Studio / Gemini API:            generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//  - Agent Platform / Vertex AI (01/10/2026, theo yêu cầu người dùng — để dùng credits Google Cloud, vì credits KHÔNG trả được
//    cho Gemini API của AI Studio): aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent (endpoint global,
//    key tạo ở "Get Agent Platform API Key"). Mỗi provider = taoProvider({ ten, diaChiApi }) với tên riêng trong thông báo lỗi.
function taoProvider({ ten, diaChiApi }) {
  async function goi({ apiKey, model, body }) {
    if (!apiKey) throw loiApi(`Chưa nhập API key ${ten} ở menu QC.`);
    if (!model) throw loiApi(`Chưa chọn model ${ten} ở menu QC.`);
    const controller = new AbortController();
    const hen = setTimeout(() => controller.abort(), THOI_GIAN_CHO_MS);
    let res;
    try {
      res = await fetch(`${diaChiApi}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw loiApi(err.name === 'AbortError' ? `${ten} quá thời gian chờ (${THOI_GIAN_CHO_MS / 1000}s).` : `Lỗi kết nối tới ${ten}: ${err.message}`);
    } finally {
      clearTimeout(hen);
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw loiApi(`${ten} trả về dữ liệu không hợp lệ (HTTP ${res.status}).`); }
    // Vertex có thể trả lỗi dạng mảng [{ error: ... }]
    const loi = (Array.isArray(data) ? data[0] && data[0].error : data.error) || null;
    if (!res.ok) throw loiApi(`${ten} báo lỗi (HTTP ${res.status}${loi && loi.status ? ' ' + loi.status : ''}): ${(loi && loi.message) || text.slice(0, 200)}`);
    if (data.promptFeedback && data.promptFeedback.blockReason) throw loiApi(`${ten} từ chối xử lý (${data.promptFeedback.blockReason}).`);
    const ungVien = (data.candidates || [])[0];
    const traLoi = ungVien && ungVien.content && (ungVien.content.parts || []).map(p => p.text || '').join('');
    if (!traLoi) throw loiApi(`${ten} không trả nội dung (finishReason: ${(ungVien && ungVien.finishReason) || 'không rõ'}).`);
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
      throw loiApi(`${ten} trả về không phải JSON hợp lệ: ${traLoi.slice(0, 200)}`);
    }
  }

  // "Thử kết nối" ở menu QC — 1 lượt gọi nhỏ, chỉ kiểm tra key + model dùng được.
  async function thuKetNoi({ apiKey, model }) {
    // Không đặt maxOutputTokens: model 2.5 dùng chung hạn mức cho bước "suy nghĩ" -> hạn thấp có thể trả rỗng, báo lỗi oan.
    await goi({ apiKey, model, body: { contents: [{ role: 'user', parts: [{ text: 'Trả lời đúng 1 chữ: OK' }] }] } });
  }

  return { phanTichAnh, thuKetNoi };
}

const gemini = taoProvider({ ten: 'Gemini', diaChiApi: DIA_CHI_API });
const vertex = taoProvider({ ten: 'Gemini (Agent Platform)', diaChiApi: 'https://aiplatform.googleapis.com/v1/publishers/google/models' });

module.exports = { phanTichAnh: gemini.phanTichAnh, thuKetNoi: gemini.thuKetNoi, vertex, sangSchemaGemini };
