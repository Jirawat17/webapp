// Ghi vào Google Sheet của SELLER (bổ sung 28/09/2026, theo yêu cầu người dùng — thay customerSheetService.js).
// Luồng dữ liệu của hệ thống: Sheet Seller -> (IMPORTRANGE) RAW -> (QUERY) Don_Hang_ALL; app KHÔNG ghi được
// RAW/Don_Hang_ALL (kết quả công thức) nên mọi thứ muốn Seller thấy phải ghi thẳng vào Sheet Seller:
//   GHI_CHU -> GHI_CHU_XUONG | TRACKING -> TRACKING_ID2 + HANG_VAN_CHUYEN2 | DELIVERED -> Delivered
// Tìm đúng ô:
//   1. Team = phần chữ trong mã đơn (9LIEM12 -> LIEM, donNhieuAoService.js#phanTichStt).
//   2. Tab CONFIG của Sheet chính (cùng nơi công thức IMPORTRANGE của RAW đang dùng) — cột tìm THEO TÊN
//      (TEAM, Spreadsheet ID, Tab), tiêu đề dòng 1. 1 team có thể nhiều dòng (mỗi tháng 1 tab).
//   3. Đọc MỌI tab của team (tab cùng tháng với mã đơn đọc trước), tìm mã đơn ở cột STT_Key (tiêu đề dòng 1):
//      đúng 1 dòng mới ghi; 0 hoặc >= 2 dòng -> lỗi, KHÔNG ghi (tránh ghi nhầm Sheet của Seller).
//   4. Chỉ ghi đúng các cột của loại đó (COT_THEO_LOAI), trên đúng dòng tìm được — không thêm/xoá dòng,
//      không đụng ô khác. Ghi dạng RAW (nguyên văn): USER_ENTERED làm mã tracking 22 chữ số thành số khoa
//      học (mất chữ số) và biến nội dung bắt đầu bằng "=" thành công thức.
// Không bao giờ throw: trả kết quả từng đơn; MỌI lần ghi (thành công/lỗi, ô TRƯỚC -> SAU) lưu vào
// nhatKyDbService#dong_bo_sheet_seller (theo dõi ở Settings + Trung tâm hành động) và lịch sử đơn.

const path = require('path');
const sheetsService = require('./sheetsService');
const nhatKyDbService = require('./nhatKyDbService');
const { thoiGianVNISOString } = require('./dateUtils');
const { phanTichStt } = require('./donNhieuAoService');

const TAB_CONFIG = 'CONFIG';
const COT_CONFIG = { team: 'TEAM', sheet: 'Spreadsheet ID', tab: 'Tab' };
const COT_THEO_LOAI = { GHI_CHU: ['GHI_CHU_XUONG'], TRACKING: ['TRACKING_ID2', 'HANG_VAN_CHUYEN2'], DELIVERED: ['Delivered'] };
const NHAN_LOAI = { GHI_CHU: 'Ghi chú xưởng', TRACKING: 'Tracking', DELIVERED: 'Delivered' };
const COT_CAN_CO = ['STT_Key', ...Object.values(COT_THEO_LOAI).flat()];

const tachSpreadsheetId = v => {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(String(v || ''));
  return m ? m[1] : String(v || '').trim();
};
const tenTabTrongRange = tab => `'${String(tab).replace(/'/g, "''")}'`;

function emailTaiKhoanDichVu() {
  try { return require(path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)).client_email || ''; } catch (e) { return ''; }
}

function moTaLoiGoogle(err, spreadsheetId, tab) {
  const ma = err && (err.code || (err.response && err.response.status));
  if (ma === 403) {
    const email = emailTaiKhoanDichVu();
    return `Tài khoản dịch vụ${email ? ` (${email})` : ''} chưa có quyền với Sheet ${spreadsheetId} — chia sẻ quyền Chỉnh sửa cho tài khoản này.`;
  }
  if (ma === 404) return `Không tìm thấy Sheet ${spreadsheetId} (sai Spreadsheet ID?).`;
  if (ma === 400 && /parse range/i.test(String(err.message))) return `Sheet ${spreadsheetId} không có tab "${tab}".`;
  return `Lỗi Google Sheets${ma ? ` (${ma})` : ''}: ${err.message}`;
}

