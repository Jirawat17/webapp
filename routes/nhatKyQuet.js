// Logs_UploadAnh (12/10/2026, theo yêu cầu người dùng): nhật ký MỌI thao tác ở menu Quét QR (mở camera, quét QR, chụp + tải ảnh,
// xác nhận hàng loạt, quét lại/bỏ ngang) kèm thông tin thiết bị + phiên bản app — để so tốc độ giữa các loại máy/trình duyệt
// (vd Android/Chrome nhanh, iOS/máy cũ chậm) và biết chặng nào chậm. Trình duyệt (scan.html) gom sự kiện rồi gửi theo lô.
// Ghi: mọi người đã đăng nhập. Xem/tổng hợp: CHỈ superadmin (trang Logs). Không lưu nội dung ảnh, chỉ số đo.
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireLogin, requireExactRole } = require('../middleware/auth');
const nhatKy = require('../services/nhatKyDbService');
const { thoiGianVNISOString } = require('../services/dateUtils');

router.use(requireLogin);

// Phiên bản app MỚI NHẤT = số ?v= của api.js trong scan.html đang phục vụ (đọc 1 lần lúc khởi động — mỗi lần triển khai container
// khởi động lại). Trang Quét QR so với số của chính nó để nhắc "Có bản mới" (tab mở suốt ca nhiều ngày không tải lại).
let PHIEN_BAN_MOI_NHAT = '';
try {
  PHIEN_BAN_MOI_NHAT = (fs.readFileSync(path.join(__dirname, '..', 'public', 'scan.html'), 'utf8').match(/\/js\/api\.js\?v=(\d+)/) || [])[1] || '';
} catch (e) { /* không đọc được -> không nhắc */ }

// XONG_DON (15/10/2026): mỗi lần Xong lượt ảnh đã sản xuất (bấm nút / tự Xong khi quét đơn khác) + khôi phục đơn chờ Xong bị bỏ.
const SU_KIEN = ['MO_CAMERA', 'QUET_QR', 'CHUP_ANH', 'XAC_NHAN_HANG_LOAT', 'QUET_LAI', 'THOAT_GIUA_CHUNG', 'XONG_DON'];
const NGUONG_CHAM_CHUP_MS = 8000; // CHUP_ANH: từ lúc có ảnh tới lúc tải xong > 8 giây = chậm (người dùng chọn 12/10/2026)
const chu = (v, n) => String(v == null ? '' : v).slice(0, n);
// Giới hạn ghi (12/10/2026, rà soát): tối đa 600 sự kiện/người/phút — vòng lặp lỗi phía trình duyệt hay gửi bậy không làm phình
// nhat_ky.db (dùng chung với lịch sử hoạt động). Vượt thì bỏ phần thừa, vẫn trả số phiên bản. Đếm trong bộ nhớ (1 tiến trình).
const SU_KIEN_TOI_DA_MOI_PHUT = 600;
const demTheoNguoi = new Map(); // tên -> { phut, dem, daBao }
// chi_tiet <= 3000 ký tự và LUÔN là JSON hợp lệ (12/10/2026, rà soát): cắt chuỗi JSON giữa chừng làm json_extract của bảng tổng hợp
// báo "malformed JSON" cho cả khoảng ngày. Quá dài -> rút từng chuỗi con còn 200 ký tự; vẫn quá -> bỏ dần TRƯỜNG LỚN NHẤT (giữ các trường
// còn lại: loại file, mạng, thời gian máy chủ...) và ghi tên trường đã bỏ vào catBot.
function chiTietGon(ct) {
  const o = ct && typeof ct === 'object' && !Array.isArray(ct) ? ct : {};
  let s = JSON.stringify(o);
  if (s.length <= 3000) return s;
  const gon = JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' ? v.slice(0, 200) : v)));
  // Đo kích thước từng trường 1 LẦN, sắp xếp 1 LẦN, bỏ từ lớn xuống tới khi phần còn lại <= 2000 ký tự (chừa ~1000 cho catBot) —
  // không đo lại cả object mỗi vòng (object hàng nghìn trường nhỏ từ trình duyệt lỗi sẽ thành O(n²), chặn máy chủ).
  const kichThuoc = Object.entries(gon).map(([k, v]) => [k, k.length + JSON.stringify(v ?? null).length + 4]).sort((a, b) => b[1] - a[1]);
  let tong = kichThuoc.reduce((a, [, n]) => a + n, 2);
  const boDi = [];
  for (const [k, n] of kichThuoc) {
    if (tong <= 2000) break;
    delete gon[k]; tong -= n;
    boDi.push(k);
  }
  // catBot: tối đa 20 tên trường đã bỏ (+ số còn lại) — trang Logs hiện "[bị rút gọn: ...]"
  const ghiChu = boDi.slice(0, 20).map(k => String(k).slice(0, 40)).concat(boDi.length > 20 ? [`+${boDi.length - 20}`] : []);
  s = JSON.stringify(boDi.length ? { ...gon, catBot: ghiChu } : gon);
  return s.length <= 3000 ? s : '{"catBot":true}';
}
const so = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.min(Number(v), 1e9)) : null);

