# Inject a real WM_DISPLAYCHANGE into LumenDeck's display-watch window.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MsgSend {
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
}
"@

# Find the hidden display-watch window by title.
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FindWin {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    public static IntPtr Find(string needle) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, lp) => {
            var sb = new StringBuilder(256);
            GetWindowTextW(h, sb, 256);
            if (sb.ToString().Contains(needle)) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@

$hwnd = [FindWin]::Find("LumenDeck Display Watch")
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "display-watch window NOT found"; exit 1 }
[MsgSend]::SendMessage($hwnd, 0x007E, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Write-Output "WM_DISPLAYCHANGE sent to 0x$($hwnd.ToString('X'))"
