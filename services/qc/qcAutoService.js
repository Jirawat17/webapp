// Tự động quét QC (02/10/2026, theo yêu cầu người dùng) — mỗi QC bật/tắt + thời gian chờ riêng (menu QC). Lịch: cron mỗi 2 phút
// (batDauLichAutoQc, gọi 1 lần trong server.js). Một lượt: với mỗi QC đang BẬT -> lọc đơn đúng trạng thái + có ảnh (kiểm tra file
// thật trên MinIO) + đã qua mốc chuyển trạng thái + thời gian chờ -> giành quyền (bảng qc_auto, khoá (STT_Key, LoaiQc)) -> chayQc
// chế độ AUTO (ghi qc_log + cảnh báo Telegram như QC thủ công) -> đánh dấu XONG / LOI.
// Người dùng chốt: chỉ đơn chuyển trạng thái từ mốc áp dụng (lần khởi động đầu có tính năng) trở đi; QC2/QC3 vẫn chạy nếu đơn đã
// sang bước sau; lỗi kỹ thuật thử lại tối đa 2 lần (tổng 3 lần), cách nhau >= 30 phút; đã QC thủ công vẫn auto QC.
const cron = require('node-cron');
const orderService = require('../orderService');
const caiDatDbService = require('../caiDatDbService');
const nhatKyDbService = require('../nhatKyDbService');
const storageService = require('../storageService');
const qcService = require('./qcService');

const NGUOI_CHAY_AUTO = { ten: 'Hệ thống (Auto QC)', vaiTro: 'superadmin' };
const SO_LAN_THU_TOI_DA = 3; // lần đầu + 2 lần thử lại khi lỗi kỹ thuật
const KHOANG_CACH_THU_LAI_MS = 30 * 60 * 1000;
const SO_DON_TOI_DA_MOI_LUOT = 10; // mỗi QC mỗi lượt 2 phút — giới hạn chi phí AI + thời gian 1 lượt
const CHO_MAC_DINH = { gio: 0, phut: 5 };
const DA_HUY = ['CANCELLED_Đã hủy', 'REFUNDED_Hoàn đơn'];
const COT_FILE_THEU = ['Anh_File_Theu_URL', 'Anh_File_Theu_URL_2', 'Anh_File_Theu_URL_3'];

// Điều kiện từng QC: trạng thái (dat), cột ảnh cần có (ít nhất 1 ảnh tồn tại thật), cột mốc thời gian chuyển trạng thái.
const QUY_TAC = {
  QC1: {
    trangThai: r => r.TRANG_THAI_VE_FILE === 'Đã vẽ file' && !DA_HUY.includes(r.TRANG_THAI_XUONG),
    cotAnh: COT_FILE_THEU, cotMoc: 'THOI_GIAN_VE_FILE', moTa: 'Đã vẽ file',
  },
  QC2: {
    trangThai: r => ['Đã sản xuất', 'ĐÃ DÁN TEM', 'DELIVERED_Đã giao đến khách'].includes(r.TRANG_THAI_XUONG),
    cotAnh: ['Anh_Da_San_Xuat_URL'], cotMoc: 'THOI_GIAN_SAN_XUAT', moTa: 'Đã sản xuất',
  },
  QC3: {
    trangThai: r => ['ĐÃ DÁN TEM', 'DELIVERED_Đã giao đến khách'].includes(r.TRANG_THAI_XUONG),
    cotAnh: ['Anh_Da_Dan_Tem_URL'], cotMoc: 'THOI_GIAN_DAN_TEM', moTa: 'ĐÃ DÁN TEM',
  },
};

// Số nguyên không âm, giờ 0–720, phút 0–59. -> number | null
const soNguyen = (v, max) => (/^\d+$/.test(String(v ?? '').trim()) && Number(v) <= max ? Number(v) : null);

function layCauHinhAuto() {
  const ch = caiDatDbService.layCauHinhQc();
  return Object.keys(QUY_TAC).map(loai => {
    const c = ch[loai] || {};
    return {
      loai, bat: c.AutoBat === 'TRUE',
      gio: soNguyen(c.AutoGio, 720) ?? CHO_MAC_DINH.gio, phut: soNguyen(c.AutoPhut, 59) ?? CHO_MAC_DINH.phut,
    };
  });
}

