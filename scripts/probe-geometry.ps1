# Probe LumenDeck wallpaper window geometry vs monitor bounds (DPI-aware).
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class GeoProbe {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfoW(IntPtr h, ref MONITORINFO mi);
    [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int i);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }

    public static string Run() {
        var sb = new StringBuilder();
        EnumWindows((h, lp) => {
            var title = new StringBuilder(256);
            GetWindowTextW(h, title, 256);
            if (title.ToString().Contains("LumenDeck Wallpaper")) {
                RECT r; GetWindowRect(h, out r);
                MONITORINFO mi = new MONITORINFO();
                mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                IntPtr hmon = MonitorFromWindow(h, 2 /* MONITOR_DEFAULTTONEAREST */);
                GetMonitorInfoW(hmon, ref mi);
                sb.AppendFormat("hwnd=0x{0:X}\n  window  : L={1} T={2} R={3} B={4}  ({5}x{6})\n  monitor : L={7} T={8} R={9} B={10}  ({11}x{12})\n  delta   : top={13} left={14} right={15} bottom={16}\n  exStyle : 0x{17:X}\n",
                    h.ToInt64(), r.L, r.T, r.R, r.B, r.R - r.L, r.B - r.T,
                    mi.rcMonitor.L, mi.rcMonitor.T, mi.rcMonitor.R, mi.rcMonitor.B,
                    mi.rcMonitor.R - mi.rcMonitor.L, mi.rcMonitor.B - mi.rcMonitor.T,
                    r.T - mi.rcMonitor.T, r.L - mi.rcMonitor.L,
                    mi.rcMonitor.R - r.R, mi.rcMonitor.B - r.B,
                    (long)GetWindowLongW(h, -20));
            }
            return true;
        }, IntPtr.Zero);
        return sb.Length == 0 ? "NO WALLPAPER WINDOWS FOUND" : sb.ToString();
    }
}
"@
[GeoProbe]::Run()
