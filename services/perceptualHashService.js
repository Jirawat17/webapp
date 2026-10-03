const sharp = require('sharp');

// dHash (difference hash) — resize ảnh về 1 lưới pixel xám nhỏ, so sánh độ sáng từng cặp pixel liền kề
// THEO HÀNG. Nhẹ, không cần mô hình AI, nhắm bắt được ảnh bị resize/đổi định dạng vẫn ra hash giống hệt
// hoặc gần giống (khác thuật toán băm nội dung như SHA-256 — chỉ cần đổi 1 byte là ra hash hoàn toàn
// khác). Xem docs/superpowers/specs/2026-09-06-don-hang-loat-design.md mục 3 để biết lý do chọn thuật
// toán này.
//
// QUAN TRỌNG — kernel 'nearest': đã tự kiểm thử bằng ảnh giả lập trước khi viết hàm này. Dùng kernel
// mặc định của sharp ('lanczos3', vốn "mượt" hơn) khiến CHỈ RIÊNG việc đổi định dạng PNG->JPEG (dù
// chất lượng 100%) đã đẩy khoảng cách Hamming lên đáng kể — coi như khác hẳn thiết kế dù là đúng 1 ảnh.
// Đổi sang 'nearest' (lấy đúng 1 pixel, không nội suy/làm mượt) giảm mức trôi này đáng kể — quan trọng
// với ảnh nét thẳng/khối màu phẳng kiểu thiết kế thêu, nơi nội suy mượt phá vỡ đúng cạnh sắc mà dHash
// dựa vào để so sánh. ĐỪNG đổi lại kernel mặc định mà không kiểm thử lại bằng ảnh giả lập trước.
//
// QUAN TRỌNG — .trim() TRƯỚC khi resize (bổ sung 14/09/2026, xem
// docs/superpowers/specs/2026-09-14-sua-loi-so-khop-anh-hang-loat-design.md — root cause đã tự tái
// hiện bằng ảnh giả lập trước khi sửa): file thiết kế PNG xuất từ phần mềm thêu thường là 1 vùng nội
// dung NHỎ đặt giữa 1 canvas TRONG SUỐT rất lớn (để đặt linh hoạt lên nhiều loại sản phẩm). Resize
// thẳng canvas gốc xuống lưới quá nhỏ khiến GẦN NHƯ TOÀN BỘ điểm lấy mẫu rơi vào vùng nền trong suốt
// (nền trong suốt bị premultiply về đen giống hệt nhau ở MỌI ảnh) — hash ra gần như CHỈ phản ánh hình
// dạng/tỉ lệ canvas, KHÔNG phải nội dung thiết kế thật. .trim() cắt bỏ viền đồng nhất/trong suốt quanh
// nội dung trước khi resize — đưa vùng nội dung thật chiếm phần lớn điểm lấy mẫu. An toàn cho ảnh
// KHÔNG có viền để cắt (ảnh mockup JPEG đầy khung, ảnh nhiễu...) — sharp giữ nguyên kích thước gốc,
// không cắt nhầm, đã tự kiểm thử cả trường hợp ảnh trong suốt hoàn toàn/ảnh 1 màu đồng nhất/ảnh nhiễu.
//
// QUAN TRỌNG — lưới 17x16 = 256 bit (bổ sung 15/09/2026, theo phản hồi thực tế người dùng: sau khi sửa
// .trim() ở trên, vẫn thấy nhiều thiết kế CHỮ NGẮN khác hẳn nhau (tên đội bóng, họ tên riêng...) bị gộp
// chung 1 nhóm). Tự dựng lại nhiều thiết kế chữ THẬT (SVG, không phải khối màu đơn giản như lần kiểm
// trước) để đo: ở lưới CŨ 9x8 (64 bit), 6 thiết kế tên trường/đội khác hẳn nhau (CINCINNATI, OHIO
// STATE, NOTRE DAME, ALABAMA, INDIANA, PENN STATE) có cặp GẦN NHAU CHỈ 8/64 bit (12.5%) — ngang bằng
// hoặc dưới ngưỡng mặc định 8, tức hash quá THÔ để phân biệt 2 dòng chữ đậm khác nhau trên nền trắng,
// không phải lỗi ngưỡng. Tăng lưới lên 17x16 (256 bit): khoảng cách nhỏ nhất giữa 2 thiết kế khác nhau
// tăng lên 49/256 (19.1%, gần gấp đôi biên an toàn theo tỉ lệ) trong khi vẫn nhận đúng 2 ảnh gần giống
// hệt (lệch màu nhẹ, mô phỏng nén ảnh) là 0/256 — không "sửa quá tay".
// ĐÁNH ĐỔI ĐÃ PHÁT HIỆN (chưa có cách khắc phục, ghi lại để biết trước): lưới càng mịn càng NHẠY hơn
// với việc ảnh bị resize qua 1 bước trung gian dùng kernel mượt TRƯỚC KHI tới đây (vd nếu nơi khác từng
// thu nhỏ ảnh bằng kernel mặc định trước khi lưu) — đo được khoảng cách "cùng 1 ảnh, đã bị resize 1 lần
// bằng kernel mượt trước đó" tăng từ ~9% (lưới cũ) lên ~26% (lưới mới), tức có thể VƯỢT ngưỡng dù là
// đúng 1 thiết kế. Chấp nhận đánh đổi này vì vấn đề THỰC TẾ người dùng gặp (gộp nhầm thiết kế khác hẳn
// nhau) nghiêm trọng hơn nguy cơ lý thuyết này — theo dõi thêm sau khi người dùng quét lại trên dữ liệu
// thật.
//
// LƯU Ý VẬN HÀNH: đổi thuật toán này làm HASH_ANH_MAU đã tính trước đó trong Sheet KHÔNG còn khớp cách
// tính mới — phải "Quét gợi ý Đơn hàng loạt" LẠI toàn bộ đơn liên quan thì nhóm đề xuất mới phản ánh
// đúng thuật toán đã sửa (code không tự động tính lại hash cũ). Ngưỡng Hamming đang lưu trong
// CaiDatHangLoat cũng đổi Ý NGHĨA theo tỉ lệ (cùng số bit tuyệt đối giờ chiếm tỉ lệ % nhỏ hơn hẳn trong
// tổng 256 bit so với tổng 64 bit cũ) — xem services/donHangLoatService.js#NGUONG_MAC_DINH/NGUONG_TOI_DA.
const CHIEU_RONG_HASH = 17;
const CHIEU_CAO_HASH = 16;
const KERNEL_RESIZE = 'nearest';

