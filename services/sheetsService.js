const { google } = require('googleapis');
const { getAuthClient } = require('../config/googleClients');

const SHEET_ID = process.env.SHEET_ID;

// ============================================================
// CACHE ĐỌC — tối ưu tốc độ, đặc biệt cho luồng quét QR (trước đây mỗi lần quét đọc lại
// TOÀN BỘ nhiều tab liên tiếp qua mạng tới Google, cộng dồn vài giây/lần quét).
//
// NGUYÊN TẮC AN TOÀN: cache CHỈ dùng cho mục đích đọc/hiển thị/kiểm tra nhanh. Bất kỳ thao tác
// nào chuẩn bị GHI (updateCells/appendRow) đều tự động xoá cache của tab đó ngay sau khi ghi
// xong, và các nơi cần đọc số dòng thật (_row) trước khi ghi PHẢI gọi readTab() thẳng (bỏ qua
// cache) để không bao giờ ghi nhầm dòng nếu có ai khác vừa thêm/xoá dòng ở nơi khác.
// ============================================================
const _cacheBang = new Map(); // tabName -> { data: {headers, rows}, hetHan }
const _cacheHeader = new Map(); // tabName -> { headers, hetHan } — KHÔNG xoá khi appendRow, vì thêm 1
                                 // dòng dữ liệu không làm đổi header; chỉ xoá khi updateCells sửa hẳn dòng 1

// Yêu cầu ĐANG ĐỌC DỞ theo từng tab — gộp các lượt gọi readTabCached/getHeadersCached xảy ra CÙNG
// LÚC (vd nhiều nhân viên cùng mở trang Đơn hàng đúng lúc cache vừa hết hạn) thành 1 request thật
// duy nhất tới Google, thay vì mỗi lượt gọi tự bắn 1 request riêng ("cache stampede") — đây từng là
// 1 trong các nguyên nhân góp phần vượt quota 'Read requests per minute per user'.
const _dangDocBang = new Map(); // tabName -> Promise
const _dangDocHeader = new Map(); // tabName -> Promise

function xoaCacheBang(tabName) {
  _cacheBang.delete(tabName);
}

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

// ============================================================
// THỬ LẠI KHI GOOGLE TRẢ LỖI TẠM THỜI — 429 (vượt quota/rate-limit) hoặc 500/503 (lỗi tạm thời phía
// Google) đều là lỗi CÓ THỂ TỰ KHỎI nếu chờ 1 chút rồi gọi lại (đúng khuyến nghị chính thức của Google
// cho các API này: exponential backoff + jitter). KHÔNG thử lại lỗi khác (400 sai tham số, 404 không
// tìm thấy sheet...) vì gọi lại không giúp ích, chỉ làm chậm phản hồi vô ích.
// Trước đây KHÔNG có lớp này — bất kỳ lượt vượt quota nào (dù chỉ thoáng qua vài giây do nhiều người
// dùng cùng lúc) đều rơi thẳng ra người dùng dưới dạng lỗi thô của Google (vd "Không tải được danh
// sách: Quota exceeded for quota metric..."), thay vì tự phục hồi.
// ============================================================
const SO_LAN_THU_LAI_TOI_DA = 4;
const DO_TRE_GOC_MS = 500;

function maLoiHttp(err) {
  return (err && (err.code || (err.response && err.response.status))) || null;
}

function loiTamThoiCoTheThuLai(err) {
  const ma = maLoiHttp(err);
  return ma === 429 || ma === 500 || ma === 503;
}

async function goiApiCoThuLai(goiApi) {
  for (let lan = 0; ; lan++) {
    try {
      return await goiApi();
    } catch (err) {
      if (!loiTamThoiCoTheThuLai(err) || lan >= SO_LAN_THU_LAI_TOI_DA) {
        if (maLoiHttp(err) === 429) {
          throw new Error('Google Sheets đang tạm quá tải do có nhiều người thao tác cùng lúc — vui lòng thử lại sau ít phút.');
        }
        throw err;
      }
      const doTreMs = DO_TRE_GOC_MS * 2 ** lan + Math.random() * 300; // jitter tránh nhiều request cùng retry đồng loạt
      await new Promise(r => setTimeout(r, doTreMs));
    }
  }
}