// [{ team, spreadsheetId, tab, dongConfig }]
async function docConfig() {
  let bang;
  try {
    bang = await sheetsService.readTabCached(TAB_CONFIG, 60000);
  } catch (err) {
    throw new Error(`Không đọc được tab ${TAB_CONFIG} của Sheet chính: ${err.message}`);
  }
  const thieu = Object.values(COT_CONFIG).filter(c => !bang.headers.includes(c));
  if (thieu.length) throw new Error(`Tab ${TAB_CONFIG} thiếu cột: ${thieu.join(', ')} (tiêu đề phải ở dòng 1).`);
  return bang.rows
    .filter(r => String(r[COT_CONFIG.team] || '').trim())
    .map(r => ({
      team: String(r[COT_CONFIG.team]).trim().toUpperCase(),
      spreadsheetId: tachSpreadsheetId(r[COT_CONFIG.sheet]),
      tab: String(r[COT_CONFIG.tab] || '').trim(),
      dongConfig: r._row,
    }));
}

// Các (Sheet, tab) có thể chứa đơn — tab cùng tháng với mã đơn (9... -> "T9.") lên trước.
function nguonCuaDon(sttKey, config) {
  const p = phanTichStt(sttKey);
  if (!p) throw new Error(`Mã đơn "${sttKey}" không đúng dạng <tháng><team><số> — không xác định được Team.`);
  const thang = Number(/^\d+/.exec(String(sttKey).trim())[0]);
  const daCo = new Set();
  const ds = config.filter(c => c.team === p.team && c.spreadsheetId && c.tab)
    .filter(c => !daCo.has(c.spreadsheetId + '|' + c.tab) && daCo.add(c.spreadsheetId + '|' + c.tab));
  if (ds.length === 0) throw new Error(`Tab ${TAB_CONFIG} không có dòng nào TEAM = ${p.team} (đủ Spreadsheet ID và Tab).`);
  const cungThang = c => c.tab.toUpperCase().startsWith(`T${thang}.`);
  return { team: p.team, ds: [...ds.filter(cungThang), ...ds.filter(c => !cungThang(c))] };
}

async function docTab(client, spreadsheetId, tab, range = '') {
  const res = await sheetsService.goiApiCoThuLai(() => client.spreadsheets.values.get({
    spreadsheetId, range: tenTabTrongRange(tab) + range,
  }));
  const values = res.data.values || [];
  return { headers: (values[0] || []).map(h => String(h).trim()), values };
}

