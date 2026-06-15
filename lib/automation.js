// Core automation: parse the Excel, drive the time365 portal with Puppeteer,
// export the SUMMARY overtime report (per area / combined) as CSV + PDF, save to disk.

const path = require('path');
const fs = require('fs');
const os = require('os');
const XLSX = require('xlsx');
const puppeteer = require('puppeteer-core');
const { ensureBrowser } = require('./browser');

const LOGIN_URL = 'https://time365.moh.gov.kw/login';
const REPORT_URL = 'https://time365.moh.gov.kw/report-management/attendance_reports';
const REPORT_TITLE = 'تقرير ملخص العمل الاضافي';

// ---- Excel parsing ---------------------------------------------------------

function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }); // array of arrays

  let civilIdCol = -1, headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const idx = rows[i].findIndex(c => String(c).indexOf('الرقم المدني') > -1);
    if (idx > -1) { civilIdCol = idx; headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    throw new Error('Could not find the "الرقم المدني" column in the Excel file.');
  }

  const groups = {};
  let currentArea = 'غير محدد';
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const a = String(r[0] || '').replace(/\s+/g, ' ').trim(); // column A = area (merged / forward-filled; collapse line breaks)
    if (a) currentArea = a;
    const cid = String(r[civilIdCol] || '').replace(/\D/g, '');
    if (cid.length >= 10) {
      (groups[currentArea] = groups[currentArea] || []).push(cid);
    }
  }
  return groups;
}

function buildJobs(groups, outputMode) {
  const names = Object.keys(groups);
  const all = names.reduce((acc, a) => acc.concat(groups[a]), []);
  if (outputMode === 'combined') return [{ label: 'الكل', civilIds: all }];
  if (outputMode === 'both') {
    const j = names.map(a => ({ label: a, civilIds: groups[a] }));
    j.push({ label: 'الكل', civilIds: all });
    return j;
  }
  return names.map(a => ({ label: a, civilIds: groups[a] })); // per_area
}

// ---- helpers ---------------------------------------------------------------

const pad = n => (n < 10 ? '0' + n : '' + n);
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const safeName = s => String(s)
  .replace(/[\\/:*?"<>|]/g, '_')   // forbidden filename chars
  .replace(/\s+/g, '_')             // every space / line break -> underscore
  .replace(/_+/g, '_')              // collapse repeats
  .replace(/^_|_$/g, '');           // trim leading/trailing underscores

async function waitForDownload(dir, before, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1500));
    const files = fs.readdirSync(dir).filter(f => !before.has(f) && !f.endsWith('.crdownload'));
    if (files.length) {
      const newest = files
        .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0].f;
      return newest;
    }
  }
  return null;
}

// ---- main flow -------------------------------------------------------------

