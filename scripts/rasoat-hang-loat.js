// Script RÀ SOÁT (CHỈ ĐỌC, KHÔNG GHI GÌ) — chẩn đoán vì sao 1 lô đơn được NGHI NGỜ cùng/rất giống ảnh
// thêu lại không được tính năng "Đơn hàng loạt" (routes/orders.js, quét theo lựa chọn) gộp nhóm.
//
// In ra, với từng đơn trong danh sách STT_Key truyền vào:
//   - DUONG_DAN_URL, HASH_ANH_MAU đang lưu trong Sheet, NHOM_HANG_LOAT hiện tại
//   - Hash TÍNH LẠI TƯƠI (tải ảnh thật, chạy lại perceptualHashService) — so với hash đang lưu để
//     phát hiện hash CŨ/SAI (ảnh đã đổi nhưng hash lưu trong Sheet chưa cập nhật theo)
// Rồi in ra MA TRẬN khoảng cách Hamming giữa TỪNG CẶP đơn (dùng hash tính lại tươi) — để biết chính
// xác các cặp đang cách nhau bao nhiêu bit, so với ngưỡng NGUONG_HAMMING đang dùng trong
// routes/orders.js — trả lời rõ: ảnh có thực sự trùng/gần trùng theo thuật toán không, hay ngưỡng
// đang quá chặt, hay hash lưu trong Sheet đã lỗi thời.
//
// CÁCH CHẠY (trên VPS/server đang chạy thật, nơi có node_modules + .env + service-account.json):
//   node scripts/rasoat-hang-loat.js STT_Key_1 STT_Key_2 STT_Key_3 ...
// (Không có tham số --apply — script này KHÔNG BAO GIỜ ghi gì vào Sheet.)

require('dotenv').config();
const orderService = require('../services/orderService');
const { taiDsAnh } = require('../services/anhNguonService');
const { tinhHashAnh, khoangCachHamming } = require('../services/perceptualHashService');

const NGUONG_HAMMING = 8; // PHẢI khớp NGUONG_HAMMING trong routes/orders.js — sửa 1 chỗ nhớ sửa chỗ kia

async function chay() {
  const sttKeys = process.argv.slice(2);
  if (sttKeys.length === 0) {
    console.error('Thiếu tham số — truyền vào danh sách STT_Key cần rà soát, ví dụ:\n  node scripts/rasoat-hang-loat.js 9K12 9K13 9SON44');
    process.exit(1);
  }

  const { rows } = await orderService.getAll({ fresh: true });
  const theoSttKey = new Map(rows.map(r => [r.STT_Key, r]));

  const dsDon = [];
  for (const key of sttKeys) {
    const don = theoSttKey.get(key);
    if (!don) { console.log(`[BỎ QUA] Không tìm thấy đơn "${key}" trong Sheet.`); continue; }
    dsDon.push(don);
  }

  console.log(`\n=== Thông tin từng đơn (${dsDon.length}/${sttKeys.length} tìm thấy) ===\n`);
  for (const don of dsDon) {
    console.log(`${don.STT_Key}:`);
    console.log(`  DUONG_DAN_URL   = ${don.DUONG_DAN_URL || '(trống)'}`);
    console.log(`  HASH_ANH_MAU    = ${don.HASH_ANH_MAU || '(trống)'}  (đang lưu trong Sheet)`);
    console.log(`  NHOM_HANG_LOAT  = ${don.NHOM_HANG_LOAT || '(trống)'}`);

    if (!don.DUONG_DAN_URL) {
      console.log('  -> Không có ảnh mẫu, không thể tính/so hash.');
      don._hashTuoi = null;
      continue;
    }
    try {
      const dsMau = await taiDsAnh(don.DUONG_DAN_URL);
      const hashTuoi = dsMau[0] ? await tinhHashAnh(dsMau[0]) : null;
      don._hashTuoi = hashTuoi;
      console.log(`  Hash TÍNH LẠI   = ${hashTuoi || '(không tải/tính được ảnh)'}`);
      if (don.HASH_ANH_MAU && hashTuoi && don.HASH_ANH_MAU !== hashTuoi) {
        console.log(`  *** LỆCH HASH: hash lưu trong Sheet KHÁC hash tính lại ngay bây giờ — có thể ảnh đã đổi mà chưa quét lại, hoặc hash cũ tính bằng thuật toán/kernel khác. ***`);
      }
    } catch (err) {
      console.log(`  -> Lỗi tải/tính hash: ${err.message}`);
      don._hashTuoi = null;
    }
    console.log('');
  }

  console.log(`\n=== Ma trận khoảng cách Hamming (dùng hash TÍNH LẠI TƯƠI, ngưỡng đang dùng = ${NGUONG_HAMMING}) ===\n`);
  const coHashTuoi = dsDon.filter(d => d._hashTuoi);
  if (coHashTuoi.length < 2) {
    console.log('Không đủ ≥2 đơn có hash tính được để so sánh.');
  } else {
    for (let i = 0; i < coHashTuoi.length; i++) {
      for (let j = i + 1; j < coHashTuoi.length; j++) {
        const a = coHashTuoi[i], b = coHashTuoi[j];
        const kc = khoangCachHamming(a._hashTuoi, b._hashTuoi);
        const nhan = kc <= NGUONG_HAMMING ? '<= ngưỡng -> SẼ được gộp nhóm' : '> ngưỡng -> KHÔNG được gộp nhóm';
        console.log(`  ${a.STT_Key} <-> ${b.STT_Key}: cách nhau ${kc}/64 bit  (${nhan})`);
      }
    }
  }

  console.log('\nGợi ý đọc kết quả:');
  console.log('- Nếu thấy "LỆCH HASH" ở trên -> hash lưu trong Sheet đã lỗi thời, cần xoá HASH_ANH_MAU của đơn đó rồi quét lại.');
  console.log(`- Nếu khoảng cách giữa 2 đơn > ${NGUONG_HAMMING} nhưng bạn chắc chắn ảnh giống nhau -> có thể cần nới ngưỡng NGUONG_HAMMING, hoặc ảnh tuy nhìn giống mắt thường nhưng khác nhau về kích thước khung/tỉ lệ/nền theo cách ảnh hưởng tới dHash.`);
  console.log('- Nếu 2 ảnh dùng chung DUONG_DAN_URL nhưng là tập nhiều ảnh (nhiều URL) -> hệ thống chỉ hash ẢNH ĐẦU TIÊN trong danh sách, ảnh thêu có thể không nằm ở vị trí đầu.');
}

chay().catch(err => {
  console.error('Lỗi khi rà soát:', err.message);
  process.exit(1);
});
