<#
  Bring the WeChat window to the front / screenshot it / send keystrokes.
  Rule: keystrokes are only sent when the foreground window really belongs to
  the WeChat process - otherwise we bail out instead of pasting into some
  random window. Always screenshot before sending anything.
  (ASCII only: Windows PowerShell 5.1 reads .ps1 as ANSI, Chinese breaks it.)
#>
param(
  [ValidateSet('shot','full','crop','paste','enter','keys','info','focus','place','click','scroll')]
  [string]$Action = 'info',
  [string]$Out = 'shots-final/wechat.png'
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

# Without this the process sees a scaled, virtualised desktop and every
# coordinate we compute is wrong (that is why the window never moved).
[void][WinApi]::SetProcessDPIAware()

function Get-WeixinWindow {
  Get-Process Weixin -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

function Test-WeixinFocused {
  $fg = [WinApi]::GetForegroundWindow()
  $fgpid = 0
  [void][WinApi]::GetWindowThreadProcessId($fg, [ref]$fgpid)
  $w = Get-WeixinWindow
  if (-not $w) { return $false }
  return ($fgpid -eq $w.Id)
}

$proc = Get-WeixinWindow
if (-not $proc) { Write-Output 'NO_WECHAT_WINDOW'; exit 1 }
$h = $proc.MainWindowHandle

if ($Action -eq 'info') {
  Write-Output ('TITLE=' + $proc.MainWindowTitle)
  $r = New-Object WinApi+RECT
  [void][WinApi]::GetWindowRect($h, [ref]$r)
  Write-Output ('RECT=' + $r.Left + ',' + $r.Top + ',' + $r.Right + ',' + $r.Bottom)
  Write-Output ('MINIMIZED=' + [WinApi]::IsIconic($h))
  Write-Output ('FOCUSED=' + (Test-WeixinFocused))
  exit 0
}

if ([WinApi]::IsIconic($h)) { [void][WinApi]::ShowWindow($h, 9) }
[void][WinApi]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 500
if (-not (Test-WeixinFocused)) {
  try {
    $sh = New-Object -ComObject WScript.Shell
    [void]$sh.AppActivate($proc.Id)
  } catch { }
  Start-Sleep -Milliseconds 700
}

$focused = Test-WeixinFocused
$title = (Get-WeixinWindow).MainWindowTitle

if ($Action -eq 'focus') {
  Write-Output ('FOCUSED=' + $focused)
  Write-Output ('TITLE=' + $title)
  if (-not $focused) { exit 3 }
  exit 0
}

if ($Action -eq 'place') {
  # Move the window fully on screen so the message box (bottom of the window) is visible.
  # Coords here are in the same virtualised space GetWindowRect reports.
  $x = [int]$env:WX_X; $y = [int]$env:WX_Y; $w = [int]$env:WX_W; $h = [int]$env:WX_H
  [void][WinApi]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $h, 0x0040)
  Start-Sleep -Milliseconds 600
  $r = New-Object WinApi+RECT
  [void][WinApi]::GetWindowRect($proc.MainWindowHandle, [ref]$r)
  Write-Output ('RECT=' + $r.Left + ',' + $r.Top + ',' + $r.Right + ',' + $r.Bottom)
  exit 0
}

if ($Action -eq 'scroll') {
  # WX_CX/WX_CY = where to put the pointer, WX_WHEEL = notches (negative scrolls down)
  $cx = [int]$env:WX_CX; $cy = [int]$env:WX_CY; $n = [int]$env:WX_WHEEL
  [void][WinApi]::SetCursorPos($cx, $cy)
  Start-Sleep -Milliseconds 250
  $delta = -120
  if ($n -gt 0) { $delta = 120 }
  for ($i = 0; $i -lt [Math]::Abs($n); $i++) {
    [WinApi]::mouse_event(0x0800, 0, 0, [uint32]$delta, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
  }
  Start-Sleep -Milliseconds 400
  Write-Output ('SCROLLED=' + $n)
  exit 0
}

if ($Action -eq 'keys') {
  # WX_KEYS uses SendKeys syntax, e.g. "^a" then "{DEL}"
  [System.Windows.Forms.SendKeys]::SendWait($env:WX_KEYS)
  Start-Sleep -Milliseconds 700
  Write-Output ('KEYS=' + $env:WX_KEYS)
  exit 0
}

if ($Action -eq 'click') {
  $cx = [int]$env:WX_CX; $cy = [int]$env:WX_CY
  [void][WinApi]::SetCursorPos($cx, $cy)
  Start-Sleep -Milliseconds 200
  [WinApi]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [WinApi]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 500
  Write-Output ('CLICKED=' + $cx + ',' + $cy)
  exit 0
}

if ($Action -eq 'crop') {
  $cx = [int]$env:WX_L; $cy = [int]$env:WX_T; $cw = [int]$env:WX_W; $ch = [int]$env:WX_H
  $bmp = New-Object System.Drawing.Bitmap($cw, $ch)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($cx, $cy, 0, 0, $bmp.Size)
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $full = (Resolve-Path -LiteralPath $dir).Path + '\' + (Split-Path -Leaf $Out)
  $bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ('CROP=' + $cx + ',' + $cy + ' ' + $cw + 'x' + $ch)
  exit 0
}

if ($Action -eq 'full') {
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $full = (Resolve-Path -LiteralPath $dir).Path + '\' + (Split-Path -Leaf $Out)
  $bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ('SHOT=' + $Out)
  Write-Output ('SCREEN=' + $vs.Width + 'x' + $vs.Height)
  Write-Output ('FOCUSED=' + $focused)
  exit 0
}

if ($Action -eq 'shot') {
  $r = New-Object WinApi+RECT
  [void][WinApi]::GetWindowRect($h, [ref]$r)
  $w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap($w, $ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $full = (Resolve-Path -LiteralPath $dir).Path + '\' + (Split-Path -Leaf $Out)
  $bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ('SHOT=' + $Out)
  Write-Output ('TITLE=' + $title)
  Write-Output ('FOCUSED=' + $focused)
  exit 0
}

if (-not $focused) {
  Write-Output 'REFUSED_NOT_FOCUSED'
  Write-Output ('TITLE=' + $title)
  exit 2
}

if ($Action -eq 'paste') {
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 900
  Write-Output 'PASTED'
  exit 0
}

if ($Action -eq 'enter') {
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 900
  Write-Output 'ENTERED'
  exit 0
}
