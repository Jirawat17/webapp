// Lớp AI Provider cho AI QC (30/09/2026, theo yêu cầu người dùng) — qcService.js chỉ gọi 2 hàm dưới đây, không biết đang
// dùng nhà cung cấp nào. Thêm nhà cung cấp mới: viết 1 file cùng giao diện { phanTichAnh, thuKetNoi } rồi đăng ký vào PROVIDER.
//   phanTichAnh({ apiKey, model, prompt, anh: [{ mime, data: Buffer, ten }], schema }) -> object JSON
//   thuKetNoi({ apiKey, model }) -> throw nếu key/model không dùng được
// Lỗi gọi API mang err.loiApi = true.
const PROVIDER = {
  gemini: require('./geminiProvider'),
  claude: require('./claudeProvider'),
};
const PROVIDER_MAC_DINH = 'gemini';

function layProvider(ten = PROVIDER_MAC_DINH) {
  const p = PROVIDER[ten];
  if (!p) throw Object.assign(new Error(`Chưa hỗ trợ nhà cung cấp AI "${ten}".`), { loiApi: true });
  return p;
}

module.exports = {
  phanTichAnh: (thamSo, ten) => layProvider(ten).phanTichAnh(thamSo),
  thuKetNoi: (thamSo, ten) => layProvider(ten).thuKetNoi(thamSo),
};
