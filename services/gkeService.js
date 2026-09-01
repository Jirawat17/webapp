// Tích hợp GKE Logistics (order.gkelogistics.com) — tạo vận đơn thật + lấy tem in khi đơn chuyển
// sang "Đã đóng gói" (mục Quét mã QR Tracking, xem routes/gke.js). Quyết định cùng người dùng
// 31/08/2026:
//   - customer_order_num khi tạo đơn LUÔN đặt = STT_Key của mình — nhờ vậy in lại tem sau này
//     KHÔNG cần lưu riêng order_num/waybill number của GKE, chỉ cần num_type=1 + STT_Key.
//   - Đơn đã có MA_VAN_DON_ID rồi thì KHÔNG tạo đơn GKE mới nữa (mỗi lần order/create/ tạo 1 vận
//     đơn thật, gọi lặp sẽ ra nhiều vận đơn trùng) — chỉ gọi lại label/print/ để in lại tem cũ.
//   - Cân nặng: ước lượng SO_LUONG * 0.05kg/áo (chưa có cột cân nặng thật trong Sheet).
//   - Khai báo hải quan: dùng 1 mức giá/mã HS cố định cho MỌI đơn (đọc từ .env), không phân biệt
//     loại sản phẩm — đơn giản hoá theo yêu cầu, có thể tách theo LOAI sau này nếu cần chính xác hơn.
//   - Lỗi gọi GKE KHÔNG chặn màn quét (xem routes/gke.js) — chỉ báo lỗi rõ, nhân viên quét lại sau.
//
// GHI LOG CHI TIẾT RA CONSOLE SERVER (bổ sung 01/09/2026, theo yêu cầu người dùng — lần test đầu
// chỉ thấy "Đã có lỗi xảy ra" chung chung, không biết lỗi ở bước nào): mọi bước gọi GKE đều in ra
// console.log/console.error kèm tên bước, để mở terminal server lúc test là thấy ngay lỗi thật ở
// đâu, không cần đoán. Xem thêm ghi chú "CÁCH TÌM LỖI" ở cuối file.
const BASE_URL = 'https://order.gkelogistics.com/openapi/customer';

// fetch() của Node không có timeout mặc định — nếu mạng tới GKE bị treo (chặn tường lửa, DNS lỗi...)
// request có thể treo VÔ THỜI HẠN, khiến người dùng chỉ thấy vòng xoay chờ mãi rồi cuối cùng nhận
// 1 lỗi mơ hồ do proxy (nếu có) tự ngắt kết nối trả về trang lỗi KHÔNG PHẢI JSON — đây chính là
// nguyên nhân hay gặp nhất của thông báo "Có lỗi xảy ra" chung chung (client không parse được JSON
// nên rơi vào thông báo mặc định). Đặt timeout rõ ràng để báo đúng nguyên nhân "quá thời gian chờ".
const TIMEOUT_MS = 20000;

