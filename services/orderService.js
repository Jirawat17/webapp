const { readTab, updateCells } = require('./sheetsService');

const TAB = 'Don_Hang_ALL';
const KEY_COL = 'STT_Key';

async function getAll() {
  return readTab(TAB); // { headers, rows }
}

async function getByKey(sttKey) {
  const { headers, rows } = await getAll();
  const row = rows.find(r => r[KEY_COL] === sttKey);
  return { headers, row };
}

async function update(sttKey, updates) {
  const { headers, row } = await getByKey(sttKey);
  if (!row) throw new Error('Không tìm thấy đơn hàng: ' + sttKey);
  await updateCells(TAB, headers, row._row, updates);
  return { ...row, ...updates };
}

// Mỗi vai trò chỉ thấy đúng phần việc của mình — giữ đúng nguyên tắc thiết kế cũ của AppSheet:
// team sản xuất chỉ thấy đơn đủ điều kiện, không phí thời gian với đơn thiếu phôi/file
function filterForRole(rows, user) {
  switch (user.vaiTro) {
    case 've_file':
    case 'chuan_bi_phoi':
      return rows.filter(r =>
        String(r.Co_Phoi).toUpperCase() !== 'TRUE' || String(r.Co_File_Ve).toUpperCase() !== 'TRUE'
      );
    case 'san_xuat':
      return rows.filter(r =>
        String(r.Co_Phoi).toUpperCase() === 'TRUE' &&
        String(r.Co_File_Ve).toUpperCase() === 'TRUE' &&
        r.Trang_Thai === 'SAN_XUAT' &&
        (!user.team || r.Team_San_Xuat === user.team)
      );
    case 'dong_goi':
      return rows.filter(r => r.Trang_Thai === 'DONG_GOI' || r.Trang_Thai === 'SHIPPED');
    default: // admin, quan_ly — xem tất cả
      return rows;
  }
}

module.exports = { TAB, KEY_COL, getAll, getByKey, update, filterForRole };
