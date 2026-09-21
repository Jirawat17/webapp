// Script CHẨN ĐOÁN (chỉ đọc, không ghi gì vào Sheet/SQLite, không tạo đơn/gọi order/create) — in ra
// JSON GỐC mà GKE trả về cho API "Tra cứu tracking" (query/track/), để thấy CHÍNH XÁC tên trường/mã
// trạng thái GKE dùng khi đơn đã giao xong/trả hàng/bất thường (bổ sung 21/09/2026, theo yêu cầu người
// dùng — xem ảnh chụp cổng GKE cho 1 đơn "Đã giao hàng", cổng GKE có 7 nhóm trạng thái tổng quát:
// Không tìm thấy/Chưa nhập kho/Đã nhập kho/Đang vận chuyển/Đang giao hàng/Đã giao hàng/Đơn bất
// thường). Tài liệu công khai openapi.gkelogistics.com KHÔNG liệt kê bảng mã này — đã tra thử, chỉ có
// hướng dẫn xác thực/mã HTTP chung. Dữ liệu chạy ra từ script này sẽ dùng để thiết kế tính năng tự
// động DỪNG quét tracking cho đơn đã ở trạng thái cuối, xem mục 4 "đã cân nhắc nhưng chưa làm" trong
// docs/superpowers/specs/2026-09-14-cap-nhat-trang-thai-tracking-design.md.
//
// CỐ Ý KHÔNG dùng lại gkeService.layLichSuTrackingGke() — hàm đó giả định sẵn `data.data` LÀ mảng sự
// kiện, nếu GKE trả thêm 1 trường trạng thái tổng quát riêng ở NGOÀI mảng đó thì hàm đó sẽ âm thầm bỏ
// mất, không thấy được. Script này gọi thẳng API bằng fetch thô, in ra TOÀN VĂN JSON, không qua bước
// "giả định cấu trúc" nào — xem đúng những gì GKE thật sự trả về.
//
// CÁCH CHẠY (trên VPS/server thật đang có .env với tài khoản GKE thật — sandbox/máy dev KHÔNG chạy
// được vì không có tài khoản GKE thật):
//   node scripts/chan-doan-trang-thai-tracking-gke.js <STT_Key>
//
// LƯU Ý QUAN TRỌNG: <STT_Key> là mã đơn NỘI BỘ (cột STT_Key trong Sheet/Danh sách đơn hàng của app),
// KHÔNG PHẢI mã tracking hiển thị trên cổng GKE (dạng "GKE260908002340U") — lúc tạo đơn app đã đặt
// customer_order_num = STT_Key (xem gkeService.js#taoDonGke), GKE tra theo đúng mã này. Muốn chẩn đoán
// đúng đơn "Đã giao hàng" trong ảnh, hãy tìm STT_Key tương ứng bằng cách gõ mã tracking đó vào ô tìm
// kiếm ở menu Danh sách đơn hàng/Tracking của app trước.
//
// AN TOÀN CHẠY LẠI NHIỀU LẦN — chỉ 2 lượt gọi POST đọc dữ liệu (đăng nhập lấy token + tra cứu
// tracking), không ghi gì vào GKE/Sheet/SQLite.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { layCauHinhGke } = require('../services/gkeService');

const BASE_URL = 'https://order.gkelogistics.com/openapi/customer';
const TIMEOUT_MS = 45000;

async function goiJson(buoc, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  console.log(`\n[${buoc}] Gọi ${options.method} ${url}`);
  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  console.log(`[${buoc}] HTTP ${res.status}`);
  try {
    return JSON.parse(text);
  } catch (e) {
    console.log(`[${buoc}] Phản hồi KHÔNG phải JSON — 1000 ký tự đầu:\n${text.slice(0, 1000)}`);
    throw new Error(`[${buoc}] Không parse được JSON`);
  }
}

async function chay() {
  const sttKey = process.argv[2];
  if (!sttKey) {
    console.log('Cần truyền STT_Key. Ví dụ: node scripts/chan-doan-trang-thai-tracking-gke.js STT001');
    return;
  }

  const cauHinh = await layCauHinhGke();
  if (!cauHinh.username || !cauHinh.password) {
    console.log('Thiếu tài khoản API GKE (GkeUsername/GkePassword) — vào menu Tracking trên web để nhập, hoặc kiểm tra .env.');
    return;
  }

  console.log(`Đang chẩn đoán tracking cho STT_Key = "${sttKey}"...`);

  const dangNhap = await goiJson('đăng nhập', `${BASE_URL}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cauHinh.username, password: cauHinh.password }),
  });
  if (!dangNhap.success || !dangNhap.data || !dangNhap.data.token) {
    console.log('Đăng nhập GKE thất bại:', JSON.stringify(dangNhap, null, 2));
    return;
  }
  console.log('Đăng nhập thành công, lấy được token.');

  const traCuu = await goiJson('tra cứu tracking', `${BASE_URL}/query/track/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${dangNhap.data.token}`,
      'Accept-Language': 'vi',
    },
    body: JSON.stringify({ num_type: 1, num: sttKey }),
  });

  console.log('\n========== TOÀN BỘ JSON GỐC (không qua xử lý gì) ==========');
  console.log(JSON.stringify(traCuu, null, 2));
  console.log('=============================================================');

  console.log('\n----- Các trường ở CẤP NGOÀI CÙNG (ngang hàng với "data") -----');
  console.log(Object.keys(traCuu).join(', '));

  const danhSachSuKien = Array.isArray(traCuu.data) ? traCuu.data
    : (traCuu.data && Array.isArray(traCuu.data.list)) ? traCuu.data.list
    : null;

  if (!danhSachSuKien) {
    console.log('\n"data" không phải mảng và không có "data.list" dạng mảng — xem JSON gốc ở trên để biết đúng cấu trúc thật.');
  } else {
    console.log(`\nTìm thấy ${danhSachSuKien.length} sự kiện. Các trường có trong MỖI sự kiện: ${danhSachSuKien.length ? Object.keys(danhSachSuKien[0]).join(', ') : '(không có sự kiện nào)'}`);
    if (danhSachSuKien.length > 0) {
      console.log('\n----- Sự kiện ĐẦU TIÊN (đầy đủ) -----');
      console.log(JSON.stringify(danhSachSuKien[0], null, 2));
      console.log('\n----- Sự kiện CUỐI CÙNG (đầy đủ) — đây là sự kiện job tự động hiện đang dùng làm "trạng thái hiện tại" -----');
      console.log(JSON.stringify(danhSachSuKien[danhSachSuKien.length - 1], null, 2));
    }
  }

  const thuMucData = path.join(__dirname, '..', 'data');
  fs.mkdirSync(thuMucData, { recursive: true });
  const tenFile = path.join(thuMucData, `chan-doan-tracking-${sttKey}.json`);
  fs.writeFileSync(tenFile, JSON.stringify(traCuu, null, 2), 'utf8');
  console.log(`\nĐã lưu toàn bộ JSON gốc vào file: ${tenFile} (thư mục data/ không bị đưa lên Git).`);
  console.log('Gửi lại nội dung in ở trên (hoặc file này) để tiếp tục thiết kế logic nhận diện trạng thái cuối.');
}

chay().catch(err => {
  console.error('\nLỗi:', err.message);
  process.exit(1);
});
