const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { runReports } = require('./lib/automation');

function credFile() { return path.join(app.getPath('userData'), 'credentials.json'); }

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 640,
    minHeight: 560,
    title: 'Time365 Report Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ---- Auto-update -----------------------------------------------------------
// Checks the update server on launch. If a newer version exists it downloads it
// silently, then asks the user to install it. Disabled automatically in dev.
function setupAutoUpdate() {
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-downloaded', (info) => {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        buttons: ['تحديث الآن', 'لاحقًا'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'تحديث جديد متوفر',
        message: `يتوفر إصدار جديد (${info.version}).`,
        detail: 'سيتم إغلاق التطبيق وتثبيت التحديث ثم إعادة فتحه.'
      });
      if (choice === 0) {
        setImmediate(() => autoUpdater.quitAndInstall());
      }
    });

    // Stay quiet on errors (e.g. offline, server unreachable) — don't nag the user.
    autoUpdater.on('error', () => {});

    // Check shortly after launch, and then once an hour while the app is open.
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 3000);
    setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 60 * 60 * 1000);
  } catch (e) {
    // electron-updater throws in unpackaged/dev mode — ignore.
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC -------------------------------------------------------------------

ipcMain.handle('select-excel', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select the Excel file',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }]
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('select-output', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select the output folder',
    properties: ['openDirectory', 'createDirectory']
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('default-output', async () => {
  return path.join(app.getPath('documents'), 'Time365Reports');
});

ipcMain.handle('load-credentials', async () => {
  try {
    const data = JSON.parse(fs.readFileSync(credFile(), 'utf8'));
    let password = '';
    if (data.enc && safeStorage.isEncryptionAvailable()) {
      password = safeStorage.decryptString(Buffer.from(data.enc, 'base64'));
    } else if (data.password) {
      password = data.password; // plaintext fallback (older save / no OS encryption)
    }
    return { username: data.username || '', password };
  } catch (e) {
    return null;
  }
});

ipcMain.handle('save-credentials', async (_e, { username, password, remember }) => {
  try {
    if (!remember) {
      try { fs.unlinkSync(credFile()); } catch (_) {}
      return { ok: true };
    }
    const data = { username: username || '' };
    if (password) {
      if (safeStorage.isEncryptionAvailable()) {
        data.enc = safeStorage.encryptString(password).toString('base64'); // Windows DPAPI
      } else {
        data.password = password; // fallback if OS encryption isn't available
      }
    }
    fs.writeFileSync(credFile(), JSON.stringify(data), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('run', async (event, params) => {
  const send = (msg) => event.sender.send('progress', msg);
  const userDataDir = path.join(app.getPath('userData'), 'session');
  const cacheDir = path.join(app.getPath('userData'), 'browser');
  try {
    const saved = await runReports({
      excelPath: params.excelPath,
      year: params.year,
      month: params.month,
      outputMode: params.outputMode,
      outputDir: params.outputDir,
      username: params.username,
      password: params.password,
      onProgress: send,
      userDataDir,
      cacheDir
    });
    if (saved.length) {
      send(`Done. ${saved.length} file(s) saved.`);
      shell.openPath(params.outputDir);
    } else {
      send('Finished, but no files were produced. Check the messages above.');
    }
    return { ok: true, saved };
  } catch (err) {
    send('ERROR: ' + (err && err.message ? err.message : String(err)));
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});
