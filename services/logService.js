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

// Ghi vào tab NhatKyQuetHangLoat có sẵn trong Sheet (đúng schema cũ: Thoi_Gian, Nguoi_Quet, Ten_Kich_Ban,
// STT_Key, Trang_Thai_Cu, Trang_Thai_Moi, Ket_Qua, Ghi_Chu) — để tương thích các báo cáo/luồng cũ đã dựa vào tab này
async function ghiNhatKyQuetHangLoat({ nguoiQuet, tenKichBan, sttKey, trangThaiCu, trangThaiMoi, ketQua, ghiChu = '' }) {
  const TAB_QUET = 'NhatKyQuetHangLoat';
  const { headers } = await readTab(TAB_QUET);
  await appendRow(TAB_QUET, headers, {
    Thoi_Gian: new Date().toISOString(),
    Nguoi_Quet: nguoiQuet,
    Ten_Kich_Ban: tenKichBan,
    STT_Key: sttKey,
    Trang_Thai_Cu: trangThaiCu,
    Trang_Thai_Moi: trangThaiMoi,
    Ket_Qua: ketQua,
    Ghi_Chu: ghiChu,
  });
}

module.exports = { ghiLog, layLichSuTheoDon, ghiNhatKyQuetHangLoat };
