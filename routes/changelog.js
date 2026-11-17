const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Đọc git log, lấy commit có section "CHANGELOG:" trong message.
// Format commit message để hiển thị trong Tab Cập nhật:
//
//   <tiêu đề ngắn>
//
//   CHANGELOG:
//   - mục 1
//   - mục 2
//
// Các commit không có CHANGELOG: bị bỏ qua.
// Nhóm theo ngày (NGAY_LEN_DON git commit), gộp nhiều commit cùng ngày vào 1 entry.
router.get('/', (req, res) => {
  let log;
  try {
    // %x00 = null byte separator giữa các commit, tránh nhầm với nội dung message
    log = execSync(
      'git log --format="%ad%x00%B%x1E" --date=format:"%Y-%m-%d" -n 200',
      { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 }
    );
  } catch (e) {
    console.error('[changelog] git log lỗi:', e.message);
    return res.status(500).json({ loi: 'Không đọc được git log' });
  }

  // Mỗi commit kết thúc bằng \x1E (record separator)
  const commits = log.split('\x1E').map(s => s.trim()).filter(Boolean);

  // Map: ngay -> [các dòng changelog]
  const theoNgay = new Map();

  for (const raw of commits) {
    const nullIdx = raw.indexOf('\x00');
    if (nullIdx === -1) continue;
    const ngay = raw.slice(0, nullIdx).trim();
    const body = raw.slice(nullIdx + 1).trim();

    // Tìm section CHANGELOG: (không phân biệt hoa thường)
    const match = body.match(/^CHANGELOG:\s*\n([\s\S]+?)(?:\n\n|$)/im);
    if (!match) continue;

    const dongItems = match[1]
      .split('\n')
      .map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean);
    if (!dongItems.length) continue;

    if (!theoNgay.has(ngay)) theoNgay.set(ngay, []);
    theoNgay.get(ngay).push(...dongItems);
  }

  // Chuyển thành mảng JSON, ngày mới nhất trước
  const kq = [...theoNgay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ngay, capNhat]) => ({
      ngay,
      phienBan: ngay.split('-').reverse().join('/'), // YYYY-MM-DD -> DD/MM/YYYY
      capNhat,
    }));

  res.json(kq);
});

module.exports = router;
