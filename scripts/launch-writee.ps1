param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appUrl = 'http://localhost:5173/'
$identity = 'ed94e1e9-0d44-467a-a738-445a929ca50d'
$launchLock = [Threading.Mutex]::new($false, 'Local\Writee-ed94e1e9-launch')
$lockHeld = $false

function Test-WriteeReady {
    try {
        $response = Invoke-RestMethod -Uri ($appUrl + 'writee-launch.json') -TimeoutSec 2
        return ($response.app -eq 'Writee' -and $response.id -eq $identity)
    } catch {
        return $false
    }
}

function Test-PortInUse {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $pending = $client.BeginConnect('localhost', 5173, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(1000)) { return $false }
        $client.EndConnect($pending)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

try {
    try { $lockHeld = $launchLock.WaitOne(35000) }
    catch [Threading.AbandonedMutexException] { $lockHeld = $true }
    if (-not $lockHeld) { throw 'Another Writee launch is still in progress. Please retry shortly.' }

    if (-not (Test-WriteeReady)) {
        if (Test-PortInUse) { throw 'Port 5173 is used by another application. Writee did not stop or replace it.' }
        $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
        $vitePath = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
        if (-not (Test-Path -LiteralPath $vitePath)) { throw 'Writee dependencies are missing. Run npm install in the project folder first.' }
        $server = Start-Process -FilePath $nodePath -ArgumentList @(
            ('"' + $vitePath + '"'), '--host', 'localhost', '--port', '5173', '--strictPort', '--clearScreen', 'false'
        ) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $projectRoot 'writee-server.log') `
            -RedirectStandardError (Join-Path $projectRoot 'writee-server-error.log')
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while (-not (Test-WriteeReady)) {
            if ($server.HasExited) { throw 'Writee server could not start. See writee-server-error.log in the project folder.' }
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Writee took too long to start. See writee-server.log in the project folder.' }
            Start-Sleep -Milliseconds 300
        }
    }
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Writee', 'OK', 'Error')
    exit 1
} finally {
    if ($lockHeld) { $launchLock.ReleaseMutex() }
    $launchLock.Dispose()
}

if ($NoBrowser) {
    Write-Output ('Writee ready: ' + $appUrl)
    exit 0
}

$browserPaths = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$browserPath = $browserPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($browserPath) {
    Start-Process -FilePath $browserPath -ArgumentList ('--app=' + $appUrl)
} else {
    Start-Process $appUrl
}
