// Tự động mua tracking GKE cho đơn đánh dấu AUTO_TRACKING="YES", sau khi đã trôi qua đủ số phút chờ
// tính từ THOI_GIAN_IN_MA (thời điểm chuyển "Đã in mã") — bổ sung 09/09/2026, theo yêu cầu người
// dùng. Xem đầy đủ lý do thiết kế ở
// docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md.
const orderService = require('./orderService');
const gkeService = require('./gkeService');
const { readTab, readTabCached, updateCells, appendRow } = require('./sheetsService');
const { ghiLog } = require('./logService');

const TAB_CAU_HINH = 'CauHinhTracking';
const SO_PHUT_MAC_DINH = 10;

// "Người dùng" hệ thống — dùng khi ghi qua orderService.update()/ghiLog() từ job chạy nền, không có
// ai thật đang đăng nhập. Chưa có tiền lệ nào khác trong dự án (job cảnh báo hiện có ghi thẳng
// updateCells, không qua update()) — CẦN đi qua update() ở đây để tái dùng đúng logic chống mua vận
// đơn trùng đã có (xem muaTrackingChoDon bên dưới), không viết lại logic đó lần 2.
const NGUOI_HE_THONG = { ten: 'Hệ thống (tự động)', vaiTro: 'admin' };

// Đọc cấu hình bật/tắt + số phút chờ. Tab CauHinhTracking do người dùng tự tạo trước (2 cột
// BatTuDongMuaTracking, SoPhutCho) — CHƯA tạo tab/chưa có dòng dữ liệu thì coi như TẮT (mặc định an
// toàn), không chặn phần còn lại của app.
async function layCauHinh() {
  try {
    const { rows } = await readTabCached(TAB_CAU_HINH, 60000);
    const dong = rows[0];
    if (!dong) return { bat: false, soPhutCho: SO_PHUT_MAC_DINH, daCoDongDuLieu: false };
    return {
      bat: String(dong.BatTuDongMuaTracking).toUpperCase() === 'TRUE',
      soPhutCho: Number(dong.SoPhutCho) > 0 ? Number(dong.SoPhutCho) : SO_PHUT_MAC_DINH,
      daCoDongDuLieu: true,
    };
  } catch (e) {
    console.error('[TrackingTuDong] Không đọc được cấu hình (có thể chưa tạo tab CauHinhTracking):', e.message);
    return { bat: false, soPhutCho: SO_PHUT_MAC_DINH, daCoDongDuLieu: false };
  }
}

// Ghi cấu hình — tự thêm dòng đầu tiên nếu tab mới chỉ có header (chưa từng lưu lần nào), các lần
// sau ghi đè đúng dòng đó. Throw rõ ràng nếu tab CHƯA TỒN TẠI (kể cả header) — người dùng phải tự
// tạo tab trước, không tự tạo tab hộ (sheetsService hiện chưa có hàm tạo tab mới).
async function luuCauHinh({ bat, soPhutCho }) {
  const { headers, rows } = await readTab(TAB_CAU_HINH).catch(() => {
    throw new Error(`Chưa tìm thấy tab '${TAB_CAU_HINH}' trong Google Sheet — hãy tạo tab này với 2 cột BatTuDongMuaTracking, SoPhutCho trước.`);
  });
  const giaTri = { BatTuDongMuaTracking: bat ? 'TRUE' : 'FALSE', SoPhutCho: soPhutCho };

  if (rows[0]) {
    await updateCells(TAB_CAU_HINH, headers, rows[0]._row, giaTri);
  } else {
    await appendRow(TAB_CAU_HINH, headers, giaTri);
  }
}

