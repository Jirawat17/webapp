// Tích hợp GKE Logistics (order.gkelogistics.com) — tạo vận đơn thật + lấy tem in. Gọi từ
// services/trackingAutoService.js (muaTrackingChoDon() — nút "Mua Tracking"/job tự động/"MUA TRACKING
// và IN LABEL"; inLabelChoDon() — chỉ lấy lại tem, không tạo đơn mới). KHÔNG còn gắn với việc đổi
// TRANG_THAI_XUONG nữa — trước đây có 1 chế độ quét QR riêng (routes/gke.js, "Quét mã QR Tracking")
// vừa gọi GKE vừa tự chuyển trạng thái sang "ĐÃ DÁN TEM", đã XOÁ 09/09/2026 lần 4 theo yêu cầu người
// dùng (thay bằng chụp ảnh xác nhận thuần, xem routes/photos.js mốc da_dan_tem) — việc đổi trạng thái
// và việc gọi GKE giờ hoàn toàn tách biệt. Quyết định cùng người dùng 31/08/2026:
//   - customer_order_num khi tạo đơn LUÔN đặt = STT_Key của mình — nhờ vậy in lại tem sau này
//     KHÔNG cần lưu riêng order_num/waybill number của GKE, chỉ cần num_type=1 + STT_Key.
//   - Đơn đã tạo vận đơn GKE rồi (kể cả đang chờ tem, xem MA_DANG_CHO_TEM bên dưới) thì KHÔNG được gọi
//     order/create/ lại — mỗi lần gọi tạo 1 vận đơn thật, gọi lặp sẽ ra 2 vận đơn trùng nhau.
//     muaTrackingChoDon() ghi giá trị placeholder này vào cột TAM_THOI (KHÔNG phải TRACKING_ID nữa —
//     đổi 12/09/2026 lần 14, theo yêu cầu người dùng, để TRACKING_ID luôn chỉ là rỗng hoặc mã thật)
//     NGAY sau khi tạo đơn thành công, TRƯỚC KHI thử lấy tem — vì tem có thể chưa generate xong ngay
//     (xem layTemIn), nếu không ghi gì ở bước này mà lấy tem thất bại thì lượt sau sẽ tưởng nhầm là
//     chưa tạo đơn.
//   - Cân nặng: TRONG_LUONG (kg/áo, cột thật trong Sheet) x SO_LUONG; đơn chưa có TRONG_LUONG (trống/
//     không hợp lệ) thì tạm dùng ước lượng 0.05kg/áo như cũ (bổ sung 01/09/2026, xem tinhCanNangKg).
//   - Khai báo hải quan: dùng 1 mức giá/mã HS cố định cho MỌI đơn (đọc từ .env), không phân biệt
//     loại sản phẩm — đơn giản hoá theo yêu cầu, có thể tách theo LOAI sau này nếu cần chính xác hơn.
//   - Lỗi gọi GKE KHÔNG chặn thao tác của người dùng — chỉ báo lỗi rõ, thử lại sau.
//
// GHI LOG CHI TIẾT RA CONSOLE SERVER (bổ sung 01/09/2026, theo yêu cầu người dùng — lần test đầu
// chỉ thấy "Đã có lỗi xảy ra" chung chung, không biết lỗi ở bước nào): mọi bước gọi GKE đều in ra
// console.log/console.error kèm tên bước, để mở terminal server lúc test là thấy ngay lỗi thật ở
// đâu, không cần đoán. Xem thêm ghi chú "CÁCH TÌM LỖI" ở cuối file.
//
// CẤU HÌNH (bổ sung 09/09/2026, theo yêu cầu người dùng — trước đó toàn bộ nằm cứng trong .env, khó
// chỉnh cho người không rành kỹ thuật): mọi hàm dưới đây nhận `cauHinh` làm tham số thay vì tự đọc
// process.env.GKE_* trực tiếp. Từ 27/09/2026: cấu hình theo TỪNG TÀI KHOẢN GKE gán cho từng Xưởng —
// nơi gọi lấy cấu hình đúng tài khoản của đơn qua layCauHinhGkeChoDon(row) rồi truyền xuống (xem khối
// "TÀI KHOẢN GKE THEO XƯỞNG" bên dưới). .env chỉ còn dùng 1 lần khi chuyển cấu hình cũ sang Tài khoản 1.
const caiDatDbService = require('./caiDatDbService');
const { PDFDocument, StandardFonts } = require('pdf-lib');

function layGiaTri(dong, tenCot, bienEnv, macDinh = '') {
  if (dong && dong[tenCot]) return dong[tenCot];
  if (bienEnv && process.env[bienEnv]) return process.env[bienEnv];
  return macDinh;
}

// ============================================================
// TÀI KHOẢN GKE THEO XƯỞNG (bổ sung 27/09/2026, theo yêu cầu người dùng) — mỗi Xưởng dùng 1 tài khoản
// GKE riêng (đủ 14 trường: đăng nhập, người gửi, hải quan, cân nặng mặc định), quản lý ở Settings. Thay
// cho 1 bộ cấu hình chung duy nhất trước đây (cau_hinh_tracking). Chọn tài khoản cho 1 đơn — xem
// layCauHinhGkeChoDon(). KHÔNG bao giờ tự dùng tài khoản của Xưởng khác thay thế.
// ============================================================