router.post('/', (req, res) => {
  let ds = Array.isArray(req.body?.suKien) ? req.body.suKien.slice(0, 30) : [];
  const tb = req.body?.thietBi && typeof req.body.thietBi === 'object' ? req.body.thietBi : {};
  const u = req.session.user;
  const phut = Math.floor(Date.now() / 60000);
  const d = demTheoNguoi.get(u.ten);
  const c = d && d.phut === phut ? d : { phut, dem: 0 };
  const truocGioiHan = ds.length;
  ds = ds.slice(0, Math.max(0, SU_KIEN_TOI_DA_MOI_PHUT - c.dem));
  c.dem += ds.length;
  if (ds.length < truocGioiHan && !c.daBao) { // (4) bỏ sự kiện vì vượt giới hạn -> báo 1 lần/người/phút (xem ở Logs > Log server)
    c.daBao = true;
    console.warn(`[NhatKyQuet] ${u.ten} vượt ${SU_KIEN_TOI_DA_MOI_PHUT} sự kiện/phút — bỏ phần vượt (trình duyệt có thể đang lặp gửi lỗi).`);
  }
  demTheoNguoi.set(u.ten, c);
  const thietBi = {
    heDieuHanh: chu(`${chu(tb.os, 20)} ${chu(tb.osVer, 15)}`.trim(), 40), trinhDuyet: chu(`${chu(tb.br, 30)} ${chu(tb.brVer, 15)}`.trim(), 50),
    may: chu(tb.may, 60), phienBanApp: chu(req.body?.phienBanApp, 10),
    thongTin: JSON.stringify({ ram: so(tb.ram), cpu: so(tb.cpu), manHinh: chu(tb.manHinh, 30), standalone: !!tb.standalone, ua: chu(req.get('user-agent'), 300) }),
  };
  const bayGio = Date.now();
  const dong = ds.filter(s => s && SU_KIEN.includes(s.suKien)).map(s => {
    const tongMs = so(s.tongMs);
    const ketQua = chu(s.ketQua, 20);
    return {
      luc: thoiGianVNISOString(new Date(bayGio - Math.min(so(s.cachMs) || 0, 24 * 3600 * 1000))), // giờ máy chủ trừ độ trễ gom lô
      nguoi: u.ten, vaiTro: u.vaiTro || '', xuong: u.xuong || '',
      suKien: s.suKien, cheDo: chu(s.cheDo, 20), sttKey: chu(s.sttKey, 60), ketQua, loi: chu(s.loi, 300),
      tongMs, cham: s.suKien === 'CHUP_ANH' && tongMs > NGUONG_CHAM_CHUP_MS ? 1 : 0,
      chiTiet: chiTietGon(s.chiTiet),
      ...thietBi,
    };
  });
  if (dong.length) nhatKy.ghiNhieuLogsUploadAnh(dong); // CHUP_ANH có sauThoat -> xoá dòng THOAT đã ghi trước của chính ảnh đó (trong hàm)
  res.json({ phienBanMoiNhat: PHIEN_BAN_MOI_NHAT });
});