// Mua tracking cho 1 đơn — Y HỆT luồng quét tay (routes/gke.js): tạo vận đơn (nếu chưa từng) → ghi
// placeholder chống trùng → lấy tem → ghi TRACKING_ID/HANG_VAN_CHUYEN thật. KHÔNG đổi TRANG_THAI_XUONG
// (khác luồng quét tay) — đơn tự động mua tracking sớm vẫn còn nguyên trạng thái sản xuất, "ĐÃ DÁN
// TEM" chỉ nên đúng nghĩa khi tem thật được dán lên hộp lúc đóng gói xong (vẫn làm ở scan.html như cũ,
// lúc đó TRACKING_ID đã có sẵn nên chỉ lấy tem in, không tạo vận đơn lần 2).
async function muaTrackingChoDon(sttKey) {
  const { row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
  if (row.TRACKING_ID && row.TRACKING_ID !== gkeService.MA_DANG_CHO_TEM) return null; // đã có tracking thật rồi (vd vừa được quét tay) — bỏ qua

  const chuaTungTaoDon = !row.TRACKING_ID;
  const dangChoTuLanTruoc = row.TRACKING_ID === gkeService.MA_DANG_CHO_TEM;

  if (chuaTungTaoDon) {
    await gkeService.taoDonGke(row);
    await orderService.update(sttKey, { TRACKING_ID: gkeService.MA_DANG_CHO_TEM }, NGUOI_HE_THONG);
  }

  const ketQuaTem = await gkeService.layTemIn(row, { laLanDauSauKhiTao: chuaTungTaoDon || dangChoTuLanTruoc });
  await orderService.update(sttKey, {
    TRACKING_ID: ketQuaTem.tracking_num,
    HANG_VAN_CHUYEN: ketQuaTem.delivery_carrier,
  }, NGUOI_HE_THONG);

  ghiLog({
    nguoiDung: NGUOI_HE_THONG.ten, vaiTro: NGUOI_HE_THONG.vaiTro, hanhDong: 'TU_DONG_MUA_TRACKING',
    sttKey, chiTiet: { trackingNum: ketQuaTem.tracking_num, hangVanChuyen: ketQuaTem.delivery_carrier },
  }).catch(err => console.error('[TrackingTuDong] Lỗi ghi log nền:', err.message));

  return ketQuaTem;
}

// 1 lượt quét — gọi từ services/trackingJob.js (cron mỗi 2 phút). Lỗi ở 1 đơn (thiếu địa chỉ, GKE từ
// chối...) chỉ log, KHÔNG dừng cả lượt quét — đơn đó tự thử lại ở lượt sau.
async function chayQuetTuDongMuaTracking() {
  const cauHinh = await layCauHinh();
  if (!cauHinh.bat) return { daQuet: false, soDonDaMua: 0 };

  const { rows } = await orderService.getAll();
  const bayGio = Date.now();
  const nguongMs = cauHinh.soPhutCho * 60 * 1000;

  const donDuDieuKien = rows.filter(r => {
    if (String(r.AUTO_TRACKING).toUpperCase() !== 'YES') return false;
    if (r.TRACKING_ID && r.TRACKING_ID !== gkeService.MA_DANG_CHO_TEM) return false; // đã có tracking thật
    if (!r.THOI_GIAN_IN_MA) return false;
    const thoiDiem = new Date(r.THOI_GIAN_IN_MA).getTime();
    if (isNaN(thoiDiem)) return false;
    return (bayGio - thoiDiem) >= nguongMs;
  });

  let soDonDaMua = 0;
  for (const don of donDuDieuKien) {
    try {
      const ketQua = await muaTrackingChoDon(don.STT_Key);
      if (ketQua) soDonDaMua++;
    } catch (err) {
      console.error(`[TrackingTuDong] Lỗi mua tracking cho ${don.STT_Key}:`, err.message);
    }
  }

  return { daQuet: true, soDonDaMua, tongSoDuDieuKien: donDuDieuKien.length };
}

// Danh sách MỌI đơn AUTO_TRACKING="YES" kèm trạng thái — dùng cho trang public/tracking.html.
async function layDanhSachDonAutoTracking() {
  const [{ rows }, cauHinh] = await Promise.all([orderService.getAll(), layCauHinh()]);
  const bayGio = Date.now();
  const nguongMs = cauHinh.soPhutCho * 60 * 1000;

  return rows
    .filter(r => String(r.AUTO_TRACKING).toUpperCase() === 'YES')
    .map(r => {
      const daCoTrackingThat = !!r.TRACKING_ID && r.TRACKING_ID !== gkeService.MA_DANG_CHO_TEM;
      const dangChoTem = r.TRACKING_ID === gkeService.MA_DANG_CHO_TEM;
      const thoiDiemInMa = r.THOI_GIAN_IN_MA ? new Date(r.THOI_GIAN_IN_MA).getTime() : null;
      const daDuGio = thoiDiemInMa && !isNaN(thoiDiemInMa) ? (bayGio - thoiDiemInMa) >= nguongMs : false;

      let trangThai;
      if (daCoTrackingThat) trangThai = 'DA_MUA';
      else if (dangChoTem) trangThai = 'DANG_CHO_TEM';
      else if (!thoiDiemInMa || isNaN(thoiDiemInMa)) trangThai = 'THIEU_THOI_GIAN_IN_MA';
      else if (daDuGio) trangThai = 'DEN_HAN_CHO_XU_LY';
      else trangThai = 'DANG_CHO';

      return {
        sttKey: r.STT_Key,
        trangThai,
        trackingId: daCoTrackingThat ? r.TRACKING_ID : '',
        hangVanChuyen: daCoTrackingThat ? (r.HANG_VAN_CHUYEN || '') : '',
        thoiGianInMa: r.THOI_GIAN_IN_MA || '',
        thoiGianCapNhatCuoi: r.ThoiGianCapNhatCuoi || '',
      };
    })
    .sort((a, b) => new Date(b.thoiGianCapNhatCuoi || 0) - new Date(a.thoiGianCapNhatCuoi || 0));
}

module.exports = { layCauHinh, luuCauHinh, chayQuetTuDongMuaTracking, layDanhSachDonAutoTracking };