// Gọi 1 URL, LUÔN đọc response dạng text trước rồi mới thử parse JSON — nếu parse lỗi thì in ra
// console 500 ký tự đầu của response thật (thường là trang lỗi HTML từ proxy/GKE) thay vì nuốt lỗi
// âm thầm như cách cũ (res.json().catch(() => ({}))) từng làm, khiến không biết GKE trả về CÁI GÌ.
async function fetchJson(buoc, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  console.log(`[GKE] [${buoc}] Gọi ${options.method} ${url}`);

  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`[GKE] [${buoc}] Quá thời gian chờ (${TIMEOUT_MS / 1000}s) — kiểm tra mạng/tường lửa tới order.gkelogistics.com`);
      throw new Error(`[${buoc}] Gọi GKE quá thời gian chờ (${TIMEOUT_MS / 1000}s) — kiểm tra kết nối mạng của server tới order.gkelogistics.com`);
    }
    console.error(`[GKE] [${buoc}] Lỗi mạng:`, err.message);
    throw new Error(`[${buoc}] Lỗi kết nối tới GKE: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error(`[GKE] [${buoc}] Phản hồi KHÔNG phải JSON (HTTP ${res.status}) — 500 ký tự đầu:`, text.slice(0, 500));
    throw new Error(`[${buoc}] GKE trả về dữ liệu không hợp lệ (HTTP ${res.status}) — xem log server để thấy nguyên văn phản hồi`);
  }

  console.log(`[GKE] [${buoc}] Phản hồi: HTTP ${res.status}, code=${data.code}, success=${data.success}`);
  return { res, data };
}

// Cache token trong bộ nhớ tiến trình — GKE cấp token sống 24h, khuyến nghị làm mới mỗi 12h
// (xem Integration Guide). Làm mới sớm hơn hạn thật để tránh trường hợp gọi API đúng lúc token
// vừa hết hạn giữa chừng 1 request.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
let tokenCache = { token: null, thoiDiemLay: 0 };

async function layToken({ boQuaCache = false } = {}) {
  if (!boQuaCache && tokenCache.token && Date.now() - tokenCache.thoiDiemLay < TOKEN_TTL_MS) {
    return tokenCache.token;
  }
  if (!process.env.GKE_API_USERNAME || !process.env.GKE_API_PASSWORD) {
    throw new Error('[đăng nhập] Thiếu GKE_API_USERNAME/GKE_API_PASSWORD trong .env');
  }

  const { data } = await fetchJson('đăng nhập', `${BASE_URL}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.GKE_API_USERNAME,
      password: process.env.GKE_API_PASSWORD,
    }),
  });
  if (!data.success || !data.data || !data.data.token) {
    throw new Error('[đăng nhập] Đăng nhập GKE thất bại: ' + (data.detail || 'phản hồi thiếu token'));
  }

  tokenCache = { token: data.data.token, thoiDiemLay: Date.now() };
  console.log('[GKE] [đăng nhập] Lấy token mới thành công, hiệu lực tới', new Date(Date.now() + TOKEN_TTL_MS).toLocaleString('vi-VN'));
  return tokenCache.token;
}

