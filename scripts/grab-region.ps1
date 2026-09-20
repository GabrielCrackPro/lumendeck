param([string]$OutFile = "sticker-zone.png", [int]$X = 1500, [int]$Y = -320, [int]$W = 560, [int]$H = 400)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class DFix3 { [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx); }
'@
$old = [DFix3]::SetThreadDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($W, $H)))
$g.Dispose()
$bmp.Save($OutFile)
[DFix3]::SetThreadDpiAwarenessContext($old) | Out-Null
Write-Output "saved $OutFile"
