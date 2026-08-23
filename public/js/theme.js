// Áp dụng màu chủ đạo người dùng đã chọn NGAY LẬP TỨC, trước khi phần còn lại của trang vẽ ra —
// tránh hiện tượng nháy màu mặc định rồi mới đổi sang màu đã chọn. File này PHẢI nạp trong <head>.
const BANG_MAU_CHU_DAO = [
  { id: 'rose',    ten: 'Đỏ mận (mặc định)', primary: '#be123c', dark: '#9f1239', light: '#fff1f2' },
  { id: 'blue',    ten: 'Xanh dương',        primary: '#1d4ed8', dark: '#1e40af', light: '#eff6ff' },
  { id: 'emerald', ten: 'Xanh lá',           primary: '#047857', dark: '#065f46', light: '#ecfdf5' },
  { id: 'orange',  ten: 'Cam',               primary: '#c2410c', dark: '#9a3412', light: '#fff7ed' },
  { id: 'violet',  ten: 'Tím',               primary: '#6d28d9', dark: '#5b21b6', light: '#f5f3ff' },
  { id: 'teal',    ten: 'Xanh ngọc',         primary: '#0f766e', dark: '#115e59', light: '#f0fdfa' },
  { id: 'pink',    ten: 'Hồng',              primary: '#be185d', dark: '#9d174d', light: '#fdf2f8' },
  { id: 'slate',   ten: 'Xám đậm',           primary: '#334155', dark: '#1e293b', light: '#f8fafc' },
];

function layMauDaChon() {
  try { return localStorage.getItem('mauChuDao') || 'rose'; } catch (e) { return 'rose'; }
}

function luuMauDaChon(id) {
  try { localStorage.setItem('mauChuDao', id); } catch (e) { /* trình duyệt chặn localStorage — bỏ qua */ }
}

function apDungMauChuDao(id) {
  const preset = BANG_MAU_CHU_DAO.find(p => p.id === id) || BANG_MAU_CHU_DAO[0];
  const style = document.documentElement.style;
  style.setProperty('--color-primary', preset.primary);
  style.setProperty('--color-primary-dark', preset.dark);
  style.setProperty('--color-primary-light', preset.light);
  return preset;
}

apDungMauChuDao(layMauDaChon()); // chạy ngay khi file này được nạp