const docLoc = q => ({
  tu: chu(q.tu, 10), den: chu(q.den, 10), nguoi: chu(q.nguoi, 60), suKien: SU_KIEN.includes(q.suKien) ? q.suKien : '',
  nhomKq: chu(q.nhomKq, 20), chiCham: q.chiCham === '1',
});
// gioiHan tối đa 20000 (xuất CSV); trang xem chỉ lấy 1000.
router.get('/', requireExactRole('superadmin'), (req, res) => {
  res.json({ ds: nhatKy.dsLogsUploadAnh({ ...docLoc(req.query), gioiHan: Math.min(Number(req.query.gioiHan) || 500, 20000) }), nguongChamMs: NGUONG_CHAM_CHUP_MS });
});

// Tổng hợp theo nhóm thiết bị (hệ điều hành + trình duyệt, lấy số phiên bản CHÍNH) hoặc theo người dùng: số lượt, trung bình
// từng chặng của lượt chụp, nhóm 10% chậm nhất, tỉ lệ lỗi. Tính ở JS (90 ngày dữ liệu vẫn nhỏ với SQLite + 1 lần quét).
const banChinh = s => String(s || '').replace(/^(\D*\d+)[.\d]*/, '$1'); // "iOS 17.5" -> "iOS 17", "Chrome 138.0" -> "Chrome 138"
router.get('/tong-hop', requireExactRole('superadmin'), (req, res) => {
  const theoNguoi = req.query.nhom === 'nguoi';
  const nhom = new Map();
  const them = (ds, v) => { if (Number.isFinite(v)) ds.push(v); };
  for (const r of nhatKy.duyetTongHopLogsUploadAnh(docLoc(req.query))) {
    const khoa = theoNguoi ? r.nguoi : `${banChinh(r.he_dieu_hanh) || '?'} · ${banChinh(r.trinh_duyet) || '?'}`;
    const g = nhom.get(khoa) || { nhom: khoa, soLuot: 0, soLoiKyThuat: 0, soNghiepVu: 0, soBoNgang: 0, chup: [], nen: [], gui: [], mayChu: [], kiemTra: [], moCamera: [], timMa: [], nguoi: new Set(), may: new Set() };
    nhom.set(khoa, g);
    g.soLuot++;
    if (r.nhom_kq === 'KY_THUAT') g.soLoiKyThuat++;
    else if (r.nhom_kq === 'NGHIEP_VU') g.soNghiepVu++;
    else if (r.nhom_kq === 'BO_NGANG') g.soBoNgang++;
    g.nguoi.add(r.nguoi); if (r.may) g.may.add(r.may);
    if (r.su_kien === 'CHUP_ANH' && r.ket_qua === 'OK') { them(g.chup, r.tong_ms); them(g.nen, r.ms_nen); them(g.gui, r.ms_gui); them(g.mayChu, r.ms_may_chu); }
    if (r.su_kien === 'QUET_QR') { them(g.kiemTra, r.ms_kiem_tra); them(g.timMa, r.ms_tim_ma); }
    if (r.su_kien === 'MO_CAMERA' && r.ket_qua === 'OK') them(g.moCamera, r.tong_ms);
  }
  const tb = ds => (ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : null);
  const p90 = ds => { if (!ds.length) return null; const s = [...ds].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]; };
  res.json([...nhom.values()].map(g => ({
    nhom: g.nhom, soLuot: g.soLuot, soLoiKyThuat: g.soLoiKyThuat, soNghiepVu: g.soNghiepVu, soBoNgang: g.soBoNgang, soChup: g.chup.length, soNguoi: g.nguoi.size, dsMay: [...g.may].slice(0, 5),
    tbChup: tb(g.chup), p90Chup: p90(g.chup), tbNen: tb(g.nen), tbGui: tb(g.gui), tbMayChu: tb(g.mayChu),
    tbKiemTra: tb(g.kiemTra), tbTimMa: tb(g.timMa), tbMoCamera: tb(g.moCamera),
  })).sort((a, b) => b.soLuot - a.soLuot));
});

module.exports = router;