// [khoá dùng trong code/giao diện, tên cột SQLite]
const CAC_TRUONG_CAU_HINH_GKE = [
  ['ten', 'Ten'],
  ['username', 'GkeUsername'], ['password', 'GkePassword'], ['serviceCode', 'GkeServiceCode'],
  ['shipperName', 'GkeShipperName'], ['shipperPhone', 'GkeShipperPhone'],
  ['shipperAddress', 'GkeShipperAddress'], ['shipperCity', 'GkeShipperCity'],
  ['shipperProvince', 'GkeShipperProvince'], ['shipperPostcode', 'GkeShipperPostcode'],
  ['customsItemName', 'GkeCustomsItemName'], ['customsHsCode', 'GkeCustomsHsCode'],
  ['customsDeclaredPrice', 'GkeCustomsDeclaredPrice'], ['customsCurrency', 'GkeCustomsCurrency'],
  ['canNangMoiAoKg', 'CanNangMoiAoKg'],
];
const MAC_DINH_CAU_HINH_GKE = { shipperName: 'Maxthread VN', customsItemName: 'Embroidered garment', customsCurrency: 'USD' };

// Dòng SQLite -> object cấu hình dùng trong code (cùng khuôn object layCauHinhGke() cũ + id/ten).
function cauHinhTuDong(dong) {
  const ch = { id: String(dong.id) };
  for (const [khoa, cot] of CAC_TRUONG_CAU_HINH_GKE) ch[khoa] = dong[cot] || MAC_DINH_CAU_HINH_GKE[khoa] || '';
  ch.canNangMoiAoKg = Number(dong.CanNangMoiAoKg) || 0.05;
  return ch;
}

// Chuyển 1 LẦN bộ cấu hình chung cũ (cau_hinh_tracking + .env làm giá trị ngầm định, đúng cách
// layCauHinhGke() cũ từng đọc) thành "Tài khoản 1", tự gán cho Xưởng BN (đã xác nhận với người dùng).
// Đơn đã tạo vận đơn trước khi nâng cấp coi như mua bằng tài khoản này — xem ID_TAI_KHOAN_CU.
const ID_TAI_KHOAN_CU = '1';
function chuyenCauHinhCuSangTaiKhoan() {
  const dong = caiDatDbService.layCauHinhTracking();
  if (dong && dong.DaChuyenTaiKhoanGke === 'TRUE') return;
  const ENV = {
    GkeUsername: 'GKE_API_USERNAME', GkePassword: 'GKE_API_PASSWORD', GkeServiceCode: 'GKE_SERVICE_CODE',
    GkeShipperName: 'GKE_SHIPPER_NAME', GkeShipperPhone: 'GKE_SHIPPER_PHONE', GkeShipperAddress: 'GKE_SHIPPER_ADDRESS',
    GkeShipperCity: 'GKE_SHIPPER_CITY', GkeShipperProvince: 'GKE_SHIPPER_PROVINCE', GkeShipperPostcode: 'GKE_SHIPPER_POSTCODE',
    GkeCustomsItemName: 'GKE_CUSTOMS_ITEM_NAME', GkeCustomsHsCode: 'GKE_CUSTOMS_HS_CODE',
    GkeCustomsDeclaredPrice: 'GKE_CUSTOMS_DECLARED_PRICE', GkeCustomsCurrency: 'GKE_CUSTOMS_CURRENCY',
  };
  const giaTri = { Ten: 'Tài khoản 1', CanNangMoiAoKg: layGiaTri(dong, 'CanNangMoiAoKg', null) };
  for (const [cot, env] of Object.entries(ENV)) giaTri[cot] = layGiaTri(dong, cot, env);
  if (giaTri.GkeUsername && caiDatDbService.layDanhSachTaiKhoanGke().length === 0) {
    const id = caiDatDbService.ghiTaiKhoanGke(null, giaTri);
    if (caiDatDbService.layDanhSachXuong().includes('BN') && !caiDatDbService.layGanTaiKhoanGke().BN) {
      caiDatDbService.ganTaiKhoanGkeChoXuong('BN', id);
    }
    console.log(`[GKE] Đã chuyển cấu hình GKE cũ thành "Tài khoản 1" (id ${id}), gán cho Xưởng BN.`);
  }
  caiDatDbService.datCauHinhTracking({ DaChuyenTaiKhoanGke: 'TRUE' });
}
chuyenCauHinhCuSangTaiKhoan();

// Lỗi CHUNG (30/09/2026) — ảnh hưởng MỌI đơn, không phải do dữ liệu của 1 đơn: tài khoản/cấu hình GKE, đăng nhập, mất
// kết nối, GKE quá thời gian chờ hoặc trả trang lỗi. trackingAutoService.js KHÔNG tính vào giới hạn 10 lần thử của đơn.
const loiChung = thongBao => Object.assign(new Error(thongBao), { loiChung: true });

