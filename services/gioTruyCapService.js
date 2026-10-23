// Giờ đóng truy cập theo Xưởng (23/10/2026, theo yêu cầu người dùng — nhân viên làm quá muộn ảnh hưởng sức khoẻ). Mỗi Xưởng 1 khung giờ
// đóng (vd 22:00–06:00, vắt qua nửa đêm được) lưu trong danh_sach_xuong (caiDatDbService#layGioDongXuong). Người dùng chốt:
//  - chặn MỌI vai trò trừ superadmin; người thuộc nhiều Xưởng bị chặn khi CHỈ CẦN 1 Xưởng của họ đang đóng; người chưa gán Xưởng không bị chặn;
//  - đến giờ đóng: chặn mọi thao tác mới, riêng gửi ảnh / bấm Xong được gửi nốt trong 10 phút (không mất ảnh đã chụp);
//  - "Mở tạm" tới giờ chọn trong khung (superadmin, cùng mật khẩu xác nhận) — hết giờ đó tự đóng theo lịch;
//  - lưu thiết lập / mở tạm phải nhập mật khẩu xác nhận — đổi được trên Settings (services/matKhauXacNhanService.js), kiểm tra ở máy
//    chủ, không gửi xuống trình duyệt.
// Giờ tính theo giờ Việt Nam (UTC+7, không đổi giờ mùa hè) — không phụ thuộc múi giờ của máy chủ.
const caiDat = require('./caiDatDbService');
const { ghiLog } = require('./logService');

const MS_PHUT = 60 * 1000;
const PHUT_NGAY = 24 * 60;
const LECH_VN_PHUT = 7 * 60;
const GUI_NOT_MS = 10 * MS_PHUT; // ảnh đang gửi dở được gửi nốt
const GHI_LOG_LAI_MS = 15 * MS_PHUT; // mỗi người tối đa 1 dòng log "truy cập ngoài giờ" / 15 phút (mỗi trang gọi nhiều API)