// danhSach: [{ sttKey, loai: 'GHI_CHU'|'TRACKING'|'DELIVERED', giaTri: { COT: 'giá trị' } }]
// user: { ten, vaiTro } | tuyChon.ghiLichSu: false -> không ghi lịch sử đơn (nơi gọi tự ghi, vd ghi chú).
// -> [{ sttKey, loai, ok, lyDo, spreadsheetId, tab, dong, thayDoi: [{ cot, tu, sang }] }]
async function ghiHangLoat(danhSach, user, { ghiLichSu = true } = {}) {
  const ketQua = danhSach.map(x => ({
    sttKey: String(x.sttKey || '').trim(), loai: x.loai, giaTri: x.giaTri || {},
    ok: false, lyDo: '', spreadsheetId: '', tab: '', dong: '', thayDoi: [],
  }));
  if (ketQua.length === 0) return [];

  let config, client;
  try {
    [config, client] = await Promise.all([docConfig(), sheetsService.getSheetsClient()]);
  } catch (err) {
    ketQua.forEach(k => { k.lyDo = err.message; });
    return ketThuc(ketQua, user, ghiLichSu);
  }

  // Mỗi tab chỉ đọc 1 lần cho cả lượt (vd job Delivered nhiều đơn cùng 1 Sheet).
  const cacheTab = new Map();
  const docTabCache = (id, tab) => {
    const khoa = id + '|' + tab;
    if (!cacheTab.has(khoa)) cacheTab.set(khoa, docTab(client, id, tab).catch(err => ({ loi: moTaLoiGoogle(err, id, tab) })));
    return cacheTab.get(khoa);
  };

  const theoSheet = new Map(); // spreadsheetId -> [ketQua đã tìm được ô]
  for (const k of ketQua) {
    try {
      const cacCot = COT_THEO_LOAI[k.loai];
      if (!cacCot) throw new Error(`Loại ghi không hợp lệ: ${k.loai}`);
      const { team, ds } = nguonCuaDon(k.sttKey, config);
      const thay = [];
      for (const n of ds) {
        const t = await docTabCache(n.spreadsheetId, n.tab);
        // Không đọc được 1 tab của team -> không chắc đơn có nằm ở đó không -> dừng, không đoán.
        if (t.loi) throw new Error(t.loi);
        const iStt = t.headers.indexOf('STT_Key');
        if (iStt === -1) throw new Error(`Tab "${n.tab}" (Sheet ${n.spreadsheetId}) không có cột STT_Key ở dòng 1.`);
        t.values.forEach((hang, i) => {
          if (i > 0 && String(hang[iStt] || '').trim() === k.sttKey) thay.push({ ...n, t, soDong: i + 1, hang });
        });
      }
      if (thay.length === 0) throw new Error(`Không tìm thấy mã đơn ${k.sttKey} trong ${ds.map(n => `tab "${n.tab}"`).join(', ')} của Team ${team}.`);
      if (thay.length > 1) throw new Error(`Mã đơn ${k.sttKey} có ${thay.length} dòng (${thay.map(x => `tab "${x.tab}" dòng ${x.soDong}`).join(', ')}) — không ghi để tránh ghi nhầm.`);
      const d = thay[0];
      Object.assign(k, { spreadsheetId: d.spreadsheetId, tab: d.tab, dong: d.soDong });
      const thieu = cacCot.filter(c => !d.t.headers.includes(c));
      if (thieu.length) throw new Error(`Tab "${d.tab}" thiếu cột: ${thieu.join(', ')}.`);
      k.thayDoi = cacCot.map(cot => {
        const i = d.t.headers.indexOf(cot);
        return { cot, tu: String(d.hang[i] ?? ''), sang: String(k.giaTri[cot] ?? ''), range: `${tenTabTrongRange(d.tab)}!${sheetsService.colToLetter(i)}${d.soDong}` };
      });
      if (!theoSheet.has(d.spreadsheetId)) theoSheet.set(d.spreadsheetId, []);
      theoSheet.get(d.spreadsheetId).push(k);
    } catch (err) {
      k.lyDo = err.message;
    }
  }

  for (const [spreadsheetId, ds] of theoSheet) {
    try {
      await sheetsService.goiApiCoThuLai(() => client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: ds.flatMap(k => k.thayDoi.map(t => ({ range: t.range, values: [[t.sang]] }))) },
      }));
      ds.forEach(k => { k.ok = true; });
    } catch (err) {
      const lyDo = moTaLoiGoogle(err, spreadsheetId);
      ds.forEach(k => { k.lyDo = lyDo; });
    }
  }
  return ketThuc(ketQua, user, ghiLichSu);
}

