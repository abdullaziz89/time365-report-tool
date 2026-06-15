// Renderer logic (external file so it runs under the page's CSP).

const monthsAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const monthSel = document.getElementById('month');
const yearSel = document.getElementById('year');
const excelPath = document.getElementById('excelPath');
const outputDir = document.getElementById('outputDir');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const rememberEl = document.getElementById('remember');
const logEl = document.getElementById('log');
const runBtn = document.getElementById('run');
const drop = document.getElementById('drop');

// default to previous month
const now = new Date();
const cur = now.getMonth();                 // 0..11
const pm = cur === 0 ? 12 : cur;            // previous month as 1..12
const py = cur === 0 ? now.getFullYear() - 1 : now.getFullYear();

monthsAr.forEach((name, i) => {
  const o = document.createElement('option');
  o.value = String(i + 1);
  o.textContent = name;
  if (i + 1 === pm) o.selected = true;
  monthSel.appendChild(o);
});
for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) {
  const o = document.createElement('option');
  o.value = String(y);
  o.textContent = String(y);
  if (y === py) o.selected = true;
  yearSel.appendChild(o);
}

function log(msg) {
  logEl.textContent += msg + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

window.api.defaultOutput().then(p => { outputDir.value = p; });
window.api.onProgress(log);

// load saved credentials (if any)
window.api.loadCredentials().then(c => {
  if (c) {
    usernameEl.value = c.username || '';
    passwordEl.value = c.password || '';
    rememberEl.checked = true;
  }
});

// ---- file selection: button + drag & drop --------------------------------

function setExcel(p) {
  if (p && /\.(xlsx|xls)$/i.test(p)) {
    excelPath.value = p;
  } else if (p) {
    log('⚠ الرجاء اختيار ملف بصيغة .xlsx أو .xls');
  }
}

document.getElementById('pickExcel').onclick = async () => {
  const p = await window.api.selectExcel();
  setExcel(p);
};
drop.onclick = async () => {
  const p = await window.api.selectExcel();
  setExcel(p);
};

['dragenter', 'dragover'].forEach(ev => {
  drop.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); drop.classList.add('drag'); });
});
['dragleave', 'drop'].forEach(ev => {
  drop.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('drag'); });
});
// allow dropping anywhere on the window without the browser navigating away
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

drop.addEventListener('drop', e => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  let p = '';
  try { p = window.api.getPathForFile(file); } catch (_) { p = file.path || ''; }
  setExcel(p);
});

document.getElementById('pickOutput').onclick = async () => {
  const p = await window.api.selectOutput();
  if (p) outputDir.value = p;
};

// ---- run ------------------------------------------------------------------

runBtn.onclick = async () => {
  if (!excelPath.value) { log('⚠ الرجاء اختيار ملف الإكسل أولاً.'); return; }
  const mode = document.querySelector('input[name=mode]:checked').value;
  runBtn.disabled = true;
  logEl.textContent = '';
  log('بدء المعالجة…');
  // remember (or clear) credentials per the checkbox
  await window.api.saveCredentials({
    username: usernameEl.value.trim(),
    password: passwordEl.value,
    remember: rememberEl.checked
  });
  try {
    const res = await window.api.run({
      excelPath: excelPath.value,
      month: monthSel.value,
      year: yearSel.value,
      outputMode: mode,
      outputDir: outputDir.value,
      username: usernameEl.value.trim(),
      password: passwordEl.value
    });
    if (res && res.ok) log('✅ انتهى.');
  } catch (e) {
    log('ERROR: ' + e);
  } finally {
    runBtn.disabled = false;
  }
};
