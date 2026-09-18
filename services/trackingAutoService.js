// Tự động mua tracking GKE cho đơn đánh dấu AUTO_TRACKING="YES", sau khi đã trôi qua đủ số phút chờ
// tính từ THOI_GIAN_IN_MA (thời điểm chuyển "Đã in mã") — bổ sung 09/09/2026, theo yêu cầu người
// dùng. Xem đầy đủ lý do thiết kế ở
// docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md.
const orderService = require('./orderService');
const gkeService = require('./gkeService');
const nhatKyDbService = require('./nhatKyDbService');
const caiDatDbService = require('./caiDatDbService');
const { ghiLog } = require('./logService');
const { dinhDangNgayGioNgan } = require('./dateUtils');

const SO_PHUT_MAC_DINH = 10;

// "Người dùng" hệ thống — dùng khi ghi qua orderService.update()/ghiLog() từ job chạy nền, không có
// ai thật đang đăng nhập. Chưa có tiền lệ nào khác trong dự án (job cảnh báo hiện có ghi thẳng
// updateCells, không qua update()) — CẦN đi qua update() ở đây để tái dùng đúng logic chống mua vận
// đơn trùng đã có (xem muaTrackingChoDon bên dưới), không viết lại logic đó lần 2.
const NGUOI_HE_THONG = { ten: 'Hệ thống (tự động)', vaiTro: 'admin' };

// Log NGẮN GỌN (mỗi việc 1 dòng) cho tính năng này, xem NGAY trên trang "Tracking" — bổ sung
// 09/09/2026, theo yêu cầu người dùng (chọn mức "ngắn gọn", không phải log kỹ thuật chi tiết từng
// bước gọi GKE — mức đó vẫn chỉ xem qua console server như cũ). Mảng trong bộ nhớ, mất khi restart
// server — cùng đánh đổi chấp nhận được như services/presenceService.js. Giới hạn số dòng để không
// phình bộ nhớ vô hạn qua thời gian dài chạy.
const SO_DONG_LOG_TOI_DA = 300;
const _logs = []; // { luc: ISOString, dong: string }

function ghiLogTracking(dong) {
  _logs.push({ luc: new Date().toISOString(), dong });
  if (_logs.length > SO_DONG_LOG_TOI_DA) _logs.shift();
}

function layLogTracking() {
  return [..._logs].reverse(); // mới nhất trước
}

// Ghi 1 dòng log CHI TIẾT cho tracking (bổ sung 09/09/2026 lần 4, theo yêu cầu người dùng: "ghi toàn
// bộ Logs chi tiết cho phần tracking (gồm cả thủ công và tự động)") — đây là bản ghi LÂU DÀI, khác hẳn
// _logs (bộ nhớ, ngắn gọn, mất khi restart) ở trên: mỗi dòng chứa TOÀN BỘ log kỹ thuật từng bước gọi
// GKE (y hệt console server, xem gkeService.js#ghi/ghiLoi + tham số nhatKy truyền xuyên suốt
// taoDonGke/layTemIn), không chỉ 1 câu tóm tắt.
//
// Chuyển sang SQLite (bổ sung 19/09/2026, theo yêu cầu người dùng — xem
// docs/superpowers/specs/2026-09-19-nhat-ky-sqlite-design.md, services/nhatKyDbService.js), không còn
// ghi vào tab Sheet "LogsTracking" nữa. KHÔNG BAO GIỜ throw — lỗi ghi (dù giờ khó xảy ra hơn hẳn so
// với ghi Sheet qua mạng) chỉ console.error, không được làm hỏng luồng mua tracking THẬT đang chạy
// (cùng triết lý ghiLog() trong logService.js).
//
// Cột ThoiGian vẫn giữ NGUYÊN định dạng dinhDangNgayGioNgan() — "09-09 06:59:25" (DD-MM HH:mm:ss, giờ
// VN, KHÔNG có năm, bổ sung 09/09/2026 lần 7) dù nay không còn lý do "dễ xem trực tiếp trên Sheet" nữa
// — giữ nguyên để không đổi hành vi ngoài phạm vi migrate lần này (đổi định dạng thời gian là quyết
// định khác, cần hỏi riêng nếu muốn làm).
async function ghiLogTrackingVaoDb({ sttKey, nguon, nguoiDung, vaiTro, ketQua, trackingId = '', hangVanChuyen = '', chiTiet = '' }) {
  try {
    nhatKyDbService.ghiLogsTracking({
      ThoiGian: dinhDangNgayGioNgan(new Date()),
      STT_Key: sttKey,
      Nguon: nguon,
      NguoiDung: nguoiDung,
      VaiTro: vaiTro,
      KetQua: ketQua,
      TRACKING_ID: trackingId,
      HANG_VAN_CHUYEN: hangVanChuyen,
      ChiTiet: chiTiet,
    });
  } catch (err) {
    console.error('[TrackingTuDong] Lỗi ghi log chi tiết tracking:', err.message);
  }
}