// ds = [{ loai, bat, gio, phut }] — kiểm tra hết rồi mới lưu. -> thông báo lỗi | null
function luuCauHinhAuto(ds) {
  if (!Array.isArray(ds) || !ds.length) return 'Chưa có cấu hình để lưu.';
  for (const d of ds) {
    if (!d || !Object.hasOwn(QUY_TAC, d.loai)) return `Loại QC không hợp lệ: ${d && d.loai}.`;
    if (typeof d.bat !== 'boolean') return `${d.loai}: Bật/Tắt không hợp lệ.`;
    if (soNguyen(d.gio, 720) === null) return `${d.loai}: Giờ phải là số nguyên từ 0 đến 720.`;
    if (soNguyen(d.phut, 59) === null) return `${d.loai}: Phút phải là số nguyên từ 0 đến 59.`;
  }
  for (const d of ds) caiDatDbService.datCauHinhQc(d.loai, { AutoBat: d.bat ? 'TRUE' : '', AutoGio: String(Number(d.gio)), AutoPhut: String(Number(d.phut)) });
  return null;
}

const thoiDiem = s => { const t = new Date(s || '').getTime(); return Number.isFinite(t) ? t : null; };

// Ảnh MinIO: kiểm tra object có thật (HEAD). Link ngoài MinIO (Drive... ảnh cũ): không kiểm tra rẻ được -> coi là có, QC tự tải và
// báo CẦN CHECK LẠI nếu hỏng. -> danh sách URL tồn tại; lỗi mạng/MinIO -> throw (bỏ qua đơn ở lượt này, KHÔNG giành quyền).
async function anhTonTai(urls) {
  const co = [];
  for (const url of urls) {
    const key = storageService.proxyUrlToObjectKey(url);
    if (!key || await storageService.tonTaiObject(key)) co.push(url);
  }
  return co;
}

// Thời điểm upload ảnh gần nhất theo lịch sử UPLOAD_ANH của đơn (nếu có) — chỉ để ghi log.
function thoiDiemUpload(sttKey, urls) {
  const tim = new Set(urls);
  const dong = nhatKyDbService.layTatCaLichSuHoatDong().filter(r => r.STT_Key === sttKey && r.HanhDong === 'UPLOAD_ANH');
  return dong.filter(r => { try { return tim.has(JSON.parse(r.ChiTiet).url); } catch (e) { return false; } }).map(r => r.ThoiGian);
}

