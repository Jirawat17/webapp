// Bộ icon SVG dùng chung toàn app — thay cho emoji (emoji không nhất quán giữa các thiết bị
// và không có ngữ nghĩa rõ ràng cho screen reader).
const ICONS = {
  orders: '<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="13" y2="15"/>',
  scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M17 4h2a1 1 0 0 1 1 1v2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 20H5a1 1 0 0 1-1-1v-2"/><line x1="4" y1="12" x2="20" y2="12"/>',
  chart: '<line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="12" width="3" height="8"/><rect x="11" y="8" width="3" height="12"/><rect x="16" y="4" width="3" height="16"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.3"/><path d="M15 13.5c2.4.4 4.1 2.3 4.5 4.5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.3"/>',
  chat: '<path d="M4 5h16v11H9l-4 4V5z"/>',
  send: '<polygon points="20 4 14 20 11 13 4 10 20 4"/>',
  close: '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
  check: '<polyline points="4 12 9 17 20 6"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><line x1="12" y1="10" x2="12" y2="13.5"/><circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none"/>',
  package: '<path d="M3 8l9-5 9 5-9 5-9-5z"/><path d="M3 8v9l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="22"/>',
  filter: '<polygon points="3 4 21 4 14 13 14 19 10 21 10 13 3 4"/>',
  download: '<path d="M12 3v12"/><polyline points="7 11 12 16 17 11"/><path d="M4 19h16"/>',
  file: '<path d="M6 2h9l5 5v15H6z"/><polyline points="15 2 15 7 20 7"/>',
  logo: '<circle cx="12" cy="12" r="9"/><path d="M8 12c1.3-2 2.7-2 4 0s2.7 2 4 0"/>',
  spinner: '<circle cx="12" cy="12" r="9" stroke-opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/>',
  arrowRight: '<line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/>',
};

function icon(name, opts) {
  opts = opts || {};
  const size = opts.size || 22;
  const cls = opts.className || '';
  const inner = ICONS[name] || '';
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${inner}</svg>`;
}
