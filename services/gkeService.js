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
const BASE_URL = 'https://order.gkelogistics.com/openapi/customer';

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
    throw new Error('Thiếu GKE_API_USERNAME/GKE_API_PASSWORD trong .env');
  }

  const res = await fetch(`${BASE_URL}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.GKE_API_USERNAME,
      password: process.env.GKE_API_PASSWORD,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error('Đăng nhập GKE thất bại: ' + (data.detail || `HTTP ${res.status}`));

  tokenCache = { token: data.data.token, thoiDiemLay: Date.now() };
  return tokenCache.token;
}

// Gọi 1 endpoint POST của GKE, tự đính token — nếu bị từ chối do token hỏng (401, hoặc code khác
// 200 kèm chữ "token"/"unauthorized" trong detail) thì làm mới token 1 lần rồi thử lại đúng 1 lần,
// không lặp vô hạn.
async function goiApi(path, body, { daThuLai = false } = {}) {
  const token = await layToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  if (!data.success) {
    const loiTokenHong = res.status === 401 || /token/i.test(data.detail || '');
    if (loiTokenHong && !daThuLai) {
      await layToken({ boQuaCache: true });
      return goiApi(path, body, { daThuLai: true });
    }
    throw new Error(data.detail || `Lỗi GKE (mã ${data.code ?? res.status})`);
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
  if (!goc) throw new Error('Đơn thiếu DIA_CHI_NUOC — không xác định được mã quốc gia cho GKE');
  if (/^[a-zA-Z]{2}$/.test(goc)) return goc.toUpperCase(); // đã là mã 2 ký tự sẵn thì dùng luôn
  const ma = MA_QUOC_GIA[chuanHoa(goc)];
  if (!ma) throw new Error(`Chưa có ánh xạ mã quốc gia cho "${goc}" — bổ sung vào MA_QUOC_GIA trong services/gkeService.js`);
  return ma;
}

function thongTinNguoiGui() {
  if (!process.env.GKE_SHIPPER_PHONE || !process.env.GKE_SHIPPER_ADDRESS || !process.env.GKE_SHIPPER_POSTCODE) {
    throw new Error('Thiếu GKE_SHIPPER_PHONE/GKE_SHIPPER_ADDRESS/GKE_SHIPPER_POSTCODE trong .env — cần đủ thông tin người gửi (xưởng)');
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
  if (!process.env.GKE_SERVICE_CODE) {
    throw new Error('Thiếu GKE_SERVICE_CODE trong .env — xem hướng dẫn lấy mã ở get/services/');
  }
  if (!process.env.GKE_CUSTOMS_HS_CODE || !process.env.GKE_CUSTOMS_DECLARED_PRICE) {
    throw new Error('Thiếu GKE_CUSTOMS_HS_CODE/GKE_CUSTOMS_DECLARED_PRICE trong .env — cần khai báo hải quan');
  }

  const soLuong = Number(donHang.SO_LUONG) || 1;
  const tenHang = process.env.GKE_CUSTOMS_ITEM_NAME || 'Embroidered garment';

  return goiApi('/order/create/', {
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
        export_price: Number(process.env.GKE_CUSTOMS_DECLARED_PRICE),
        export_price_currency: process.env.GKE_CUSTOMS_CURRENCY || 'USD',
      }],
    }],
  });
}

// Lấy tem in (PDF base64) — dùng num_type=1 (Customer Order Number) + STT_Key, KHÔNG cần biết
// order_num/waybill number nội bộ của GKE vì lúc tạo đơn đã đặt customer_order_num = STT_Key.
async function layTemIn(donHang) {
  return goiApi('/label/print/', { num_type: 1, num: donHang.STT_Key });
}

// Hàm chính routes/gke.js gọi — tự quyết định tạo đơn mới hay chỉ in lại tuỳ đơn đã có
// MA_VAN_DON_ID hay chưa.
async function taoDonVaLayTem(donHang) {
  if (!donHang.MA_VAN_DON_ID) {
    await taoDonGke(donHang);
  }
  return layTemIn(donHang);
}

module.exports = { taoDonVaLayTem, taoDonGke, layTemIn, maQuocGia };