// Chọn tài khoản GKE cho 1 đơn: (1) tài khoản ĐÃ tạo vận đơn cho đơn này (cột TAI_KHOAN_GKE) — in lại
// tem/tra trạng thái phải dùng đúng tài khoản đó dù đơn đã đổi Xưởng; đơn tạo vận đơn TRƯỚC khi có cột
// này -> tài khoản cũ (ID_TAI_KHOAN_CU); (2) chưa tạo vận đơn -> tài khoản đang gán cho Xưởng của đơn.
// Không xác định được -> throw lỗi rõ ràng (không dùng tài khoản Xưởng khác thay thế).
function layCauHinhGkeChoDon(row) {
  let id = row.TAI_KHOAN_GKE;
  if (!id && (row.TRACKING_ID || row.TAM_THOI)) id = ID_TAI_KHOAN_CU;
  if (!id) {
    if (!row.XUONG) throw loiChung(`[tài khoản GKE] Đơn ${row.STT_Key} chưa gán Xưởng — không xác định được tài khoản GKE để dùng.`);
    id = caiDatDbService.layGanTaiKhoanGke()[row.XUONG];
    if (!id) throw loiChung(`[tài khoản GKE] Xưởng "${row.XUONG}" chưa được gán tài khoản GKE — vào Settings > Tài khoản GKE để gán.`);
  }
  const dong = caiDatDbService.layTaiKhoanGke(id);
  if (!dong) throw loiChung(`[tài khoản GKE] Tài khoản GKE #${id} (dùng cho đơn ${row.STT_Key}) không còn tồn tại — kiểm tra lại ở Settings.`);
  const ch = cauHinhTuDong(dong);
  if (!ch.username || !ch.password) throw loiChung(`[tài khoản GKE] Tài khoản "${ch.ten}" chưa có username/password — cập nhật ở Settings.`);
  return ch;
}

// ---- Dùng cho routes/tracking.js (giao diện Settings, CHỈ superadmin) ----
function layDanhSachTaiKhoanGke() {
  const gan = caiDatDbService.layGanTaiKhoanGke();
  return {
    taiKhoan: caiDatDbService.layDanhSachTaiKhoanGke().map(d => {
      const ch = { id: String(d.id) };
      for (const [khoa, cot] of CAC_TRUONG_CAU_HINH_GKE) ch[khoa] = d[cot];
      return ch;
    }),
    danhSachXuong: caiDatDbService.layDanhSachXuong(),
    ganXuong: gan,
  };
}
function luuTaiKhoanGke(id, giaTri) {
  const ghi = {};
  for (const [khoa, cot] of CAC_TRUONG_CAU_HINH_GKE) ghi[cot] = String(giaTri[khoa] ?? '').trim();
  if (ghi.GkeCustomsCurrency) ghi.GkeCustomsCurrency = ghi.GkeCustomsCurrency.toUpperCase();
  if (!ghi.Ten) throw new Error('Thiếu tên tài khoản');
  if (id && !caiDatDbService.layTaiKhoanGke(id)) throw new Error('Không tìm thấy tài khoản');
  const moiId = caiDatDbService.ghiTaiKhoanGke(id, ghi);
  tokenCache.delete(String(moiId)); // đổi username/password -> buộc đăng nhập lại
  return String(moiId);
}
function xoaTaiKhoanGke(id) {
  const dangGan = Object.entries(caiDatDbService.layGanTaiKhoanGke()).filter(([, v]) => v === String(id)).map(([x]) => x);
  if (dangGan.length) throw new Error(`Tài khoản đang được gán cho Xưởng: ${dangGan.join(', ')} — bỏ gán trước khi xoá.`);
  caiDatDbService.xoaTaiKhoanGke(id);
  tokenCache.delete(String(id));
}
function ganTaiKhoanGkeChoXuong(xuong, id) {
  if (!caiDatDbService.layDanhSachXuong().includes(xuong)) throw new Error(`Xưởng không hợp lệ: "${xuong}"`);
  if (id && !caiDatDbService.layTaiKhoanGke(id)) throw new Error('Không tìm thấy tài khoản');
  caiDatDbService.ganTaiKhoanGkeChoXuong(xuong, id);
}

const BASE_URL = 'https://order.gkelogistics.com/openapi/customer';

// fetch() của Node không có timeout mặc định — nếu mạng tới GKE bị treo (chặn tường lửa, DNS lỗi...)
// request có thể treo VÔ THỜI HẠN, khiến người dùng chỉ thấy vòng xoay chờ mãi. Từng đặt 20s (thấy
// hụt thật khi test 01/09/2026 — order/create/ với dữ liệu đơn xuyên biên giới đầy đủ mất hơn 20s
// mới xong, không phải lỗi mạng), nâng lên 45s cho có dư — GKE bắt buộc phối hợp với hãng vận
// chuyển cuối (UniUni...) để tạo vận đơn thật, nặng hơn hẳn 1 lượt đăng nhập lấy token đơn thuần.
// Trước đó cũng từng nghi ngờ 1 proxy/tunnel phía trước tự ngắt kết nối trả về trang lỗi KHÔNG PHẢI
// JSON — đây chính là nguyên nhân hay gặp nhất của thông báo "Có lỗi xảy ra" chung chung (client không parse được JSON
// nên rơi vào thông báo mặc định). Đặt timeout rõ ràng để báo đúng nguyên nhân "quá thời gian chờ".
const TIMEOUT_MS = 45000;

