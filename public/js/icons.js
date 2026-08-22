// Bộ icon SVG dùng chung toàn app — nét đều, bo góc mềm mại, logo dùng gradient cho cảm giác cao cấp hơn.
let _demIdGradient = 0;

const ICONS = {
  orders: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  chart: '<path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M3 20h18"/>',
  users: '<circle cx="9" cy="7.5" r="3"/><path d="M3.5 20c0-3.6 2.9-6.5 5.5-6.5s5.5 2.9 5.5 6.5"/><circle cx="17.5" cy="8.5" r="2.3"/><path d="M15.2 13.7c2.6.3 4.6 2.5 5 5.3"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><polyline points="9.5 16 14 12 9.5 8"/><line x1="14" y1="12" x2="3" y2="12"/>',
  camera: '<path d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3a1 1 0 0 1 1 1V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 5 18V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.4"/><circle cx="17.3" cy="10.8" r="0.6" fill="currentColor" stroke="none"/>',
  chat: '<path d="M4.5 5.5h15a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H10l-4.2 3.4a.5.5 0 0 1-.8-.4V16h-.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z"/>',
  send: '<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3z"/><path d="M12.9 13 21 3"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  minimize: '<line x1="6" y1="15" x2="18" y2="15" />',
  check: '<circle cx="12" cy="12" r="9.5" fill="currentColor" fill-opacity="0.12" stroke="none"/><polyline points="7.5 12.5 10.5 15.5 17 9"/>',
  alert: '<path d="M12 3.2 2.5 20h19L12 3.2z"/><line x1="12" y1="9.5" x2="12" y2="13.5"/><circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none"/>',
  package: '<path d="M12 3 4 7v10l8 4 8-4V7l-8-4z"/><path d="M4 7l8 4 8-4"/><line x1="12" y1="11" x2="12" y2="21"/>',
  filter: '<path d="M4 5h16l-6.5 7.5V19l-3 1.5v-8L4 5z"/>',
  download: '<path d="M12 3v11"/><polyline points="7.5 10.5 12 15 16.5 10.5"/><path d="M4.5 19.5h15"/>',
  file: '<path d="M6.5 2.5h8l5 5v13.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><polyline points="14.5 2.5 14.5 7.5 19.5 7.5"/>',
  logo: '<defs><linearGradient id="__GRADID__" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#c084fc"/></linearGradient></defs><circle cx="12" cy="12" r="9.5" fill="url(#__GRADID__)" stroke="none"/><path d="M7.2 12c1.6-2.4 3.2-2.4 4.8 0s3.2 2.4 4.8 0" stroke="white" stroke-width="1.8"/>',
  spinner: '<circle cx="12" cy="12" r="9" stroke-opacity="0.2"/><path d="M21 12a9 9 0 0 0-9-9"/>',
  arrowRight: '<line x1="4" y1="12" x2="18.5" y2="12"/><polyline points="13.5 6.5 19 12 13.5 17.5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" fill-opacity="0.15"/><rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  sparkle: '<path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3z"/>',
};

function icon(name, opts) {
  opts = opts || {};
  const size = opts.size || 22;
  const cls = opts.className || '';
  let inner = ICONS[name] || '';

  if (inner.includes('__GRADID__')) {
    _demIdGradient += 1;
    inner = inner.split('__GRADID__').join('icongrad' + _demIdGradient);
  }

  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${inner}</svg>`;
}
