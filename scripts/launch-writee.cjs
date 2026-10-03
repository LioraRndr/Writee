const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const url = 'http://localhost:5173/';
const identity = 'ed94e1e9-0d44-467a-a738-445a929ca50d';
const lockPath = path.join(os.tmpdir(), `writee-${identity}.lock`);
const noBrowser = process.argv.includes('--no-browser');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ready() {
  try {
    const response = await fetch(`${url}writee-launch.json`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const info = await response.json();
    return info.app === 'Writee' && info.id === identity;
  } catch { return false; }
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: 'localhost', port: 5173 });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(true));
  });
}

async function ensureServer() {
  if (await ready()) return;
  const deadline = Date.now() + 35000;
  let lock;
  while (lock === undefined) {
    try {
      lock = fs.openSync(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await ready()) return;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 60000) fs.unlinkSync(lockPath);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (Date.now() > deadline) throw new Error('Another Writee launch is still in progress. Please retry shortly.');
      await delay(300);
    }
  }
  try {
    if (await ready()) return;
    if (await portInUse()) throw new Error('Port 5173 is used by another application. No existing service was stopped.');
    const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(vite)) throw new Error('Dependencies are missing. Run npm install in the Writee project folder.');
    const out = fs.openSync(path.join(root, 'writee-server.log'), 'a');
    const err = fs.openSync(path.join(root, 'writee-server-error.log'), 'a');
    let spawnError;
    let exited = false;
    let server;
    try {
      server = spawn(process.execPath, [vite, '--host', 'localhost', '--port', '5173', '--strictPort', '--clearScreen', 'false'], {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, err],
      });
      server.once('error', (error) => { spawnError = error; });
      server.once('exit', () => { exited = true; });
      server.unref();
    } finally {
      fs.closeSync(out);
      fs.closeSync(err);
    }
    while (!(await ready())) {
      if (spawnError) throw spawnError;
      if (exited) throw new Error('Server startup failed. See writee-server-error.log.');
      if (Date.now() > deadline) throw new Error('Server startup timed out. See writee-server.log.');
      await delay(300);
    }
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

async function main() {
  await ensureServer();
  if (noBrowser) { console.log(`Writee ready: ${url}`); return; }
  const browser = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || os.homedir(), 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].find((file) => fs.existsSync(file));
  const child = browser
    ? spawn(browser, [`--app=${url}`], { detached: true, windowsHide: true, stdio: 'ignore' })
    : spawn('explorer.exe', [url], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.once('error', fail);
  child.unref();
}

function fail(error) {
  fs.appendFileSync(path.join(root, 'writee-launch-error.log'), `${new Date().toISOString()} ${error.stack || error}\n`, 'utf8');
  console.error(error.message);
  process.exitCode = 1;
}

main().catch(fail);
