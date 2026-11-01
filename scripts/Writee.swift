import AppKit

// Finder 文件事件通过参数数组传给 Node，不拼接 shell 命令。
final class WriteeDelegate: NSObject, NSApplicationDelegate {
  private var receivedFiles = false
  private var requests: [[URL]] = []
  private var task: Process?
  private var idleTimer: Timer?
  private let folder = Bundle.main.bundleURL.resolvingSymlinksInPath().deletingLastPathComponent()

  func applicationDidFinishLaunching(_ notification: Notification) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
      if !self.receivedFiles { self.enqueue([]) }
    }
  }

  func application(_ application: NSApplication, open urls: [URL]) {
    receivedFiles = true
    enqueue(urls)
  }

  private func enqueue(_ urls: [URL]) {
    idleTimer?.invalidate()
    requests.append(urls)
    runNext()
  }

  private func runNext() {
    guard task == nil else { return }
    guard !requests.isEmpty else {
      idleTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { _ in NSApp.terminate(nil) }
      return
    }
    let urls = requests.removeFirst()
    let candidates = [
      "/Users/render/.local/share/fnm/node-versions/v24.16.0/installation/bin/node",
      "/opt/homebrew/opt/node@24/bin/node", "/opt/homebrew/opt/node@22/bin/node"
    ]
    guard let node = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
      fail("未找到 Node.js。请使用同目录的“启动 Writee.command”检查运行环境。")
      return
    }
    do {
      let runtime = folder.appendingPathComponent(".mac-runtime")
      try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: true)
      let logURL = runtime.appendingPathComponent("app.log")
      if !FileManager.default.fileExists(atPath: logURL.path) {
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
      }
      let log = try FileHandle(forWritingTo: logURL)
      try log.seekToEnd()
      let process = Process()
      process.executableURL = URL(fileURLWithPath: node)
      process.currentDirectoryURL = folder
      process.arguments = [folder.appendingPathComponent("scripts/launch-mac.cjs").path, "--background"] + urls.flatMap { ["--file", $0.path] }
      var environment = ProcessInfo.processInfo.environment
      environment["PATH"] = URL(fileURLWithPath: node).deletingLastPathComponent().path + ":/usr/bin:/bin:/usr/sbin:/sbin"
      process.environment = environment
      process.standardOutput = log
      process.standardError = log
      process.terminationHandler = { result in
        try? log.close()
        DispatchQueue.main.async {
          self.task = nil
          if result.terminationStatus != 0 {
            let text = (try? String(contentsOf: logURL, encoding: .utf8)) ?? ""
            self.fail("启动失败。\n\(String(text.suffix(1800)))\n\n日志：\(logURL.path)")
          } else { self.runNext() }
        }
      }
      task = process
      try process.run()
    } catch {
      task = nil
      fail(error.localizedDescription)
    }
  }

  private func fail(_ message: String) {
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "Writee 未能打开文件"
    alert.informativeText = message
    alert.addButton(withTitle: "好")
    alert.runModal()
    NSApp.terminate(nil)
  }
}

let app = NSApplication.shared
let delegate = WriteeDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
