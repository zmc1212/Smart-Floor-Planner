$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WechatIdeWindowState {
 public delegate bool EnumProc(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 public struct RECT { public int Left,Top,Right,Bottom; }
}
'@
$taskIdeProcesses = @(Get-Process -Name '微信开发者工具' | Where-Object { $_.Path -eq 'D:\微信开发工具\微信web开发者工具\微信开发者工具.exe' } | Select-Object -ExpandProperty Id)
$taskWindows = [System.Collections.Generic.List[object]]::new()
$taskCallback = [WechatIdeWindowState+EnumProc]{ param($windowHandle, $enumParam)
  [uint32]$ownerProcess = 0
  [void][WechatIdeWindowState]::GetWindowThreadProcessId($windowHandle, [ref]$ownerProcess)
  if (($taskIdeProcesses -contains [int]$ownerProcess) -and [WechatIdeWindowState]::IsWindowVisible($windowHandle)) {
    $title = [System.Text.StringBuilder]::new(512)
    [void][WechatIdeWindowState]::GetWindowText($windowHandle, $title, 512)
    $bounds = [WechatIdeWindowState+RECT]::new()
    [void][WechatIdeWindowState]::GetWindowRect($windowHandle, [ref]$bounds)
    $taskWindows.Add([pscustomobject]@{Handle=$windowHandle.ToInt64();ProcessId=$ownerProcess;Title=$title.ToString();Bounds=$bounds})
  }
  return $true
}
[void][WechatIdeWindowState]::EnumWindows($taskCallback, [IntPtr]::Zero)
[pscustomobject]@{At=[DateTimeOffset]::UtcNow.ToString('o');Windows=@($taskWindows);Screens=@([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [pscustomobject]@{Primary=$_.Primary;Bounds=$_.Bounds} })} | ConvertTo-Json -Depth 5 -Compress