let dangChay = false;
// 1 lượt quét. bayGio (ms) truyền vào được để test. -> [{ loai, sttKey, ketQua | loi | boQua }]
async function chayLuotAutoQc(bayGio = Date.now()) {
  if (dangChay) return [];
  dangChay = true;
  const nhatKy = [];
  try {
    const dangBat = layCauHinhAuto().filter(c => c.bat);
    if (!dangBat.length) return nhatKy;
    const mocApDung = thoiDiem(caiDatDbService.layMocApDungAutoQc());
    const { rows } = await orderService.getAll({ fresh: true });
    for (const cfg of dangBat) {
      const qt = QUY_TAC[cfg.loai];
      // Ngưỡng hỏng -> chayQc sẽ từ chối; bỏ cả loại QC ở lượt này, không tốn lần thử của đơn nào.
      const loiNguong = qcService.kiemTraNguong(qcService.layNguong(cfg.loai), cfg.loai);
      if (loiNguong) { console.error(`[AutoQC] Bỏ qua ${cfg.loai}: ${loiNguong}`); continue; }
      const choMs = (cfg.gio * 60 + cfg.phut) * 60 * 1000;
      const daAuto = nhatKyDbService.layTatCaAutoQc();
      const ungVien = rows
        .map(r => ({ r, moc: thoiDiem(r[qt.cotMoc]) }))
        .filter(({ r, moc }) => {
          if (moc === null || mocApDung === null || moc < mocApDung || bayGio < moc + choMs) return false;
          if (!qt.trangThai(r) || !qt.cotAnh.some(c => r[c])) return false;
          const a = daAuto.get(`${r.STT_Key}|${cfg.loai}`);
          return !a || (a.TrangThai === 'LOI' && a.SoLanThu < SO_LAN_THU_TOI_DA && thoiDiem(a.LanThuCuoi) + KHOANG_CACH_THU_LAI_MS <= bayGio);
        })
        .sort((a, b) => a.moc - b.moc)
        .slice(0, SO_DON_TOI_DA_MOI_LUOT);

      for (const { r } of ungVien) {
        const sttKey = r.STT_Key;
        let anh;
        try { anh = await anhTonTai(qt.cotAnh.map(c => r[c]).filter(Boolean)); } catch (err) {
          console.error(`[AutoQC] ${cfg.loai} ${sttKey}: không kiểm tra được ảnh (${err.message}) — thử lượt sau.`);
          continue;
        }
        if (!anh.length) { nhatKy.push({ loai: cfg.loai, sttKey, boQua: 'Ảnh chưa tồn tại thật trên MinIO' }); continue; }
        const giuDuoc = nhatKyDbService.giuQuyenAutoQc(sttKey, cfg.loai, {
          bayGio: new Date(bayGio).toISOString(), truocMoc: new Date(bayGio - KHOANG_CACH_THU_LAI_MS).toISOString(), soLanToiDa: SO_LAN_THU_TOI_DA,
        });
        if (!giuDuoc) { nhatKy.push({ loai: cfg.loai, sttKey, boQua: 'Đã được giành quyền ở nơi khác' }); continue; }
        const lanThu = (nhatKyDbService.layTatCaAutoQc().get(`${sttKey}|${cfg.loai}`) || {}).SoLanThu || 1;
        const thongTinAuto = {
          trang_thai_luc_qc: { xuong: r.TRANG_THAI_XUONG || '', ve_file: r.TRANG_THAI_VE_FILE || '' },
          moc_chuyen_trang_thai: { trang_thai: qt.moTa, cot: qt.cotMoc, luc: r[qt.cotMoc] },
          thoi_gian_cho: { gio: cfg.gio, phut: cfg.phut }, lan_thu: lanThu, so_lan_toi_da: SO_LAN_THU_TOI_DA,
          anh_dieu_kien: anh, thoi_diem_upload: thoiDiemUpload(sttKey, anh),
        };
        try {
          const kq = await qcService.chayQc({ sttKey, loai: cfg.loai, user: NGUOI_CHAY_AUTO, cheDo: 'AUTO', thongTinAuto });
          if (kq.loi) {
            nhatKyDbService.ketThucAutoQc(sttKey, cfg.loai, { trangThai: 'LOI', ketQua: kq.loi.slice(0, 500), qcLogId: kq.id });
            nhatKy.push({ loai: cfg.loai, sttKey, loi: kq.loi });
          } else {
            nhatKyDbService.ketThucAutoQc(sttKey, cfg.loai, { trangThai: 'XONG', ketQua: kq.ketQua.result, qcLogId: kq.id });
            nhatKy.push({ loai: cfg.loai, sttKey, ketQua: kq.ketQua.result });
          }
        } catch (err) { // lỗi nghiệp vụ (đơn biến mất...) — vẫn tính là 1 lần thử LOI, không lặp vô hạn
          nhatKyDbService.ketThucAutoQc(sttKey, cfg.loai, { trangThai: 'LOI', ketQua: String(err.message).slice(0, 500), qcLogId: err.logId || '' });
          nhatKy.push({ loai: cfg.loai, sttKey, loi: err.message });
        }
      }
    }
    if (nhatKy.length) console.log(`[AutoQC] ${nhatKy.map(n => `${n.loai} ${n.sttKey}: ${n.ketQua || (n.loi ? 'LỖI ' + n.loi : 'bỏ qua — ' + n.boQua)}`).join(' | ')}`);
    return nhatKy;
  } catch (err) {
    console.error('[AutoQC] Lỗi lượt quét:', err.message);
    return nhatKy;
  } finally {
    dangChay = false;
  }
}

function batDauLichAutoQc() {
  const n = nhatKyDbService.donDepAutoQcDangChay();
  if (n) console.log(`[AutoQC] ${n} lượt đang chạy dở trước khi khởi động lại -> tính là LỖI (còn được thử lại theo giới hạn).`);
  cron.schedule('*/2 * * * *', () => { chayLuotAutoQc(); });
  console.log('[AutoQC] Đã bật lịch Tự động quét QC (mỗi 2 phút; từng QC bật/tắt ở menu QC).');
}

module.exports = { QUY_TAC, SO_LAN_THU_TOI_DA, layCauHinhAuto, luuCauHinhAuto, chayLuotAutoQc, batDauLichAutoQc };