// Đọc cấu hình bật/tắt + số phút chờ — bảng SQLite cau_hinh_tracking (bổ sung 19/09/2026, xem
// services/caiDatDbService.js). Chưa từng lưu lần nào (chưa migrate/chưa ai lưu) thì coi như TẮT (mặc
// định an toàn), không chặn phần còn lại của app.
async function layCauHinh() {
  const dong = caiDatDbService.layCauHinhTracking();
  if (!dong) return { bat: false, soPhutCho: SO_PHUT_MAC_DINH, daCoDongDuLieu: false };
  return {
    bat: String(dong.BatTuDongMuaTracking).toUpperCase() === 'TRUE',
    soPhutCho: Number(dong.SoPhutCho) > 0 ? Number(dong.SoPhutCho) : SO_PHUT_MAC_DINH,
    daCoDongDuLieu: true,
  };
}

// Ghi cấu hình — UPSERT ghi 1 phần (chỉ BatTuDongMuaTracking/SoPhutCho, không đụng các cột Gke* mà
// gkeService.js#luuCauHinhGke ghi riêng trên CÙNG dòng — xem caiDatDbService.js#datCauHinhTracking).
async function luuCauHinh({ bat, soPhutCho }) {
  caiDatDbService.datCauHinhTracking({ BatTuDongMuaTracking: bat ? 'TRUE' : 'FALSE', SoPhutCho: soPhutCho });
}

