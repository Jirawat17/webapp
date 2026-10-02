// Claude Provider cho AI QC (01/10/2026, theo yêu cầu người dùng) — gọi THẲNG Anthropic Messages API (api.anthropic.com),
// không SDK, không proxy. Cùng giao diện với geminiProvider.js: { phanTichAnh, thuKetNoi }.
// Ép trả JSON đúng schema bằng tool use: 1 tool duy nhất có input_schema = schema QC, tool_choice bắt buộc gọi tool đó.
const sharp = require('sharp');

const DIA_CHI_API = 'https://api.anthropic.com/v1/messages';
const PHIEN_BAN_API = '2023-06-01';
const THOI_GIAN_CHO_MS = 120 * 1000;
const TEN_TOOL = 'ghi_ket_qua_qc';
// Claude nhận tối đa 5MB/ảnh và tự thu nhỏ ảnh có cạnh dài > 1568px — ảnh lớn hơn ngưỡng dưới được thu về 1568px trước khi gửi.
const DUNG_LUONG_GUI_TOI_DA = 3.5 * 1024 * 1024;
const CANH_DAI = 1568;

// Schema chung (kiểu Gemini: nullable: true) -> JSON Schema chuẩn (type: [kiểu, 'null']).
function sangSchemaClaude(s) {
  if (Array.isArray(s)) return s.map(sangSchemaClaude);
  if (!s || typeof s !== 'object') return s;
  const kq = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'nullable') continue;
    if (k === 'properties') kq.properties = Object.fromEntries(Object.entries(v).map(([ten, con]) => [ten, sangSchemaClaude(con)]));
    else if (k === 'items') kq.items = sangSchemaClaude(v);
    else kq[k] = v;
  }
  if (s.nullable && typeof kq.type === 'string') {
    kq.type = [kq.type, 'null'];
    if (Array.isArray(kq.enum)) kq.enum = [...kq.enum, null];
  }
  return kq;
}

const loiApi = thongBao => Object.assign(new Error(thongBao), { loiApi: true });

async function goi({ apiKey, model, body }) {
  if (!apiKey) throw loiApi('Chưa nhập API key Claude ở menu QC.');
  if (!model) throw loiApi('Chưa chọn model Claude ở menu QC.');
  const controller = new AbortController();
  const hen = setTimeout(() => controller.abort(), THOI_GIAN_CHO_MS);
  let res;
  try {
    res = await fetch(DIA_CHI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': PHIEN_BAN_API },
      body: JSON.stringify({ model, ...body }),
      signal: controller.signal,
    });
  } catch (err) {
    throw loiApi(err.name === 'AbortError' ? `Claude quá thời gian chờ (${THOI_GIAN_CHO_MS / 1000}s).` : `Lỗi kết nối tới Claude: ${err.message}`);
  } finally {
    clearTimeout(hen);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw loiApi(`Claude trả về dữ liệu không hợp lệ (HTTP ${res.status}).`); }
  if (!res.ok) throw loiApi(`Claude báo lỗi (HTTP ${res.status}${data.error && data.error.type ? ' ' + data.error.type : ''}): ${(data.error && data.error.message) || text.slice(0, 200)}`);
  return data;
}

async function thuNhoNeuCan({ mime, data }) {
  if (data.length <= DUNG_LUONG_GUI_TOI_DA) return { mime, data };
  const nho = await sharp(data).rotate().resize(CANH_DAI, CANH_DAI, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  return { mime: 'image/jpeg', data: nho };
}

// anh: [{ mime, data: Buffer, ten }] — mỗi ảnh kèm 1 dòng tên ngay trước để model tham chiếu đúng file.
async function phanTichAnh({ apiKey, model, prompt, anh = [], schema, thongKe }) {
  const content = [{ type: 'text', text: prompt }];
  for (const a of anh) {
    const { mime, data } = await thuNhoNeuCan(a);
    content.push({ type: 'text', text: `Ảnh: ${a.ten}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: data.toString('base64') } });
  }
  const data = await goi({
    apiKey, model,
    body: {
      max_tokens: 8192,
      temperature: 0,
      messages: [{ role: 'user', content }],
      tools: [{ name: TEN_TOOL, description: 'Ghi kết quả QC theo đúng cấu trúc yêu cầu.', input_schema: sangSchemaClaude(schema || { type: 'object' }) }],
      tool_choice: { type: 'tool', name: TEN_TOOL },
    },
  });
  if (thongKe && data.usage) Object.assign(thongKe, { tokenVao: data.usage.input_tokens || 0, tokenRa: data.usage.output_tokens || 0 });
  if (data.stop_reason === 'max_tokens') throw loiApi('Claude trả lời bị cắt ngang (hết max_tokens).');
  const tool = (data.content || []).find(c => c.type === 'tool_use' && c.name === TEN_TOOL);
  if (!tool || !tool.input || typeof tool.input !== 'object') throw loiApi(`Claude không trả kết quả có cấu trúc (stop_reason: ${data.stop_reason || 'không rõ'}).`);
  return tool.input;
}

// "Thử kết nối" ở menu QC — 1 lượt gọi nhỏ, chỉ kiểm tra key + model dùng được.
async function thuKetNoi({ apiKey, model }) {
  await goi({ apiKey, model, body: { max_tokens: 16, temperature: 0, messages: [{ role: 'user', content: 'Trả lời đúng 1 chữ: OK' }] } });
}

module.exports = { phanTichAnh, thuKetNoi, sangSchemaClaude };
