const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, dialog, shell } = require('electron')
const { registerFile } = require('../scripts/local-files.cjs')
const { createLaunchQueue } = require('../scripts/local-launch.cjs')
const { startDesktopServer } = require('./server.cjs')

const origin = 'http://127.0.0.1:5183'
const pendingPaths = []
let mainWindow = null
let launchQueue = null
let server = null

function markdownArguments(argv, workingDirectory) {
  return argv.filter((value) => !value.startsWith('-') && /\.(md|markdown|mdown)$/i.test(value))
    .map((value) => path.resolve(workingDirectory, value))
}

function focusWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function openFiles(files) {
  if (!launchQueue) {
    pendingPaths.push(...files)
    return
  }
  for (const file of files) {
    try {
      launchQueue.enqueue(registerFile(file))
    } catch (error) {
      dialog.showErrorBox('Writee 未能打开文件', `${file}\n\n${error.message}`)
    }
  }
  if (!mainWindow) createWindow()
  else focusWindow()
}

async function showFileDialog(action, suggestedName) {
  if (!mainWindow) return null
  const filters = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] }]
  if (action === 'open') {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    const capability = registerFile(file)
    return { kind: 'file', name: path.basename(file), path: file, localKey: capability.key, token: capability.token }
  }
  if (action === 'save' && typeof suggestedName === 'string') {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.basename(suggestedName),
      filters,
    })
    if (result.canceled || !result.filePath) return null
    const file = result.filePath
    if (!/\.(md|markdown|mdown)$/i.test(file)) throw new Error('请使用 .md、.markdown 或 .mdown 扩展名')
    try {
      fs.writeFileSync(file, '', { flag: 'wx' })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    const capability = registerFile(file)
    return { kind: 'file', name: path.basename(file), path: file, localKey: capability.key, token: capability.token }
  }
  throw new Error('不支持的文件对话框')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Writee',
    backgroundColor: '#f5f0e6',
    icon: path.join(__dirname, '../public/writee-logo.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin + '/')) return
    event.preventDefault()
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
  })
  void mainWindow.loadURL(origin + '/')
  return mainWindow
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    openFiles(markdownArguments(argv, workingDirectory))
    focusWindow()
  })
  app.on('open-file', (event, file) => {
    event.preventDefault()
    openFiles([file])
  })
  app.on('activate', () => {
    if (app.isReady() && !mainWindow) createWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => server?.close())
  void app.whenReady().then(async () => {
    launchQueue = createLaunchQueue(path.join(app.getPath('userData'), 'launch-queue'))
    server = await startDesktopServer({
      root: path.join(__dirname, '../dist'),
      origin,
      launchQueue,
      showFileDialog,
    })
    createWindow()
    const initial = markdownArguments(process.argv, process.cwd())
    openFiles([...pendingPaths.splice(0), ...initial])
  }).catch((error) => {
    dialog.showErrorBox('Writee 启动失败', error.message)
    app.quit()
  })
}