// Mua tracking cho 1 đơn — tạo vận đơn (nếu chưa từng) → ghi placeholder chống trùng → lấy tem → ghi
// TRACKING_ID/HANG_VAN_CHUYEN thật. KHÔNG đổi TRANG_THAI_XUONG — việc mua tracking (hàm này) và việc
// đổi trạng thái "ĐÃ DÁN TEM" (qua chụp ảnh xác nhận, xem routes/photos.js mốc da_dan_tem) là 2 THAO
// TÁC riêng, nhưng KHÔNG độc lập: từ 09/09/2026 lần 5, theo yêu cầu người dùng, đơn BẮT BUỘC phải chạy
// qua hàm này lấy được TRACKING_ID thật TRƯỚC thì mới chuyển sang "ĐÃ DÁN TEM" được (chặn ở
// services/orderService.js#kiemTraCongAnhBatBuoc, áp dụng cho mọi người gọi kể cả admin) — thứ tự bắt
// buộc: mua tracking trước, chụp ảnh ĐÃ DÁN TEM sau. Có TRACKING_ID thật mà chưa "ĐÃ DÁN TEM" thì vẫn
// hợp lệ (đơn đang chờ dán tem thật lên kiện).
// `user` mặc định = "người dùng hệ thống" (job tự động gọi không truyền gì thêm) — routes/tracking.js
// #POST /mua-thu-cong TRUYỀN người admin đang đăng nhập thật vào đây, để log ghi đúng AI đã bấm mua
// thủ công thay vì luôn hiện "Hệ thống (tự động)".
//
// GHI LOG CẢ THÀNH CÔNG LẪN LỖI ngay tại đây (bổ sung 09/09/2026, theo yêu cầu người dùng "ghi logs
// chi tiết với đơn mua Tracking thủ công và Tracking tự động") — trước đó lỗi ở luồng THỦ CÔNG hoàn
// toàn KHÔNG được ghi vào Logs xem trên web (chỉ hiện qua alert() nhất thời cho đúng người bấm, ai
// khác không biết), chỉ luồng tự động (chayQuetTuDongMuaTracking) mới log lỗi. Chuyển việc log lỗi
// vào ĐÂY (rồi throw lại) để CẢ 3 nơi gọi hàm này (job tự động, POST /mua-thu-cong cho cả nút đơn lẻ
// lẫn nút hàng loạt) đều tự động được ghi log đầy đủ, không phải lặp lại try/catch+log ở từng nơi gọi.
// Mỗi dòng log gắn nhãn nguồn [Tự động]/[Thủ công - <tên>] ở đầu để phân biệt rõ ngay khi lướt qua,
// không phải suy luận "không có hậu tố nghĩa là tự động" như cách làm cũ.
async function muaTrackingChoDon(sttKey, cauHinhGke, user = NGUOI_HE_THONG) {
  const laThuCong = user !== NGUOI_HE_THONG;
  const nhanNguon = laThuCong ? `[Thủ công - ${user.ten}]` : '[Tự động]';
  const nguonSheet = laThuCong ? 'Thủ công' : 'Tự động';
  // Gộp TOÀN BỘ log kỹ thuật từng bước gọi GKE (đăng nhập/tạo đơn/in tem) vào đây, truyền xuyên suốt
  // qua gkeService.taoDonGke()/layTemIn() — xem gkeService.js#ghi/ghiLoi. Dùng cho cột ChiTiet ở
  // ghiLogTrackingVaoDb() bên dưới, y hệt nội dung sẽ in ra console server.
  const nhatKy = [];

  try {
    const { headers, row } = await orderService.getByKey(sttKey, { fresh: true });
    if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
    if (row.TRACKING_ID) {
      ghiLogTrackingVaoDb({
        sttKey, nguon: nguonSheet, nguoiDung: user.ten, vaiTro: user.vaiTro,
        ketQua: 'Bỏ qua', chiTiet: 'Đơn này đã có mã tracking thật rồi — không mua lại.',
      });
      return null; // đã có tracking thật rồi (vd vừa được quét tay) — bỏ qua
    }
    // Từ 12/09/2026 lần 14, theo yêu cầu người dùng: trạng thái "đang chờ tem" KHÔNG còn ghi tạm vào
    // TRACKING_ID nữa (cột này giờ LUÔN chỉ là rỗng hoặc mã thật) — chuyển hẳn sang cột TAM_THOI, người
    // dùng tự thêm vào Sheet. Kiểm tra cột tồn tại NGAY TỪ ĐẦU (trước khi gọi GKE tạo đơn thật) — thiếu
    // cột thì dừng hẳn ở đây, không được để mất dấu "đã tạo đơn thật hay chưa" giữa chừng (rủi ro tạo
    // trùng vận đơn thật nếu ghi TAM_THOI thất bại ngay sau khi gọi taoDonGke() thành công).
    if (!headers.includes('TAM_THOI')) {
      throw new Error('Chưa có cột TAM_THOI trong tab Don_Hang_ALL — cần thêm cột này (đánh dấu đơn đang chờ tem GKE) trước khi mua tracking.');
    }

    const chuaTungTaoDon = !row.TAM_THOI;
    const dangChoTuLanTruoc = row.TAM_THOI === gkeService.MA_DANG_CHO_TEM;

    if (chuaTungTaoDon) {
      await gkeService.taoDonGke(row, cauHinhGke, nhatKy);
      await orderService.update(sttKey, { TAM_THOI: gkeService.MA_DANG_CHO_TEM }, user);
    }

    const ketQuaTem = await gkeService.layTemIn(row, cauHinhGke, { laLanDauSauKhiTao: chuaTungTaoDon || dangChoTuLanTruoc }, nhatKy);
    await orderService.update(sttKey, {
      TRACKING_ID: ketQuaTem.tracking_num,
      HANG_VAN_CHUYEN: ketQuaTem.delivery_carrier,
      TAM_THOI: '', // đã có tracking thật — không còn "tạm" nữa
    }, user);

    ghiLogTracking(`${nhanNguon} ${sttKey}: đã mua tracking ${ketQuaTem.tracking_num} (${ketQuaTem.delivery_carrier})`);
    ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: laThuCong ? 'MUA_TRACKING_THU_CONG' : 'TU_DONG_MUA_TRACKING',
      sttKey, chiTiet: { trackingNum: ketQuaTem.tracking_num, hangVanChuyen: ketQuaTem.delivery_carrier },
    }).catch(err => console.error('[TrackingTuDong] Lỗi ghi log nền:', err.message));
    ghiLogTrackingVaoDb({
      sttKey, nguon: nguonSheet, nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công',
      trackingId: ketQuaTem.tracking_num, hangVanChuyen: ketQuaTem.delivery_carrier, chiTiet: nhatKy.join('\n'),
    });

    return ketQuaTem;
  } catch (err) {
    ghiLogTracking(`${nhanNguon} ${sttKey}: LỖI — ${err.message}`);
    ghiLogTrackingVaoDb({
      sttKey, nguon: nguonSheet, nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi',
      chiTiet: nhatKy.concat(`LỖI: ${err.message}`).join('\n'),
    });
    throw err;
  }
}

