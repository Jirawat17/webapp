const { readTab, appendRow } = require('./sheetsService');

const TAB = 'LichSuHoatDong';

// Ghi 1 dòng log — luôn ghi lại AI làm, vai trò gì, lúc nào, làm gì, trên đơn nào
async function ghiLog({ nguoiDung, vaiTro, hanhDong, sttKey = '', chiTiet = '' }) {
  const { headers } = await readTab(TAB);
  await appendRow(TAB, headers, {
    ThoiGian: new Date().toISOString(),
    NguoiDung: nguoiDung,
    VaiTro: vaiTro,
    HanhDong: hanhDong,
    STT_Key: sttKey,
    ChiTiet: typeof chiTiet === 'string' ? chiTiet : JSON.stringify(chiTiet),
  });
}

// Lấy lịch sử của 1 đơn hàng, sắp theo thời gian tăng dần (dùng cho timeline chi tiết đơn)
async function layLichSuTheoDon(sttKey) {
  const { rows } = await readTab(TAB);
  return rows
    .filter(r => r.STT_Key === sttKey)
    .sort((a, b) => new Date(a.ThoiGian) - new Date(b.ThoiGian));
}

module.exports = { ghiLog, layLichSuTheoDon };
