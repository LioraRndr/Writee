param([string]$IconPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'public\favicon.ico'))

$ErrorActionPreference = 'Stop'

# 浏览器应用窗口会放大小尺寸 favicon；为 Windows 单独提供原生尺寸的 ICO。
# 在窗口存续期间保留图标句柄，刷新页面或改变显示缩放时重新设置；无界面运行。
try {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class WriteeWindowIcons {
    delegate bool EnumProc(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr state);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int index, uint dpi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    static List<IntPtr> FindWindows() {
        var windows = new List<IntPtr>();
        EnumWindows(delegate(IntPtr window, IntPtr state) {
            var text = new StringBuilder(256);
            GetWindowText(window, text, text.Capacity);
            if (text.ToString() != "Writee \u00b7 \u5199\u4f5c") return true;
            GetClassName(window, text, text.Capacity);
            if (text.ToString() != "Chrome_WidgetWin_1") return true;
            uint pid;
            GetWindowThreadProcessId(window, out pid);
            try {
                using (var process = Process.GetProcessById((int)pid)) {
                    if (process.ProcessName != "chrome" && process.ProcessName != "msedge") return true;
                }
            } catch (ArgumentException) { return true; }
            windows.Add(window);
            return true;
        }, IntPtr.Zero);
        return windows;
    }

    public static void Run(string iconPath) {
        using (var mutex = new Mutex(false, "Local\\Writee-window-icons-ed94e1e9")) {
            bool held;
            try { held = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { held = true; }
            if (!held) return;
            var icons = new Dictionary<string, IntPtr>();
            var lastSeen = DateTime.UtcNow;
            bool seenWindow = false;
            try {
                for (;;) {
                    var windows = FindWindows();
                    if (windows.Count > 0) { lastSeen = DateTime.UtcNow; seenWindow = true; }
                    else if ((DateTime.UtcNow - lastSeen).TotalSeconds > (seenWindow ? 5 : 30)) break;
                    foreach (var window in windows) {
                        var dpi = GetDpiForWindow(window);
                        if (dpi == 0) continue;
                        for (int kind = 0; kind <= 1; kind++) {
                            int width = GetSystemMetricsForDpi(kind == 0 ? 49 : 11, dpi);
                            int height = GetSystemMetricsForDpi(kind == 0 ? 50 : 12, dpi);
                            string key = width + "x" + height;
                            IntPtr icon;
                            if (!icons.TryGetValue(key, out icon)) {
                                icon = LoadImage(IntPtr.Zero, iconPath, 1, width, height, 0x10);
                                if (icon == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                                icons.Add(key, icon);
                            }
                            IntPtr current;
                            if (SendMessageTimeout(window, 0x7F, (IntPtr)kind, IntPtr.Zero, 2, 100, out current) == IntPtr.Zero) continue;
                            if (current != icon) {
                                IntPtr previous;
                                SendMessageTimeout(window, 0x80, (IntPtr)kind, icon, 2, 100, out previous);
                            }
                        }
                    }
                    Thread.Sleep(1000);
                }
            } finally {
                foreach (var icon in icons.Values) DestroyIcon(icon);
                mutex.ReleaseMutex();
            }
        }
    }
}
'@
    [WriteeWindowIcons]::Run($IconPath)
} catch {
    $logPath = Join-Path (Split-Path -Parent (Split-Path -Parent $IconPath)) 'writee-icon-error.log'
    [IO.File]::AppendAllText($logPath, ([DateTime]::UtcNow.ToString('o') + ' ' + $_.Exception.Message + "`n"), [Text.Encoding]::UTF8)
    exit 1
}