// Trạng thái TRANG_THAI_XUONG tối thiểu để được IN LABEL — bổ sung 09/09/2026 lần 2, theo yêu cầu
// người dùng: 2 nút "IN LABEL"/"MUA TRACKING và IN LABEL" (khác nút "Mua Tracking" gốc phía trên,
// KHÔNG kiểm tra trạng thái) phải bắt buộc đơn đã sản xuất xong mới cho in — tránh lãng phí tem thật
// cho đơn còn chưa sẵn sàng gửi đi. Giống hệt điều kiện chụp ảnh xác nhận ĐÃ DÁN TEM (routes/photos.js,
// mốc da_dan_tem) và TRANG_THAI_NGUON_HOP_LE_CHO_DAN_TEM (services/orderService.js).
// (Đổi từ 'Đã đóng gói' sang 'Đã sản xuất' 09/09/2026 lần 3 — XOÁ "Đã đóng gói" khỏi hệ thống, xem
// data/pipelineTinhTrang.js.)
const TRANG_THAI_DU_DIEU_KIEN_IN_LABEL = ['Đã sản xuất', 'ĐÃ DÁN TEM'];

function kiemTraDieuKienInLabel(row) {
  if (!TRANG_THAI_DU_DIEU_KIEN_IN_LABEL.includes(row.TRANG_THAI_XUONG)) {
    throw new Error(`Đơn đang ở "${row.TRANG_THAI_XUONG}" — phải "Đã sản xuất" hoặc "ĐÃ DÁN TEM" mới in được label.`);
  }
}

// Đánh dấu đơn ĐÃ in label — cột IN_LABEL (YES/NO, người dùng tự thêm 09/09/2026) + THOI_GIAN_IN_LABEL
// (mốc thời gian lần in gần nhất, CÙNG khuôn THOI_GIAN_IN_MA — người dùng cần tự thêm cột này vào Sheet
// nếu muốn dùng). Cả 2 cột đều TUỲ CHỌN (guard headers.includes) — chưa thêm cột nào thì bỏ qua việc
// ghi cờ này, KHÔNG được làm hỏng việc in label thật (đã in được rồi thì không nên báo lỗi ngược lại).
// Tự đọc fresh riêng (không nhận headers/row từ nơi gọi) — đơn giản hơn cho các hàm gọi bên dưới, đổi
// lại tốn thêm 1 lượt đọc Sheet, chấp nhận được vì đây là thao tác thủ công, không phải đường nóng.
async function ghiDaInLabel(sttKey, user) {
  const { headers, row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) return;
  const capNhat = {
    ...(headers.includes('IN_LABEL') ? { IN_LABEL: 'YES' } : {}),
    ...(headers.includes('THOI_GIAN_IN_LABEL') ? { THOI_GIAN_IN_LABEL: dinhDangNgayGioNgan(new Date()) } : {}),
  };
  if (Object.keys(capNhat).length === 0) return;
  await orderService.update(sttKey, capNhat, user, { donDaDoc: { headers, row } });
}

