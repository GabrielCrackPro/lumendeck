# Probe lumendeck windows parented under Progman / WorkerW (desktop layer),
# converting parent-relative rects to screen coordinates.
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public class ChildProbe {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lp);
    [DllImport("user32.dll")] public static extern IntPtr FindWindowW(string cls, string title);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

    static uint Target;
    static StringBuilder Out;

    static string ClassOf(IntPtr h) { var sb = new StringBuilder(256); GetClassNameW(h, sb, 256); return sb.ToString(); }
    static RECT ScreenRect(IntPtr h) {
        RECT r; GetWindowRect(h, out r);
        // Convert parent-relative to screen via the parent origin.
        IntPtr p = GetParent(h);
        if (p != IntPtr.Zero) {
            POINT o = new POINT { X = 0, Y = 0 };
            ScreenToClient(p, ref o);
            r.L += o.X; r.R += o.X; r.T += o.Y; r.B += o.Y;
        }
        return r;
    }

    static bool ChildCb(IntPtr h, IntPtr lp) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid == Target) {
            RECT r = ScreenRect(h);
            Out.AppendFormat("  child hwnd=0x{0:X} class=\"{1}\" screen=({2},{3})-({4},{5}) {6}x{7}\n",
                h.ToInt64(), ClassOf(h), r.L, r.T, r.R, r.B, r.R - r.L, r.B - r.T);
        }
        return true;
    }

    static bool TopCb(IntPtr h, IntPtr lp) {
        string cls = ClassOf(h);
        if (cls == "Progman" || cls == "WorkerW") {
            Out.AppendFormat("parent hwnd=0x{0:X} class={1}\n", h.ToInt64(), cls);
            EnumChildWindows(h, ChildCb, IntPtr.Zero);
        }
        return true;
    }

    public static string Run() {
        Target = 0;
        foreach (var p in Process.GetProcessesByName("lumendeck")) { Target = (uint)p.Id; break; }
        if (Target == 0) return "lumendeck.exe NOT RUNNING";
        Out = new StringBuilder();
        Out.AppendFormat("lumendeck pid={0}\n", Target);
        EnumWindows(TopCb, IntPtr.Zero);
        return Out.ToString();
    }
}
"@
[ChildProbe]::Run()