// Mỗi ký tự hex ứng với 4 bit — bảng tra số bit "1" trong 1 nibble (0-15), dùng để đếm nhanh khoảng
// cách Hamming giữa 2 chuỗi hex mà không cần vòng lặp bit-by-bit.
const SO_BIT_1_TRONG_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// Timeout cho sharp (bổ sung 22/09/2026, theo yêu cầu người dùng) — sharp từng gây treo THẬT 2 lần ở
// tính năng khác (viền QR, xem docs/... đã gỡ bỏ sharp ở đó), dù đã benchmark chấp nhận dùng lại cho
// riêng tính năng hash này. Vòng lặp "Quét hàng loạt" gọi hàm này cho NHIỀU ảnh liên tiếp — 1 ảnh khiến
// sharp kẹt (buffer hỏng theo cách lạ, bug native binary...) sẽ treo LUÔN cả vòng lặp, không chỉ riêng
// ảnh đó. Promise.race không huỷ được tiến trình sharp bên trong (không có API huỷ chính thức), nhưng
// đảm bảo NƠI GỌI không đợi vô hạn — coi như hash lỗi (trả null, đúng hợp đồng sẵn có của hàm này) và
// tiếp tục ảnh kế tiếp.
const THOI_GIAN_TOI_DA_MS = 10000;

