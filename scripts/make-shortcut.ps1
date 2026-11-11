# Puts a "Job Tracker" shortcut with the app's icon on the desktop (the real Desktop folder, OneDrive included).
# It runs start.bat, which starts the app if needed and opens it in the browser.
# Run by setup.bat, or on its own:  npm run shortcut
param(
  # Another folder instead of the desktop (used for testing).
  [string]$Folder = [Environment]::GetFolderPath('Desktop'),
  [string]$Name = 'Job Tracker'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$link = Join-Path $Folder "$Name.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = Join-Path $repo 'start.bat'
$shortcut.WorkingDirectory = $repo
$shortcut.IconLocation = (Join-Path $repo 'public\app.ico') + ',0'
# Minimized: the console only shows on the taskbar while the app starts.
$shortcut.WindowStyle = 7
$shortcut.Description = 'Open the Job Tracker'
$shortcut.Save()
Write-Host "Shortcut created: $link"
