// PreToolUse hook: chặn mọi tool call chạm tới đường dẫn nằm ngoài ALLOWED.
// Exit 2 = chặn (thông báo ở stderr được gửi cho Claude). Lỗi đọc input = chặn luôn (fail closed).
const path = require('path');
const ALLOWED = 'd:\\n8n_data\\webapp';
const ENV_PATHS = 'USERPROFILE|HOME|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|PUBLIC|OneDrive|ProgramData|ProgramFiles|SystemRoot|windir|SystemDrive';

function check({ tool_name: tool = '', tool_input: inp = {}, cwd = ALLOWED }) {
  const bad = [];
  const norm = p => p.replace(/^\/([a-z])(?=\/|$)/i, '$1:'); // Git Bash: /c/Users -> c:/Users
  const inside = p => {
    const r = path.win32.resolve(cwd, norm(p)).toLowerCase();
    return r === ALLOWED || r.startsWith(ALLOWED + '\\');
  };

  // 1. Tool đọc/ghi file: kiểm tra đường dẫn sau khi resolve (bắt cả đường dẫn tương đối có ..)
  for (const k of ['file_path', 'path', 'notebook_path']) {
    if (typeof inp[k] === 'string' && inp[k] && !inside(inp[k])) bad.push(inp[k]);
  }
  if (tool === 'Glob' && typeof inp.pattern === 'string' && !inside(inp.pattern.replace(/[*?{[].*$/, '') || '.')) bad.push(inp.pattern);

  // 2. Lệnh shell (Bash / PowerShell / Monitor)
  if (typeof inp.command === 'string') {
    const c = inp.command;
    for (const m of c.matchAll(/(?:^|[\s"'`=(,;|&<>])([a-z]:[\\/][^\s"'`;|&<>)]*|\/[a-z]\/[^\s"'`;|&<>)]*)/gi)) {
      if (!inside(m[1])) bad.push(m[1]);
    }
    if (/(?:^|[\s"'`;|&(])[a-z]:(?=$|[\s"'`;|&)])/i.test(c)) bad.push('(chuyển sang ổ đĩa khác)');
    if (/(?:^|[\s"'`])\\\\[a-z0-9.]/i.test(c)) bad.push('(đường dẫn mạng UNC)');
    if (/(?:^|[\s"'`=])~(?=[\\/\s"'`]|$)|\$HOME\b/i.test(c)) bad.push('(thư mục ~ / $HOME)');
    if (new RegExp(`\\$env:(${ENV_PATHS})\\b|%(${ENV_PATHS})%|\\$\\{?(${ENV_PATHS})\\b`, 'i').test(c)) bad.push('(biến môi trường trỏ ra ngoài)');
    if (/\.\.(?=[\\/]|$|[\s"'`;|&)])/.test(c)) bad.push('(dùng .. để ra thư mục cha)');
    if (/\bmklink\b|\bsubst\b|-ItemType\s+["']?(SymbolicLink|Junction|HardLink)|\bln\s+-s/i.test(c)) bad.push('(tạo link/ổ ảo)');
  }

  // 3. Tool MCP (trình duyệt...): không cho mở file:// ngoài ALLOWED
  if (tool.startsWith('mcp__')) {
    for (const m of JSON.stringify(inp).matchAll(/file:\/\/\/?([a-z]:[^"\s]*)/gi)) {
      if (!inside(decodeURIComponent(m[1]).replace(/\\\\/g, '\\'))) bad.push('file:///' + m[1]);
    }
  }
  return bad;
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', d => (raw += d)).on('end', () => {
    let bad;
    try { bad = check(JSON.parse(raw.replace(/^﻿/, ''))); } catch (e) { bad = ['(không đọc được input của hook: ' + e.message + ')']; }
    if (bad.length) {
      process.stderr.write(`BỊ CHẶN: Claude chỉ được truy cập D:\\n8n_data\\webapp. Vi phạm: ${bad.join(', ')}`);
      process.exit(2);
    }
  });
}
module.exports = { check };