// Ghi 1 dòng log — LUÔN in ra console server như cũ (không đổi hành vi debug hiện có), ĐỒNG THỜI gộp
// vào mảng `nhatKy` nếu có truyền vào — bổ sung 09/09/2026 lần 4, theo yêu cầu người dùng: cột ChiTiet
// trong tab Sheet mới "LogsTracking" cần ghi lại ĐẦY ĐỦ mọi dòng log liên quan (tất cả các bước gọi
// GKE), không chỉ mỗi thông báo lỗi cuối cùng — xem ảnh chụp console server người dùng gửi kèm.
// `nhatKy` là THAM SỐ TUỲ CHỌN truyền xuyên suốt fetchJson → layToken/goiApi → taoDonGke/layTemIn —
// services/trackingAutoService.js truyền vào ở CẢ muaTrackingChoDon() lẫn inLabelChoDon() (mục 9/10
// trong docs/superpowers/specs/2026-09-09-tu-dong-mua-tracking-design.md), để cột ChiTiet trong tab
// LogsTracking ghi lại đầy đủ mọi bước gọi GKE cho từng lượt.
function ghi(nhatKy, ...doiSo) {
  console.log(...doiSo);
  if (nhatKy) nhatKy.push(doiSo.map(d => (typeof d === 'string' ? d : JSON.stringify(d))).join(' '));
}
function ghiLoi(nhatKy, ...doiSo) {
  console.error(...doiSo);
  if (nhatKy) nhatKy.push(doiSo.map(d => (typeof d === 'string' ? d : JSON.stringify(d))).join(' '));
}

// Gọi 1 URL, LUÔN đọc response dạng text trước rồi mới thử parse JSON — nếu parse lỗi thì in ra
// console 500 ký tự đầu của response thật (thường là trang lỗi HTML từ proxy/GKE) thay vì nuốt lỗi
// âm thầm như cách cũ (res.json().catch(() => ({}))) từng làm, khiến không biết GKE trả về CÁI GÌ.
async function fetchJson(buoc, url, options, nhatKy) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  ghi(nhatKy, `[GKE] [${buoc}] Gọi ${options.method} ${url}`);

  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      ghiLoi(nhatKy, `[GKE] [${buoc}] Quá thời gian chờ (${TIMEOUT_MS / 1000}s) — kiểm tra mạng/tường lửa tới order.gkelogistics.com`);
      throw loiChung(`[${buoc}] Gọi GKE quá thời gian chờ (${TIMEOUT_MS / 1000}s) — kiểm tra kết nối mạng của server tới order.gkelogistics.com`);
    }
    ghiLoi(nhatKy, `[GKE] [${buoc}] Lỗi mạng:`, err.message);
    throw loiChung(`[${buoc}] Lỗi kết nối tới GKE: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    ghiLoi(nhatKy, `[GKE] [${buoc}] Phản hồi KHÔNG phải JSON (HTTP ${res.status}) — 500 ký tự đầu:`, text.slice(0, 500));
    throw loiChung(`[${buoc}] GKE trả về dữ liệu không hợp lệ (HTTP ${res.status}) — xem log server để thấy nguyên văn phản hồi`);
  }

  ghi(nhatKy, `[GKE] [${buoc}] Phản hồi: HTTP ${res.status}, code=${data.code}, success=${data.success}`);
  return { res, data };
}

// Cache token trong bộ nhớ tiến trình — GKE cấp token sống 24h, khuyến nghị làm mới mỗi 12h
// (xem Integration Guide). Làm mới sớm hơn hạn thật để tránh trường hợp gọi API đúng lúc token
// vừa hết hạn giữa chừng 1 request.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
// Cache RIÊNG theo từng tài khoản (bổ sung 27/09/2026) — id tài khoản -> { token, thoiDiemLay }. Dùng
// chung 1 biến như trước sẽ khiến Xưởng này gọi API bằng token của tài khoản Xưởng kia.
const tokenCache = new Map();

async function layToken(cauHinh, { boQuaCache = false } = {}, nhatKy) {
  const daCache = tokenCache.get(cauHinh.id);
  if (!boQuaCache && daCache && Date.now() - daCache.thoiDiemLay < TOKEN_TTL_MS) {
    return daCache.token;
  }
  if (!cauHinh.username || !cauHinh.password) {
    throw loiChung('[đăng nhập] Thiếu username/password tài khoản GKE — cập nhật ở Settings.');
  }
  ghi(nhatKy, `[GKE] [đăng nhập] Dùng tài khoản "${cauHinh.ten}" (id ${cauHinh.id})`);

  const { data } = await fetchJson('đăng nhập', `${BASE_URL}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: cauHinh.username,
      password: cauHinh.password,
    }),
  }, nhatKy);
  if (!data.success || !data.data || !data.data.token) {
    throw loiChung('[đăng nhập] Đăng nhập GKE thất bại: ' + (data.detail || 'phản hồi thiếu token'));
  }

  tokenCache.set(cauHinh.id, { token: data.data.token, thoiDiemLay: Date.now() });
  ghi(nhatKy, '[GKE] [đăng nhập] Lấy token mới thành công, hiệu lực tới', new Date(Date.now() + TOKEN_TTL_MS).toLocaleString('vi-VN'));
  return data.data.token;
}