const laGio = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const sangPhut = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const phutVN = ms => Math.floor(ms / MS_PHUT + LECH_VN_PHUT) % PHUT_NGAY;
const gioVN = ms => { const m = phutVN(ms); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const trongKhung = (m, tu, den) => (tu < den ? m >= tu && m < den : m >= tu || m < den);
// -> lỗi (chuỗi) hoặc '' nếu đúng. Mật khẩu đổi được trên Settings (services/matKhauXacNhanService.js, loại GIO_NGHI).
function kiemTraMatKhau(mk) {
  return require('./matKhauXacNhanService').dung('GIO_NGHI', mk) ? '' : 'Sai mật khẩu xác nhận — chưa lưu gì.';
}

// 1 Xưởng tại thời điểm `bayGio` (ms). null = không bật / cấu hình hỏng. Đang đóng -> { dong, batDau, moLuc }; đang mở -> { dongLuc }.
function trangThaiXuong(d, bayGio) {
  if (!d || d.GioDongBat !== '1' || !laGio(d.GioDongTu) || !laGio(d.GioDongDen) || d.GioDongTu === d.GioDongDen) return null;
  const tu = sangPhut(d.GioDongTu), den = sangPhut(d.GioDongDen), m = phutVN(bayGio);
  const dauPhut = bayGio - (bayGio % MS_PHUT);
  const moTam = Date.parse(d.MoTamDen) || 0;
  const dangMoTam = moTam > bayGio;
  if (trongKhung(m, tu, den) && !dangMoTam) {
    const dauKhung = dauPhut - ((m - tu + PHUT_NGAY) % PHUT_NGAY) * MS_PHUT;
    return { dong: true, batDau: Math.max(dauKhung, moTam), moLuc: dauPhut + ((den - m + PHUT_NGAY) % PHUT_NGAY) * MS_PHUT };
  }
  // Mở tạm tới 1 giờ NẰM TRONG khung -> đóng lúc đó; còn lại -> lần tới giờ bắt đầu khung.
  if (dangMoTam && trongKhung(phutVN(moTam), tu, den)) return { dong: false, dongLuc: moTam };
  return { dong: false, dongLuc: dauPhut + (((tu - m + PHUT_NGAY) % PHUT_NGAY) || PHUT_NGAY) * MS_PHUT };
}

// Trạng thái của 1 người dùng. null = không bị giới hạn (superadmin, chưa gán Xưởng, Xưởng không bật giờ đóng).
// Đang đóng: { dong: true, xuong, khung, moLuc ('HH:MM'), batDau (ms), thongBao }; đang mở: { dong: false, xuong, khung, dongLuc, conLaiMs }.
function trangThaiChoUser(user, bayGio = Date.now()) {
  if (!user || user.vaiTro === 'superadmin') return null;
  const cuaUser = String(user.xuong || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!cuaUser.length) return null;
  const theoTen = new Map(caiDat.layGioDongXuong().map(d => [d.Ten, d]));
  const ds = cuaUser.map(x => ({ x, d: theoTen.get(x), tt: trangThaiXuong(theoTen.get(x), bayGio) })).filter(k => k.tt);
  if (!ds.length) return null;
  const khung = k => `${k.d.GioDongTu}–${k.d.GioDongDen}`;
  const dong = ds.filter(k => k.tt.dong);
  if (dong.length) {
    const moLuc = gioVN(Math.max(...dong.map(k => k.tt.moLuc)));
    const xuong = dong.map(k => k.x);
    const batDau = Math.min(...dong.map(k => k.tt.batDau));
    return {
      dong: true, xuong, khung: dong.map(khung).join(', '), moLuc, batDau,
      conGuiNotMs: Math.max(0, GUI_NOT_MS - (bayGio - batDau)), // trang Quét QR cho đóng màn để gửi nốt ảnh / bấm Xong (api.js)
      thongBao: `Hệ thống đang tạm đóng với Xưởng ${xuong.join(', ')} (${dong.map(khung).join(', ')}) để mọi người nghỉ ngơi — mở lại lúc ${moLuc}.`,
    };
  }
  const gan = ds.reduce((a, b) => (b.tt.dongLuc < a.tt.dongLuc ? b : a));
  return { dong: false, xuong: [gan.x], khung: khung(gan), dongLuc: gioVN(gan.tt.dongLuc), conLaiMs: gan.tt.dongLuc - bayGio };
}

// Lượt API vẫn được qua khi đang đóng: phiên / đăng xuất / trạng thái giờ đóng / đo mạng / log thao tác quét / báo lỗi (để trang hiện
// được màn "đã đóng" và không mất log). Đăng nhập tự kiểm tra riêng (routes/auth.js).
const MIEN_CHAN_DUNG = ['/auth/hien-tai', '/auth/dang-xuat', '/auth/dang-nhap', '/auth/danh-sach', '/gio-truy-cap/trang-thai'];
const MIEN_CHAN_DAU = ['/ping', '/nhat-ky-quet', '/bao-loi']; // + đường con
const GUI_NOT = ['/photos/upload', '/photos/hoan-tat-san-xuat'];
const _lanGhiLog = new Map(); // ten -> ms lần ghi log gần nhất

function ghiTruyCapNgoaiGio(user, tt, duongDan) {
  const truoc = _lanGhiLog.get(user.ten) || 0;
  if (Date.now() - truoc < GHI_LOG_LAI_MS) return;
  _lanGhiLog.set(user.ten, Date.now());
  console.warn(`[GioTruyCap] ${user.ten} (${user.vaiTro}) truy cập ngoài giờ — Xưởng ${tt.xuong.join(', ')} đóng ${tt.khung}: ${duongDan}`);
  ghiLog({ nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'TRUY_CAP_NGOAI_GIO', chiTiet: { xuong: tt.xuong.join(', '), khung: tt.khung, duongDan } })
    .catch(e => console.error('[GioTruyCap] Lỗi ghi log:', e.message));
}

// Middleware gắn ở /api (server.js, sau kiemTraLaiTaiKhoan): đang đóng -> 423 + dongTruyCap (trang hiện màn "đã đóng").
function chanNgoaiGio(req, res, next) {
  const u = req.session && req.session.user;
  if (!u || MIEN_CHAN_DUNG.includes(req.path) || MIEN_CHAN_DAU.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
  const tt = trangThaiChoUser(u);
  if (!tt || !tt.dong) return next();
  if (req.method === 'POST' && GUI_NOT.includes(req.path) && Date.now() - tt.batDau < GUI_NOT_MS) return next();
  ghiTruyCapNgoaiGio(u, tt, `${req.method} ${req.path}`);
  res.status(423).json({ error: tt.thongBao, dongTruyCap: tt });
}

// ---- Settings (CHỈ superadmin, routes/gioTruyCap.js) ----
function layThietLap(bayGio = Date.now()) {
  return caiDat.layGioDongXuong().map(d => {
    const tt = trangThaiXuong(d, bayGio);
    const moTam = Date.parse(d.MoTamDen) || 0;
    return {
      ten: d.Ten, bat: d.GioDongBat === '1', tu: d.GioDongTu, den: d.GioDongDen,
      moTamDen: moTam > bayGio ? gioVN(moTam) : '',
      trangThai: !tt ? '' : tt.dong ? `Đang đóng — mở lại lúc ${gioVN(tt.moLuc)}` : `Đang mở — đóng lúc ${gioVN(tt.dongLuc)}`,
    };
  });
}

function luuThietLap(ds) {
  if (!Array.isArray(ds)) throw new Error('Thiếu danh sách Xưởng');
  const coXuong = new Set(caiDat.layDanhSachXuong());
  const cu = new Map(caiDat.layGioDongXuong().map(d => [d.Ten, d]));
  const sach = ds.map(d => {
    const ten = String(d.ten || ''), tu = String(d.tu || ''), den = String(d.den || ''), bat = d.bat === true;
    if (!coXuong.has(ten)) throw new Error(`Không có Xưởng "${ten}"`);
    if ((bat || tu || den) && (!laGio(tu) || !laGio(den))) throw new Error(`Xưởng ${ten}: giờ phải dạng HH:MM`);
    if (bat && tu === den) throw new Error(`Xưởng ${ten}: giờ đóng và giờ mở không được trùng nhau`);
    return { ten, bat, tu, den };
  });
  caiDat.datGioDongXuong(sach);
  // Đổi khung / bật-tắt -> bỏ "mở tạm" cũ (đặt theo khung cũ, không còn đúng ý).
  for (const d of sach) {
    const c = cu.get(d.ten);
    if (c && c.MoTamDen && (c.GioDongBat !== (d.bat ? '1' : '') || c.GioDongTu !== d.tu || c.GioDongDen !== d.den)) caiDat.datMoTamXuong(d.ten, '');
  }
  return sach;
}

// den 'HH:MM' = mở tạm tới lần tới giờ đó (phải nằm trong khung đóng, hoặc đúng giờ mở = mở cả đêm); '' = huỷ mở tạm.
function datMoTam(xuong, den, bayGio = Date.now()) {
  const d = caiDat.layGioDongXuong().find(x => x.Ten === xuong);
  if (!d) throw new Error(`Không có Xưởng "${xuong}"`);
  if (!den) { caiDat.datMoTamXuong(xuong, ''); return ''; }
  if (!trangThaiXuong(d, bayGio)) throw new Error(`Xưởng ${xuong} chưa bật giờ đóng`);
  if (!laGio(den)) throw new Error('Giờ mở tạm phải dạng HH:MM');
  const tu = sangPhut(d.GioDongTu), denKhung = sangPhut(d.GioDongDen), p = sangPhut(den);
  if (!trongKhung(p, tu, denKhung) && p !== denKhung) throw new Error(`Giờ mở tạm phải nằm trong khung đóng ${d.GioDongTu}–${d.GioDongDen}`);
  const dauPhut = bayGio - (bayGio % MS_PHUT), m = phutVN(bayGio);
  const t = dauPhut + (((p - m + PHUT_NGAY) % PHUT_NGAY) || PHUT_NGAY) * MS_PHUT;
  // Chỉ trong lần nghỉ ĐANG diễn ra hoặc lần kế tiếp — giờ đã qua (vd 23:00 chọn "tới 22:30") sẽ thành 22:30 NGÀY MAI = mở gần 24 giờ: chặn.
  const dauLanNghi = trongKhung(m, tu, denKhung) ? dauPhut - ((m - tu + PHUT_NGAY) % PHUT_NGAY) * MS_PHUT
    : dauPhut + ((tu - m + PHUT_NGAY) % PHUT_NGAY) * MS_PHUT;
  const cuoiLanNghi = dauLanNghi + (((denKhung - tu + PHUT_NGAY) % PHUT_NGAY) || PHUT_NGAY) * MS_PHUT;
  if (t > cuoiLanNghi) throw new Error(`${den} đã qua trong lần nghỉ này — chọn giờ sau ${gioVN(bayGio)} và không quá ${d.GioDongDen}`);
  caiDat.datMoTamXuong(xuong, new Date(t).toISOString());
  return gioVN(t);
}

module.exports = { trangThaiChoUser, trangThaiXuong, chanNgoaiGio, ghiTruyCapNgoaiGio, layThietLap, luuThietLap, datMoTam, kiemTraMatKhau };
