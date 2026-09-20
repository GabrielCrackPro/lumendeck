Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class DpiFix {
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
# System.Drawing capture must be per-monitor aware to span the whole virtual desktop.
$old = [DpiFix]::SetThreadDpiAwarenessContext([IntPtr](-4))

Add-Type -AssemblyName System.Windows.Forms
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
Write-Output ("virtual-screen (per-monitor aware): ({0},{1}) {2}x{3}" -f $vs.X, $vs.Y, $vs.Width, $vs.Height)

$bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
$g.Dispose()

function Region-Avg($bmp, $x, $y, $w, $h, $vsX, $vsY) {
    $sx = $x - $vsX; $sy = $y - $vsY
    $sumR = 0; $sumG = 0; $sumB = 0; $n = 0
    for ($yy = $sy; $yy -lt $sy + $h; $yy += 4) {
        for ($xx = $sx; $xx -lt $sx + $w; $xx += 4) {
            if ($xx -lt 0 -or $yy -lt 0 -or $xx -ge $bmp.Width -or $yy -ge $bmp.Height) { continue }
            $c = $bmp.GetPixel($xx, $yy)
            $sumR += $c.R; $sumG += $c.G; $sumB += $c.B; $n++
        }
    }
    if ($n -eq 0) { return "OUT-OF-BOUNDS" }
    return "avg=({0},{1},{2}) n={3}" -f [int]($sumR/$n), [int]($sumG/$n), [int]($sumB/$n), $n
}

# Sticker at physical (1670,-143) 220x220 — bottom area of DISPLAY6 (211,-1080)-(2131,0)
Write-Output ("STICKER REGION (1670,-143): " + (Region-Avg $bmp 1670 -143 220 220 $vs.X $vs.Y))
Write-Output ("LEFT OF STICKER:            " + (Region-Avg $bmp 1300 -143 220 220 $vs.X $vs.Y))
Write-Output ("DISPLAY6 CENTER (1171,-540): " + (Region-Avg $bmp 1060 -650 220 220 $vs.X $vs.Y))
Write-Output ("PRIMARY CENTER (1280,800):  " + (Region-Avg $bmp 1200 700 220 220 $vs.X $vs.Y))

$bmp.Save("$env:TEMP\lumendeck-screen.png")
[DpiFix]::SetThreadDpiAwarenessContext($old) | Out-Null
Write-Output "saved: $env:TEMP\lumendeck-screen.png"
