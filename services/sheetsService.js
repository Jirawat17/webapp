const { google } = require('googleapis');
const { getAuthClient } = require('../config/googleClients');

const SHEET_ID = process.env.SHEET_ID;

// Đổi index cột (0-based) thành chữ cột kiểu Sheets (0 -> A, 1 -> B, 26 -> AA...)
function colToLetter(idx) {
  let letter = '';
  idx += 1;
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    idx = Math.floor((idx - 1) / 26);
  }
  return letter;
}

async function getSheetsClient() {
  const auth = await getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

// Đọc toàn bộ 1 tab. Trả về { headers, rows } — mỗi row là object {TenCot: giaTri, _row: soDongThat}
// _row dùng để ghi lại đúng dòng đó sau này (dòng 1 là header nên dữ liệu bắt đầu từ dòng 2)
async function readTab(tabName) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: tabName,
  });

  const values = res.data.values || [];
  if (values.length === 0) return { headers: [], rows: [] };

  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1).map((row, i) => {
    const obj = { _row: i + 2 };
    headers.forEach((h, idx) => { obj[h] = row[idx] !== undefined ? row[idx] : ''; });
    return obj;
  });

  return { headers, rows };
}

// Thêm 1 dòng mới vào cuối tab, ghi theo đúng thứ tự cột thật của sheet (truyền vào qua headers)
async function appendRow(tabName, headers, rowObject) {
  const sheets = await getSheetsClient();
  const values = [headers.map(h => (rowObject[h] !== undefined ? rowObject[h] : ''))];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: tabName,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

// Cập nhật một số ô của 1 dòng đã biết số dòng thật — chỉ ghi đúng cột cần đổi, không đụng cột khác
async function updateCells(tabName, headers, rowNumber, updates) {
  const sheets = await getSheetsClient();

  const data = Object.keys(updates).map(colName => {
    const idx = headers.indexOf(colName);
    if (idx === -1) {
      throw new Error(`Không tìm thấy cột '${colName}' trong tab '${tabName}'`);
    }
    return {
      range: `${tabName}!${colToLetter(idx)}${rowNumber}`,
      values: [[updates[colName]]],
    };
  });

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

module.exports = { readTab, appendRow, updateCells, colToLetter };
