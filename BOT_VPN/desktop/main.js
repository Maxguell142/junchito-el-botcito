const { app, BrowserWindow, dialog, safeStorage, utilityProcess } = require('electron');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { randomBytes } = require('crypto');
const { backup, DatabaseSync } = require('node:sqlite');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let backendProcess = null;
let backendExited = false;
let shuttingDown = false;
let appOrigin = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadUserEnvironment(userDataPath) {
  const envPath = path.join(userDataPath, '.env');
  if (!fs.existsSync(envPath)) return;

  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    throw new Error(`No se pudo leer la configuración local (${error.message}).`);
  }
}

async function copyDatabaseSafely(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(source, destinationPath);
  } finally {
    source.close();
  }
}

async function prepareDatabase(databasePath, userDataPath) {
  if (fs.existsSync(databasePath)) return;

  if (!app.isPackaged) {
    const developmentDatabase = path.join(app.getAppPath(), 'bot_vpn.sqlite3');
    if (fs.existsSync(developmentDatabase)) {
      await copyDatabaseSafely(developmentDatabase, databasePath);
    }
    return;
  }

  const choice = await dialog.showMessageBox({
    type: 'question',
    title: 'Primera ejecución de QUANTUM FX',
    message: '¿Querés importar tu base de datos actual?',
    detail: 'Podés elegir tu archivo bot_vpn.sqlite3. Si empezás vacía, la aplicación crea una base nueva en tu perfil de Windows.',
    buttons: ['Importar base existente', 'Empezar vacía'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });

  if (choice.response !== 0) return;

  const selected = await dialog.showOpenDialog({
    title: 'Seleccionar base de QUANTUM FX',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Base SQLite', extensions: ['sqlite3', 'sqlite', 'db'] }]
  });

  if (selected.canceled || !selected.filePaths[0]) {
    throw new Error('No se seleccionó la base. Volvé a abrir la aplicación para intentarlo otra vez.');
  }

  await copyDatabaseSafely(selected.filePaths[0], databasePath);
}

async function loadPiiEncryptionKey(userDataPath) {
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error('Windows no habilitó el cifrado local. No se puede abrir el registro de datos personales de forma segura.');
  }
  const keyPath = path.join(userDataPath, 'identity-data-key.dpapi');
  if (fs.existsSync(keyPath)) {
    const encrypted = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
    const { result } = await safeStorage.decryptStringAsync(encrypted);
    if (!/^[a-f0-9]{64}$/i.test(result)) throw new Error('La clave de cifrado local no es válida.');
    return result;
  }

  const key = randomBytes(32).toString('hex');
  const encrypted = await safeStorage.encryptStringAsync(key);
  fs.writeFileSync(keyPath, encrypted.toString('base64'), { flag: 'wx', mode: 0o600 });
  return key;
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForBackend(url) {
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    if (backendExited) {
      throw new Error('El servidor local terminó antes de quedar listo.');
    }

    try {
      const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
      await response.arrayBuffer();
      lastError = new Error(`El servidor respondió ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await sleep(300);
  }

  throw new Error(`El servidor local no respondió a tiempo${lastError ? ` (${lastError.message})` : ''}.`);
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: '#0D0D0D',
    title: 'QUANTUM FX',
    icon: path.join(app.getAppPath(), 'public', 'logo.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== appOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(url);
}

async function startDesktopApp() {
  const userDataPath = app.getPath('userData');
  fs.mkdirSync(userDataPath, { recursive: true });
  loadUserEnvironment(userDataPath);
  const piiEncryptionKey = await loadPiiEncryptionKey(userDataPath);

  const databasePath = process.env.BOT_VPN_DB_PATH || path.join(userDataPath, 'bot_vpn.sqlite3');
  await prepareDatabase(databasePath, userDataPath);

  const port = await findAvailablePort();
  const url = `http://127.0.0.1:${port}`;
  appOrigin = new URL(url).origin;
  const serverPath = path.join(app.getAppPath(), 'src', 'server', 'server.js');

  if (!fs.existsSync(serverPath)) {
    throw new Error('No se encontró el servidor de QUANTUM FX dentro de la aplicación.');
  }

  backendExited = false;
  backendProcess = utilityProcess.fork(serverPath, [], {
    cwd: userDataPath,
    env: {
      ...process.env,
      PORT: String(port),
      BOT_VPN_DB_PATH: databasePath,
      BOT_VPN_PII_ENCRYPTION_KEY: piiEncryptionKey
    },
    stdio: 'pipe',
    serviceName: 'QUANTUM FX Local Server'
  });

  let backendOutput = '';
  for (const stream of [backendProcess.stdout, backendProcess.stderr]) {
    stream?.on('data', chunk => {
      backendOutput = `${backendOutput}${chunk.toString()}`.slice(-5000);
    });
  }

  backendProcess.on('exit', code => {
    backendExited = true;
    backendProcess = null;
    if (!shuttingDown && mainWindow) {
      dialog.showErrorBox('QUANTUM FX se cerró', `El servidor local terminó (código ${code}).\n\n${backendOutput.slice(-1800)}`);
      app.quit();
    }
  });

  await waitForBackend(url);
  createMainWindow(url);
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => startDesktopApp()).catch(error => {
    dialog.showErrorBox('No se pudo iniciar QUANTUM FX', error.message);
    app.quit();
  });

  app.on('before-quit', event => {
    if (!backendProcess || backendExited || shuttingDown) return;

    event.preventDefault();
    shuttingDown = true;
    const child = backendProcess;
    const forceStop = setTimeout(() => child.kill(), 4000);
    forceStop.unref();
    child.once('exit', () => {
      clearTimeout(forceStop);
      backendProcess = null;
      app.quit();
    });
    child.postMessage({ type: 'shutdown' });
  });

  app.on('window-all-closed', () => app.quit());
}
