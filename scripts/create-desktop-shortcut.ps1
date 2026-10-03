param([string]$Destination = [Environment]::GetFolderPath('Desktop'))

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$shortcutPath = Join-Path $Destination 'Writee.lnk'
if (Test-Path -LiteralPath $shortcutPath) { throw ('Shortcut already exists: ' + $shortcutPath) }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'launch-writee.vbs') + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = (Join-Path $projectRoot 'public\favicon.ico') + ',0'
$shortcut.Description = 'Writee - writing and revision'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output $shortcutPath