// Gọi 1 endpoint POST của GKE, tự đính token — nếu bị từ chối do token hỏng (401, hoặc code khác
// 200 kèm chữ "token"/"unauthorized" trong detail) thì làm mới token 1 lần rồi thử lại đúng 1 lần,
// không lặp vô hạn. `buoc` = tên bước để log/báo lỗi rõ ràng theo đúng giai đoạn (đăng nhập/tạo đơn/in tem).
// `extraHeaders` (bổ sung 14/09/2026, mặc định rỗng — không đổi hành vi 2 chỗ gọi cũ) — cho phép truyền
// thêm header tuỳ endpoint, VD Accept-Language: vi cho query/track/ (xem layLichSuTrackingGke).
async function goiApi(buoc, path, body, cauHinh, { daThuLai = false, extraHeaders = {} } = {}, nhatKy) {
  const token = await layToken(cauHinh, {}, nhatKy);
  const { res, data } = await fetchJson(buoc, `${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extraHeaders },
    body: JSON.stringify(body),
  }, nhatKy);

  if (!data.success) {
    // code=301 "Repeated" — KHÔNG phải lỗi thật, GKE đang báo "đơn này (theo customer_order_num) đã
    // tồn tại rồi", kèm sẵn data của vận đơn đã tạo trước đó (order_num, tracking_num...). Gặp thật
    // 01/09/2026: do 1 bug cũ (đã vá — xem MA_DANG_CHO_TEM bên dưới) khiến Sheet không
    // ghi lại vận đơn đã tạo, quét lại tưởng nhầm chưa tạo và gọi order/create/ lần nữa — GKE tự
    // chặn trùng ở phía họ và trả thẳng data cũ, coi như thành công để đi tiếp lấy tem, không báo lỗi.
    if (data.code === 301 && data.data) {
      ghi(nhatKy, `[GKE] [${buoc}] GKE báo "đã tồn tại từ trước" (code 301) — dùng lại dữ liệu cũ:`, JSON.stringify(data.data));
      return data.data;
    }
    const loiTokenHong = res.status === 401 || /token/i.test(data.detail || '');
    if (loiTokenHong && !daThuLai) {
      ghi(nhatKy, `[GKE] [${buoc}] Token có vẻ đã hỏng — làm mới token và thử lại 1 lần`);
      await layToken(cauHinh, { boQuaCache: true }, nhatKy);
      return goiApi(buoc, path, body, cauHinh, { daThuLai: true, extraHeaders }, nhatKy);
    }
    ghiLoi(nhatKy, `[GKE] [${buoc}] GKE từ chối:`, JSON.stringify(data));
    throw new Error(`[${buoc}] ${data.detail || `Lỗi GKE (mã ${data.code ?? res.status})`}`);
  }
  return data.data;
}

// Chuẩn hoá để so sánh không phân biệt hoa/thường/dấu — cùng tinh thần taiSanService.chuan(), nhưng
// lọc dấu bằng cách so mã điểm Unicode (0x300-0x36f = dải dấu kết hợp sau khi tách NFD) thay vì viết
// trực tiếp 1 khoảng ký tự kết hợp trong regex — tránh ký tự tổ hợp nằm ngay trong mã nguồn (dễ vỡ
// qua các công cụ xử lý văn bản khác nhau: git diff, trình soạn thảo, copy-paste...).
function chuanHoa(str) {
  return Array.from(String(str || '').trim().toLowerCase().normalize('NFD'))
    .filter(kyTu => {
      const maDiem = kyTu.codePointAt(0);
      return !(maDiem >= 0x0300 && maDiem <= 0x036f);
    })
    .join('')
    .replace(/đ/g, 'd'); // "đ" không tách dấu qua NFD — đổi tay (vd "Đức" -> "duc")
}

// GKE bắt buộc mã quốc gia 2 ký tự (ISO 3166-1 alpha-2) — cột DIA_CHI_NUOC trong Sheet nhiều khả
// năng đang lưu tên đầy đủ (vd "United States"), không phải mã 2 ký tự. Bổ sung thêm dòng khi gặp
// quốc gia mới báo lỗi "chưa có ánh xạ" — cố tình KHÔNG đoán bừa để tránh gửi sai mã quốc gia
// (ảnh hưởng trực tiếp tới việc định tuyến vận chuyển quốc tế).
// Khoá tra đã bỏ dấu, chữ thường, bỏ dấu chấm (xem khoaQuocGia) — "U.S.A." -> "usa", "Mỹ" -> "my".
const MA_QUOC_GIA = {
  'united states': 'US', 'united states of america': 'US', usa: 'US', us: 'US', america: 'US',
  my: 'US', 'nuoc my': 'US', 'hoa ky': 'US',
  canada: 'CA',
  'south korea': 'KR', korea: 'KR', 'han quoc': 'KR',
  'united kingdom': 'GB', uk: 'GB', gb: 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB',
  scotland: 'GB', wales: 'GB', 'northern ireland': 'GB', anh: 'GB', 'vuong quoc anh': 'GB',
  australia: 'AU', uc: 'AU',
  vietnam: 'VN', 'viet nam': 'VN',
  france: 'FR', phap: 'FR',
  germany: 'DE', duc: 'DE',
};

function khoaQuocGia(ten) {
  return chuanHoa(ten).replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function maQuocGia(ten) {
  const goc = String(ten || '').trim();
  if (!goc) throw new Error('[chuẩn bị dữ liệu] Đơn thiếu DIA_CHI_NUOC — không xác định được mã quốc gia cho GKE');
  // Tra bảng TRƯỚC, rồi mới coi chuỗi 2 chữ cái là mã ISO sẵn (sửa 27/09/2026 — trước đây "UK" được gửi
  // nguyên văn cho GKE thay vì mã ISO đúng "GB").
  const ma = MA_QUOC_GIA[khoaQuocGia(goc)] || (/^[a-zA-Z]{2}$/.test(goc) ? goc.toUpperCase() : null);
  if (!ma) throw new Error(`[chuẩn bị dữ liệu] Chưa có ánh xạ mã quốc gia cho "${goc}" — bổ sung vào MA_QUOC_GIA trong services/gkeService.js`);
  return ma;
}

// Mua tracking GKE CHỈ cho đơn giao tới US hoặc UK (bổ sung 27/09/2026, theo yêu cầu người dùng) — xét
// cột DIA_CHI_NUOC (đúng cột dùng tạo vận đơn). Trống/không nhận ra = không được mua.
const QUOC_GIA_DUOC_MUA_TRACKING = ['US', 'GB'];
function duocMuaTrackingTheoQuocGia(row) {
  try { return QUOC_GIA_DUOC_MUA_TRACKING.includes(maQuocGia(row.DIA_CHI_NUOC)); } catch { return false; }
}

function thongTinNguoiGui(cauHinh) {
  const thieu = ['shipperPhone', 'shipperAddress', 'shipperPostcode'].filter(k => !cauHinh[k]);
  if (thieu.length) {
    throw loiChung(`[chuẩn bị dữ liệu] Thiếu ${thieu.join(', ')} trong cấu hình GKE — vào menu Tracking để nhập đủ thông tin người gửi (xưởng)`);
  }
  return {
    full_name: cauHinh.shipperName,
    company: cauHinh.shipperName,
    phone: cauHinh.shipperPhone,
    country: 'VN',
    postcode: cauHinh.shipperPostcode,
    province: cauHinh.shipperProvince,
    city: cauHinh.shipperCity,
    address: cauHinh.shipperAddress,
  };
}

// Số điện thoại giả dùng khi đơn KHÔNG có SDT — GKE bắt buộc phải có số điện thoại người nhận mới tạo
// được vận đơn. CHỈ dùng cho đúng lượt gọi GKE này (không ghi ngược lại cột SDT của đơn trong Sheet) —
// theo lựa chọn của người dùng 12/09/2026, để đơn vẫn hiện SDT trống ở mọi nơi khác (danh sách, chi
// tiết, báo cáo), tránh nhầm số giả này là số thật của khách.
const SDT_MAC_DINH_KHI_THIEU = '0000000000';

function thongTinNguoiNhan(donHang) {
  const thieu = ['TEN', 'DIA_CHI_TEN_TP', 'MA_ZIPCODE'].filter(k => !donHang[k]);
  if (thieu.length) {
    throw new Error(`[chuẩn bị dữ liệu] Đơn ${donHang.STT_Key} thiếu cột ${thieu.join(', ')} — không đủ thông tin người nhận cho GKE`);
  }
  return {
    full_name: donHang.TEN || '',
    phone: donHang.SDT || SDT_MAC_DINH_KHI_THIEU,
    country: maQuocGia(donHang.DIA_CHI_NUOC),
    postcode: donHang.MA_ZIPCODE || '',
    province: donHang.DIA_CHI_BANG || '',
    city: donHang.DIA_CHI_TEN_TP || '',
    address: donHang.DIA_CHI_TEN_DUONG || donHang.TEN_DIA_CHI || '',
  };
}

// Cân nặng cả kiện = TRONG_LUONG (kg/áo, cột thật trong Sheet, người dùng xác nhận đơn vị kg
// 01/09/2026) x SO_LUONG. TRONG_LUONG trống/0/không hợp lệ thì dùng cauHinh.canNangMoiAoKg/áo thay
// thế (trước đây cố định 0.05kg trong code — bổ sung 09/09/2026, chuyển lên giao diện Tracking để
// chỉnh không cần sửa code, xem layCauHinhGke()).
function tinhCanNangKg(donHang, cauHinh) {
  // DonNhieuAo (bổ sung 26/09/2026): đơn ".1" mua tracking cho CẢ nhóm — nơi gọi truyền sẵn tổng cân
  // nặng các đơn chưa huỷ trong nhóm (xem trackingAutoService.js#_muaTrackingChoDonThat).
  if (donHang._CAN_NANG_KG > 0) return donHang._CAN_NANG_KG;
  const soLuong = Number(donHang.SO_LUONG) || 1;
  const trongLuongMoiCai = Number(donHang.TRONG_LUONG);
  const canNangMoiCai = trongLuongMoiCai > 0 ? trongLuongMoiCai : cauHinh.canNangMoiAoKg;
  return Math.max(soLuong * canNangMoiCai, 0.01);
}

// Giá trị tạm ghi vào TRACKING_ID NGAY SAU KHI order/create/ thành công, TRƯỚC KHI thử lấy tem —
// đóng lại "khoảng hở" nguy hiểm: nếu không ghi gì cho tới lúc có tem thật, mà lấy tem lại thất bại
// (GKE cần thời gian generate tem, có thể chưa xong ngay — xem layTemIn), quét/quét-tự-động lại đơn
// sẽ hiểu nhầm "chưa tạo đơn" và gọi order/create/ THÊM 1 LẦN, tạo ra 2 vận đơn thật trùng nhau bên
// GKE. Phát hiện qua test thật 01/09/2026. Giá trị này KHÔNG PHẢI mã vận đơn thật — nhân viên nhìn
// trong Sheet thấy giá trị này thì biết đơn đang chờ, không phải lỗi hiển thị. Đặt ở gkeService.js
// (không phải trackingAutoService.js) vì CẢ luồng thủ công/tự động (muaTrackingChoDon()) LẪN
// inLabelChoDon() (services/trackingAutoService.js) đều cần nhận diện đúng giá trị này.
const MA_DANG_CHO_TEM = 'DANG_CHO_GKE_TAO_TEM';

// Tạo 1 vận đơn THẬT bên GKE — chỉ gọi hàm này khi đơn CHƯA từng tạo vận đơn lần nào.
async function taoDonGke(donHang, cauHinh, nhatKy) {
  const thieuCauHinh = ['serviceCode', 'customsHsCode', 'customsDeclaredPrice'].filter(k => !cauHinh[k]);
  if (thieuCauHinh.length) {
    throw loiChung(`[chuẩn bị dữ liệu] Thiếu ${thieuCauHinh.join(', ')} trong cấu hình GKE — vào menu Tracking để nhập.`);
  }

  const body = {
    customer_order_num: donHang.STT_Key,
    service_code: cauHinh.serviceCode,
    'need-track': 'Y',
    need_scan: false,
    shipper_info: thongTinNguoiGui(cauHinh),
    consignee_info: thongTinNguoiNhan(donHang),
    parcel_list: [{
      weight: tinhCanNangKg(donHang, cauHinh),
      item_list: [{
        export_declared: cauHinh.customsItemName,
        import_declared: cauHinh.customsItemName,
        export_hscode: cauHinh.customsHsCode,
        import_hscode: cauHinh.customsHsCode,
        // GKE bắt buộc khai giá CẢ 2 chiều xuất/nhập cho đơn xuyên biên giới (phát hiện qua log lỗi
        // thật 01/09/2026: "import_price: Field required") — dùng CÙNG 1 mức cố định cho cả 2, đúng
        // quyết định "1 mức cố định" ban đầu, không tách riêng giá xuất/nhập.
        export_price: Number(cauHinh.customsDeclaredPrice),
        export_price_currency: cauHinh.customsCurrency,
        import_price: Number(cauHinh.customsDeclaredPrice),
        import_price_currency: cauHinh.customsCurrency,
      }],
    }],
  };
  ghi(nhatKy, `[GKE] [tạo đơn] Body gửi cho đơn ${donHang.STT_Key}:`, JSON.stringify(body));

  return goiApi('tạo đơn', '/order/create/', body, cauHinh, {}, nhatKy);
}

// Ngay sau khi order/create/ thành công, tem thường CHƯA generate xong ngay — gọi label/print/
// quá sớm bị GKE từ chối với thông báo kiểu "等待抓取面单" (đang chờ lấy được tem). Phát hiện qua
// test thật 01/09/2026. Tự đợi + thử lại vài lần thay vì báo lỗi ngay, để vẫn giữ đúng luồng
// "quét là in luôn, không cần bấm gì thêm" — nếu sau hết số lần thử vẫn chưa xong thì mới báo lỗi
// thật cho người dùng (đơn đã tạo thành công, chỉ chưa lấy được tem, có thể vào lại sau để in lại).
const SO_LAN_THU_LAI_TEM = 6;
const KHOANG_CACH_THU_LAI_MS = 3000;
function dangChoTemSanSang(thongBaoLoi) {
  return /等待抓取面单|waiting|pending|chưa.*sẵn sàng|đang.*xử lý/i.test(thongBaoLoi || '');
}

// Lấy tem in (PDF base64) — dùng num_type=1 (Customer Order Number) + STT_Key, KHÔNG cần biết
// order_num/waybill number nội bộ của GKE vì lúc tạo đơn đã đặt customer_order_num = STT_Key.
async function layTemIn(donHang, cauHinh, { laLanDauSauKhiTao = false } = {}, nhatKy) {
  const soLanThu = laLanDauSauKhiTao ? SO_LAN_THU_LAI_TEM : 1;
  for (let lan = 1; lan <= soLanThu; lan++) {
    try {
      return await goiApi('in tem', '/label/print/', { num_type: 1, num: donHang.STT_Key }, cauHinh, {}, nhatKy);
    } catch (err) {
      const conThuTiep = laLanDauSauKhiTao && lan < soLanThu && dangChoTemSanSang(err.message);
      if (!conThuTiep) throw err;
      ghi(nhatKy, `[GKE] [in tem] Tem chưa sẵn sàng (lần ${lan}/${soLanThu}), đợi ${KHOANG_CACH_THU_LAI_MS / 1000}s rồi thử lại...`);
      await new Promise(r => setTimeout(r, KHOANG_CACH_THU_LAI_MS));
    }
  }
}

// Tra cứu LỊCH SỬ trạng thái tracking thật (bổ sung 14/09/2026, theo yêu cầu người dùng — xem
// docs/superpowers/specs/2026-09-14-cap-nhat-trang-thai-tracking-design.md) — dùng num_type=1 + STT_Key
// giống hệt layTemIn() ở trên. Accept-Language: vi để GKE tự trả track_name bằng tiếng Việt, không cần
// tự xây bảng dịch. Trả về NGUYÊN VĂN mảng sự kiện (cũ -> mới dần theo tài liệu API) — nơi gọi tự lấy
// phần tử CUỐI làm trạng thái hiện tại; mảng RỖNG (đơn label mới tạo, chưa có sự kiện nào) không phải
// lỗi, KHÔNG throw.
async function layLichSuTrackingGke(sttKey, cauHinh, nhatKy) {
  const data = await goiApi(
    'tra cứu tracking', '/query/track/', { num_type: 1, num: sttKey }, cauHinh,
    { extraHeaders: { 'Accept-Language': 'vi' } }, nhatKy
  );
  return Array.isArray(data) ? data : [];
}

// CÁCH TÌM LỖI khi tab "Quét mã QR Tracking" báo lỗi:
//   1. Mở terminal đang chạy `npm start`/`node server.js` (hoặc `docker logs -f xuong-theu-webapp`
//      nếu chạy Docker) — mọi bước đều in dòng bắt đầu "[GKE]", kèm đúng tên bước (đăng nhập / tạo
//      đơn / in tem / chuẩn bị dữ liệu) đang thất bại.
//   2. Nếu dòng lỗi có "Phản hồi KHÔNG phải JSON" — GKE hoặc 1 proxy ở giữa trả về HTML/lỗi mạng,
//      500 ký tự in kèm theo là nội dung thật nhận được, đọc trực tiếp để biết chuyện gì xảy ra.
//   3. Nếu dòng lỗi có "Quá thời gian chờ" — server không kết nối được tới order.gkelogistics.com
//      trong 45 giây, kiểm tra tường lửa/mạng ra ngoài của máy đang chạy server.
//   4. Nếu dòng lỗi có "chưa sẵn sàng" / "等待抓取面单" ở bước in tem — bình thường, hệ thống tự thử
//      lại vài lần (xem layTemIn); chỉ thực sự lỗi nếu hết số lần thử vẫn chưa xong.
//   5. Thông báo hiện trên điện thoại/trình duyệt (mục ket-qua-tra-cuu) LUÔN kèm tên bước trong
//      ngoặc vuông ở đầu câu, vd "[tạo đơn] ..." — khớp đúng với log server để đối chiếu nhanh.
// Ghép nhiều tem PDF (mỗi tem là 1 chuỗi base64 lấy từ layTemIn()) thành 1 file PDF nhiều trang duy
// nhất — bổ sung 09/09/2026, dùng khi in label HÀNG LOẠT tại menu Đơn hàng (chọn nhiều đơn cùng lúc):
// chỉ hiện 1 hộp thoại in duy nhất (mỗi đơn 1 trang) thay vì mở lần lượt N hộp thoại in riêng biệt.
// Chỉ 1 phần tử thì trả về NGUYÊN VĂN base64 đó, khỏi tốn công load/save lại qua pdf-lib.
async function gopCacTemPdf(danhSachBase64) {
  if (danhSachBase64.length === 1) return danhSachBase64[0];

  const taiLieuGop = await PDFDocument.create();
  for (const base64 of danhSachBase64) {
    const taiLieuNguon = await PDFDocument.load(Buffer.from(base64, 'base64'));
    const cacTrang = await taiLieuGop.copyPages(taiLieuNguon, taiLieuNguon.getPageIndices());
    cacTrang.forEach(trang => taiLieuGop.addPage(trang));
  }
  const bytesGop = await taiLieuGop.save();
  return Buffer.from(bytesGop).toString('base64');
}

// Ghi 1 dòng chữ nhỏ ở mép dưới MỌI trang tem (bổ sung 26/09/2026, DonNhieuAo) — vd "KIEN GOM 4 DON:
// 9F13.1, 9F13.2, ..." để người đóng gói biết 1 tem này dùng cho cả kiện. Font chuẩn của pdf-lib KHÔNG
// có dấu tiếng Việt nên chỉ dùng chữ không dấu. Tự thu nhỏ cỡ chữ cho vừa bề ngang tem.
// ponytail: vị trí cố định ở mép dưới — nếu đè lên mã vạch của hãng nào thì đổi toạ độ y ở đây.
async function ghiChuLenTem(base64, chu) {
  const taiLieu = await PDFDocument.load(Buffer.from(base64, 'base64'));
  const font = await taiLieu.embedFont(StandardFonts.HelveticaBold);
  for (const trang of taiLieu.getPages()) {
    const { width } = trang.getSize();
    let co = 7;
    while (co > 4 && font.widthOfTextAtSize(chu, co) > width - 8) co -= 0.5;
    trang.drawText(chu, { x: 4, y: 3, size: co, font });
  }
  return Buffer.from(await taiLieu.save()).toString('base64');
}

module.exports = {
  duocMuaTrackingTheoQuocGia,
  layCauHinhGkeChoDon, layDanhSachTaiKhoanGke, luuTaiKhoanGke, xoaTaiKhoanGke, ganTaiKhoanGkeChoXuong,
  ghiChuLenTem, tinhCanNangKg, taoDonGke, layTemIn, layLichSuTrackingGke, maQuocGia, MA_DANG_CHO_TEM, gopCacTemPdf,
  chuanHoa };
