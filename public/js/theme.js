// Áp dụng màu chủ đạo + chế độ sáng/tối người dùng đã chọn NGAY LẬP TỨC, trước khi phần còn lại
// của trang vẽ ra — tránh hiện tượng nháy màu/nền mặc định rồi mới đổi. File này PHẢI nạp trong <head>.
const BANG_MAU_CHU_DAO = [
  // "Công nghệ (Navy)" đặt LÊN ĐẦU + là mặc định (đổi 09/09/2026, theo yêu cầu người dùng — trước đó
  // 'rose' là mặc định). Theo đúng thiết kế gốc 26/08/2026, ở Chế độ Sáng đây chỉ là 1 màu chủ đạo
  // xanh bình thường như mọi màu khác trong bảng — KHÔNG có xử lý riêng nào (đã rà lại style.css,
  // không tìm thấy khối CSS scope theo [data-mau="navy"] như comment cũ mô tả — có thể là ý định ban
  // đầu chưa từng được xây, không phải hành vi hiện tại; báo lại người dùng, chưa tự ý xây thêm phần
  // "nền navy đậm + glow cam" đó vì ngoài phạm vi yêu cầu lần này).
  { id: 'navy',    ten: 'Công nghệ (Navy) (mặc định)', primary: '#38bdf8', dark: '#0ea5e9', light: '#e0f2fe' },
  { id: 'blue',    ten: 'Xanh dương',        primary: '#1d4ed8', dark: '#1e40af', light: '#eff6ff' },
  { id: 'emerald', ten: 'Xanh lá',           primary: '#047857', dark: '#065f46', light: '#ecfdf5' },
  { id: 'orange',  ten: 'Cam',               primary: '#c2410c', dark: '#9a3412', light: '#fff7ed' },
  { id: 'violet',  ten: 'Tím',               primary: '#6d28d9', dark: '#5b21b6', light: '#f5f3ff' },
  { id: 'teal',    ten: 'Xanh ngọc',         primary: '#0f766e', dark: '#115e59', light: '#f0fdfa' },
  { id: 'pink',    ten: 'Hồng',              primary: '#be185d', dark: '#9d174d', light: '#fdf2f8' },
  { id: 'slate',   ten: 'Xám đậm',           primary: '#334155', dark: '#1e293b', light: '#f8fafc' },
  { id: 'rose',    ten: 'Đỏ mận',            primary: '#be123c', dark: '#9f1239', light: '#fff1f2' },
];

function layMauDaChon() {
  try { return localStorage.getItem('mauChuDao') || 'navy'; } catch (e) { return 'navy'; }
}

function luuMauDaChon(id) {
  try { localStorage.setItem('mauChuDao', id); } catch (e) { /* trình duyệt chặn localStorage — bỏ qua */ }
}

// "primary-light" được thiết kế làm nền nhạt TRÊN NỀN SÁNG (gần trắng) — trên nền tối cần đổi
// sang phiên bản trong suốt của chính màu nhấn, không thì mảng "đang chọn"/hover sẽ chói và lệch tông.
function hexSangRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function apDungMauChuDao(id) {
  const preset = BANG_MAU_CHU_DAO.find(p => p.id === id) || BANG_MAU_CHU_DAO[0];
  const style = document.documentElement.style;
  document.documentElement.setAttribute('data-mau', preset.id); // để style.css scope riêng theme "navy" ở Chế độ Tối
  style.setProperty('--color-primary', preset.primary);
  style.setProperty('--color-primary-dark', preset.dark);
  style.setProperty('--color-primary-light', dangCheDoToi() ? hexSangRgba(preset.primary, 0.18) : preset.light);
  return preset;
}

// ============================================================
// CHẾ ĐỘ TỐI (dark theme) — bật/tắt thủ công, lưu riêng trên từng máy/trình duyệt, KHÔNG tự theo
// hệ điều hành (theo đúng lựa chọn khi làm tính năng này).
// ============================================================
function dangCheDoToi() {
  try { return localStorage.getItem('cheDoToi') === '1'; } catch (e) { return false; }
}

function luuCheDoToi(bat) {
  try { localStorage.setItem('cheDoToi', bat ? '1' : '0'); } catch (e) { /* bỏ qua nếu trình duyệt chặn */ }
}

function apDungCheDoToi(bat) {
  document.documentElement.setAttribute('data-theme', bat ? 'dark' : 'light');
  apDungMauChuDao(layMauDaChon()); // tính lại --color-primary-light cho hợp nền sáng/tối hiện tại
}

apDungCheDoToi(dangCheDoToi()); // chạy ngay khi file này được nạp
