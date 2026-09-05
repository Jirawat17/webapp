# Nút gộp "IN MÃ + IN DANH SÁCH PHÔI ĐƠN ĐANG CHỌN + IN ĐƠN ĐANG CHỌN" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 1 toolbar button on the "Danh sách đơn hàng" page (`public/orders.html`) that, in one click, marks the selected orders as `"Đã in mã"`, prints their order PDF, and prints their grouped "phôi" (blank stock) PDF — reusing the existing status-change and print functions instead of duplicating logic.

**Architecture:** Pure frontend change in a single static HTML page with inline `<script>` (no framework, no build step, no backend changes). Two existing functions (`inDonHangLoatCoTienDo`, `inPhoiDangChon`) get a small, backward-compatible extension so they can be called with a captured order list and without their own `alert()` popups; a new orchestrator function calls them sequentially and shows one consolidated summary alert.

**Tech Stack:** Vanilla JS (no framework), Express backend (untouched by this plan), existing helpers from `public/js/api.js` (`apiFetch`, `chayHangLoatCoTienDo`, `taoThanhTienDo`), `public/js/icons.js` (`icon()`).

**Spec:** `docs/superpowers/specs/2026-09-05-nut-gop-in-ma-phoi-don-design.md`

**Testing note:** This codebase has no automated test suite (no test runner in `package.json`, no existing test files) — every similar function on this page (`apDungNhanh`, `inDonDangChon`, `inPhoiDangChon`) is verified by hand in the browser only. This plan follows that existing convention: each task's "verify" step is a manual check using the dev server (`.claude/launch.json` config `webapp`, port 3000) instead of an automated test. If logging in with a real account isn't possible in the execution environment (Google Sheets-backed auth), fall back to careful code re-reading of the diff and say so explicitly — do not claim a live browser check happened if it didn't.

---

## Task 1: Add the new button to the toolbar

**Files:**
- Modify: `public/orders.html:15-20`

- [ ] **Step 1: Add the button element**

Find this block near the top of `public/orders.html`:

```html
  <div class="thanh-cong-cu-danh-sach">
    <button type="button" class="btn-hanh-dong phu" id="btn-mo-loc" onclick="batTatPanel('panel-loc')"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-mo-sap-xep" onclick="batTatPanel('panel-sap-xep')"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-phoi-ao" onclick="inPhoiDangChon(this)"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-don-dang-chon" onclick="inDonDangChon(this)"></button>
  </div>
```

Replace it with:

```html
  <div class="thanh-cong-cu-danh-sach">
    <button type="button" class="btn-hanh-dong phu" id="btn-mo-loc" onclick="batTatPanel('panel-loc')"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-mo-sap-xep" onclick="batTatPanel('panel-sap-xep')"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-phoi-ao" onclick="inPhoiDangChon(this)"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-don-dang-chon" onclick="inDonDangChon(this)"></button>
    <button type="button" class="btn-hanh-dong phu" id="btn-in-ma-phoi-don" onclick="inMaPhoiDonDangChon(this)"></button>
  </div>
```

(The button has no label yet and no click handler defined yet — that's Task 2 and Task 5. It will render as an empty button until then; that's expected and matches how `btn-in-phoi-ao`/`btn-in-don-dang-chon` also start empty and get their `innerHTML` set by JS.)

- [ ] **Step 2: Commit**

```bash
git add public/orders.html
git commit -m "$(cat <<'EOF'
feat: add empty toolbar button placeholder for combined print+status action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Label the button and hide it for roles other than admin/ve_file

**Files:**
- Modify: `public/orders.html:181-182`

- [ ] **Step 1: Add the label + role-visibility logic**

Find this block (inside the page's startup `(async () => { ... })()` block, right after the two existing print buttons get their labels):

```js
  document.getElementById('btn-in-phoi-ao').innerHTML = icon('printer') + ' IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN';
  document.getElementById('btn-in-don-dang-chon').innerHTML = icon('printer') + ' IN ĐƠN ĐANG CHỌN';