// Trả về chuỗi hex 16 ký tự (64 bit) hoặc null nếu ảnh lỗi/định dạng không đọc được (sharp ném lỗi
// với buffer rỗng, hỏng, hoặc không phải ảnh — bắt lỗi ở đây để nơi gọi không cần tự try/catch).
async function tinhHashAnh(buffer) {
  if (!buffer || buffer.length === 0) return null;

  try {
    const { data } = await Promise.race([
      sharp(buffer)
        .trim()
        .resize(CHIEU_RONG_HASH, CHIEU_CAO_HASH, { fit: 'fill', kernel: KERNEL_RESIZE })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Quá thời gian chờ tính hash ảnh')), THOI_GIAN_TOI_DA_MS)),
    ]);

    let bit = '';
    for (let y = 0; y < CHIEU_CAO_HASH; y++) {
      for (let x = 0; x < CHIEU_RONG_HASH - 1; x++) {
        const trai = data[y * CHIEU_RONG_HASH + x];
        const phai = data[y * CHIEU_RONG_HASH + x + 1];
        bit += trai < phai ? '1' : '0';
      }
    }

    let hex = '';
    for (let i = 0; i < bit.length; i += 4) {
      hex += parseInt(bit.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch (err) {
    return null;
  }
}

// ---------------- Hash HÌNH DẠNG (03/10/2026, menu "Tìm ảnh" — docs/superpowers/specs/2026-10-03-thu-vien-tim-anh-design.md mục 9) ----------------
// KHÔNG thay tinhHashAnh ở trên (Đơn hàng loạt vẫn dùng nguyên). Mục tiêu: cùng 1 thiết kế nhưng khác màu chỉ / khác nền
// (trong suốt, đen, trắng) / khác viền / khác kích thước vẫn ra hash gần nhau. tinhHashAnh không làm được vì sharp đưa vùng
// trong suốt về ĐEN — nền trong suốt và nền đen giống nhau, nền trắng lệch hẳn; đổi màu chỉ cũng đổi độ sáng.
// Cách làm: tách MẶT NẠ "điểm nào là nội dung" (bỏ hẳn màu), cắt sát nội dung, lấy độ phủ trung bình theo ô 17x16 rồi dHash.
// - Ảnh có kênh trong suốt thật (có điểm alpha < 250): nội dung = alpha >= 128. Riêng ảnh là 1 TẤM NỀN ĐẶC có vài điểm trong
//   suốt (góc bo tròn, lề trong suốt quanh tấm nền — mặt nạ alpha phủ > 90% khung của chính nó): mặt nạ alpha chỉ là tấm nền,
//   hash gần như hằng số và mọi thiết kế kiểu này "giống 100%" nhau (đo 03/10/2026) -> tách nội dung theo màu tấm nền
//   (trung vị màu các điểm đục trên viền khung) như ảnh không trong suốt.
// - Ảnh không trong suốt: nền = trung vị màu 4 góc; nội dung = điểm lệch màu nền > DO_LECH_NEN. Giới hạn đã biết: thiết kế
//   tràn kín cả 4 góc thì đoán sai nền.
// Khung nội dung bỏ 0,5% điểm nội dung ở mỗi phía (theo hàng, theo cột): 1 chấm lạc ở góc ảnh không kéo giãn khung (đo
// 03/10/2026: chấm 4px làm cùng 1 thiết kế chỉ còn giống 66%, thấp hơn 1 thiết kế khác).
// ponytail: phân vị cố định 0,5% — nét thật nhỏ hơn mức đó ở rìa thiết kế cũng bị cắt; đổi tỉ lệ nếu đo ảnh thật thấy lệch.
// Độ phủ theo Ô (trung bình mọi điểm trong ô) thay vì lấy 1 điểm/ô — nét chữ thêu mảnh dễ rơi lọt giữa các điểm lấy mẫu.
const CANH_MAT_NA = 512;
const DO_LECH_NEN = 48; // khoảng cách màu RGB (Euclid, 0..441) — hiệu chỉnh bằng ảnh giả lập 03/10/2026, xem số đo trong spec
const TI_LE_PHU_TAM_NEN = 0.9;
const TI_LE_BO_MOI_PHIA = 0.005;

// Số điểm nội dung theo từng hàng / cột.
function demHangCot(matNa, w, h) {
  const hang = new Uint32Array(h), cot = new Uint32Array(w);
  let tong = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (matNa[y * w + x]) { hang[y]++; cot[x]++; tong++; }
  }
  return { hang, cot, tong };
}
// [đầu, cuối] sau khi bỏ tối đa `bo` điểm ở mỗi phía (bo = 0 -> đúng khung min/max).
function bien(dem, bo) {
  let a = 0, b = dem.length - 1, s = 0;
  while (s + dem[a] <= bo) s += dem[a++];
  s = 0;
  while (s + dem[b] <= bo) s += dem[b--];
  return [a, b];
}

async function tinhHashHinhDang(buffer) {
  if (!buffer || buffer.length === 0) return null;
  try {
    const { data, info } = await Promise.race([
      sharp(buffer)
        .ensureAlpha()
        .resize(CANH_MAT_NA, CANH_MAT_NA, { fit: 'inside', withoutEnlargement: true, kernel: KERNEL_RESIZE })
        .raw()
        .toBuffer({ resolveWithObject: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Quá thời gian chờ tính hash hình dạng')), THOI_GIAN_TOI_DA_MS)),
    ]);
    const w = info.width, h = info.height, kenh = info.channels; // ensureAlpha -> 4 kênh
    const soDiem = w * h;

    let coTrongSuot = false;
    for (let i = 3; i < data.length; i += kenh) if (data[i] < 250) { coTrongSuot = true; break; }

    // trung vị màu (từng kênh) của các điểm cho trước
    const trungVi = dsDiem => [0, 1, 2].map(c => {
      const v = dsDiem.map(p => data[p * kenh + c]).sort((a, b) => a - b);
      const m = v.length >> 1;
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    });
    // nội dung = điểm ĐỤC lệch màu nền > DO_LECH_NEN (ảnh không trong suốt: mọi điểm đều đục)
    const theoMauNen = (nen, matNaRa) => {
      const nguong2 = DO_LECH_NEN * DO_LECH_NEN;
      for (let p = 0; p < soDiem; p++) {
        const dr = data[p * kenh] - nen[0], dg = data[p * kenh + 1] - nen[1], db = data[p * kenh + 2] - nen[2];
        matNaRa[p] = data[p * kenh + 3] >= 128 && dr * dr + dg * dg + db * db > nguong2 ? 1 : 0;
      }
    };

    let matNa = new Uint8Array(soDiem);
    let dem;
    if (coTrongSuot) {
      for (let p = 0; p < soDiem; p++) matNa[p] = data[p * kenh + 3] >= 128 ? 1 : 0;
      dem = demHangCot(matNa, w, h);
      if (!dem.tong) return null; // trong suốt hoàn toàn
      const [ax, bx] = bien(dem.cot, 0), [ay, by] = bien(dem.hang, 0);
      if (dem.tong > TI_LE_PHU_TAM_NEN * (bx - ax + 1) * (by - ay + 1)) { // tấm nền đặc — xem ghi chú đầu mục
        const vien = [];
        for (let x = ax; x <= bx; x++) vien.push(ay * w + x, by * w + x);
        for (let y = ay + 1; y < by; y++) vien.push(y * w + ax, y * w + bx);
        const matNaNen = new Uint8Array(soDiem);
        theoMauNen(trungVi(vien.filter(p => matNa[p])), matNaNen);
        const demNen = demHangCot(matNaNen, w, h);
        if (demNen.tong) { matNa = matNaNen; dem = demNen; } // tấm nền trơn không có gì trên đó -> giữ mặt nạ alpha
      }
    } else {
      theoMauNen(trungVi([0, w - 1, (h - 1) * w, h * w - 1]), matNa);
      dem = demHangCot(matNa, w, h);
    }
    if (!dem.tong) return null; // ảnh trống — không có điểm nội dung nào
    const bo = Math.floor(dem.tong * TI_LE_BO_MOI_PHIA);
    const [x0, x1] = bien(dem.cot, bo), [y0, y1] = bien(dem.hang, bo);

    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const phu = new Float64Array(CHIEU_RONG_HASH * CHIEU_CAO_HASH);
    for (let oy = 0; oy < CHIEU_CAO_HASH; oy++) {
      const ya = y0 + Math.floor(oy * bh / CHIEU_CAO_HASH), yb = Math.max(ya + 1, y0 + Math.floor((oy + 1) * bh / CHIEU_CAO_HASH));
      for (let ox = 0; ox < CHIEU_RONG_HASH; ox++) {
        const xa = x0 + Math.floor(ox * bw / CHIEU_RONG_HASH), xb = Math.max(xa + 1, x0 + Math.floor((ox + 1) * bw / CHIEU_RONG_HASH));
        let tong = 0;
        for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) tong += matNa[y * w + x];
        phu[oy * CHIEU_RONG_HASH + ox] = tong / ((yb - ya) * (xb - xa));
      }
    }

    let hex = '';
    let nibble = 0, soBit = 0;
    for (let y = 0; y < CHIEU_CAO_HASH; y++) {
      for (let x = 0; x < CHIEU_RONG_HASH - 1; x++) {
        nibble = (nibble << 1) | (phu[y * CHIEU_RONG_HASH + x] < phu[y * CHIEU_RONG_HASH + x + 1] ? 1 : 0);
        if (++soBit === 4) { hex += nibble.toString(16); nibble = 0; soBit = 0; }
      }
    }
    return hex;
  } catch (err) {
    return null;
  }
}

// Hash gần như hằng số (gần hết bit 0 hoặc gần hết bit 1) = ảnh gần như 1 màu / 1 khối đặc: KHÔNG mang thông tin hình dạng,
// 2 ảnh khác hẳn nhau vẫn "giống 100%" (đo 03/10/2026: chỉ đen thuần trên nền trong suốt -> hash toàn 0; tấm nền bo góc -> 4 bit
// 1). Thiết kế thật đo được ~120-130 bit 1/256. Thư viện "Tìm ảnh" coi hash suy biến như không có hash khi so điểm.
const SO_BIT_1_TOI_THIEU = 16;
function laHashSuyBien(hex) {
  if (!hex) return false;
  let soBit1 = 0;
  for (let i = 0; i < hex.length; i++) soBit1 += SO_BIT_1_TRONG_NIBBLE[parseInt(hex[i], 16)];
  return soBit1 < SO_BIT_1_TOI_THIEU || soBit1 > hex.length * 4 - SO_BIT_1_TOI_THIEU;
}

// Khoảng cách Hamming (số bit khác nhau) giữa 2 hash — càng nhỏ càng giống nhau. Trả về Infinity nếu
// thiếu 1 trong 2 giá trị hoặc độ dài không khớp (không thể so sánh), để nơi gọi coi như "chắc chắn
// không cùng nhóm" thay vì so sánh sai.
function khoangCachHamming(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return Infinity;

  let khoangCach = 0;
  for (let i = 0; i < hexA.length; i++) {
    const xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    khoangCach += SO_BIT_1_TRONG_NIBBLE[xor];
  }
  return khoangCach;
}

module.exports = { tinhHashAnh, tinhHashHinhDang, laHashSuyBien, khoangCachHamming };
