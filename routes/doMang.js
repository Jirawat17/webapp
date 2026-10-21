// Đo tốc độ mạng tới máy chủ (16/10/2026, theo yêu cầu người dùng) — public/js/api.js#doMangMotLan gọi POST /api/ping mỗi 30 giây (mọi
// trang đã đăng nhập) và đo thời gian khứ hồi. Route PHẢI trả lời NGAY (không đọc Sheet/MinIO) để số đo gần như chỉ là thời gian mạng.
// Body mang theo các lần đo TRƯỚC (log chi tiết, không tốn thêm request) -> lưu bảng do_mang (nhatKyDbService) cho báo cáo hằng ngày.
// Chưa đăng nhập / hết phiên: trả 401 (không lưu) — trình duyệt giữ lại số đo, gửi tiếp khi đăng nhập lại; số đo thời gian vẫn hợp lệ.
const express = require('express');
const router = express.Router();
const nhatKy = require('../services/nhatKyDbService');
const { thoiGianVNISOString } = require('../services/dateUtils');
const doMangMayChu = require('../services/doMangMayChuService');
const { traNhaMang } = require('../services/nhaMangService');

const chu = (v, toiDa) => String(v ?? '').slice(0, toiDa);
const so = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

// Thời gian máy chủ xử lý lượt đo (17/10/2026) — header Server-Timing "app;dur=…" để trình duyệt / DevTools tách phần xử lý khỏi phần đi
// đường. Tính từ lúc request VÀO app (req._tVaoPing, server.js — trước session) tới ngay trước khi trả lời.
const datThoiGianXuLy = (req, res) => {
  if (req._tVaoPing) res.setHeader('Server-Timing', `app;dur=${(performance.now() - req._tVaoPing).toFixed(1)}`);
};
const soDoan = v => (so(v) === null ? null : Math.max(0, Math.round(so(v))));

router.post('/', (req, res) => {
  doMangMayChu.hocTenMien(req); // lượt đi qua Cloudflare -> biết tên miền để máy chủ tự đo (khi chưa đặt TEN_MIEN_APP)
  const u = req.session && req.session.user;
  if (!u) { datThoiGianXuLy(req, res); return res.status(401).json({ ok: false, error: 'Chưa đăng nhập' }); }
  // Bỏ số đo ghi dưới tên NGƯỜI KHÁC (máy dùng chung: số đo lúc người trước hết phiên không bị ghi sang người vừa đăng nhập).
  const ds = (Array.isArray(req.body && req.body.ds) ? req.body.ds.slice(0, 200) : [])
    .filter(d => d && typeof d === 'object' && (!d.nguoi || d.nguoi === u.ten));
  if (ds.length) {
    const tb = req.body.thietBi && typeof req.body.thietBi === 'object' ? req.body.thietBi : {};
    const bayGio = Date.now();
    // Nhà mạng (21/10/2026): tra từ IP của lượt GỬI (thường trùng IP lúc đo — vài chục giây trước), KHÔNG lưu IP. Sau Cloudflare: IP thật ở
    // header cf-connecting-ip (đi thẳng không qua Cloudflare thì header này có thể bị giả — chỉ dùng cho thống kê, không cho quyền gì).
    const nhaMang = chu(traNhaMang(req.headers['cf-connecting-ip'] || req.socket.remoteAddress), 60);
    try {
      nhatKy.ghiNhieuDoMang(ds.map(d => ({
        luc: thoiGianVNISOString(new Date(bayGio - Math.min(Math.max(so(d.cachMs) || 0, 0), 24 * 3600 * 1000))),
        nguoi: chu(u.ten, 60), vaiTro: chu(u.vaiTro, 20), xuong: chu(u.xuong, 60), trang: chu(d.trang, 80),
        ms: so(d.ms) === null ? null : Math.max(0, Math.round(so(d.ms))), loi: chu(d.loi, 60),
        loaiMang: chu(d.loai, 10), mbps: so(d.mbps), rtt: so(d.rtt),
        heDieuHanh: chu(`${tb.os || ''} ${tb.osVer || ''}`.trim(), 40), trinhDuyet: chu(`${tb.br || ''} ${tb.brVer || ''}`.trim(), 40), may: chu(tb.may, 60),
        msCF: soDoan(d.msCF), msCFMayChu: soDoan(d.msCFMayChu), msApp: soDoan(d.msApp), msXepHang: soDoan(d.msXepHang), msKetNoi: soDoan(d.msKetNoi),
        colo: chu(String(d.colo || '').replace(/[^A-Z]/g, ''), 5),
        nhaMang, kieuKetNoi: chu(String(d.kieu || '').replace(/[^a-z-]/g, ''), 12),
      })));
    } catch (err) {
      console.error('[DoMang] Lỗi lưu số đo mạng:', err.message);
    }
  }
  // Tốc độ chiều lên đo từ điện thoại tới speed.cloudflare.com (22/10/2026, api.js#doTocDoLenNeuDenLuot) -> bảng do_toc_do.
  const tocDo = (Array.isArray(req.body && req.body.tocDo) ? req.body.tocDo.slice(0, 50) : [])
    .filter(d => d && typeof d === 'object' && (!d.nguoi || d.nguoi === u.ten));
  if (tocDo.length) {
    const tb = req.body.thietBi && typeof req.body.thietBi === 'object' ? req.body.thietBi : {};
    const bayGio = Date.now();
    const nhaMang = chu(traNhaMang(req.headers['cf-connecting-ip'] || req.socket.remoteAddress), 60);
    try {
      nhatKy.ghiNhieuTocDo(tocDo.map(d => ({
        luc: thoiGianVNISOString(new Date(bayGio - Math.min(Math.max(so(d.cachMs) || 0, 0), 24 * 3600 * 1000))),
        nguon: 'dien_thoai', huong: d.huong === 'xuong' ? 'xuong' : 'len',
        kb: soDoan(d.kb), ms: soDoan(d.ms), kbs: soDoan(d.kbs), msRtt: soDoan(d.msRtt),
        colo: chu(String(d.colo || '').replace(/[^A-Z]/g, ''), 5), nhaMang, kieuKetNoi: chu(String(d.kieu || '').replace(/[^a-z-]/g, ''), 12),
        nguoi: chu(u.ten, 60), xuong: chu(u.xuong, 60), may: chu(tb.may || `${tb.os || ''} ${tb.br || ''}`.trim(), 60), loi: chu(d.loi, 60),
      })));
    } catch (err) {
      console.error('[DoMang] Lỗi lưu số đo tốc độ:', err.message);
    }
  }
  datThoiGianXuLy(req, res);
  res.json({ ok: true });
});

module.exports = router;