// "IN LABEL" — chỉ IN LẠI tem cho đơn ĐÃ có tracking thật, không mua/tạo vận đơn gì thêm (bổ sung
// 09/09/2026 lần 2, theo yêu cầu người dùng). Dùng lại ĐÚNG gkeService.layTemIn() — gọi từ Đơn hàng/
// Đơn hàng chi tiết/Tracking. KHÔNG liên quan gì tới việc đổi TRANG_THAI_XUONG sang "ĐÃ DÁN TEM" (việc
// đó nay làm qua chụp ảnh xác nhận thuần, xem routes/photos.js mốc da_dan_tem) — chỉ yêu cầu đơn đang
// "Đã sản xuất"/"ĐÃ DÁN TEM" và đã có tracking thật để có gì mà in lại (xem kiemTraDieuKienInLabel).
async function inLabelChoDon(sttKey, cauHinhGke, user) {
  const nhatKy = [];
  const { row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);

  try {
    kiemTraDieuKienInLabel(row);
    if (!row.TRACKING_ID) {
      throw new Error('Đơn chưa có mã tracking thật — dùng nút "MUA TRACKING và IN LABEL" thay vì "IN LABEL".');
    }

    const ketQuaTem = await gkeService.layTemIn(row, cauHinhGke, { laLanDauSauKhiTao: false }, nhatKy);
    await ghiDaInLabel(sttKey, user);

    ghiLogTrackingVaoDb({
      sttKey, nguon: 'In label', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công',
      trackingId: row.TRACKING_ID, hangVanChuyen: row.HANG_VAN_CHUYEN, chiTiet: nhatKy.join('\n'),
    });
    return ketQuaTem;
  } catch (err) {
    ghiLogTrackingVaoDb({
      sttKey, nguon: 'In label', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi',
      chiTiet: nhatKy.concat(`LỖI: ${err.message}`).join('\n'),
    });
    throw err;
  }
}

// "MUA TRACKING và IN LABEL" — 1 nút làm CẢ 2 việc (bổ sung 09/09/2026 lần 2, theo yêu cầu người
// dùng): đơn CHƯA có tracking thì mua trước (dùng lại muaTrackingChoDon(), đã tự lấy tem trong lúc mua
// nên KHÔNG cần gọi GKE thêm lần nào cho bước in — label_base64 đã có sẵn trong kết quả trả về); đơn
// ĐÃ có tracking thật rồi thì bỏ qua bước mua, chỉ in lại (uỷ quyền thẳng cho inLabelChoDon() ở trên,
// hàm đó tự ghi log riêng của nó — TRÁNH ghi log trùng lặp 2 lần cho cùng 1 lần in).
// Bắt buộc "Đã sản xuất"/"ĐÃ DÁN TEM" cho CẢ 2 nhánh — khác nút "Mua Tracking" gốc (không kiểm tra
// trạng thái): đã xác nhận với người dùng, 2 nút MỚI này dành riêng cho lúc chuẩn bị gửi hàng, không
// phải để lấy mã tracking sớm như nút gốc.
async function muaTrackingVaInLabelChoDon(sttKey, cauHinhGke, user) {
  const { row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);

  try {
    kiemTraDieuKienInLabel(row);
  } catch (err) {
    ghiLogTrackingVaoDb({
      sttKey, nguon: 'Mua tracking + In label', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi',
      chiTiet: `LỖI: ${err.message}`,
    });
    throw err;
  }

  const daCoTrackingThat = !!row.TRACKING_ID;
  if (daCoTrackingThat) {
    return inLabelChoDon(sttKey, cauHinhGke, user);
  }

  const ketQuaTem = await muaTrackingChoDon(sttKey, cauHinhGke, user); // tự ghi log riêng (Nguồn "Thủ công"), cả 2 chiều
  if (!ketQuaTem) throw new Error('Đơn vừa được mua tracking bởi người khác — thử lại thao tác này.');

  await ghiDaInLabel(sttKey, user);
  ghiLogTrackingVaoDb({
    sttKey, nguon: 'Mua tracking + In label', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công',
    trackingId: ketQuaTem.tracking_num, hangVanChuyen: ketQuaTem.delivery_carrier,
    chiTiet: 'Đơn chưa có tracking — đã mua tracking mới và in label ngay (xem dòng log "Thủ công" liền trước để biết chi tiết kỹ thuật bước mua tracking).',
  });
  return ketQuaTem;
}

