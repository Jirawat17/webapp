// Tự động mua tracking GKE — bổ sung 09/09/2026, theo yêu cầu người dùng (thiết kế gốc ở
// docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md). ĐỔI 29/09/2026, theo yêu cầu người dùng:
// bỏ điều kiện AUTO_TRACKING="YES" (từ khi chuyển sang SQLite 18/09 không còn chỗ nào đặt cờ này -> job không
// bao giờ tìm thấy đơn), mốc tính giờ chờ đổi từ "Đã in mã" (THOI_GIAN_IN_MA) sang "Đã sản xuất"
// (THOI_GIAN_SAN_XUAT, orderService.js tự ghi) — mua cho đơn từ "Đã sản xuất" trở đi đủ giờ chờ. (Bản trung gian
// cùng ngày dùng mốc "Đang chạy máy" — người dùng đổi lại sang "Đã sản xuất".) Không bù mốc cho đơn đã nằm sẵn ở
// "Đã sản xuất" trước khi có cột này (đã xác nhận: chỉ đơn mới — đơn cũ mua tay nếu cần).
// BỔ SUNG 30/09/2026: HOẶC đủ X giờ (mặc định 48) kể từ "Đã in mã" — điều kiện nào đến trước, xem thoiDiemDenHan.
const orderService = require('./orderService');
const gkeService = require('./gkeService');
const nhatKyDbService = require('./nhatKyDbService');
const caiDatDbService = require('./caiDatDbService');
const sheetSellerService = require('./sheetSellerService');
const telegramService = require('./telegramService');
const { ghiLog } = require('./logService');
const { dinhDangNgayGioNgan, thoiGianVNISOString } = require('./dateUtils');
const trangThaiDbService = require('./trangThaiDbService');
const donNhieuAoService = require('./donNhieuAoService');

const SO_PHUT_MAC_DINH = 10;

// Trạng thái được tự mua (29/09/2026, theo yêu cầu người dùng): "Đã sản xuất" trở đi trên đường chính, trước khi
// giao — KHÔNG mua đơn chưa sản xuất xong, LỖI SẢN XUẤT / huỷ / hoàn (nhánh rẽ) và đơn đã DELIVERED.
const TRANG_THAI_TU_MUA = ['Đã sản xuất', 'ĐÃ DÁN TEM'];
const thoiDiemSanXuat = r => {
  const t = new Date(r.THOI_GIAN_SAN_XUAT || '').getTime();
  return isNaN(t) ? null : t;
};

// Điều kiện BỔ SUNG (30/09/2026, theo yêu cầu người dùng): đơn đã "Đã in mã" đủ X giờ (mặc định 48, chỉnh ở trang
// Tracking) cũng được tự mua — kể cả khi chưa sản xuất xong. Mốc = THOI_GIAN_IN_MA (orderService.js ghi mỗi lần đơn
// chuyển sang "Đã in mã", lần gần nhất), chỉ tính đơn in mã từ MocApDungTheoInMa (lúc deploy) trở đi. Trạng thái
// được mua theo điều kiện này (đã xác nhận): từ "Đã in mã" tới "ĐÃ DÁN TEM" + LỖI SẢN XUẤT; KHÔNG mua đơn bị đưa về
// "Chưa in mã", huỷ, hoàn, đã giao.
const SO_GIO_SAU_IN_MA_MAC_DINH = 48;
const TRANG_THAI_TU_MUA_THEO_IN_MA = ['Đã in mã', 'ĐÃ SẴN SÀNG CHẠY MÁY', 'Đang chạy máy', 'Đã sản xuất', 'LỖI SẢN XUẤT CẦN LÀM LẠI', 'ĐÃ DÁN TEM'];

// Thời điểm (ms) đơn đến hạn tự mua = điều kiện nào đến TRƯỚC: "Đã sản xuất" + số phút chờ, hoặc "Đã in mã" + số giờ.
// null = không thuộc điều kiện nào (chưa từng tới hạn được).
function thoiDiemDenHan(r, cauHinh) {
  const han = [];
  const sx = thoiDiemSanXuat(r);
  if (TRANG_THAI_TU_MUA.includes(r.TRANG_THAI_XUONG) && sx !== null) han.push(sx + cauHinh.soPhutCho * 60 * 1000);
  const inMa = new Date(r.THOI_GIAN_IN_MA || '').getTime();
  if (TRANG_THAI_TU_MUA_THEO_IN_MA.includes(r.TRANG_THAI_XUONG) && inMa >= cauHinh.mocApDungTheoInMa) {
    han.push(inMa + cauHinh.soGioSauInMa * 60 * 60 * 1000);
  }
  return han.length ? Math.min(...han) : null;
}

// Giới hạn thử TỰ ĐỘNG (30/09/2026, theo yêu cầu người dùng): mỗi đơn job tự động thử tối đa 10 lần; lần thứ 10 vẫn lỗi ->
// TU_MUA_CHE_DO = 'THU_CONG', job bỏ qua đơn vĩnh viễn (lưu SQLite, restart không mất) cho tới khi mua tay thành công hoặc
// bấm "Cho tự động thử lại" (trang Tracking). CHỈ đếm lỗi RIÊNG của đơn sau khi đã tới bước gọi GKE (GKE từ chối đơn,
// thiếu/sai thông tin người nhận/quốc gia) — KHÔNG đếm lỗi chung (err.loiChung, gkeService.js: tài khoản/đăng nhập/mất
// kết nối/GKE lỗi) và các điều kiện chặn trước bước GKE. Mua tay lỗi không đếm. Mỗi đơn đã xếp hàng riêng
// (xepHangMuaTracking) + job không chạy chồng lượt -> không đếm trùng.
const SO_LAN_THU_TU_DONG_TOI_DA = 10;
const CHE_DO_THU_CONG = 'THU_CONG';

// Sửa dữ liệu gửi GKE cho đơn đã chuyển mua thủ công (01/10/2026, theo yêu cầu người dùng). Cột THONG_TIN_GKE_CHO_DON_LOI
// (SQLite) = JSON {cột: giá trị}; chỉ 7 cột người nhận dưới đây, CHỈ dùng khi gửi GKE — Sheet giữ nguyên.
const TRUONG_SUA_GKE = {
  MA_ZIPCODE: 'ZIP code', TEN: 'Tên người nhận', SDT: 'Số điện thoại', DIA_CHI_TEN_DUONG: 'Địa chỉ',
  DIA_CHI_TEN_TP: 'Thành phố', DIA_CHI_BANG: 'Bang', DIA_CHI_NUOC: 'Quốc gia',
};
const DO_DAI_GIA_TRI_GKE_TOI_DA = 200;
function docThongTinGke(row) {
  let o;
  try { o = JSON.parse(row.THONG_TIN_GKE_CHO_DON_LOI || '{}'); } catch (e) { return {}; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => Object.hasOwn(TRUONG_SUA_GKE, k) && typeof v === 'string' && v));
}
// Giá trị gốc (Sheet) đúng như lúc gửi GKE — "Địa chỉ" = dòng 1 + dòng 2 đã ghép (gkeService.js#diaChiGuiGke).
const giaTriGocGke = (row, truong) => (truong === 'DIA_CHI_TEN_DUONG' ? gkeService.diaChiGuiGke(row) : row[truong]) || '';
// -> bản sao row đã đè giá trị sửa tay (nếu có) + ghi 1 dòng nhật ký để log mua tracking thấy rõ đã dùng dữ liệu sửa tay.
function apDungThongTinGke(row, nhatKy) {
  const sua = docThongTinGke(row);
  if (!Object.keys(sua).length) return row;
  nhatKy.push(`[Sửa tay dữ liệu gửi GKE] ${Object.entries(sua).map(([k, v]) => `${TRUONG_SUA_GKE[k]}: "${giaTriGocGke(row, k)}" -> "${v}"`).join('; ')}.`);
  // "Địa chỉ" sửa tay = địa chỉ ĐẦY ĐỦ (người dùng chốt 02/10/2026) — không ghép thêm DIA_CHI_TEN_DUONG_2 của Sheet nữa.
  return { ...row, ...sua, ...(sua.DIA_CHI_TEN_DUONG ? { DIA_CHI_TEN_DUONG_2: '' } : {}) };
}
const XOA_THEO_DOI_THU = { TU_MUA_SO_LAN_THU: '', TU_MUA_CHE_DO: '', TU_MUA_LOI_GAN_NHAT: '', TU_MUA_THOI_GIAN_THU: '' };