```

Replace it with:

```js
  document.getElementById('btn-in-phoi-ao').innerHTML = icon('printer') + ' IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN';
  document.getElementById('btn-in-don-dang-chon').innerHTML = icon('printer') + ' IN ĐƠN ĐANG CHỌN';

  // Nút gộp 3 việc (đổi trạng thái "Đã in mã" + in 2 file PDF) — chỉ dành cho admin/ve_file theo
  // đúng phạm vi người dùng đã xác nhận, ẩn hẳn với các vai trò khác (san_xuat, nguoi_lay_phoi) thay
  // vì chỉ dựa vào việc backend chặn đổi trạng thái (xem spec 2026-09-05).
  const btnInMaPhoiDon = document.getElementById('btn-in-ma-phoi-don');
  if (user.vaiTro === 'admin' || user.vaiTro === 've_file') {
    btnInMaPhoiDon.innerHTML = icon('printer') + ' IN MÃ + IN DANH SÁCH PHÔI ĐƠN ĐANG CHỌN + IN ĐƠN ĐANG CHỌN';
  } else {
    btnInMaPhoiDon.style.display = 'none';
  }
```

This relies on the `user` variable already in scope from `const user = await requireLoginOrRedirect();` at the top of the same `(async () => { ... })()` block — no new fetch needed.

- [ ] **Step 2: Verify in the browser**

Start the dev server (`webapp` config, port 3000) and open `/orders.html` while logged in.

- If the logged-in account's role is `admin` or `ve_file`: confirm the new button appears in the toolbar with the exact label "IN MÃ + IN DANH SÁCH PHÔI ĐƠN ĐANG CHỌN + IN ĐƠN ĐANG CHỌN" and a printer icon.
- If a `san_xuat` or `nguoi_lay_phoi` test account is available, log in as that role and confirm the button is absent (not just invisible — check it doesn't take up layout space).
- If no second test account is available, verify the hidden branch by temporarily running this in the browser console instead (does not require a real account swap):
  ```js
  document.getElementById('btn-in-ma-phoi-don').style.display = 'none'; // simulate the hidden branch
  ```
  and confirm the toolbar layout looks correct without the button, then reload the page to restore it.

- [ ] **Step 3: Commit**

```bash
git add public/orders.html
git commit -m "$(cat <<'EOF'
feat: label combined print+status button, restrict to admin/ve_file

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Let `inDonHangLoatCoTienDo` report status instead of always alerting

**Why:** The combined button needs to run the existing "IN ĐƠN ĐANG CHỌN" print job and fold its outcome into one final summary alert, instead of letting it pop its own `alert()` mid-flow. The standalone "IN ĐƠN ĐANG CHỌN" button must keep behaving exactly as before.

**Files:**
- Modify: `public/orders.html:521-582` (function `inDonHangLoatCoTienDo`)

- [ ] **Step 1: Add an opt-out for the internal alert and a return value**

Find the full function:

```js
// IN ĐƠN ĐANG CHỌN có thể in NHIỀU đơn cùng lúc, phải tải ảnh từng đơn một nên chậm — khác với luồng
// quét QR/đổi trạng thái hàng loạt (chayHangLoatCoTienDo trong api.js, tách được thành nhiều lệnh gọi
// độc lập), tạo file PDF là 1 tiến trình liên tục trên server nên dùng CHẠY NỀN + HỎI TIẾN ĐỘ ĐỊNH KỲ:
// server tạo 1 "công việc" (job), trả về jobId ngay, xử lý thật ở nền; client hỏi lại tiến độ mỗi
// 700ms tới khi xong rồi mới tải file về (xem routes/reports.js router.post('/don-can-in/bat-dau')).
// `than` — nội dung body gửi lên: { sttKeys } của các đơn đang tick chọn (xem inDonDangChon()).
// Có nút "DỪNG" (onHuy) — bấm vào sẽ báo server đặt cờ hủy thật (route '/don-can-in/huy/:jobId'),
// server dừng xử lý các đơn CÒN LẠI ngay (đơn đang xử lý dở vẫn hoàn tất bình thường), không chỉ đơn
// thuần ẩn thanh tiến độ ở trình duyệt — xem routes/reports.js router.post('/don-can-in/bat-dau').
async function inDonHangLoatCoTienDo(nut, nhanGoc, than) {
  let ketQuaBatDau;
  try {
    ketQuaBatDau = await apiFetch('/reports/don-can-in/bat-dau', {
      method: 'POST', body: JSON.stringify({ ...than, dinhDang: 'pdf' }),
    });
  } catch (e) {
    alert('Lỗi: ' + e.message);
    nut.disabled = false; nut.innerHTML = nhanGoc;
    return;
  }

  const { jobId, tongSo } = ketQuaBatDau;
  if (tongSo === 0) {
    alert('Không có đơn nào để in.');
    nut.disabled = false; nut.innerHTML = nhanGoc;
    return;
  }

  const thanhTienDo = taoThanhTienDo(nut, {
    onHuy: () => { apiFetch(`/reports/don-can-in/huy/${jobId}`, { method: 'POST' }).catch(() => {}); },
  });
  thanhTienDo.capNhat(0, tongSo);

  try {
    let tienDo;
    do {
      await new Promise(r => setTimeout(r, 700));
      tienDo = await apiFetch(`/reports/don-can-in/tien-do/${jobId}`);
      thanhTienDo.capNhat(tienDo.daXong, tienDo.tongSo);
      if (tienDo.trangThai === 'loi') throw new Error(tienDo.loi || 'Tạo file thất bại');
    } while (tienDo.trangThai !== 'xong' && tienDo.trangThai !== 'huy');

    if (tienDo.trangThai === 'huy') {
      alert(`Đã dừng. Đã tạo xong ${tienDo.daXong}/${tienDo.tongSo} đơn trước khi dừng (không tải về được nữa, hãy in lại nếu cần).`);
      return;
    }

    const res = await fetch(`/api/reports/don-can-in/tai-ve/${jobId}`, { credentials: 'include' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Không tải được file');
    }
    const blob = await res.blob();
    taiFileTuBlob(blob, res.headers.get('Content-Disposition'), 'don-can-in.pdf');
  } catch (e) {
    alert('Lỗi: ' + e.message);
  } finally {
    thanhTienDo.xoa();
    nut.disabled = false;
    nut.innerHTML = nhanGoc;
  }
}
```