// 1 lượt quét — gọi từ services/trackingJob.js (cron mỗi 2 phút). Lỗi ở 1 đơn (thiếu địa chỉ, GKE từ
// chối...) chỉ log, KHÔNG dừng cả lượt quét — đơn đó tự thử lại ở lượt sau.
async function chayQuetTuDongMuaTracking() {
  const cauHinh = await layCauHinh();
  if (!cauHinh.bat) return { daQuet: false, soDonDaMua: 0 };

  const [{ rows }, cauHinhGke] = await Promise.all([orderService.getAll(), gkeService.layCauHinhGke()]);
  const bayGio = Date.now();
  const nguongMs = cauHinh.soPhutCho * 60 * 1000;

  const donDuDieuKien = rows.filter(r => {
    if (String(r.AUTO_TRACKING).toUpperCase() !== 'YES') return false;
    if (r.TRACKING_ID) return false; // đã có tracking thật
    if (!r.THOI_GIAN_IN_MA) return false;
    const thoiDiem = new Date(r.THOI_GIAN_IN_MA).getTime();
    if (isNaN(thoiDiem)) return false;
    return (bayGio - thoiDiem) >= nguongMs;
  });

  let soDonDaMua = 0;
  for (const don of donDuDieuKien) {
    try {
      const ketQua = await muaTrackingChoDon(don.STT_Key, cauHinhGke);
      if (ketQua) soDonDaMua++;
    } catch (err) {
      // Đã ghi vào layLogTracking() BÊN TRONG muaTrackingChoDon() rồi (xem ghi chú ở đó) — ở đây chỉ
      // cần in thêm ra console server để xem full stack khi cần debug sâu hơn dòng log ngắn gọn.
      console.error(`[TrackingTuDong] Lỗi mua tracking cho ${don.STT_Key}:`, err.message);
    }
  }

  return { daQuet: true, soDonDaMua, tongSoDuDieuKien: donDuDieuKien.length };
}

// ============================================================
// CẬP NHẬT TRẠNG THÁI TRACKING THẬT (bổ sung 14/09/2026, theo yêu cầu người dùng — xem
// docs/superpowers/specs/2026-09-14-cap-nhat-trang-thai-tracking-design.md). HOÀN TOÀN TÁCH BIỆT khỏi
// việc mua tracking ở trên — chỉ ĐỌC trạng thái vận chuyển thật từ GKE (đơn ĐÃ có TRACKING_ID rồi) và
// ghi vào 2 cột MỚI, người dùng tự thêm vào Sheet: TRANG_THAI_TRACKING (mô tả mới nhất, tiếng Việt) +
// THOI_GIAN_CAP_NHAT_TRACKING (mốc tra cứu thành công gần nhất). KHÔNG đụng TRANG_THAI_XUONG hay bất kỳ
// cột pipeline nào khác — đã xác nhận rõ với người dùng, đây thuần là cột thông tin để xem.
// ============================================================

// Cập nhật cho ĐÚNG 1 đơn — bỏ qua sớm (không gọi GKE) nếu Sheet chưa có CẢ 2 cột đích, và nếu GKE
// chưa có sự kiện tracking nào (mảng rỗng, label vừa tạo) thì cũng bỏ qua, thử lại ở lượt quét sau.
// Trả {ok:false, lyDo} cho 3 trường hợp "không có gì để làm" này (KHÔNG throw — không phải lỗi thật,
// tự thử lại được ở lượt sau) — vẫn THROW bình thường cho lỗi GKE/ghi Sheet thật (giữ đúng khuôn
// muaTrackingChoDon() ở trên: throw cho lỗi thật, trả sentinel cho trường hợp "bỏ qua có chủ đích").
// Trả {ok:true, suKien} khi ghi thành công — `lyDo` (bổ sung 14/09/2026, theo yêu cầu người dùng, cho
// nút "Tracking thủ công" ở routes/tracking.js hiện rõ LÝ DO thay vì chỉ biết chung chung "không có gì
// mới") dùng ĐƯỢC cho cả job tự động (chỉ cần `.ok`, bỏ qua `.lyDo`) lẫn route thủ công (cần cả 2).
async function capNhatTrangThaiTrackingChoDon(sttKey, cauHinhGke) {
  const { headers, row } = await orderService.getByKey(sttKey, { fresh: true });
  if (!row) return { ok: false, lyDo: 'Không tìm thấy đơn: ' + sttKey };

  const coCotTrangThai = headers.includes('TRANG_THAI_TRACKING');
  const coCotThoiGian = headers.includes('THOI_GIAN_CAP_NHAT_TRACKING');
  if (!coCotTrangThai && !coCotThoiGian) {
    return { ok: false, lyDo: 'Sheet chưa có cột TRANG_THAI_TRACKING hoặc THOI_GIAN_CAP_NHAT_TRACKING — cần thêm ít nhất 1 trong 2 cột vào tab Don_Hang_ALL trước.' };
  }

  const lichSu = await gkeService.layLichSuTrackingGke(sttKey, cauHinhGke, []);
  if (lichSu.length === 0) {
    return { ok: false, lyDo: 'GKE chưa có sự kiện tracking nào cho đơn này (có thể vừa tạo nhãn, chưa được đơn vị vận chuyển quét nhận).' };
  }

  const suKienMoiNhat = lichSu[lichSu.length - 1];
  const capNhat = {
    ...(coCotTrangThai ? { TRANG_THAI_TRACKING: suKienMoiNhat.track_name || suKienMoiNhat.track_name_en || '' } : {}),
    ...(coCotThoiGian ? { THOI_GIAN_CAP_NHAT_TRACKING: dinhDangNgayGioNgan(new Date()) } : {}),
  };
  await orderService.update(sttKey, capNhat, NGUOI_HE_THONG, { donDaDoc: { headers, row } });
  return { ok: true, suKien: suKienMoiNhat };
}