// Không throw — lỗi ghi chỉ in console (không che lỗi mua gốc).
function ghiNhanLanThuTuDong(row, err) {
  try {
    const soLan = (Number(row.TU_MUA_SO_LAN_THU) || 0) + 1;
    const chuyenThuCong = soLan >= SO_LAN_THU_TU_DONG_TOI_DA;
    trangThaiDbService.ghiDe(row.STT_Key, {
      TU_MUA_SO_LAN_THU: String(soLan), TU_MUA_LOI_GAN_NHAT: err.message, TU_MUA_THOI_GIAN_THU: thoiGianVNISOString(),
      ...(chuyenThuCong ? { TU_MUA_CHE_DO: CHE_DO_THU_CONG } : {}),
    });
    if (!chuyenThuCong) return;
    ghiLogTracking(`[Tự động] ${row.STT_Key}: đã thử ${soLan} lần không mua được — CHUYỂN SANG MUA THỦ CÔNG. Lỗi gần nhất: ${err.message}`, row.STT_Key, true);
    ghiLog({
      nguoiDung: NGUOI_HE_THONG.ten, vaiTro: NGUOI_HE_THONG.vaiTro, hanhDong: 'TU_DONG_MUA_CHUYEN_THU_CONG', sttKey: row.STT_Key,
      chiTiet: { soLanThu: soLan, lyDo: err.message },
    }).catch(e => console.error('[TrackingTuDong] Lỗi ghi log nền:', e.message));
  } catch (e) {
    console.error(`[TrackingTuDong] Lỗi ghi nhận lần thử cho ${row.STT_Key}:`, e.message);
  }
}

// "Người dùng" hệ thống — dùng khi ghi qua orderService.update()/ghiLog() từ job chạy nền, không có
// ai thật đang đăng nhập. Chưa có tiền lệ nào khác trong dự án (job cảnh báo hiện có ghi thẳng
// updateCells, không qua update()) — CẦN đi qua update() ở đây để tái dùng đúng logic chống mua vận
// đơn trùng đã có (xem muaTrackingChoDon bên dưới), không viết lại logic đó lần 2.
const NGUOI_HE_THONG = { ten: 'Hệ thống (tự động)', vaiTro: 'admin' };

// Xếp hàng theo STT_Key (bổ sung 22/09/2026, theo yêu cầu người dùng) — cùng khuôn với
// orderService.js#xepHangTheoDon. Trước đây KHÔNG có khoá nào: cron quét mỗi 2 phút (trackingJob.js)
// và người bấm "Mua ngay"/"Mua thủ công" CHO ĐÚNG 1 đơn có thể trùng thời điểm — cả 2 đều tự đọc
// row.TRACKING_ID/TAM_THOI (thấy "chưa có") TRƯỚC khi lượt còn lại kịp ghi xong, nên cả 2 đều gọi GKE
// tạo đơn thật, chỉ trông chờ GKE tự nhận diện "đã tồn tại" (code 301) — tốn 1 lượt gọi GKE thừa mỗi
// lần trùng, và có khoảng hở thật trước khi GKE kịp nhận diện (xem chú thích guard chống chồng lượt
// CÙNG NGUỒN ở trackingJob.js — guard đó KHÔNG chặn được trùng GIỮA 2 NGUỒN khác nhau như ở đây).
// Khoá RIÊNG theo từng đơn (không khoá toàn cục) — mua tracking cho các đơn khác nhau vẫn chạy song
// song bình thường, không chậm đi.
const _hangDoiMuaTracking = new Map(); // sttKey -> Promise của lượt muaTrackingChoDon() gần nhất đang xếp hàng
function xepHangMuaTracking(sttKey, congViec) {
  const hangCho = (_hangDoiMuaTracking.get(sttKey) || Promise.resolve()).catch(() => {});
  const luotNay = hangCho.then(congViec);
  _hangDoiMuaTracking.set(sttKey, luotNay);
  luotNay.catch(() => {}).finally(() => {
    if (_hangDoiMuaTracking.get(sttKey) === luotNay) _hangDoiMuaTracking.delete(sttKey);
  });
  return luotNay;
}

// Log NGẮN GỌN (mỗi việc 1 dòng) cho tính năng này, xem NGAY trên trang "Tracking" — bổ sung
// 09/09/2026, theo yêu cầu người dùng (chọn mức "ngắn gọn", không phải log kỹ thuật chi tiết từng
// bước gọi GKE — mức đó vẫn chỉ xem qua console server như cũ). Mảng trong bộ nhớ, mất khi restart
// server — cùng đánh đổi chấp nhận được như services/presenceService.js. Giới hạn số dòng để không
// phình bộ nhớ vô hạn qua thời gian dài chạy.
const SO_DONG_LOG_TOI_DA = 300;
const _logs = []; // { luc: ISOString, dong: string, sttKey } — sttKey để lọc theo Xưởng người xem (29/09/2026)