// Ghi nhật ký đồng bộ (mỗi ô 1 dòng khi thành công, 1 dòng/đơn khi lỗi) + lịch sử đơn.
function ketThuc(ketQua, user, ghiLichSu) {
  const thoiGian = thoiGianVNISOString();
  const nguoiDung = (user && user.ten) || 'Hệ thống';
  const chung = k => ({ ThoiGian: thoiGian, NguoiDung: nguoiDung, STT_Key: k.sttKey, Loai: k.loai, SpreadsheetId: k.spreadsheetId, Tab: k.tab, Dong: k.dong });
  try {
    nhatKyDbService.ghiNhieuDongBoSheetSeller(ketQua.flatMap(k => (k.ok
      ? k.thayDoi.map(t => ({ ...chung(k), Cot: t.cot, GiaTriTruoc: t.tu, GiaTriSau: t.sang, KetQua: 'OK' }))
      : [{
        ...chung(k), Cot: (COT_THEO_LOAI[k.loai] || []).join(', '),
        GiaTriTruoc: k.thayDoi.map(t => t.tu).join(' | '),
        GiaTriSau: (COT_THEO_LOAI[k.loai] || []).map(c => k.giaTri[c] ?? '').join(' | '),
        KetQua: 'LOI', LyDo: k.lyDo,
      }])));
    if (ghiLichSu) {
      require('./logService').ghiLogNhieu(ketQua.map(k => ({
        nguoiDung, vaiTro: (user && user.vaiTro) || '', hanhDong: 'GHI_SHEET_SELLER', sttKey: k.sttKey,
        chiTiet: chiTietLichSu(k),
      })));
    }
  } catch (err) {
    console.error('[SheetSeller] Lỗi ghi nhật ký đồng bộ:', err.message);
  }
  ketQua.forEach(k => { k.thayDoi = k.thayDoi.map(({ cot, tu, sang }) => ({ cot, tu, sang })); });
  return ketQua;
}

// Chi tiết lưu vào lịch sử đơn cho 1 lần ghi (dùng chung với ghi chú xưởng ở routes/orders.js).
function chiTietLichSu(k) {
  return {
    loai: k.loai, ketQua: k.ok ? 'OK' : 'LOI', lyDo: k.lyDo, tab: k.tab, dong: k.dong,
    thayDoi: Object.fromEntries(k.thayDoi.map(t => [t.cot, { tu: t.tu, sang: t.sang }])),
    ...(k.ok ? {} : { giaTri: k.giaTri }),
  };
}

// Settings: bảng CONFIG app đọc được; kiemTraSheet -> đọc thử dòng tiêu đề từng tab (thiếu quyền ĐỌC, sai
// tab, thiếu cột). Chỉ đọc — không phát hiện được thiếu quyền GHI (lộ ra ở lần ghi thật).
async function kiemTraConfig({ kiemTraSheet = false } = {}) {
  sheetsService.xoaCacheBang(TAB_CONFIG);
  let config;
  try {
    config = await docConfig();
  } catch (err) {
    return { loi: err.message, dong: [], email: emailTaiKhoanDichVu() };
  }
  if (!kiemTraSheet) return { dong: config, email: emailTaiKhoanDichVu() };
  const client = await sheetsService.getSheetsClient();
  const dong = [];
  for (const c of config) {
    if (!c.spreadsheetId || !c.tab) { dong.push({ ...c, ok: false, loi: 'Thiếu Spreadsheet ID hoặc Tab.' }); continue; }
    try {
      const { headers } = await docTab(client, c.spreadsheetId, c.tab, '!1:1');
      const thieuCot = COT_CAN_CO.filter(x => !headers.includes(x));
      dong.push({ ...c, ok: thieuCot.length === 0, thieuCot, loi: thieuCot.length ? `Thiếu cột: ${thieuCot.join(', ')}` : '' });
    } catch (err) {
      dong.push({ ...c, ok: false, loi: moTaLoiGoogle(err, c.spreadsheetId, c.tab) });
    }
  }
  return { dong, email: emailTaiKhoanDichVu() };
}

module.exports = { ghiHangLoat, kiemTraConfig, chiTietLichSu, COT_THEO_LOAI, NHAN_LOAI };
