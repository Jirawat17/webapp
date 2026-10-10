// A1 (11/10/2026, theo yêu cầu người dùng — spec 2026-10-04-21-tinh-nang-design.md mục 1): báo "Có EMB sẵn" trên thẻ đơn cần vẽ.
// Với mỗi đơn "Chưa vẽ file"/"Đang vẽ file" (Q2) đã có PNG trong thư viện và CHƯA có EMB: tìm trong các đơn ĐÃ có EMB (lưu xong) file
// PNG giống nhất; kết quả đầu tiên thuộc nhóm Trùng file / Ảnh giống / Cùng hình dạng thì ghi gợi ý, không có thì xoá. Chưa lưu ngưỡng
// thì chỉ nhận Trùng file (Q3 — nguongService.phanNhom tự trả null khi chưa có ngưỡng). Điểm lưu là điểm đo thật, không làm tròn.
// CHỈ gợi ý — không tự gắn EMB vào đơn. Tính cho TOÀN BỘ đơn (không theo người xem); API lọc theo Xưởng lúc trả về.
const cron = require('node-cron');
const db = require('./thuVienDbService');
const { timTuongTu } = require('./timKiemService');
const nguongService = require('./nguongService');
const orderService = require('../orderService');

const TRANG_THAI_VE_CAN_GOI_Y = ['Chưa vẽ file', 'Đang vẽ file'];
const NHOM_GOI_Y = ['TRUNG_FILE', 'ANH_GIONG', 'CUNG_HINH_DANG'];
const nhuongLuong = () => new Promise(r => setImmediate(r));

const laDonCanGoiY = r => r && TRANG_THAI_VE_CAN_GOI_Y.includes(r.TRANG_THAI_VE_FILE || 'Chưa vẽ file')
  && !['CANCELLED_Đã hủy', 'REFUNDED_Hoàn đơn', 'DELIVERED_Đã giao đến khách'].includes(r.TRANG_THAI_XUONG);

// 1 đơn -> ghi/xoá dòng gợi ý. maCoEmb: Set mã có EMB đã lưu xong (truyền vào để cả lượt dùng chung 1 lần đọc).
function tinhGoiYChoDon(sttKey, maCoEmb, nguong) {
  const png = db.dsFileCuaDon(sttKey).filter(f => f.loai === 'PNG');
  if (!png.length || maCoEmb.has(sttKey)) { db.xoaGoiYEmb(sttKey); return null; }
  const mau = db.dsChiMucPng(png.map(f => f.id)).map(h => ({ sha256: h.sha256, dhash: h.dhash, dhashHinhDang: h.dhash_hinh_dang, nhan: String(h.id) }));
  const { ketQua } = timTuongTu({ mau, boQuaStt: new Set([sttKey]), duocXem: k => maCoEmb.has(k), gioiHan: 5 });
  for (const r of ketQua) {
    const nhom = nguongService.phanNhom(r, nguong);
    if (!NHOM_GOI_Y.includes(nhom)) continue;
    const emb = db.embChinhCuaCacDon([r.stt_key]).get(r.stt_key);
    if (!emb) continue;
    const goiY = {
      stt_key: sttKey, file_mau_id: Number(r.soVoi), file_khop_id: r.id, stt_key_khop: r.stt_key, emb_id: emb.id, nhom,
      phan_tram_anh: r.phanTramAnh, phan_tram_hinh_dang: r.phanTramHinhDang,
    };
    db.ghiGoiYEmb(goiY);
    return goiY;
  }
  db.xoaGoiYEmb(sttKey);
  return null;
}

// Lượt đầy đủ (mỗi 10 phút): mọi đơn cần vẽ có PNG; xoá gợi ý của đơn không còn cần. Nhả luồng chính sau mỗi đơn.
let dangChay = false;
async function chayLuotGoiY() {
  if (dangChay) return;
  dangChay = true;
  const batDau = Date.now();
  try {
    const { rows } = await orderService.getAll();
    const coPng = new Set(db.dsMaTrongThuVien());
    const maCoEmb = db.dsMaCoEmbXong();
    const nguong = nguongService.layNguong();
    const canTinh = [...new Set(rows.filter(r => laDonCanGoiY(r) && coPng.has(String(r.STT_Key).trim())).map(r => String(r.STT_Key).trim()))];
    let soGoiY = 0;
    for (const k of canTinh) {
      if (tinhGoiYChoDon(k, maCoEmb, nguong)) soGoiY++;
      await nhuongLuong();
    }
    db.xoaGoiYEmbNgoai(new Set(canTinh));
    console.log(`[ThuVien] Gợi ý EMB: ${canTinh.length} đơn cần vẽ có PNG, ${soGoiY} gợi ý, ${Date.now() - batDau}ms`);
  } catch (err) {
    console.error('[ThuVien] Gợi ý EMB lỗi:', err.message);
  } finally {
    dangChay = false;
  }
}

// Ngay sau khi lưu PNG mới cho 1 đơn (gộp các lần gọi trong 5 giây) — chỉ tính lại các đơn đó. Hẹn 5 giây tính từ lần gọi ĐẦU của
// đợt (không dời lại mỗi lần gọi): hàng chờ lưu file liên tục < 5 giây/file thì dời mãi sẽ không bao giờ tính.
const choTinh = new Set();
let henTinh = null;
function tinhLaiSau(sttKey) {
  choTinh.add(String(sttKey).trim());
  if (henTinh) return;
  henTinh = setTimeout(async () => {
    henTinh = null; // mã thêm vào trong lúc đang tính -> đợt hẹn mới
    const ds = [...choTinh];
    choTinh.clear();
    try {
      const { rows } = await orderService.getAll();
      const theoMa = new Map(rows.map(r => [String(r.STT_Key).trim(), r]));
      const maCoEmb = db.dsMaCoEmbXong();
      const nguong = nguongService.layNguong();
      for (const k of ds) {
        if (laDonCanGoiY(theoMa.get(k))) tinhGoiYChoDon(k, maCoEmb, nguong);
        await nhuongLuong();
      }
    } catch (err) {
      console.error('[ThuVien] Gợi ý EMB (sau khi lưu PNG) lỗi:', err.message);
    }
  }, 5000);
}

function batDauLichGoiY() {
  cron.schedule('*/10 * * * *', () => { chayLuotGoiY(); });
  setTimeout(chayLuotGoiY, 60000); // lượt đầu 1 phút sau khi khởi động (không chờ tới mốc 10 phút)
  console.log('[ThuVien] Đã bật lịch gợi ý "Có EMB sẵn" (mỗi 10 phút).');
}

module.exports = { tinhGoiYChoDon, chayLuotGoiY, tinhLaiSau, batDauLichGoiY, laDonCanGoiY };