// 1 lượt quét — gọi từ services/trackingJob.js (cron mỗi vài giờ, thấp hơn hẳn lịch mua tracking vì
// trạng thái vận chuyển đổi chậm hơn nhiều). Quét MỌI đơn đã có TRACKING_ID — chưa lọc bớt đơn đã ở
// trạng thái cuối (giao xong/trả xong) vì cần thêm cột lưu mã trạng thái gốc mới suy được đáng tin cậy
// (xem mục 4 trong file thiết kế) — để bản sau nếu số lượng đơn/giới hạn gọi GKE thật sự thành vấn đề.
// Lỗi ở 1 đơn chỉ log console, KHÔNG dừng cả lượt — đơn đó tự thử lại ở lượt sau.
async function chayQuetCapNhatTrangThaiTracking() {
  const [{ rows }, cauHinhGke] = await Promise.all([orderService.getAll(), gkeService.layCauHinhGke()]);
  const donCoTracking = rows.filter(r => r.TRACKING_ID);

  let soDaCapNhat = 0;
  for (const don of donCoTracking) {
    try {
      const ketQua = await capNhatTrangThaiTrackingChoDon(don.STT_Key, cauHinhGke);
      if (ketQua.ok) soDaCapNhat++;
    } catch (err) {
      console.error(`[TrackingTuDong] Lỗi tra cứu trạng thái tracking cho ${don.STT_Key}:`, err.message);
    }
  }

  return { daQuet: true, soDaCapNhat, tongSoCoTracking: donCoTracking.length };
}

// Danh sách MỌI đơn AUTO_TRACKING="YES" kèm trạng thái — dùng cho trang public/tracking.html. Lọc
// theo Xưởng của `user` (bổ sung 13/09/2026, theo yêu cầu người dùng — admin xem hết, vai trò khác
// chỉ thấy đơn cùng Xưởng, xem orderService.js#locTheoXuong) — hàm này CHỈ dùng cho route GET
// /tracking/danh-sach (không dùng bởi job tự động chayQuetTuDongMuaTracking(), vốn phải xử lý MỌI
// xưởng), nên lọc thẳng ở đây an toàn, không ảnh hưởng job nền.
async function layDanhSachDonAutoTracking(user) {
  const [{ rows: tatCaDon }, cauHinh] = await Promise.all([orderService.getAll(), layCauHinh()]);
  const rows = orderService.locTheoXuong(tatCaDon, user);
  const bayGio = Date.now();
  const nguongMs = cauHinh.soPhutCho * 60 * 1000;

  return rows
    .filter(r => String(r.AUTO_TRACKING).toUpperCase() === 'YES')
    .map(r => {
      const daCoTrackingThat = !!r.TRACKING_ID;
      const dangChoTem = !r.TRACKING_ID && r.TAM_THOI === gkeService.MA_DANG_CHO_TEM;
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

module.exports = {
  layCauHinh, luuCauHinh, chayQuetTuDongMuaTracking, layDanhSachDonAutoTracking, layLogTracking,
  muaTrackingChoDon, inLabelChoDon, muaTrackingVaInLabelChoDon,
  capNhatTrangThaiTrackingChoDon, chayQuetCapNhatTrangThaiTracking,
};
