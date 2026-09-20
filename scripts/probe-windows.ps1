# Enumerate every top-level window of lumendeck.exe with rects and titles.
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

    public static string Run() {
        uint target = 0;
        foreach (var p in Process.GetProcessesByName("lumendeck")) { target = (uint)p.Id; break; }
        if (target == 0) return "lumendeck.exe NOT RUNNING";
        var sb = new StringBuilder();
        sb.AppendFormat("lumendeck pid={0}\n", target);
        EnumWindows((h, lp) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid == target) {
                RECT r; GetWindowRect(h, out r);
                var title = new StringBuilder(256);
                GetWindowTextW(h, title, 256);
                sb.AppendFormat("hwnd=0x{0:X} visible={1} title=\"{2}\" rect=({3},{4})-({5},{6}) {7}x{8}\n",
                    h.ToInt64(), IsWindowVisible(h), title, r.L, r.T, r.R, r.B, r.R - r.L, r.B - r.T);
            }
            return true;
        }, IntPtr.Zero);
        return sb.ToString();
    }
}
"@
[WinEnum]::Run()