// Gộp các lượt gọi hàm đọc (fn) trùng key xảy ra cùng lúc thành 1 lượt gọi thật duy nhất — dùng cho
// readTabCached/getHeadersCached khi cache vừa hết hạn và có nhiều request đang chờ cùng lúc.
function gopYeuCauTrung(mapDangDoc, key, fn) {
  const dangChay = mapDangDoc.get(key);
  if (dangChay) return dangChay;

  const promise = fn().finally(() => mapDangDoc.delete(key));
  mapDangDoc.set(key, promise);
  return promise;
}

// Đọc toàn bộ 1 tab. Trả về { headers, rows } — mỗi row là object {TenCot: giaTri, _row: soDongThat}
// _row dùng để ghi lại đúng dòng đó sau này (dòng 1 là header nên dữ liệu bắt đầu từ dòng 2)
// LUÔN đọc thật (không qua cache) — dùng hàm này khi cần dữ liệu chắc chắn mới nhất (trước khi ghi).
async function readTab(tabName) {
  const sheets = await getSheetsClient();
  const res = await goiApiCoThuLai(() => sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: tabName,
  }));

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

// Bản có cache của readTab — dùng cho các trường hợp chỉ đọc để hiển thị/kiểm tra nhanh
// (danh sách đơn, tra cứu, kiểm tra kịch bản...). Dữ liệu có thể cũ hơn thực tế tối đa `ttlMs`,
// nhưng KHÔNG ảnh hưởng độ chính xác cuối cùng vì bước ghi thật luôn đọc lại tươi (xem orderService.update).
async function readTabCached(tabName, ttlMs = 5000) {
  const cached = _cacheBang.get(tabName);
  const now = Date.now();
  if (cached && cached.hetHan > now) return cached.data;

  return gopYeuCauTrung(_dangDocBang, tabName, async () => {
    const data = await readTab(tabName);
    _cacheBang.set(tabName, { data, hetHan: Date.now() + ttlMs });
    return data;
  });
}

// Chỉ đọc DÒNG HEADER (dòng 1) — dùng khi appendRow chỉ cần biết thứ tự cột, không cần load toàn
// bộ dữ liệu bên dưới. Quan trọng cho các tab nhật ký (LichSuHoatDong, NhatKyQuetHangLoat) vì các
// tab này ngày càng dài theo thời gian sử dụng — đọc cả tab chỉ để lấy header sẽ ngày càng chậm dần.
async function getHeadersCached(tabName, ttlMs = 10 * 60 * 1000) {
  const cached = _cacheHeader.get(tabName);
  const now = Date.now();
  if (cached && cached.hetHan > now) return cached.headers;

  return gopYeuCauTrung(_dangDocHeader, tabName, async () => {
    const sheets = await getSheetsClient();
    const res = await goiApiCoThuLai(() => sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tabName}!1:1` }));
    const headers = (res.data.values && res.data.values[0] || []).map(h => String(h).trim());

    _cacheHeader.set(tabName, { headers, hetHan: Date.now() + ttlMs });
    return headers;
  });
}

// Thêm 1 dòng mới vào cuối tab, ghi theo đúng thứ tự cột thật của sheet (truyền vào qua headers)
async function appendRow(tabName, headers, rowObject) {
  const sheets = await getSheetsClient();
  const values = [headers.map(h => (rowObject[h] !== undefined ? rowObject[h] : ''))];

  await goiApiCoThuLai(() => sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: tabName,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  }));

  xoaCacheBang(tabName); // dòng vừa thêm phải xuất hiện ngay ở lần đọc kế tiếp, kể cả đọc qua cache
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

  await goiApiCoThuLai(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  }));

  xoaCacheBang(tabName); // đảm bảo lần đọc kế tiếp (kể cả qua cache) thấy đúng giá trị vừa ghi
}

module.exports = { readTab, readTabCached, getHeadersCached, appendRow, updateCells, colToLetter, xoaCacheBang };