// Gọi 1 endpoint POST của GKE, tự đính token — nếu bị từ chối do token hỏng (401, hoặc code khác
// 200 kèm chữ "token"/"unauthorized" trong detail) thì làm mới token 1 lần rồi thử lại đúng 1 lần,
// không lặp vô hạn. `buoc` = tên bước để log/báo lỗi rõ ràng theo đúng giai đoạn (đăng nhập/tạo đơn/in tem).
async function goiApi(buoc, path, body, { daThuLai = false } = {}) {
  const token = await layToken();
  const { res, data } = await fetchJson(buoc, `${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (!data.success) {
    const loiTokenHong = res.status === 401 || /token/i.test(data.detail || '');
    if (loiTokenHong && !daThuLai) {
      console.log(`[GKE] [${buoc}] Token có vẻ đã hỏng — làm mới token và thử lại 1 lần`);
      await layToken({ boQuaCache: true });
      return goiApi(buoc, path, body, { daThuLai: true });
    }
    console.error(`[GKE] [${buoc}] GKE từ chối:`, JSON.stringify(data));
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
    .join('');
}

// GKE bắt buộc mã quốc gia 2 ký tự (ISO 3166-1 alpha-2) — cột DIA_CHI_NUOC trong Sheet nhiều khả
// năng đang lưu tên đầy đủ (vd "United States"), không phải mã 2 ký tự. Bổ sung thêm dòng khi gặp
// quốc gia mới báo lỗi "chưa có ánh xạ" — cố tình KHÔNG đoán bừa để tránh gửi sai mã quốc gia
// (ảnh hưởng trực tiếp tới việc định tuyến vận chuyển quốc tế).
const MA_QUOC_GIA = {
  'united states': 'US', 'usa': 'US', 'us': 'US', 'hoa ky': 'US',
  canada: 'CA',
  'south korea': 'KR', korea: 'KR', 'han quoc': 'KR',
  'united kingdom': 'GB', uk: 'GB', anh: 'GB',
  australia: 'AU', uc: 'AU',
  vietnam: 'VN', 'viet nam': 'VN',
  france: 'FR', phap: 'FR',
  germany: 'DE', duc: 'DE',
};

function maQuocGia(ten) {
  const goc = String(ten || '').trim();
  if (!goc) throw new Error('[chuẩn bị dữ liệu] Đơn thiếu DIA_CHI_NUOC — không xác định được mã quốc gia cho GKE');
  if (/^[a-zA-Z]{2}$/.test(goc)) return goc.toUpperCase(); // đã là mã 2 ký tự sẵn thì dùng luôn
  const ma = MA_QUOC_GIA[chuanHoa(goc)];
  if (!ma) throw new Error(`[chuẩn bị dữ liệu] Chưa có ánh xạ mã quốc gia cho "${goc}" — bổ sung vào MA_QUOC_GIA trong services/gkeService.js`);
  return ma;
}

function thongTinNguoiGui() {
  const thieu = ['GKE_SHIPPER_PHONE', 'GKE_SHIPPER_ADDRESS', 'GKE_SHIPPER_POSTCODE'].filter(k => !process.env[k]);
  if (thieu.length) {
    throw new Error(`[chuẩn bị dữ liệu] Thiếu ${thieu.join(', ')} trong .env — cần đủ thông tin người gửi (xưởng)`);
  }
  return {
    full_name: process.env.GKE_SHIPPER_NAME || 'Maxthread VN',
    company: process.env.GKE_SHIPPER_NAME || 'Maxthread VN',
    phone: process.env.GKE_SHIPPER_PHONE,
    country: 'VN',
    postcode: process.env.GKE_SHIPPER_POSTCODE || '',
    province: process.env.GKE_SHIPPER_PROVINCE || '',
    city: process.env.GKE_SHIPPER_CITY || '',
    address: process.env.GKE_SHIPPER_ADDRESS,
  };
}

function thongTinNguoiNhan(donHang) {
  const thieu = ['TEN', 'SDT', 'DIA_CHI_TEN_TP', 'MA_ZIPCODE'].filter(k => !donHang[k]);
  if (thieu.length) {
    throw new Error(`[chuẩn bị dữ liệu] Đơn ${donHang.STT_Key} thiếu cột ${thieu.join(', ')} — không đủ thông tin người nhận cho GKE`);
  }
  return {
    full_name: donHang.TEN || '',
    phone: donHang.SDT || '',
    country: maQuocGia(donHang.DIA_CHI_NUOC),
    postcode: donHang.MA_ZIPCODE || '',
    province: donHang.DIA_CHI_BANG || '',
    city: donHang.DIA_CHI_TEN_TP || '',
    address: donHang.DIA_CHI_TEN_DUONG || donHang.TEN_DIA_CHI || '',
  };
}

const CAN_NANG_MOI_AO_KG = 0.05; // ước lượng theo yêu cầu người dùng (31/08/2026) — chưa có cột cân nặng thật

// Tạo 1 vận đơn THẬT bên GKE — chỉ gọi khi đơn CHƯA có MA_VAN_DON_ID (xem taoDonVaLayTem).
async function taoDonGke(donHang) {
  const thieuCauHinh = ['GKE_SERVICE_CODE', 'GKE_CUSTOMS_HS_CODE', 'GKE_CUSTOMS_DECLARED_PRICE']
    .filter(k => !process.env[k]);
  if (thieuCauHinh.length) {
    throw new Error(`[chuẩn bị dữ liệu] Thiếu ${thieuCauHinh.join(', ')} trong .env`);
  }

  const soLuong = Number(donHang.SO_LUONG) || 1;
  const tenHang = process.env.GKE_CUSTOMS_ITEM_NAME || 'Embroidered garment';

  const body = {
    customer_order_num: donHang.STT_Key,
    service_code: process.env.GKE_SERVICE_CODE,
    'need-track': 'Y',
    need_scan: false,
    shipper_info: thongTinNguoiGui(),
    consignee_info: thongTinNguoiNhan(donHang),
    parcel_list: [{
      weight: Math.max(soLuong * CAN_NANG_MOI_AO_KG, 0.01),
      item_list: [{
        export_declared: tenHang,
        import_declared: tenHang,
        export_hscode: process.env.GKE_CUSTOMS_HS_CODE,
        import_hscode: process.env.GKE_CUSTOMS_HS_CODE,
        // GKE bắt buộc khai giá CẢ 2 chiều xuất/nhập cho đơn xuyên biên giới (phát hiện qua log lỗi
        // thật 01/09/2026: "import_price: Field required") — dùng CÙNG 1 mức cố định cho cả 2, đúng
        // quyết định "1 mức cố định" ban đầu, không tách riêng giá xuất/nhập.
        export_price: Number(process.env.GKE_CUSTOMS_DECLARED_PRICE),
        export_price_currency: process.env.GKE_CUSTOMS_CURRENCY || 'USD',
        import_price: Number(process.env.GKE_CUSTOMS_DECLARED_PRICE),
        import_price_currency: process.env.GKE_CUSTOMS_CURRENCY || 'USD',
      }],
    }],
  };
  console.log(`[GKE] [tạo đơn] Body gửi cho đơn ${donHang.STT_Key}:`, JSON.stringify(body));

  return goiApi('tạo đơn', '/order/create/', body);
}

// Lấy tem in (PDF base64) — dùng num_type=1 (Customer Order Number) + STT_Key, KHÔNG cần biết
// order_num/waybill number nội bộ của GKE vì lúc tạo đơn đã đặt customer_order_num = STT_Key.
async function layTemIn(donHang) {
  return goiApi('in tem', '/label/print/', { num_type: 1, num: donHang.STT_Key });
}

// Hàm chính routes/gke.js gọi — tự quyết định tạo đơn mới hay chỉ in lại tuỳ đơn đã có
// MA_VAN_DON_ID hay chưa.
async function taoDonVaLayTem(donHang) {
  if (!donHang.MA_VAN_DON_ID) {
    console.log(`[GKE] Đơn ${donHang.STT_Key} chưa có MA_VAN_DON_ID — tạo vận đơn mới`);
    await taoDonGke(donHang);
  } else {
    console.log(`[GKE] Đơn ${donHang.STT_Key} đã có MA_VAN_DON_ID=${donHang.MA_VAN_DON_ID} — chỉ in lại tem`);
  }
  return layTemIn(donHang);
}

// CÁCH TÌM LỖI khi tab "Quét mã QR Tracking" báo lỗi:
//   1. Mở terminal đang chạy `npm start`/`node server.js` — mọi bước đều in dòng bắt đầu "[GKE]",
//      kèm đúng tên bước (đăng nhập / tạo đơn / in tem / chuẩn bị dữ liệu) đang thất bại.
//   2. Nếu dòng lỗi có "Phản hồi KHÔNG phải JSON" — GKE hoặc 1 proxy ở giữa trả về HTML/lỗi mạng,
//      500 ký tự in kèm theo là nội dung thật nhận được, đọc trực tiếp để biết chuyện gì xảy ra.
//   3. Nếu dòng lỗi có "Quá thời gian chờ" — server không kết nối được tới order.gkelogistics.com
//      trong 20 giây, kiểm tra tường lửa/mạng ra ngoài của máy đang chạy server.
//   4. Thông báo hiện trên điện thoại/trình duyệt (mục ket-qua-tra-cuu) LUÔN kèm tên bước trong
//      ngoặc vuông ở đầu câu, vd "[tạo đơn] ..." — khớp đúng với log server để đối chiếu nhanh.
module.exports = { taoDonVaLayTem, taoDonGke, layTemIn, maQuocGia };