Replace it with:

```js
// IN ĐƠN ĐANG CHỌN có thể in NHIỀU đơn cùng lúc, phải tải ảnh từng đơn một nên chậm — khác với luồng
// quét QR/đổi trạng thái hàng loạt (chayHangLoatCoTienDo trong api.js, tách được thành nhiều lệnh gọi
// độc lập), tạo file PDF là 1 tiến trình liên tục trên server nên dùng CHẠY NỀN + HỎI TIẾN ĐỘ ĐỊNH KỲ:
// server tạo 1 "công việc" (job), trả về jobId ngay, xử lý thật ở nền; client hỏi lại tiến độ mỗi
// 700ms tới khi xong rồi mới tải file về (xem routes/reports.js router.post('/don-can-in/bat-dau')).
// `than` — nội dung body gửi lên: { sttKeys } của các đơn đang tick chọn (xem inDonDangChon()).
// Có nút "DỪNG" (onHuy) — bấm vào sẽ báo server đặt cờ hủy thật (route '/don-can-in/huy/:jobId'),
// server dừng xử lý các đơn CÒN LẠI ngay (đơn đang xử lý dở vẫn hoàn tất bình thường), không chỉ đơn
// thuần ẩn thanh tiến độ ở trình duyệt — xem routes/reports.js router.post('/don-can-in/bat-dau').
// `tuyChon.baoLoiBangAlert` (mặc định true) — false thì KHÔNG tự alert() khi lỗi, chỉ trả về
// {ok:false, loi} để bên gọi (vd inMaPhoiDonDangChon()) tự gộp vào 1 alert tổng kết khác. Luôn trả về
// {ok:true} hoặc {ok:false, loi} ở mọi nhánh, kể cả khi baoLoiBangAlert=true, để bên gọi luôn biết
// kết quả mà không phải đoán qua side-effect của alert().
async function inDonHangLoatCoTienDo(nut, nhanGoc, than, tuyChon = {}) {
  const baoLoiBangAlert = tuyChon.baoLoiBangAlert !== false;
  let ketQuaBatDau;
  try {
    ketQuaBatDau = await apiFetch('/reports/don-can-in/bat-dau', {
      method: 'POST', body: JSON.stringify({ ...than, dinhDang: 'pdf' }),
    });
  } catch (e) {
    if (baoLoiBangAlert) alert('Lỗi: ' + e.message);
    nut.disabled = false; nut.innerHTML = nhanGoc;
    return { ok: false, loi: e.message };
  }

  const { jobId, tongSo } = ketQuaBatDau;
  if (tongSo === 0) {
    if (baoLoiBangAlert) alert('Không có đơn nào để in.');
    nut.disabled = false; nut.innerHTML = nhanGoc;
    return { ok: false, loi: 'Không có đơn nào để in.' };
  }

  const thanhTienDo = taoThanhTienDo(nut, {
    onHuy: () => { apiFetch(`/reports/don-can-in/huy/${jobId}`, { method: 'POST' }).catch(() => {}); },
  });
  thanhTienDo.capNhat(0, tongSo);

  try {
    let tienDo;
    do {
      await new Promise(r => setTimeout(r, 700));
      tienDo = await apiFetch(`/reports/don-can-in/tien-do/${jobId}`);
      thanhTienDo.capNhat(tienDo.daXong, tienDo.tongSo);
      if (tienDo.trangThai === 'loi') throw new Error(tienDo.loi || 'Tạo file thất bại');
    } while (tienDo.trangThai !== 'xong' && tienDo.trangThai !== 'huy');

    if (tienDo.trangThai === 'huy') {
      const thongBaoHuy = `Đã dừng. Đã tạo xong ${tienDo.daXong}/${tienDo.tongSo} đơn trước khi dừng (không tải về được nữa, hãy in lại nếu cần).`;
      if (baoLoiBangAlert) alert(thongBaoHuy);
      return { ok: false, loi: thongBaoHuy };
    }

    const res = await fetch(`/api/reports/don-can-in/tai-ve/${jobId}`, { credentials: 'include' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Không tải được file');
    }
    const blob = await res.blob();
    taiFileTuBlob(blob, res.headers.get('Content-Disposition'), 'don-can-in.pdf');
    return { ok: true };
  } catch (e) {
    if (baoLoiBangAlert) alert('Lỗi: ' + e.message);
    return { ok: false, loi: e.message };
  } finally {
    thanhTienDo.xoa();
    nut.disabled = false;
    nut.innerHTML = nhanGoc;
  }
}
```