// gioiHanThu: dòng về giới hạn 10 lần thử (30/09/2026) — routes/tracking.js ẩn với vai trò không có menu Tracking.
function ghiLogTracking(dong, sttKey, gioiHanThu = false) {
  _logs.push({ luc: new Date().toISOString(), dong, sttKey, gioiHanThu });
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
// mocApDungTheoInMa: ms, NaN nếu thiếu -> điều kiện "Đã in mã" không áp dụng cho đơn nào (an toàn).
async function layCauHinh() {
  const dong = caiDatDbService.layCauHinhTracking();
  if (!dong) return { bat: false, soPhutCho: SO_PHUT_MAC_DINH, soGioSauInMa: SO_GIO_SAU_IN_MA_MAC_DINH, mocApDungTheoInMa: NaN, daCoDongDuLieu: false };
  return {
    bat: String(dong.BatTuDongMuaTracking).toUpperCase() === 'TRUE',
    soPhutCho: Number(dong.SoPhutCho) > 0 ? Number(dong.SoPhutCho) : SO_PHUT_MAC_DINH,
    soGioSauInMa: Number(dong.SoGioSauInMa) > 0 ? Number(dong.SoGioSauInMa) : SO_GIO_SAU_IN_MA_MAC_DINH,
    mocApDungTheoInMa: new Date(dong.MocApDungTheoInMa || '').getTime(),
    daCoDongDuLieu: true,
  };
}

// Ghi cấu hình — UPSERT ghi 1 phần (chỉ BatTuDongMuaTracking/SoPhutCho/SoGioSauInMa, không đụng các cột Gke* mà
// gkeService.js#luuCauHinhGke ghi riêng trên CÙNG dòng — xem caiDatDbService.js#datCauHinhTracking).
async function luuCauHinh({ bat, soPhutCho, soGioSauInMa }) {
  caiDatDbService.datCauHinhTracking({ BatTuDongMuaTracking: bat ? 'TRUE' : 'FALSE', SoPhutCho: soPhutCho, SoGioSauInMa: soGioSauInMa });
}

// Khoảng cách quét trạng thái tracking thật — bổ sung 21/09/2026, theo yêu cầu người dùng: cho chỉnh
// trực tiếp trên giao diện Tracking (giờ+phút, cùng khuôn SoPhutCho ở trên), KHÔNG cần sửa code/deploy
// lại. node-cron KHÔNG thể biểu diễn "mỗi X giờ Y phút" tuỳ ý bằng 1 pattern cố định (vd 90 phút không
// chia hết cho giờ) — nên KHÔNG đổi lịch cron theo cấu hình. Thay vào đó services/trackingJob.js giữ 1
// lịch tick CỐ ĐỊNH tần suất cao hơn (mỗi 5 phút), còn chayQuetTrangThaiNeuDenLuot() bên dưới tự so
// sánh thời gian đã trôi qua kể từ lần quét trước (ThoiDiemQuetTrangThaiGanNhat — bookkeeping NỘI BỘ,
// KHÔNG hiện trên form cấu hình) với khoảng cách đã cấu hình để quyết định có thực sự quét lượt này hay
// không — cách này biểu diễn được MỌI khoảng thời gian tuỳ ý, không giới hạn bởi cú pháp cron.
const SO_PHUT_QUET_TRANG_THAI_MAC_DINH = 120; // giữ đúng hành vi cũ (2 tiếng) nếu chưa từng cấu hình
const SO_PHUT_QUET_TRANG_THAI_TOI_THIEU = 5; // = đúng tần suất tick ở trackingJob.js, đặt thấp hơn vô nghĩa

function layCauHinhQuetTrangThai() {
  const dong = caiDatDbService.layCauHinhTracking();
  return {
    soPhutQuet: dong && Number(dong.SoPhutQuetTrangThai) > 0 ? Number(dong.SoPhutQuetTrangThai) : SO_PHUT_QUET_TRANG_THAI_MAC_DINH,
  };
}

function luuCauHinhQuetTrangThai({ soPhutQuet }) {
  caiDatDbService.datCauHinhTracking({ SoPhutQuetTrangThai: soPhutQuet });
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
// Từ 27/09/2026 KHÔNG còn nhận cauHinhGke từ nơi gọi — mỗi đơn tự lấy đúng tài khoản GKE của Xưởng mình
// (gkeService.layCauHinhGkeChoDon) BÊN TRONG hàm, vì 1 lô/1 lượt job có thể gồm đơn của nhiều Xưởng.
function muaTrackingChoDon(sttKey, user = NGUOI_HE_THONG) {
  return xepHangMuaTracking(sttKey, () => _muaTrackingChoDonThat(sttKey, user));
}

// DonNhieuAo (bổ sung 26/09/2026) — SAO tracking của đơn ".1" xuống các đơn con chưa có tracking (bỏ qua
// đơn đã huỷ), đánh dấu TRACKING_CHUNG_CUA = đơn ".1", đẩy luôn sang Sheet khách hàng (best-effort, cùng
// cách xử lý với đơn ".1"). `tracking` truyền riêng vì nhom.thanhVien là dữ liệu đọc TRƯỚC lúc mua.
// Chỉ ghi SQLite qua update() — KHÔNG gọi GKE (GKE chỉ biết vận đơn dưới STT_Key của đơn ".1").
async function saoTrackingXuongNhom(nhom, tracking, user) {
  const daSao = [];
  for (const con of nhom.thanhVien) {
    if (con.STT_Key === nhom.donMua.STT_Key || con.TRACKING_ID || con.TRANG_THAI_XUONG === donNhieuAoService.TRANG_THAI_HUY) continue;
    await orderService.update(con.STT_Key, {
      TRACKING_ID: tracking.trackingId,
      HANG_VAN_CHUYEN: tracking.hangVanChuyen,
      TRACKING_CHUNG_CUA: nhom.donMua.STT_Key,
      TRANG_THAI_TRACKING: tracking.trangThaiTracking || '',
      THOI_GIAN_CAP_NHAT_TRACKING: tracking.thoiGianCapNhat || '',
      MA_NODE_TRACKING: tracking.maNode || '',
      MA_TRANG_THAI_NODE_TRACKING: tracking.maTrangThaiNode || '',
      TAI_KHOAN_GKE: tracking.taiKhoanGke || '',
    }, user);
    daSao.push(con.STT_Key);
    ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'DUNG_CHUNG_TRACKING', sttKey: con.STT_Key,
      chiTiet: { trackingNum: tracking.trackingId, hangVanChuyen: tracking.hangVanChuyen, donMua: nhom.donMua.STT_Key, nhom: nhom.goc },
    }).catch(err => console.error('[TrackingTuDong] Lỗi ghi log nền:', err.message));
    ghiLogTrackingVaoDb({
      sttKey: con.STT_Key, nguon: 'DonNhieuAo', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Dùng chung',
      trackingId: tracking.trackingId, hangVanChuyen: tracking.hangVanChuyen,
      chiTiet: `Dùng chung tracking của ${nhom.donMua.STT_Key} (nhóm DonNhieuAo ${nhom.goc}) — không mua riêng.`,
    });
  }
  // Ghi tracking chung (+ Delivered nếu nhóm ĐÃ có trạng thái vận chuyển — đơn con thêm vào sau) vào dòng của
  // TỪNG đơn con trong Sheet Seller (28/09/2026, sheetSellerService.js). Lỗi KHÔNG bỏ qua im lặng: vào danh sách
  // theo dõi + trả loiSheet để nơi gọi (mua tay) hiện hộp đỏ cả cho đơn con.
  let loiSheet = [];
  if (daSao.length) {
    const ketQua = await sheetSellerService.ghiHangLoat(daSao.flatMap(sttKey => [
      { sttKey, loai: 'TRACKING', giaTri: { TRACKING_ID2: tracking.trackingId, HANG_VAN_CHUYEN2: tracking.hangVanChuyen } },
      ...(tracking.trangThaiTracking ? [{ sttKey, loai: 'DELIVERED', giaTri: { Delivered: tracking.trangThaiTracking } }] : []),
    ]), user);
    baoLoiSheetSeller(ketQua, user, 'tracking DonNhieuAo');
    loiSheet = ketQua.filter(k => !k.ok).map(k => ({ sttKey: k.sttKey, lyDo: `${k.loai === 'DELIVERED' ? 'Delivered' : 'Tracking'} (đơn con): ${k.lyDo}` }));
  }
  return { daSao, loiSheet };
}

// Lỗi ghi Sheet Seller: in console; luồng TỰ ĐỘNG (không ai đứng xem) báo thêm 1 tin Telegram tổng hợp.
// Luồng thủ công đã có hộp đỏ trên giao diện. Mọi lỗi đều đã nằm trong danh sách theo dõi.
function baoLoiSheetSeller(ketQua, user, viec) {
  const loi = ketQua.filter(k => !k.ok);
  if (!loi.length) return;
  loi.forEach(k => console.error(`[SheetSeller] Lỗi ghi ${viec} cho ${k.sttKey}: ${k.lyDo}`));
  if (user === NGUOI_HE_THONG) {
    telegramService.guiTinNhan(
      process.env.TELEGRAM_CHATID_TRACKING_KH,
      [
        `⚠️ Ghi ${viec} sang Sheet Seller THẤT BẠI (tự động) — ${loi.length} đơn`,
        ...loi.slice(0, 20).map(k => `${k.sttKey}: ${k.lyDo}`),
        ...(loi.length > 20 ? [`... và ${loi.length - 20} đơn khác`] : []),
        'Xem/đẩy lại ở Trung tâm hành động hoặc Settings.',
      ].join('\n')
    ).catch(() => {});
  }
}

const trackingCuaDon = r => ({
  trackingId: r.TRACKING_ID, hangVanChuyen: r.HANG_VAN_CHUYEN, trangThaiTracking: r.TRANG_THAI_TRACKING,
  thoiGianCapNhat: r.THOI_GIAN_CAP_NHAT_TRACKING, maNode: r.MA_NODE_TRACKING, maTrangThaiNode: r.MA_TRANG_THAI_NODE_TRACKING,
  taiKhoanGke: r.TAI_KHOAN_GKE,
});

// Đồng bộ mọi nhóm mà đơn ".1" ĐÃ có tracking nhưng còn đơn con chưa có (vd đơn con thêm vào Sheet sau
// khi đã mua) — gọi ở mỗi lượt job tự động mua tracking.
async function dongBoTrackingCacNhom(rows) {
  const daXet = new Set();
  for (const nhom of donNhieuAoService.xayDungBanDoNhom(rows).values()) {
    if (daXet.has(nhom.khoa)) continue;
    daXet.add(nhom.khoa);
    if (!nhom.donMua || !nhom.donMua.TRACKING_ID || nhom.loiChan.length) continue;
    try {
      await saoTrackingXuongNhom(nhom, trackingCuaDon(nhom.donMua), NGUOI_HE_THONG);
    } catch (err) {
      console.error(`[DonNhieuAo] Lỗi đồng bộ tracking nhóm ${nhom.goc}:`, err.message);
    }
  }
}

