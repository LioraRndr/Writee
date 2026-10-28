param([switch]$OpenSettings)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$binaryDirectory = Join-Path $PSScriptRoot 'bin'
$launcher = Join-Path $binaryDirectory 'Writee.exe'
$source = Join-Path $PSScriptRoot 'WriteeLauncher.cs'
$compiler = @('Framework64', 'Framework') | ForEach-Object {
  Join-Path $env:WINDIR ('Microsoft.NET\' + $_ + '\v4.0.30319\csc.exe')
} | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$compiler) { throw 'The Windows .NET Framework C# compiler was not found.' }
New-Item -ItemType Directory -Path $binaryDirectory -Force | Out-Null
& $compiler /nologo /target:winexe /codepage:65001 /reference:System.Windows.Forms.dll ("/win32icon:" + (Join-Path $projectRoot 'public\favicon.ico')) ("/out:" + $launcher) $source
if ($LASTEXITCODE -ne 0) { throw 'Writee launcher compilation failed.' }
$icon = (Join-Path $projectRoot 'public\favicon.ico') + ',0'
$command = '"' + $launcher + '" "%1"'

function Set-RegistryString([string]$Path, [string]$Name, [string]$Value) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Path)
  try { $key.SetValue($Name, $Value, [Microsoft.Win32.RegistryValueKind]::String) }
  finally { $key.Close() }
}

# 注册当前用户的候选应用，最终默认应用选择由 Windows 系统界面保存。
$class = 'Software\Classes\Writee.Markdown'
Set-RegistryString $class '' 'Markdown document - Writee'
Set-RegistryString $class 'FriendlyTypeName' 'Markdown document - Writee'
Set-RegistryString ($class + '\DefaultIcon') '' $icon
Set-RegistryString ($class + '\shell\open\command') '' $command
Set-RegistryString ($class + '\Application') 'ApplicationName' 'Writee'
Set-RegistryString ($class + '\Application') 'ApplicationIcon' $icon
$application = 'Software\Classes\Applications\Writee.exe'
Set-RegistryString $application 'FriendlyAppName' 'Writee'
Set-RegistryString ($application + '\DefaultIcon') '' $icon
Set-RegistryString ($application + '\shell\open\command') '' $command
Set-RegistryString 'Software\Microsoft\Windows\CurrentVersion\App Paths\Writee.exe' '' $launcher
$capabilities = 'Software\Writee\Capabilities'
Set-RegistryString $capabilities 'ApplicationName' 'Writee'
Set-RegistryString $capabilities 'ApplicationDescription' 'Writee Markdown editor'
Set-RegistryString $capabilities 'ApplicationIcon' $icon
foreach ($extension in @('.md', '.markdown', '.mdown')) {
  Set-RegistryString ($application + '\SupportedTypes') $extension ''
  Set-RegistryString ($capabilities + '\FileAssociations') $extension 'Writee.Markdown'
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\' + $extension + '\OpenWithProgids')
  try { $key.SetValue('Writee.Markdown', [byte[]]@(), [Microsoft.Win32.RegistryValueKind]::None) }
  finally { $key.Close() }
}
Set-RegistryString 'Software\RegisteredApplications' 'Writee' $capabilities
Add-Type -Namespace Writee -Name AssociationNotify -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shell32.dll")]
public static extern void SHChangeNotify(uint eventId, uint flags, System.IntPtr item1, System.IntPtr item2);
'@
[Writee.AssociationNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output 'Writee registered for .md, .markdown, .mdown.'
if ($OpenSettings) { Start-Process 'ms-settings:defaultapps?registeredAppUser=Writee' }
