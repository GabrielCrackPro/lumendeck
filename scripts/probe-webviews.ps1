param()
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public class MProbe4 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int L, T, R, B; }
}
'@
$out = New-Object System.Collections.ArrayList
$cb = [MProbe4+EnumProc]{ param($h, $lp)
  $sb = New-Object System.Text.StringBuilder 256
  [void][MProbe4]::GetClassName($h, $sb, 256)
  $cn = $sb.ToString()
  if ($cn -like '*Chrome*' -or $cn -like '*WebView*' -or $cn -like 'WindowsForms*') {
    $r = New-Object MProbe4+RECT
    [void][MProbe4]::GetWindowRect($h, [ref]$r)
    $tb = New-Object System.Text.StringBuilder 256
    [void][MProbe4]::GetWindowText($h, $tb, 256)
    [void]$out.Add("class=$cn vis=$([MProbe4]::IsWindowVisible($h)) rect=($($r.L),$($r.T) $($r.R-$r.L)x$($r.B-$r.T)) title='$($tb.ToString())'")
  }
  return $true
}
[void][MProbe4]::EnumWindows($cb, [IntPtr]::Zero)
$out