async function _muaTrackingChoDonThat(sttKey, user) {
  const laThuCong = user !== NGUOI_HE_THONG;
  const nhanNguon = laThuCong ? `[Thủ công - ${user.ten}]` : '[Tự động]';
  const nguonSheet = laThuCong ? 'Thủ công' : 'Tự động';
  // Gộp TOÀN BỘ log kỹ thuật từng bước gọi GKE (đăng nhập/tạo đơn/in tem) vào đây, truyền xuyên suốt
  // qua gkeService.taoDonGke()/layTemIn() — xem gkeService.js#ghi/ghiLoi. Dùng cho cột ChiTiet ở
  // ghiLogTrackingVaoDb() bên dưới, y hệt nội dung sẽ in ra console server.
  const nhatKy = [];
  let row;
  let daToiBuocGke = false; // chỉ lỗi từ bước gọi GKE trở đi mới tính là 1 lần thử (ghiNhanLanThuTuDong)

  try {
    const { headers, rows } = await orderService.getAll({ fresh: true });
    row = rows.find(r => r.STT_Key === sttKey);
    if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);
    chanMuaDonDaHuy(row);
    if (!laThuCong && row.TU_MUA_CHE_DO === CHE_DO_THU_CONG) return null; // đã chuyển mua thủ công — job không thử nữa
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

    // DonNhieuAo (bổ sung 26/09/2026) — CHỐT CHẶN DUY NHẤT cho mọi lối mua (job tự động, nút mua đơn
    // lẻ/hàng loạt, "MUA TRACKING và IN LABEL" đều đi qua đây): nhóm lỗi dữ liệu thì không mua; đơn con
    // không bao giờ gọi GKE — chỉ nhận bản sao tracking của đơn ".1" (nếu đơn ".1" đã có).
    const nhom = donNhieuAoService.layNhomCuaDon(sttKey, rows);
    if (nhom && nhom.loiChan.length) {
      throw new Error(`[DonNhieuAo ${nhom.goc}] ${nhom.loiChan.join(' ')} Sửa dữ liệu rồi thử lại.`);
    }
    if (nhom && nhom.donMua.STT_Key !== sttKey) {
      if (!nhom.donMua.TRACKING_ID) {
        throw new Error(`Đơn thuộc nhóm DonNhieuAo ${nhom.goc} — chỉ mua tracking ở đơn ${nhom.donMua.STT_Key}, các đơn còn lại dùng chung.`);
      }
      const { loiSheet } = await saoTrackingXuongNhom(nhom, trackingCuaDon(nhom.donMua), user);
      return { dungChung: true, donMua: nhom.donMua.STT_Key, tracking_num: nhom.donMua.TRACKING_ID, loiSheetCon: loiSheet };
    }
    // CHỈ mua cho đơn giao tới US/UK (bổ sung 27/09/2026, theo yêu cầu người dùng) — xét DIA_CHI_NUOC của
    // đơn mua (đơn ".1" nếu là DonNhieuAo). Chặn ở ĐÂY nên áp dụng cho mọi lối mua.
    // Dữ liệu sửa tay ở hộp đỏ mua thủ công (nếu có) — đè TRƯỚC khi xét quốc gia + gửi GKE; `row` gốc giữ nguyên cho mọi việc khác.
    const rowGke = apDungThongTinGke(row, nhatKy);
    if (!gkeService.duocMuaTrackingTheoQuocGia(rowGke)) {
      throw new Error(`Chỉ mua tracking GKE cho đơn giao tới US hoặc UK — đơn ${sttKey} có quốc gia "${rowGke.DIA_CHI_NUOC || '(trống)'}".`);
    }
    // Tài khoản GKE theo Xưởng của đơn (đơn ".1" nếu là DonNhieuAo) — lỗi rõ ràng nếu Xưởng chưa gán
    // tài khoản, KHÔNG dùng tài khoản Xưởng khác thay thế (xem gkeService.js#layCauHinhGkeChoDon).
    const cauHinhGke = gkeService.layCauHinhGkeChoDon(row);
    let donGuiGke = rowGke;
    if (nhom) {
      const canNang = nhom.thanhVien
        .filter(r => r.TRANG_THAI_XUONG !== donNhieuAoService.TRANG_THAI_HUY)
        .reduce((tong, r) => tong + gkeService.tinhCanNangKg(r, cauHinhGke), 0);
      donGuiGke = { ...rowGke, _CAN_NANG_KG: canNang };
      nhatKy.push(`[DonNhieuAo] Nhóm ${nhom.goc} (${nhom.thanhVien.length} đơn) — mua 1 tracking cho cả nhóm, cân nặng tổng ${canNang} kg.`);
    }

    daToiBuocGke = true;
    const chuaTungTaoDon = !row.TAM_THOI;
    const dangChoTuLanTruoc = row.TAM_THOI === gkeService.MA_DANG_CHO_TEM;

    if (chuaTungTaoDon) {
      await gkeService.taoDonGke(donGuiGke, cauHinhGke, nhatKy);
      // Ghi tài khoản đã tạo vận đơn CÙNG lượt với TAM_THOI — lượt lấy tem lại sau này (và in lại tem/tra
      // trạng thái) phải dùng đúng tài khoản này dù Xưởng của đơn có đổi.
      await orderService.update(sttKey, { TAM_THOI: gkeService.MA_DANG_CHO_TEM, TAI_KHOAN_GKE: cauHinhGke.id }, user);
    }

    const ketQuaTem = await gkeService.layTemIn(row, cauHinhGke, { laLanDauSauKhiTao: chuaTungTaoDon || dangChoTuLanTruoc }, nhatKy);
    await orderService.update(sttKey, {
      TRACKING_ID: ketQuaTem.tracking_num,
      HANG_VAN_CHUYEN: ketQuaTem.delivery_carrier,
      TAM_THOI: '', // đã có tracking thật — không còn "tạm" nữa
      TAI_KHOAN_GKE: cauHinhGke.id,
    }, user);
    if (row.TU_MUA_SO_LAN_THU || row.TU_MUA_CHE_DO) trangThaiDbService.ghiDe(sttKey, XOA_THEO_DOI_THU); // mua được -> hết theo dõi lần thử

    let loiSheetCon = [];
    if (nhom) {
      const { daSao, loiSheet } = await saoTrackingXuongNhom(nhom, { trackingId: ketQuaTem.tracking_num, hangVanChuyen: ketQuaTem.delivery_carrier, taiKhoanGke: cauHinhGke.id }, user);
      loiSheetCon = loiSheet;
      nhatKy.push(`[DonNhieuAo] Đã sao tracking xuống: ${daSao.join(', ') || '(không có đơn nào cần sao)'}.`);
    }

    // Ghi TRACKING_ID2/HANG_VAN_CHUYEN2 vào Sheet của Seller (sửa 28/09/2026, theo yêu cầu người dùng —
    // services/sheetSellerService.js, tra Sheet qua tab CONFIG theo Team; trước đây tra theo MA_KHACH_HANG
    // vốn luôn trống với đơn mới nên bị BỎ QUA IM LẶNG). Không chặn/rollback việc mua tracking THẬT đã xảy
    // ra; lỗi -> vào danh sách theo dõi + trả dayCheKhachHang để giao diện hiện hộp đỏ (mua tay) / Telegram
    // (tự động, baoLoiSheetSeller).
    const [kqDay] = await sheetSellerService.ghiHangLoat([{
      sttKey, loai: 'TRACKING', giaTri: { TRACKING_ID2: ketQuaTem.tracking_num, HANG_VAN_CHUYEN2: ketQuaTem.delivery_carrier },
    }], user);
    const dayCheKhachHang = kqDay.ok ? { ok: true } : { ok: false, lyDo: kqDay.lyDo };
    nhatKy.push(kqDay.ok
      ? `Đã ghi tracking vào Sheet Seller (tab "${kqDay.tab}", dòng ${kqDay.dong}).`
      : `LỖI ghi tracking vào Sheet Seller: ${kqDay.lyDo}`);
    baoLoiSheetSeller([kqDay], user, 'tracking');

    ghiLogTracking(`${nhanNguon} ${sttKey}: đã mua tracking ${ketQuaTem.tracking_num} (${ketQuaTem.delivery_carrier})`, sttKey);
    ghiLog({
      nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: laThuCong ? 'MUA_TRACKING_THU_CONG' : 'TU_DONG_MUA_TRACKING',
      sttKey, chiTiet: { trackingNum: ketQuaTem.tracking_num, hangVanChuyen: ketQuaTem.delivery_carrier },
    }).catch(err => console.error('[TrackingTuDong] Lỗi ghi log nền:', err.message));
    ghiLogTrackingVaoDb({
      sttKey, nguon: nguonSheet, nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công',
      trackingId: ketQuaTem.tracking_num, hangVanChuyen: ketQuaTem.delivery_carrier, chiTiet: nhatKy.join('\n'),
    });

    return { ...ketQuaTem, dayCheKhachHang, loiSheetCon };
  } catch (err) {
    if (!laThuCong && daToiBuocGke && !err.loiChung) ghiNhanLanThuTuDong(row, err);
    ghiLogTracking(`${nhanNguon} ${sttKey}: LỖI — ${err.message}`, sttKey);
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

// DonNhieuAo (bổ sung 26/09/2026) — 1 kiện = 1 tem: chỉ in ở nhom.donIn (thường là ".1"), và chỉ khi MỌI đơn chưa huỷ trong
// nhóm đã "Đã sản xuất" trở đi. Trả nhóm (hoặc null nếu đơn không thuộc nhóm nào) để nơi gọi ghi chú lên tem.
function kiemTraNhomKhiInLabel(row, rows) {
  const nhom = donNhieuAoService.layNhomCuaDon(row.STT_Key, rows);
  if (!nhom) return null;
  if (nhom.loiChan.length) throw new Error(`[DonNhieuAo ${nhom.goc}] ${nhom.loiChan.join(' ')}`);
  if (nhom.donIn.STT_Key !== row.STT_Key) {
    throw new Error(`Đơn thuộc nhóm DonNhieuAo ${nhom.goc} — cả nhóm dùng 1 tem, in label ở đơn ${nhom.donIn.STT_Key}.`);
  }
  const chuaXong = donNhieuAoService.cacDonChuaSanXuat(nhom);
  if (chuaXong.length) {
    throw new Error(`Nhóm DonNhieuAo ${nhom.goc} còn đơn chưa sản xuất xong: ${chuaXong.map(r => `${r.STT_Key} (${r.TRANG_THAI_XUONG})`).join(', ')} — cả nhóm phải "Đã sản xuất" mới in label.`);
  }
  return nhom;
}

async function ghiChuNhomLenTem(ketQuaTem, nhom) {
  if (!nhom || !ketQuaTem || !ketQuaTem.label_base64) return ketQuaTem;
  const cacDon = nhom.thanhVien.filter(r => r.TRANG_THAI_XUONG !== donNhieuAoService.TRANG_THAI_HUY).map(r => r.STT_Key);
  return { ...ketQuaTem, label_base64: await gkeService.ghiChuLenTem(ketQuaTem.label_base64, `KIEN GOM ${cacDon.length} DON: ${cacDon.join(', ')}`) };
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
  // Lịch sử đơn (bổ sung 27/09/2026) — trước đây in label chỉ có ở nhật ký trang Tracking.
  ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'IN_LABEL', sttKey,
    chiTiet: { trackingNum: row.TRACKING_ID || '', hangVanChuyen: row.HANG_VAN_CHUYEN || '' },
  }).catch(err => console.error('[TrackingTuDong] Lỗi ghi log nền:', err.message));
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
async function inLabelChoDon(sttKey, user) {
  const nhatKy = [];
  const { rows } = await orderService.getAll({ fresh: true });
  const row = rows.find(r => r.STT_Key === sttKey);
  if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);

  try {
    kiemTraDieuKienInLabel(row);
    const nhom = kiemTraNhomKhiInLabel(row, rows);
    // Tem lấy theo vận đơn của đơn ĐÃ MUA — khác đơn bấm in khi .1 đã mua rồi mới bị huỷ riêng.
    const donLayTem = nhom ? nhom.donMua : row;
    if (!donLayTem.TRACKING_ID) {
      throw new Error('Đơn chưa có mã tracking thật — dùng nút "MUA TRACKING và IN LABEL" thay vì "IN LABEL".');
    }

    const cauHinhGke = gkeService.layCauHinhGkeChoDon(donLayTem);
    const ketQuaTem = await ghiChuNhomLenTem(await gkeService.layTemIn(donLayTem, cauHinhGke, { laLanDauSauKhiTao: false }, nhatKy), nhom);
    await ghiDaInLabel(sttKey, user);

    ghiLogTrackingVaoDb({
      sttKey, nguon: 'In label', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Thành công',
      trackingId: donLayTem.TRACKING_ID, hangVanChuyen: donLayTem.HANG_VAN_CHUYEN, chiTiet: nhatKy.join('\n'),
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

// Đơn đã huỷ: KHÔNG mua tracking ở MỌI đường mua (bổ sung 27/09/2026, theo yêu cầu người dùng) — job tự
// động đã lọc trước; đây chặn nút mua tay/"MUA TRACKING và IN LABEL". maLoi để giao diện hiện hộp đỏ riêng
// (public/js/api.js#tachVaBaoDonDaHuy).
function chanMuaDonDaHuy(row) {
  if (row.TRANG_THAI_XUONG !== donNhieuAoService.TRANG_THAI_HUY) return;
  const err = new Error(`ĐƠN ĐÃ HỦY (KHÔNG MUA TRACKING) — đơn ${row.STT_Key} đang "${row.TRANG_THAI_XUONG}".`);
  err.maLoi = 'DON_DA_HUY';
  throw err;
}

// "MUA TRACKING và IN LABEL" — 1 nút làm CẢ 2 việc (bổ sung 09/09/2026 lần 2, theo yêu cầu người
// dùng): đơn CHƯA có tracking thì mua trước (dùng lại muaTrackingChoDon(), đã tự lấy tem trong lúc mua
// nên KHÔNG cần gọi GKE thêm lần nào cho bước in — label_base64 đã có sẵn trong kết quả trả về); đơn
// ĐÃ có tracking thật rồi thì bỏ qua bước mua, chỉ in lại (uỷ quyền thẳng cho inLabelChoDon() ở trên,
// hàm đó tự ghi log riêng của nó — TRÁNH ghi log trùng lặp 2 lần cho cùng 1 lần in).
// Bắt buộc "Đã sản xuất"/"ĐÃ DÁN TEM" cho CẢ 2 nhánh — khác nút "Mua Tracking" gốc (không kiểm tra
// trạng thái): đã xác nhận với người dùng, 2 nút MỚI này dành riêng cho lúc chuẩn bị gửi hàng, không
// phải để lấy mã tracking sớm như nút gốc.
async function muaTrackingVaInLabelChoDon(sttKey, user) {
  const { rows } = await orderService.getAll({ fresh: true });
  const row = rows.find(r => r.STT_Key === sttKey);
  if (!row) throw new Error('Không tìm thấy đơn: ' + sttKey);

  let nhom;
  try {
    chanMuaDonDaHuy(row);
    kiemTraDieuKienInLabel(row);
    nhom = kiemTraNhomKhiInLabel(row, rows);
  } catch (err) {
    ghiLogTrackingVaoDb({
      sttKey, nguon: 'Mua tracking + In label', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: 'Lỗi',
      chiTiet: `LỖI: ${err.message}`,
    });
    throw err;
  }

  const daCoTrackingThat = !!(nhom ? nhom.donMua : row).TRACKING_ID;
  if (daCoTrackingThat) {
    return inLabelChoDon(sttKey, user);
  }

  const ketQuaTem = await ghiChuNhomLenTem(await muaTrackingChoDon(sttKey, user), nhom); // tự ghi log riêng (Nguồn "Thủ công"), cả 2 chiều
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

  const { rows } = await orderService.getAll();
  const bayGio = Date.now();

  // DonNhieuAo: sao tracking xuống đơn con mới thêm (nếu đơn ".1" đã mua), rồi loại hẳn đơn con + nhóm
  // lỗi dữ liệu khỏi danh sách mua — nhóm lỗi đã hiện ở Trung tâm hành động, không cần báo lỗi lại mỗi 2 phút.
  await dongBoTrackingCacNhom(rows);
  const banDoNhom = donNhieuAoService.xayDungBanDoNhom(rows);

  const donDuDieuKien = rows.filter(r => {
    if (r.TRACKING_ID) return false; // đã có tracking thật
    if (r.TU_MUA_CHE_DO === CHE_DO_THU_CONG) return false; // đã thử đủ 10 lần — chỉ còn mua tay
    // DonNhieuAo: chỉ đơn mua (".1") — tính giờ theo mốc của CHÍNH đơn đó.
    const nhom = banDoNhom.get(r.STT_Key);
    if (nhom && (nhom.loiChan.length || nhom.donMua.STT_Key !== r.STT_Key)) return false;
    if (!gkeService.duocMuaTrackingTheoQuocGia(r)) return false; // chỉ US/UK — trang Tracking hiện rõ lý do
    // Trạng thái + thời gian: điều kiện nào đến trước (thoiDiemDenHan) — đơn huỷ/hoàn/đã giao/Chưa in mã không thuộc cả 2.
    const han = thoiDiemDenHan(r, cauHinh);
    return han !== null && bayGio >= han;
  });

  // Tài khoản GKE theo Xưởng (bổ sung 27/09/2026): đơn không xác định được tài khoản (chưa gán Xưởng,
  // Xưởng chưa gán tài khoản...) — bỏ qua ở lượt tự động thay vì ghi lỗi mỗi 2 phút cho từng đơn; trang
  // Tracking hiện rõ trạng thái "Chưa có tài khoản GKE" cho các đơn này (xem layDanhSachDonAutoTracking).
  const loiTaiKhoan = new Map();
  const donMua = donDuDieuKien.filter(r => {
    try { gkeService.layCauHinhGkeChoDon(r); return true; } catch (err) { loiTaiKhoan.set(err.message, (loiTaiKhoan.get(err.message) || 0) + 1); return false; }
  });
  for (const [lyDo, so] of loiTaiKhoan) console.warn(`[TrackingTuDong] Bỏ qua ${so} đơn — ${lyDo}`);

  let soDonDaMua = 0;
  for (const don of donMua) {
    try {
      const ketQua = await muaTrackingChoDon(don.STT_Key);
      if (ketQua && !ketQua.dungChung) soDonDaMua++;
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
// ghi vào SQLite (trangThaiDbService — TRANG_THAI_TRACKING/THOI_GIAN_CAP_NHAT_TRACKING/MA_NODE_TRACKING/
// MA_TRANG_THAI_NODE_TRACKING, LUÔN có sẵn trong schema, xem trangThaiDbService.js). KHÔNG đụng
// TRANG_THAI_XUONG hay bất kỳ cột pipeline nào khác — đã xác nhận rõ với người dùng, đây thuần là cột
// thông tin để xem.
// ============================================================

// GKE dùng "order_node"/"node_status" làm mã trạng thái NỘI BỘ, ổn định qua mọi hãng vận chuyển/quốc
// gia — KHÁC "lm_track_code" (mã riêng của TỪNG hãng vận chuyển chặng cuối, đổi tuỳ hãng/nước, KHÔNG
// dùng để nhận diện trạng thái cuối được). Xác nhận qua dữ liệu THẬT 21/09/2026 (đơn 9PQ10, giao thành
// công tại Mỹ qua USPS): chuỗi order_node OL002 (Tạo đơn) -> OL006 (Nhận kho) -> OL007 (Cân/lưu kho) ->
// OL012 (Vận chuyển đường trục) -> OL015 (Cất cánh) -> OL016 (Hạ cánh) -> OL020 (Trích xuất dặm cuối) ->
// OL021 (Quá cảnh dặm cuối) -> OL022 (Giao hàng dặm cuối) là pipeline CHÍNH của GKE. order_node="OL022"
// xuất hiện 2 lần: node_status="555" (đang "Out for Delivery", CHƯA xong) rồi node_status="000" (giao
// xong thật) — PHẢI xét ĐÚNG CẶP (order_node, node_status), vì node_status="000" một mình KHÔNG có
// nghĩa "xong" (nhiều bước đầu như OL002/OL006 cũng có node_status="000").
// CHƯA có mẫu thật cho "Đơn bất thường"/trả hàng — hàm này CHỈ nhận diện được case giao thành công. Đơn
// ở trạng thái khác (kể cả bất thường/trả hàng) cứ tiếp tục bị quét bình thường — an toàn, chỉ tốn thêm
// vài lượt gọi GKE, không dừng nhầm/sai dữ liệu. Bổ sung mã cho case đó sau khi có 1 đơn mẫu thật.
const NODE_TRACKING_DA_GIAO_XONG = 'OL022';
const TRANG_THAI_NODE_TRACKING_DA_GIAO_XONG = '000';
function daGiaoThanhCongGke(maNode, maTrangThaiNode) {
  return maNode === NODE_TRACKING_DA_GIAO_XONG && maTrangThaiNode === TRANG_THAI_NODE_TRACKING_DA_GIAO_XONG;
}

// Cập nhật cho ĐÚNG 1 đơn — bỏ qua sớm (không gọi GKE) nếu GKE chưa có sự kiện tracking nào (mảng rỗng,
// label vừa tạo), thử lại ở lượt quét sau. Trả {ok:false, lyDo} cho trường hợp "không có gì để làm" này
// (KHÔNG throw — không phải lỗi thật) — vẫn THROW bình thường cho lỗi GKE/ghi Sheet thật (giữ đúng
// khuôn muaTrackingChoDon() ở trên: throw cho lỗi thật, trả sentinel cho trường hợp "bỏ qua có chủ ý").
// Trả {ok:true, suKien} khi ghi thành công — `lyDo` (bổ sung 14/09/2026, theo yêu cầu người dùng, cho
// nút "Tracking thủ công" ở routes/tracking.js hiện rõ LÝ DO thay vì chỉ biết chung chung "không có gì
// mới") dùng ĐƯỢC cho cả job tự động (chỉ cần `.ok`, bỏ qua `.lyDo`) lẫn route thủ công (cần cả 2).
// gomDelivered (bổ sung 28/09/2026): mảng để GOM các ô Delivered cần ghi sang Sheet Seller (nơi gọi tự ghi
// 1 lần cho cả lượt — job/nút cập nhật nhiều đơn). Không truyền -> ghi ngay cho đơn này (Hệ thống).
async function capNhatTrangThaiTrackingChoDon(sttKey, { gomDelivered } = {}) {
  const { headers, rows } = await orderService.getAll({ fresh: true });
  const row = rows.find(r => r.STT_Key === sttKey);
  if (!row) return { ok: false, lyDo: 'Không tìm thấy đơn: ' + sttKey };

  // DonNhieuAo (bổ sung 26/09/2026): GKE chỉ biết vận đơn dưới STT_Key của đơn ".1" — đơn dùng chung tra
  // theo đơn đó, rồi ghi kết quả cho CẢ đơn ".1" lẫn mọi đơn đang dùng chung tracking của nó.
  const keyTra = row.TRACKING_CHUNG_CUA || sttKey;
  const cacDonGhi = rows.filter(r => r.STT_Key === keyTra || r.TRACKING_CHUNG_CUA === keyTra);

  const donTra = rows.find(r => r.STT_Key === keyTra);
  if (!donTra) return { ok: false, lyDo: `Không tìm thấy đơn ${keyTra} (đơn mua tracking của nhóm)` };
  const cauHinhGke = gkeService.layCauHinhGkeChoDon(donTra); // tài khoản ĐÃ tạo vận đơn
  const lichSu = await gkeService.layLichSuTrackingGke(keyTra, cauHinhGke, []);
  if (lichSu.length === 0) {
    return { ok: false, lyDo: 'GKE chưa có sự kiện tracking nào cho đơn này (có thể vừa tạo nhãn, chưa được đơn vị vận chuyển quét nhận).' };
  }

  const suKienMoiNhat = lichSu[lichSu.length - 1];
  const capNhat = {
    TRANG_THAI_TRACKING: suKienMoiNhat.track_name || suKienMoiNhat.track_name_en || '',
    THOI_GIAN_CAP_NHAT_TRACKING: dinhDangNgayGioNgan(new Date()),
    MA_NODE_TRACKING: suKienMoiNhat.order_node || '',
    MA_TRANG_THAI_NODE_TRACKING: suKienMoiNhat.node_status || '',
  };
  // Delivered (bổ sung 28/09/2026, theo yêu cầu người dùng): trạng thái ĐỔI -> ghi nguyên văn vào ô Delivered
  // trong Sheet Seller của TỪNG đơn dùng tracking này (cả đơn con DonNhieuAo) để Seller thấy trạng thái thật.
  const canGhiDelivered = cacDonGhi
    .filter(don => capNhat.TRANG_THAI_TRACKING && (don.TRANG_THAI_TRACKING || '') !== capNhat.TRANG_THAI_TRACKING)
    .map(don => ({ sttKey: don.STT_Key, loai: 'DELIVERED', giaTri: { Delivered: capNhat.TRANG_THAI_TRACKING } }));
  for (const don of cacDonGhi) {
    await orderService.update(don.STT_Key, capNhat, NGUOI_HE_THONG, { donDaDoc: { headers, row: don } });
  }
  if (canGhiDelivered.length) {
    if (gomDelivered) gomDelivered.push(...canGhiDelivered);
    else baoLoiSheetSeller(await sheetSellerService.ghiHangLoat(canGhiDelivered, NGUOI_HE_THONG), NGUOI_HE_THONG, 'Delivered');
  }
  return { ok: true, suKien: suKienMoiNhat };
}

// 1 lượt quét — gọi từ services/trackingJob.js (cron mỗi 2 tiếng, thấp hơn hẳn lịch mua tracking vì
// trạng thái vận chuyển đổi chậm hơn nhiều). Quét mọi đơn có TRACKING_ID, TRỪ đơn đã xác nhận giao
// thành công ở lượt quét trước (daGiaoThanhCongGke — xem comment trên) để đỡ tốn lượt gọi GKE vô ích.
// Lỗi ở 1 đơn chỉ log console, KHÔNG dừng cả lượt — đơn đó tự thử lại ở lượt sau.
async function chayQuetCapNhatTrangThaiTracking() {
  const { rows } = await orderService.getAll();
  // Bỏ đơn dùng chung tracking (DonNhieuAo) — cập nhật theo đơn ".1" của nó (xem capNhatTrangThaiTrackingChoDon).
  const donCoTracking = rows.filter(r => r.TRACKING_ID && !r.TRACKING_CHUNG_CUA);
  const donCanQuet = donCoTracking.filter(r => !daGiaoThanhCongGke(r.MA_NODE_TRACKING, r.MA_TRANG_THAI_NODE_TRACKING));

  let soDaCapNhat = 0;
  const gomDelivered = [];
  for (const don of donCanQuet) {
    try {
      const ketQua = await capNhatTrangThaiTrackingChoDon(don.STT_Key, { gomDelivered });
      if (ketQua.ok) soDaCapNhat++;
    } catch (err) {
      console.error(`[TrackingTuDong] Lỗi tra cứu trạng thái tracking cho ${don.STT_Key}:`, err.message);
    }
  }
  // Ghi Delivered 1 lần cho cả lượt (mỗi Sheet Seller 1 lệnh ghi); lỗi -> 1 tin Telegram tổng hợp.
  if (gomDelivered.length) baoLoiSheetSeller(await sheetSellerService.ghiHangLoat(gomDelivered, NGUOI_HE_THONG), NGUOI_HE_THONG, 'Delivered');

  return {
    daQuet: true, soDaCapNhat, tongSoCoTracking: donCoTracking.length,
    soDaBoQuaDaXong: donCoTracking.length - donCanQuet.length,
  };
}

// Gọi ở MỖI lượt tick cố định (5 phút, xem services/trackingJob.js) — tự quyết định có ĐẾN LƯỢT quét
// thật hay chưa, dựa vào ThoiDiemQuetTrangThaiGanNhat so với khoảng cách đã cấu hình
// (layCauHinhQuetTrangThai). Chưa từng quét lần nào (server mới cài/mới migrate) hoặc mốc lưu bị hỏng
// (không parse được thành ngày hợp lệ) đều coi như "đến lượt ngay" — an toàn hơn là kẹt cứng không bao
// giờ quét được. Đánh dấu mốc MỚI ngay TRƯỚC khi chạy lượt quét thật (không phải sau) — đơn giản, chấp
// nhận lệch vài giây/phút do thời gian chạy thật của lượt quét (không đáng kể so với khoảng cách tính
// bằng giờ), đồng thời tránh 2 tick liền kề cùng tưởng "đến lượt" nếu lượt quét trước chạy lâu.
async function chayQuetTrangThaiNeuDenLuot() {
  const dong = caiDatDbService.layCauHinhTracking();
  const { soPhutQuet } = layCauHinhQuetTrangThai();
  const lanTruoc = dong && dong.ThoiDiemQuetTrangThaiGanNhat ? new Date(dong.ThoiDiemQuetTrangThaiGanNhat).getTime() : NaN;
  const daDuGio = isNaN(lanTruoc) || (Date.now() - lanTruoc) >= soPhutQuet * 60 * 1000;
  if (!daDuGio) return { daChayLuotNay: false };

  caiDatDbService.datCauHinhTracking({ ThoiDiemQuetTrangThaiGanNhat: new Date().toISOString() });
  const ketQua = await chayQuetCapNhatTrangThaiTracking();
  return { daChayLuotNay: true, ...ketQua };
}

// Danh sách đơn cho bảng ở trang public/tracking.html, kèm trạng thái. Từ 29/09/2026 (theo yêu cầu người dùng,
// thay cho lọc AUTO_TRACKING="YES"): đơn CHỜ tự động mua (thuộc 1 trong 2 điều kiện — thoiDiemDenHan, chưa có tracking)
// + đơn ĐÃ có tracking mà sản xuất xong trong 7 ngày gần đây (bảng không dài vô hạn). Lọc theo Xưởng của `user`
// (orderService.js#locTheoXuong) — hàm này CHỈ dùng cho route GET /tracking/danh-sach, không dùng bởi job nền.
const coTaiKhoanGke = r => { try { gkeService.layCauHinhGkeChoDon(r); return true; } catch { return false; } };
const SO_MS_GIU_DON_DA_MUA = 7 * 24 * 60 * 60 * 1000;

async function layDanhSachDonAutoTracking(user) {
  const [{ rows: tatCaDon }, cauHinh] = await Promise.all([orderService.getAll(), layCauHinh()]);
  const rows = orderService.locTheoXuong(tatCaDon, user);
  const banDoNhom = donNhieuAoService.xayDungBanDoNhom(tatCaDon);
  const bayGio = Date.now();

  return rows
    .filter(r => {
      if (r.TRACKING_ID) {
        const t = thoiDiemSanXuat(r) ?? (new Date(r.THOI_GIAN_IN_MA || '').getTime() || null);
        return t !== null && bayGio - t <= SO_MS_GIU_DON_DA_MUA;
      }
      // Chờ mua: phải thuộc 1 trong 2 điều kiện tự mua — đơn cũ không có mốc KHÔNG hiện (không tự mua, hiện ra chỉ làm
      // ngập bảng).
      return thoiDiemDenHan(r, cauHinh) !== null
        || (r.TU_MUA_CHE_DO === CHE_DO_THU_CONG && !TRANG_THAI_KHONG_CAN_MUA.includes(r.TRANG_THAI_XUONG));
    })
    .map(r => {
      const daCoTrackingThat = !!r.TRACKING_ID;
      const dangChoTem = !r.TRACKING_ID && r.TAM_THOI === gkeService.MA_DANG_CHO_TEM;
      const han = thoiDiemDenHan(r, cauHinh);

      const nhom = banDoNhom.get(r.STT_Key);
      let trangThai;
      if (daCoTrackingThat) trangThai = 'DA_MUA';
      else if (r.TU_MUA_CHE_DO === CHE_DO_THU_CONG) trangThai = 'CHUYEN_THU_CONG';
      else if (nhom && nhom.loiChan.length) trangThai = 'LOI_NHOM';
      else if (nhom && nhom.donMua.STT_Key !== r.STT_Key) trangThai = 'CHO_DON_MUA_NHOM';
      else if (!gkeService.duocMuaTrackingTheoQuocGia(r)) trangThai = 'KHONG_THUOC_US_UK';
      else if (!coTaiKhoanGke(r)) trangThai = 'THIEU_TAI_KHOAN_GKE';
      else if (dangChoTem) trangThai = 'DANG_CHO_TEM';
      else if (han !== null && bayGio >= han) trangThai = 'DEN_HAN_CHO_XU_LY';
      else trangThai = 'DANG_CHO';

      return {
        sttKey: r.STT_Key,
        trangThai,
        trackingId: daCoTrackingThat ? r.TRACKING_ID : '',
        hangVanChuyen: daCoTrackingThat ? (r.HANG_VAN_CHUYEN || '') : '',
        hanTuMua: !daCoTrackingThat && han !== null ? new Date(han).toISOString() : '',
        soLanThu: daCoTrackingThat ? 0 : Number(r.TU_MUA_SO_LAN_THU) || 0,
        loiGanNhat: daCoTrackingThat ? '' : r.TU_MUA_LOI_GAN_NHAT || '',
        thoiGianSanXuat: r.THOI_GIAN_SAN_XUAT || '',
        thoiGianCapNhatCuoi: r.ThoiGianCapNhatCuoi || '',
      };
    })
    .sort((a, b) => new Date(b.thoiGianCapNhatCuoi || 0) - new Date(a.thoiGianCapNhatCuoi || 0));
}

// Cảnh báo lớn (30/09/2026): đơn đã chuyển MUA THỦ CÔNG mà chưa có tracking, trong Xưởng người xem được thấy. Bỏ đơn
// đã huỷ/hoàn/đã giao (không còn cần mua). Nơi gọi (routes/tracking.js) tự chặn vai trò không có menu Tracking.
const TRANG_THAI_KHONG_CAN_MUA = ['CANCELLED_Đã hủy', 'REFUNDED_Hoàn đơn', 'DELIVERED_Đã giao đến khách'];
async function layDonChuyenThuCong(user) {
  const { rows } = await orderService.getAll();
  return orderService.locTheoXuong(rows, user)
    .filter(r => r.TU_MUA_CHE_DO === CHE_DO_THU_CONG && !r.TRACKING_ID && !TRANG_THAI_KHONG_CAN_MUA.includes(r.TRANG_THAI_XUONG))
    .map(r => {
      const sua = docThongTinGke(r);
      return {
        sttKey: r.STT_Key, soLanThu: Number(r.TU_MUA_SO_LAN_THU) || 0, lyDo: r.TU_MUA_LOI_GAN_NHAT || '', thoiGianThu: r.TU_MUA_THOI_GIAN_THU || '',
        thongTinGke: Object.entries(TRUONG_SUA_GKE).map(([truong, nhan]) => ({ truong, nhan, goc: giaTriGocGke(r, truong), sua: sua[truong] || '' })),
      };
    });
}

// Lưu (giaTri có nội dung) hoặc xoá (giaTri === null) 1 trường sửa tay. CHỈ khi đơn đang ở chế độ mua thủ công. Nơi gọi tự
// kiểm tra quyền + Xưởng. -> thông báo lỗi (string) hoặc null nếu thành công. Ghi lịch sử đơn + log Tracking.
function suaThongTinGke(row, user, truong, giaTri) {
  if (row.TU_MUA_CHE_DO !== CHE_DO_THU_CONG) return 'Chỉ sửa được dữ liệu gửi GKE khi đơn đang ở chế độ mua thủ công.';
  if (!Object.hasOwn(TRUONG_SUA_GKE, truong)) return 'Trường thông tin không hợp lệ.';
  const xoa = giaTri === null;
  const moi = xoa ? '' : String(giaTri ?? '').trim();
  if (!xoa && !moi) return 'Chưa nhập giá trị mới.';
  if (moi.length > DO_DAI_GIA_TRI_GKE_TOI_DA) return `Giá trị quá dài (tối đa ${DO_DAI_GIA_TRI_GKE_TOI_DA} ký tự).`;
  const hienTai = docThongTinGke(row);
  const cu = hienTai[truong] || '';
  if (xoa && !cu) return 'Trường này chưa có giá trị sửa tay.';
  if (xoa) delete hienTai[truong]; else hienTai[truong] = moi;
  trangThaiDbService.ghiDe(row.STT_Key, { THONG_TIN_GKE_CHO_DON_LOI: Object.keys(hienTai).length ? JSON.stringify(hienTai) : '' });
  const goc = giaTriGocGke(row, truong);
  ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: xoa ? 'XOA_THONG_TIN_GKE' : 'SUA_THONG_TIN_GKE', sttKey: row.STT_Key,
    chiTiet: { truong, nhan: TRUONG_SUA_GKE[truong], giaTriGoc: goc, giaTriCu: cu, giaTriMoi: moi },
  }).catch(e => console.error('[TrackingTuDong] Lỗi ghi log nền:', e.message));
  const moTa = xoa
    ? `XOÁ dữ liệu sửa tay gửi GKE — ${TRUONG_SUA_GKE[truong]} "${cu}" (quay về dữ liệu gốc "${goc}").`
    : `SỬA dữ liệu gửi GKE — ${TRUONG_SUA_GKE[truong]}: gốc "${goc}"${cu ? `, đang sửa "${cu}"` : ''} -> "${moi}" (chỉ dùng khi gửi GKE, Sheet giữ nguyên).`;
  ghiLogTracking(`[Thủ công - ${user.ten}] ${row.STT_Key}: ${moTa}`, row.STT_Key, true);
  ghiLogTrackingVaoDb({ sttKey: row.STT_Key, nguon: 'Thủ công', nguoiDung: user.ten, vaiTro: user.vaiTro, ketQua: xoa ? 'Xoá dữ liệu sửa GKE' : 'Sửa dữ liệu GKE', chiTiet: moTa });
  return null;
}

// "Cho tự động thử lại" — xoá số lần thử/chế độ thủ công (dùng sau khi đã sửa thông tin đơn). Trả false nếu đơn không ở
// chế độ thủ công. Nơi gọi tự kiểm tra quyền + Xưởng.
function choTuDongThuLai(row, user) {
  if (row.TU_MUA_CHE_DO !== CHE_DO_THU_CONG) return false;
  trangThaiDbService.ghiDe(row.STT_Key, XOA_THEO_DOI_THU);
  ghiLog({
    nguoiDung: user.ten, vaiTro: user.vaiTro, hanhDong: 'CHO_TU_DONG_MUA_LAI', sttKey: row.STT_Key,
    chiTiet: { soLanThu: Number(row.TU_MUA_SO_LAN_THU) || 0, lyDo: row.TU_MUA_LOI_GAN_NHAT || '' },
  }).catch(e => console.error('[TrackingTuDong] Lỗi ghi log nền:', e.message));
  ghiLogTracking(`[Thủ công - ${user.ten}] ${row.STT_Key}: cho tự động thử mua lại (đặt lại số lần thử).`, row.STT_Key, true);
  return true;
}

module.exports = {
  layDonChuyenThuCong, choTuDongThuLai, suaThongTinGke, SO_LAN_THU_TU_DONG_TOI_DA, apDungThongTinGke, docThongTinGke,
  layCauHinh, luuCauHinh, chayQuetTuDongMuaTracking, layDanhSachDonAutoTracking, layLogTracking,
  muaTrackingChoDon, inLabelChoDon, muaTrackingVaInLabelChoDon,
  capNhatTrangThaiTrackingChoDon, chayQuetCapNhatTrangThaiTracking, chayQuetTrangThaiNeuDenLuot,
  layCauHinhQuetTrangThai, luuCauHinhQuetTrangThai, SO_PHUT_QUET_TRANG_THAI_TOI_THIEU,
};
