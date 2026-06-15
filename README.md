# Time365 Report Tool (Desktop)

A small Windows desktop app that logs into **time365.moh.gov.kw**, generates the
**overtime summary report** (تقرير ملخص العمل الاضافي) for each area (or combined),
with the **civil-ID column** enabled and **decimal hours**, and exports **PDF + CSV**
to a folder you choose.

It runs entirely on your machine, so it uses your own (Kuwait) network connection —
no server, no tunnel, no proxy.

---

## What it does

1. You pick the Excel file (same layout as your sample: area in column **A**, plus a
   **الرقم المدني** column).
2. You choose the **month**, **year**, and **output mode**:
   - **لكل منطقة (per area)** – one PDF + one CSV per area.
   - **مجمّع (combined)** – one PDF + one CSV for everyone.
   - **الاثنان (both)** – per-area files *and* the combined pair.
3. It opens a real browser. The first time, you **log in yourself** (and clear any
   OTP/CAPTCHA). The session is remembered for next time.
4. It builds and exports each report and saves the files, then opens the folder.

---

## Prerequisites (one-time, on the Windows machine)

- **Node.js LTS** (v18 or newer): https://nodejs.org → download the Windows installer.
  After installing, open a new terminal and check: `node -v`.

## Build the installer (.exe)

From inside this folder:

```
npm install
npm run dist
```

- `npm install` downloads the dependencies.
- `npm run dist` produces the Windows installer in the **`dist/`** folder
  (e.g. `dist/Time365 Report Tool Setup 1.0.0.exe`). Double-click it to install.

> The browser engine (Chromium) is **downloaded automatically the first time you run
> the app** (needs internet once). That keeps the installer small.

## Run without building (for testing)

```
npm install
npm start
```

This opens the app window directly.

---

## Using the app

1. Launch **Time365 Report Tool**.
2. Click **اختيار…** and pick your Excel file.
3. Choose month / year (defaults to last month) and the output mode.
4. (Optional) change the save folder.
5. Click **إنشاء التقارير**.
6. When the browser window opens on the login page, **sign in**. The app waits for you,
   then continues automatically. Watch progress in the log box.
7. When it finishes, the output folder opens with your `Area_YYYY-MM.pdf` / `.csv` files.

---

## Portable version

`npm run dist` also produces `Time365-Report-Tool-Portable-<version>.exe` in `dist\` —
a single file that runs without installing (good for locked-down PCs). Note it does
**not** auto-update; to update a portable user, just share the new portable exe.

## Pushing updates to installed users (auto-update via GitHub)

The **installed** app (the `Setup .exe`) checks the project's **GitHub Releases** on
launch. When a new release is published, users get a popup —
**"تحديث جديد متوفر — تحديث الآن / لاحقًا"** — and clicking **تحديث الآن** installs it and
reopens. (The portable exe does not auto-update.)

> Auto-update reads **published Releases**, not branch commits. A GitHub Action builds
> the app and creates the Release automatically when you push a version tag.

### One-time setup

1. Create a **public** GitHub repo (e.g. `ideveloprs/time365-report-tool`).
2. In `package.json` → `build.publish`, set `owner` and `repo` to match your repo.
3. Push this project to the repo:
   ```
   git init
   git add .
   git commit -m "Initial version"
   git branch -M main
   git remote add origin https://github.com/<owner>/<repo>.git
   git push -u origin main
   ```
   (`node_modules` and `dist` are git-ignored.) The included
   `.github/workflows/release.yml` builds on GitHub's Windows runners, so you don't
   build locally for releases — and the long-path problem doesn't occur there.

### Each time you release an update

1. Bump `version` in `package.json` (e.g. `1.0.0` → `1.0.1`), commit, and push.
2. Tag it and push the tag (the tag must match the version, prefixed with `v`):
   ```
   git tag v1.0.1
   git push origin v1.0.1
   ```
3. The Action builds the Windows app and publishes Release **v1.0.1** with the installer
   + `latest.yml`. Watch it under the repo's **Actions** tab.
4. Done. Installed apps detect it within the hour (or on next launch); each user sees the
   update popup and clicks **تحديث الآن**.

> You only build locally (`npm run dist`, from a short path like `C:\t365`) to make the
> **first** installer to hand out. After that, releases come from the Action — just bump
> the version and push a tag.

---

## Notes & troubleshooting

- **Login is remembered.** Your session is stored under the app's data folder
  (`%APPDATA%/time365-report-tool/session`). You normally only log in once; if it asks
  again later, the session just expired.
- **No password is stored** by the app — you type it into the real portal yourself.
- **Excel layout**: the parser finds the header row containing `الرقم المدني`, reads
  civil IDs from that column, and reads the area from column **A** (filling down for
  merged cells). If your file differs, the area grouping may need a tweak.
- **An area exported nothing?** Usually means none of its civil IDs matched an employee
  in the portal, or the export was slow — the log lists which files were/weren't saved.
- **It only works from a network allowed to reach the portal.** Since this runs on your
  Kuwaiti machine, that's already satisfied (unlike a remote server).
- **Antivirus/SmartScreen** may warn on an unsigned installer. It's unsigned because we
  didn't buy a code-signing certificate; choose "More info → Run anyway", or sign it if
  you have a certificate.

---

## Project structure

```
time365-desktop/
├── package.json        # deps + electron-builder config
├── main.js             # Electron main process (window + IPC + run)
├── preload.js          # safe bridge to the renderer
├── renderer/
│   └── index.html      # the window UI (Arabic, RTL)
└── lib/
    ├── browser.js      # downloads the Chromium engine on first run
    └── automation.js   # Excel parsing + Puppeteer report automation
```