The only behavioral change for the existing caller (`inDonDangChon`, which doesn't pass a 4th argument) is that the function now returns a value — `inDonDangChon` ignores it, so nothing changes for that button.

- [ ] **Step 2: Verify the existing "IN ĐƠN ĐANG CHỌN" button still works unchanged**

Start the dev server, open `/orders.html`, select 1-2 orders, click "IN ĐƠN ĐANG CHỌN". Confirm:
- The progress bar with a "Hủy" button still appears next to the button.
- The PDF still downloads as `don-can-in.pdf` (or the filename from `Content-Disposition`).
- The button re-enables and its label is restored afterward.

- [ ] **Step 3: Commit**

```bash
git add public/orders.html
git commit -m "$(cat <<'EOF'
refactor: let inDonHangLoatCoTienDo report status instead of only alerting

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Let `inPhoiDangChon` accept a captured order list and report status

**Files:**
- Modify: `public/orders.html:491-519` (function `inPhoiDangChon`)

- [ ] **Step 1: Add the `tuyChon` parameter**

Find:

```js
// Nút "IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN" — in ĐÚNG các đơn đang tick chọn (donDaChonSet), bỏ qua
// mọi ô lọc đang hiển thị trên trang. Không cần chạy nền + tiến độ như "IN ĐƠN ĐANG CHỌN" (mẫu
// 'phoi_ao_gop' là bảng dữ liệu thuần, không tải ảnh từng đơn nên luôn đủ nhanh) — gọi thẳng /pdf.
async function inPhoiDangChon(nut) {
  if (donDaChonSet.size === 0) { alert('Hãy chọn ít nhất 1 đơn muốn in.'); return; }

  const nhanGoc = nut.innerHTML;
  nut.disabled = true;
  nut.innerHTML = icon('spinner', { className: 'icon-spin', size: 18 }) + ' Đang tạo file...';

  const qs = new URLSearchParams();
  qs.set('mau', 'phoi_ao_gop');
  Array.from(donDaChonSet).forEach(sttKey => qs.append('sttKeys', sttKey));

  try {
    const res = await fetch('/api/reports/pdf?' + qs.toString(), { credentials: 'include' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Không xuất được file');
    }
    const blob = await res.blob();
    taiFileTuBlob(blob, res.headers.get('Content-Disposition'), 'bao-cao.pdf');
  } catch (e) {
    alert('Lỗi: ' + e.message);
  } finally {
    nut.disabled = false;
    nut.innerHTML = nhanGoc;
  }
}
```

Replace it with:

```js
// Nút "IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN" — in ĐÚNG các đơn đang tick chọn (donDaChonSet), bỏ qua
// mọi ô lọc đang hiển thị trên trang. Không cần chạy nền + tiến độ như "IN ĐƠN ĐANG CHỌN" (mẫu
// 'phoi_ao_gop' là bảng dữ liệu thuần, không tải ảnh từng đơn nên luôn đủ nhanh) — gọi thẳng /pdf.
// `tuyChon.sttKeys` (tuỳ chọn) — in đúng danh sách này thay vì đọc donDaChonSet hiện tại, dùng khi cần
// in 1 danh sách đã CHỤP LẠI từ trước (xem inMaPhoiDonDangChon()), không phụ thuộc donDaChonSet có bị
// đổi sau đó hay không. `tuyChon.baoLoiBangAlert` (mặc định true) — false thì không tự alert() khi
// lỗi, chỉ trả {ok:false, loi} để bên gọi tự gộp vào 1 alert tổng kết khác.
async function inPhoiDangChon(nut, tuyChon = {}) {
  const danhSach = tuyChon.sttKeys || Array.from(donDaChonSet);
  const baoLoiBangAlert = tuyChon.baoLoiBangAlert !== false;
  if (danhSach.length === 0) {
    if (baoLoiBangAlert) alert('Hãy chọn ít nhất 1 đơn muốn in.');
    return { ok: false, loi: 'Hãy chọn ít nhất 1 đơn muốn in.' };
  }

  const nhanGoc = nut.innerHTML;
  nut.disabled = true;
  nut.innerHTML = icon('spinner', { className: 'icon-spin', size: 18 }) + ' Đang tạo file...';

  const qs = new URLSearchParams();
  qs.set('mau', 'phoi_ao_gop');
  danhSach.forEach(sttKey => qs.append('sttKeys', sttKey));

  try {
    const res = await fetch('/api/reports/pdf?' + qs.toString(), { credentials: 'include' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Không xuất được file');
    }
    const blob = await res.blob();
    taiFileTuBlob(blob, res.headers.get('Content-Disposition'), 'bao-cao.pdf');
    return { ok: true };
  } catch (e) {
    if (baoLoiBangAlert) alert('Lỗi: ' + e.message);
    return { ok: false, loi: e.message };
  } finally {
    nut.disabled = false;
    nut.innerHTML = nhanGoc;
  }
}
```

The existing caller (`onclick="inPhoiDangChon(this)"` on `#btn-in-phoi-ao`) still calls it with just `nut`, so `tuyChon` defaults to `{}`, `danhSach` falls back to `Array.from(donDaChonSet)`, and `baoLoiBangAlert` defaults to `true` — identical behavior to before.

- [ ] **Step 2: Verify the existing "IN DANH SÁCH PHÔI..." button still works unchanged**

Select 1-2 orders, click "IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN". Confirm the PDF still downloads and the button still shows "Đang tạo file..." while working.

- [ ] **Step 3: Commit**

```bash
git add public/orders.html
git commit -m "$(cat <<'EOF'
refactor: let inPhoiDangChon take a captured order list and report status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Implement the combined orchestrator function

**Files:**
- Modify: `public/orders.html` — insert a new function right after `inDonDangChon` (end of the `<script>` block, currently the last function before `</script>`).

- [ ] **Step 1: Add `inMaPhoiDonDangChon`**

Find the end of the script (last function + closing tag):

```js
// Nút "IN ĐƠN ĐANG CHỌN" — in ĐÚNG các đơn đang tick chọn (donDaChonSet), bỏ qua mọi ô lọc đang hiển
// thị trên trang.
async function inDonDangChon(nut) {
  if (donDaChonSet.size === 0) { alert('Hãy chọn ít nhất 1 đơn muốn in.'); return; }

  const nhanGoc = nut.innerHTML;
  nut.disabled = true;
  nut.innerHTML = icon('spinner', { className: 'icon-spin', size: 18 }) + ' Đang tạo file...';

  await inDonHangLoatCoTienDo(nut, nhanGoc, { sttKeys: Array.from(donDaChonSet) });
}
</script>
</body>
</html>
```

Replace it with:

```js
// Nút "IN ĐƠN ĐANG CHỌN" — in ĐÚNG các đơn đang tick chọn (donDaChonSet), bỏ qua mọi ô lọc đang hiển
// thị trên trang.
async function inDonDangChon(nut) {
  if (donDaChonSet.size === 0) { alert('Hãy chọn ít nhất 1 đơn muốn in.'); return; }

  const nhanGoc = nut.innerHTML;
  nut.disabled = true;
  nut.innerHTML = icon('spinner', { className: 'icon-spin', size: 18 }) + ' Đang tạo file...';

  await inDonHangLoatCoTienDo(nut, nhanGoc, { sttKeys: Array.from(donDaChonSet) });
}

// Nút gộp "IN MÃ + IN DANH SÁCH PHÔI ĐƠN ĐANG CHỌN + IN ĐƠN ĐANG CHỌN" — làm 1 lần cả 3 việc:
// (1) đổi TRANG_THAI_XUONG các đơn đã chọn sang "Đã in mã", (2) in PDF thẻ đơn, (3) in PDF danh sách
// phôi gộp. Chụp lại `danhSach` NGAY khi bấm — cả 3 bước dùng chung danh sách này, không phụ thuộc
// donDaChonSet có bị đổi giữa chừng hay không (xem spec 2026-09-05). 3 bước ĐỘC LẬP: lỗi (hoặc lỗi 1
// phần) ở bước nào chỉ được ghi nhận trong alert tổng kết cuối cùng, không chặn bước sau.
async function inMaPhoiDonDangChon(nut) {
  if (donDaChonSet.size === 0) { alert('Hãy chọn ít nhất 1 đơn muốn in.'); return; }

  const danhSach = Array.from(donDaChonSet);
  if (!confirm(`Đánh dấu ${danhSach.length} đơn đã chọn thành "Đã in mã", đồng thời in file PDF đơn và file PDF danh sách phôi. Tiếp tục?`)) return;

  const nhanGoc = nut.innerHTML;
  nut.disabled = true;

  // Bước 1 — đổi trạng thái sang "Đã in mã", tuần tự từng đơn để hiện được tiến độ thật (cùng cơ chế
  // nút "Đã in mã" ở thanh hành động hàng loạt đang dùng — xem apDungNhanh()).
  nut.innerHTML = icon('spinner', { className: 'icon-spin', size: 16 }) + ' Đang đổi trạng thái...';
  let daHuyDoiTrangThai = false;
  const thanhTienDoTrangThai = taoThanhTienDo(nut, { onHuy: () => { daHuyDoiTrangThai = true; } });
  thanhTienDoTrangThai.capNhat(0, danhSach.length);
  const ketQuaTrangThai = await chayHangLoatCoTienDo(
    danhSach,
    sttKey => apiFetch('/orders/chuyen-trang-thai-hang-loat', {
      method: 'POST', body: JSON.stringify({ sttKeys: [sttKey], cot: 'TRANG_THAI_XUONG', trangThaiMoi: 'Đã in mã' }),
    }),
    { onTienDo: (hienTai, tong) => thanhTienDoTrangThai.capNhat(hienTai, tong), kiemTraHuy: () => daHuyDoiTrangThai }
  );
  thanhTienDoTrangThai.xoa();

  // Bước 2 — in PDF đơn cho TOÀN BỘ đơn đã chọn ban đầu (không phụ thuộc kết quả bước 1 — đã xác nhận
  // với người dùng: luôn in cho toàn bộ đơn đã chọn dù bước đổi trạng thái có lỗi 1 phần hay không).
  nut.disabled = true;
  nut.innerHTML = icon('spinner', { className: 'icon-spin', size: 16 }) + ' Đang tạo file đơn...';
  const ketQuaInDon = await inDonHangLoatCoTienDo(nut, nhanGoc, { sttKeys: danhSach }, { baoLoiBangAlert: false });

  // Bước 3 — in PDF phôi cho TOÀN BỘ đơn đã chọn ban đầu (không phụ thuộc kết quả bước 1/2).
  const ketQuaInPhoi = await inPhoiDangChon(nut, { sttKeys: danhSach, baoLoiBangAlert: false });

  // Alert tổng kết — ghi rõ đơn nào OK/chưa OK ở bước đổi trạng thái (bước duy nhất xử lý TỪNG đơn
  // riêng nên có được danh sách này); 2 bước in PDF xử lý theo cả lô/bảng tổng hợp nên chỉ báo được
  // thành công/lỗi của CẢ FILE, không tách được theo từng đơn (xem spec 2026-09-05, mục 4).
  let thongBao = `KẾT QUẢ:\n\n1) Đổi trạng thái "Đã in mã" — ${ketQuaTrangThai.thanhCong.length}/${danhSach.length} đơn OK`;
  if (ketQuaTrangThai.thanhCong.length > 0) {
    thongBao += `:\n   ✔ OK: ${ketQuaTrangThai.thanhCong.join(', ')}`;
  }
  if (ketQuaTrangThai.loi.length > 0) {
    thongBao += `\n   ✘ Chưa OK (${ketQuaTrangThai.loi.length} đơn):\n` +
      ketQuaTrangThai.loi.map(l => `     - ${l.sttKey}: ${l.lyDo}`).join('\n');
  }
  if (ketQuaTrangThai.daHuy) {
    thongBao += `\n   (Đã HỦY giữa chừng bước đổi trạng thái — các đơn còn lại chưa được xử lý.)`;
  }
  thongBao += `\n\n2) File PDF đơn (IN ĐƠN ĐANG CHỌN):\n   ${ketQuaInDon.ok ? '✔ Đã tạo và tải về thành công' : '✘ Lỗi: ' + ketQuaInDon.loi}`;
  thongBao += `\n\n3) File PDF phôi (IN DANH SÁCH PHÔI CỦA ĐƠN ĐANG CHỌN):\n   ${ketQuaInPhoi.ok ? '✔ Đã tạo và tải về thành công' : '✘ Lỗi: ' + ketQuaInPhoi.loi}`;
  alert(thongBao);

  nut.disabled = false;
  nut.innerHTML = nhanGoc;
  donDaChonSet.clear();
  await taiDon();
}
</script>
</body>
</html>
```

- [ ] **Step 2: Verify end-to-end in the browser**

Start the dev server, open `/orders.html` logged in as `admin` or `ve_file`:

1. Select 2-3 orders (any status), click the new button.
2. Confirm the `confirm()` dialog text mentions the right count and both PDF names.
3. Confirm it: shows "Đang đổi trạng thái..." with a progress bar first, then "Đang tạo file đơn..." with its own progress bar (and a working "Hủy" button), then "Đang tạo file phôi...".
4. Confirm 2 files download (`don-can-in.pdf`-style order PDF, then a `phoi`/`bao-cao.pdf`-style grouped PDF).
5. Confirm the final `alert()` lists the selected orders under "✔ OK" for step 1, and "✔ Đã tạo và tải về thành công" for steps 2 and 3.
6. Close the alert, confirm the order list reloads, selection is cleared, and the selected orders now show status `"Đã in mã"`.
7. Repeat with 0 orders selected — confirm it shows "Hãy chọn ít nhất 1 đơn muốn in." and does nothing else.
8. If possible, force a partial failure in step 1 (e.g. edit one selected order in another tab/Sheet right before confirming, so `orderService.getByKey` returns "not found" for it) and confirm that order shows up under "✘ Chưa OK" in the final alert, while steps 2 and 3 still ran for all originally selected orders.

- [ ] **Step 3: Commit**

```bash
git add public/orders.html
git commit -m "$(cat <<'EOF'
feat: add combined status-change + print button on orders page

Marks selected orders as "Da in ma", then prints the order PDF and the
grouped phoi PDF for the same selection, in one click. Reuses the
existing status-change and print endpoints unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final review pass

- [ ] **Step 1: Re-read the full diff against the spec**

```bash
git diff origin/main -- public/orders.html
```

Confirm every point in `docs/superpowers/specs/2026-09-05-nut-gop-in-ma-phoi-don-design.md` is covered: button placement/label, role visibility, 3-step sequencing, independent error handling, and the summary alert format.

- [ ] **Step 2: Confirm the two existing standalone buttons ("IN ĐƠN ĐANG CHỌN", "IN DANH SÁCH PHÔI...") are untouched in behavior**

Re-run the manual checks from Task 3 Step 2 and Task 4 Step 2 once more after all edits, since both functions were modified twice across this plan.

- [ ] **Step 3: No backend changes**

```bash
git diff origin/main --stat
```

Confirm only `public/orders.html` (plus the spec/plan docs already committed earlier in this feature) appears — no files under `routes/`, `services/`, or `data/` should show up.
