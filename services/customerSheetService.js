const { getSheetsClient, goiApiCoThuLai, colToLetter } = require('./sheetsService');

// Đẩy TRACKING_ID2/HANG_VAN_CHUYEN2 sang Sheet RIÊNG của từng khách hàng, sau khi mua tracking GKE
// thành công (bổ sung 21/09/2026, theo yêu cầu người dùng). HOÀN TOÀN TÁCH RIÊNG khỏi sheetsService.js
// (đường đọc/ghi CHÍNH cho Don_Hang_ALL nội bộ, không đụng gì tới file này) — đây là ghi vào 1
// spreadsheet KHÁC hẳn, KHÔNG do app kiểm soát cấu trúc, nên KHÔNG dùng SHEET_ID cố định mà nhận
// spreadsheetId làm tham số mỗi lần gọi (mỗi khách hàng 1 file riêng).
//
// TÊN CỘT ĐÍCH cố định: TRACKING_ID2/HANG_VAN_CHUYEN2 (đã xác nhận đúng tên thật trong Sheet khách
// hàng — KHÁC TRACKING_ID/HANG_VAN_CHUYEN nội bộ đang lưu ở services/trangThaiDbService.js). Mỗi khách
// hàng có thể đặt TÊN TAB khác nhau (lưu ở tab Khach_Hang, xem
// services/khachHangService.js#layThongTinSheetKhachHang) nhưng TÊN CỘT bên trong tab đó được coi là
// CỐ ĐỊNH giống nhau ở mọi khách hàng.
//
// AN TOÀN LỆCH DÒNG: đọc TƯƠI toàn bộ tab NGAY TRƯỚC KHI ghi, tự tìm đúng dòng khớp STT_Key tại đúng
// thời điểm ghi — KHÔNG nhớ sẵn số dòng từ trước, đúng bài học rút ra từ vụ lệch dòng Don_Hang_ALL (xem
// docs/superpowers/specs/2026-09-17-sua-loi-ghi-lech-dong-vstack-design.md) — áp dụng CẢ cho sheet
// ngoài này dù không có công thức VSTACK, vì app cũng không kiểm soát được ai khác đang sửa sheet đó.
//
// goiApiCoThuLai() vẫn TỰ retry lỗi mạng/quota tạm thời như bình thường bên trong hàm này (cả đọc lẫn
// ghi ở đây đều idempotent — ghi giá trị y hệt nhiều lần không sao, khác hẳn rủi ro append trùng dòng
// đã sửa ở sheetsService.js#appendRow) — nhưng nơi GỌI hàm này (services/trackingAutoService.js) không
// tự gọi lại thêm lần nữa nếu toàn bộ hàm throw, vì lỗi thường gặp nhất (chưa share quyền, sai Sheet
// ID/tên tab, không tìm thấy STT_Key) đều là lỗi CẤU HÌNH — gọi lại ngay cũng lỗi y hệt, chỉ log/báo
// Telegram để người dùng tự sửa cấu hình rồi thử lại ở lượt mua tracking kế tiếp.
async function dayTrackingSangSheetKhachHang({ spreadsheetId, tenTab, sttKey, trackingId, hangVanChuyen }) {
  const sheets = await getSheetsClient();

  const res = await goiApiCoThuLai(() => sheets.spreadsheets.values.get({ spreadsheetId, range: tenTab }));
  const values = res.data.values || [];
  if (values.length === 0) throw new Error(`Tab "${tenTab}" trống hoặc không tồn tại.`);

  const headers = values[0].map(h => String(h).trim());
  const idxSttKey = headers.indexOf('STT_Key');
  const idxTracking = headers.indexOf('TRACKING_ID2');
  const idxHangVanChuyen = headers.indexOf('HANG_VAN_CHUYEN2');
  if (idxSttKey === -1) throw new Error(`Tab "${tenTab}" không có cột STT_Key.`);
  if (idxTracking === -1 && idxHangVanChuyen === -1) {
    throw new Error(`Tab "${tenTab}" không có cột TRACKING_ID2 lẫn HANG_VAN_CHUYEN2.`);
  }

  // values[0] là header (dòng Sheet số 1) — chỉ số mảng khớp thẳng với số dòng Sheet thật (index 1 của
  // mảng = dòng 2 của Sheet, v.v.), không cần +1/-1 gì thêm khi tìm thấy.
  const chiSoDong = values.findIndex((hang, i) => i > 0 && String(hang[idxSttKey] || '').trim() === sttKey);
  if (chiSoDong === -1) throw new Error(`Không tìm thấy dòng có STT_Key="${sttKey}" trong tab "${tenTab}".`);
  const soDongThat = chiSoDong + 1;

  const data = [];
  if (idxTracking !== -1) data.push({ range: `${tenTab}!${colToLetter(idxTracking)}${soDongThat}`, values: [[trackingId || '']] });
  if (idxHangVanChuyen !== -1) data.push({ range: `${tenTab}!${colToLetter(idxHangVanChuyen)}${soDongThat}`, values: [[hangVanChuyen || '']] });

  await goiApiCoThuLai(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  }));
}

module.exports = { dayTrackingSangSheetKhachHang };
