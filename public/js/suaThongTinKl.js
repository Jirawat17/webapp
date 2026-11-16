// Sửa dữ liệu gửi KL cho đơn đã chuyển MUA THỦ CÔNG (16/11/2026, theo yêu cầu người dùng) — dùng ở
// tracking.html. Dữ liệu: d.thongTinKl = [{ truong, nhan, goc, sua, goiY }] — chỉ trường lỗi (phát hiện từ
// nội dung lỗi KL) + trường đang có giá trị sửa. Lưu vào SQLite (THONG_TIN_KL_CHO_DON_LOI), CHỈ dùng khi
// gửi KL, KHÔNG ghi Google Sheet. Trang dùng file này phải có sẵn hàm taiCanhBaoThuCong().

function htmlSuaThongTinKl(d) {
  const ds = d.thongTinKl || [];
  if (!ds.length) return '';
  const idPrefix = 'sua-kl-' + d.sttKey.replace(/[^A-Za-z0-9_-]/g, '_');
  const dangSua = ds.filter(f => f.sua);
  return `
    <div style="flex-basis:100%;margin:2px 0 4px;padding:8px 10px;background:var(--color-surface);color:var(--color-text);border-radius:6px;font-size:0.85rem">
      ${dangSua.map(f => `
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <span>Đang dùng khi gửi KL: <strong>${escapeHtml(f.nhan)} = ${escapeHtml(f.sua)}</strong> <span style="color:var(--color-text-muted)">(gốc: ${escapeHtml(f.goc || '(trống)')})</span></span>
          <button type="button" class="btn-hanh-dong phu nguy-hiem" style="padding:3px 8px;font-size:0.78rem"
            data-stt="${escapeHtml(d.sttKey)}" data-truong="${escapeHtml(f.truong)}" data-nhan="${escapeHtml(f.nhan)}"
            onclick="xoaThongTinKl(this)">Xoá</button>
        </div>`).join('')}
      ${ds.map(f => `
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
          <label style="font-weight:600;min-width:120px">${escapeHtml(f.nhan)}:</label>
          <input id="${idPrefix}-${escapeHtml(f.truong)}" value="${escapeHtml(f.goiY || f.sua || '')}"
            placeholder="Giá trị mới" maxlength="200" style="min-width:0;flex:1 1 140px;max-width:260px">
          <button type="button" class="btn-hanh-dong phu" style="padding:3px 10px;font-size:0.8rem"
            data-stt="${escapeHtml(d.sttKey)}" data-truong="${escapeHtml(f.truong)}" data-nhan="${escapeHtml(f.nhan)}"
            data-id="${idPrefix}-${escapeHtml(f.truong)}"
            onclick="luuThongTinKl(this)">Lưu</button>
          <span style="color:var(--color-text-muted)">Gốc: ${escapeHtml(f.goc || '(trống)')}</span>
        </div>`).join('')}
      <div style="color:var(--color-text-muted);margin-top:4px">Chỉ dùng khi mua tracking KL — Google Sheet giữ nguyên. Lưu xong bấm "Mua KL ngay" hoặc "Cho tự động thử lại".</div>
    </div>`;
}

async function guiThongTinKl(btn, sttKey, truong, giaTri) {
  btn.disabled = true;
  try {
    await apiFetch('/tracking/thong-tin-kl', { method: 'POST', body: JSON.stringify({ sttKey, truong, giaTri }) });
    await taiCanhBaoThuCong();
  } catch (e) {
    await hopThongBao('Không lưu được: ' + e.message);
    btn.disabled = false;
  }
}

async function luuThongTinKl(btn) {
  const giaTri = document.getElementById(btn.dataset.id).value.trim();
  if (!giaTri) { await hopThongBao('Nhập giá trị mới trước khi lưu.'); return; }
  if (!await hopXacNhan(`Đơn ${btn.dataset.stt}: dùng ${btn.dataset.nhan} = "${giaTri}" khi gửi KL?\n(Google Sheet giữ nguyên.)`)) return;
  guiThongTinKl(btn, btn.dataset.stt, btn.dataset.truong, giaTri);
}

async function xoaThongTinKl(btn) {
  if (!await hopXacNhan(`Đơn ${btn.dataset.stt}: xoá giá trị sửa tay của ${btn.dataset.nhan}, quay về dữ liệu gốc khi gửi KL?`)) return;
  guiThongTinKl(btn, btn.dataset.stt, btn.dataset.truong, null);
}