async function runReports({ excelPath, year, month, outputMode, outputDir, username, password, onProgress, userDataDir, cacheDir }) {
  onProgress('Reading Excel file…');
  const groups = parseExcel(excelPath);
  const jobs = buildJobs(groups, outputMode);
  onProgress(`Found ${Object.keys(groups).length} area(s) → ${jobs.length} report job(s).`);

  const y = parseInt(year, 10), m = parseInt(month, 10);
  const dateFrom = `${y}-${pad(m)}-01`;
  const dateTo = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
  const periodLabel = `${y}-${pad(m)}`;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 't365dl-'));

  const execPath = await ensureBrowser(cacheDir, onProgress);

  onProgress('Launching browser…');
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: execPath,
    userDataDir,
    defaultViewport: null,
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check']
  });

  const saved = [];
  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

    // Login. The session persists via userDataDir, so this is usually a one-time step.
    onProgress('Opening the portal…');
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    if (page.url().indexOf('/login') > -1) {
      const haveCreds = username && password;
      if (haveCreds) {
        onProgress('Logging in with the provided credentials…');
        try {
          await page.waitForSelector('input[type=email], input[name=email], #email', { timeout: 30000 });
          await page.type('input[type=email], input[name=email], #email', username, { delay: 20 });
          await page.type('input[type=password]', password, { delay: 20 });
          await page.click('button[type=submit]');
          // give it up to 30s to leave the login page
          await page.waitForFunction(() => location.pathname.indexOf('/login') === -1, { timeout: 30000 });
          onProgress('Logged in.');
        } catch (e) {
          onProgress('⚠ Automatic login didn\'t complete (wrong details, or an OTP/CAPTCHA). Please finish signing in manually in the browser window…');
          await page.waitForFunction(() => location.pathname.indexOf('/login') === -1, { timeout: 600000 });
          onProgress('Logged in.');
        }
      } else {
        onProgress('🔑 Please log in to time365 in the opened browser window. Waiting for you…');
        await page.waitForFunction(() => location.pathname.indexOf('/login') === -1, { timeout: 600000 });
        onProgress('Logged in.');
      }
      await new Promise(r => setTimeout(r, 1000));
    } else {
      onProgress('Already logged in (saved session).');
    }

    let jobIndex = 0;
    for (const job of jobs) {
      jobIndex++;
      onProgress(`[${jobIndex}/${jobs.length}] Area "${job.label}" — ${job.civilIds.length} employee(s)…`);

      try {
      await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('div.report-title', { timeout: 30000 });
      await page.evaluate((title) => {
        const el = [...document.querySelectorAll('div.report-title')].find(e => e.textContent.indexOf(title) > -1);
        if (el) el.click();
      }, REPORT_TITLE);
      await page.waitForSelector('#users', { timeout: 20000 });
      await new Promise(r => setTimeout(r, 1000));

      // Enable the civil-ID column
      await page.evaluate(() => { const b = document.getElementById('column-setting'); if (b) b.click(); });
      await new Promise(r => setTimeout(r, 700));
      await page.evaluate(() => {
        const cb = document.querySelector('input[value=civil_id]');
        if (cb && !cb.checked) cb.click();
        const ap = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'تطبيق');
        if (ap) ap.click();
      });
      await new Promise(r => setTimeout(r, 700));

      // Decimal hours
      await page.evaluate(() => { const r = document.getElementById('time-conversion-decimal-hours'); if (r) r.click(); });

      // Select the employees for this area.
      // IMPORTANT: there are several select2 dropdowns on the page, so we open the
      // الموظفين one specifically — it is the select2 container right after #users —
      // and type into its own focused search box.
      let added = 0;
      for (const id of job.civilIds) {
        try {
          const opened = await page.evaluate(() => {
            const sel = document.getElementById('users');
            const cont = sel && sel.nextElementSibling;
            if (!cont) return false;
            const sb = cont.querySelector('.select2-selection');
            if (sb) sb.click();
            const f = cont.querySelector('.select2-search__field');
            if (f) { f.focus(); return true; }
            return false;
          });
          if (!opened) throw new Error('users field not found');
          await page.keyboard.type(String(id), { delay: 20 });
          // wait for a real (non-loading, non "no results") option to appear
          await page.waitForFunction(() => {
            const o = document.querySelector('.select2-results__option');
            return o && !o.classList.contains('loading-results') && !/No results|لا توجد|لا يوجد/i.test(o.textContent || '');
          }, { timeout: 15000 });
          await new Promise(r => setTimeout(r, 300));
          await page.keyboard.press('Enter');
          await new Promise(r => setTimeout(r, 400));
          // authoritative count from the underlying <select multiple>
          const cnt = await page.evaluate(() => {
            const s = document.getElementById('users');
            return s ? s.selectedOptions.length : 0;
          });
          if (cnt > added) { added = cnt; if (added % 10 === 0) onProgress(`   selected ${added}/${job.civilIds.length}…`); }
        } catch (e) { /* an id with no match (or slow) is skipped */ }
      }
      onProgress(`   selected ${added}/${job.civilIds.length} employees.`);
      if (added === 0) {
        onProgress(`   ⚠ No employees matched for "${job.label}" — skipping export.`);
        continue;
      }

      // Date range (whole selected month)
      await page.evaluate((from, to) => {
        const inp = document.querySelector('#date_range');
        if (inp && inp._flatpickr) inp._flatpickr.setDate([new Date(from), new Date(to)], true);
      }, dateFrom, dateTo);
      await new Promise(r => setTimeout(r, 600));

      // Export CSV then PDF, capturing each download
      for (const fmt of [{ label: 'CSV', ext: 'csv' }, { label: 'PDF', ext: 'pdf' }]) {
        const before = new Set(fs.readdirSync(downloadDir));
        await page.evaluate((lbl) => {
          const b = [...document.querySelectorAll('.download')].find(x => x.textContent.indexOf(lbl) > -1);
          if (b) b.click();
        }, fmt.label);
        onProgress(`   exporting ${fmt.label}…`);
        const file = await waitForDownload(downloadDir, before, 180000);
        if (file) {
          const dest = path.join(outputDir, `${safeName(job.label)}_${periodLabel}.${fmt.ext}`);
          fs.copyFileSync(path.join(downloadDir, file), dest);
          try { fs.unlinkSync(path.join(downloadDir, file)); } catch (e) {}
          saved.push(dest);
          onProgress(`   ✓ saved ${path.basename(dest)}`);
        } else {
          onProgress(`   ⚠ ${fmt.label} did not download for "${job.label}".`);
        }
      }
      } catch (jobErr) {
        onProgress(`   ⚠ Error on area "${job.label}": ${jobErr && jobErr.message ? jobErr.message : jobErr} — continuing.`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (e) {}
  }

  return saved;
}

module.exports = { runReports, parseExcel, buildJobs };
