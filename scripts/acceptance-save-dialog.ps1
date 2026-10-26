param([Parameter(Mandatory=$true)][string]$Target,[ValidateSet('Save','Folder','DenyAI')][string]$Mode='Save')
$ErrorActionPreference='Stop'
if ($env:CI -ne 'true' -or !$env:ORVIA_ACCEPTANCE_EXE) { throw 'Only allowed in the disposable CI acceptance fixture' }
$fixtureExe=[IO.Path]::GetFullPath($env:ORVIA_ACCEPTANCE_EXE)
$targetFile=[IO.Path]::GetFullPath($Target)
$workspaceRoot=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE).TrimEnd('\')+'\'
if (!$targetFile.StartsWith($workspaceRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Target is outside the acceptance workspace' }
if ($Mode -eq 'Folder' -and !(Test-Path -LiteralPath $targetFile -PathType Container)) { throw 'Folder fixture is missing' }
$filenameId=if ($Mode -eq 'Folder') {'1152'} else {'1001'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OrviaDialogMessages {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd,int cmd);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr wParam,string lParam);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr wParam,IntPtr lParam);
}
'@
$deadline=[DateTime]::UtcNow.AddSeconds(40)
while ([DateTime]::UtcNow -lt $deadline) {
  $fixturePids=@(Get-Process -Name orvia -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $fixtureExe } | Select-Object -ExpandProperty Id)
  $windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.Condition]::TrueCondition)
  foreach ($owner in $windows) {
    if ($fixturePids -notcontains $owner.Current.ProcessId) { continue }
    $dialogs=@($owner.FindAll([Windows.Automation.TreeScope]::Subtree,([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'#32770'))))
    if ($owner.Current.ClassName -eq '#32770') { $dialogs += $owner }
    foreach ($dialog in $dialogs) {
    if ($fixturePids -notcontains $dialog.Current.ProcessId) { continue }
    if ($Mode -eq 'DenyAI') {
      if (!$dialog.Current.Name.StartsWith('Orvia AI')) { continue }
      $cancelButton=$dialog.FindFirst([Windows.Automation.TreeScope]::Descendants,([Windows.Automation.AndCondition]::new(([Windows.Automation.OrCondition]::new(([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'2')),([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'CommandButton_2')))),([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)))))
      if ($null -eq $cancelButton) {
        # Legacy UIAutomation on Windows PowerShell may not expose TaskDialog's
        # virtual buttons. WM_CLOSE on this exact owned OkCancel dialog is Cancel.
        [void][OrviaDialogMessages]::SendMessage([IntPtr]$dialog.Current.NativeWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
        Write-Output 'Closed AI authorization without approval in the isolated fixture'
        exit 0
      }
      $cancelPattern=$null
      if ($cancelButton.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$cancelPattern)) { $cancelPattern.Invoke() }
      else { [void][OrviaDialogMessages]::SendMessage([IntPtr]$cancelButton.Current.NativeWindowHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero) }
      Write-Output 'Denied AI authorization in the isolated acceptance fixture; no provider inference allowed'
      exit 0
    }
    $edit=$dialog.FindFirst([Windows.Automation.TreeScope]::Descendants,([Windows.Automation.AndCondition]::new(([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,$filenameId)),([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Edit')))))
    $save=$dialog.FindFirst([Windows.Automation.TreeScope]::Descendants,([Windows.Automation.AndCondition]::new(([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'1')),([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Button')))))
    if ($null -eq $edit -or $null -eq $save) { continue }
    $editHandle=[IntPtr]$edit.Current.NativeWindowHandle
    $saveHandle=[IntPtr]$save.Current.NativeWindowHandle
    if ($editHandle -eq [IntPtr]::Zero -or $saveHandle -eq [IntPtr]::Zero) { continue }
    $dialogHandle=[IntPtr]$dialog.Current.NativeWindowHandle
    [void][OrviaDialogMessages]::ShowWindow($dialogHandle,5)
    [void][OrviaDialogMessages]::SetForegroundWindow($dialogHandle)
    try { $edit.SetFocus() } catch {}
    $valuePattern=$null
    if ($edit.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$valuePattern)) { $valuePattern.SetValue($targetFile) }
    else { [void][OrviaDialogMessages]::SendMessage($editHandle,0x000C,[IntPtr]::Zero,$targetFile) }
    Start-Sleep -Milliseconds 250
    if ($Mode -in @('Save','Folder')) {
      if ([OrviaDialogMessages]::GetForegroundWindow() -ne $dialogHandle) { throw 'Owned save dialog could not receive keyboard input' }
      if ($targetFile.IndexOfAny('+^%~(){}[]'.ToCharArray()) -ge 0) { throw 'Unsupported keyboard characters in isolated fixture path' }
      [Windows.Forms.SendKeys]::SendWait($(if($Mode -eq 'Save'){'%n'}else{'%d'}))
      [Windows.Forms.SendKeys]::SendWait('^a')
      [Windows.Forms.SendKeys]::SendWait($targetFile)
      [Windows.Forms.SendKeys]::SendWait($(if($Mode -eq 'Save'){'{TAB}'}else{'{ENTER}'}))
      Start-Sleep -Milliseconds 500
    }
    try { $save.SetFocus() } catch {}
    $invokePattern=$null
    if ($save.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$invokePattern)) { $invokePattern.Invoke() }
    else { [void][OrviaDialogMessages]::SendMessage($saveHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero) }
    $closeDeadline=[DateTime]::UtcNow.AddSeconds(10)
    while ([OrviaDialogMessages]::IsWindowVisible($dialogHandle) -and [DateTime]::UtcNow -lt $closeDeadline) { Start-Sleep -Milliseconds 100 }
    if ([OrviaDialogMessages]::IsWindowVisible($dialogHandle)) { throw 'Owned native dialog did not accept the fixture target' }
    Write-Output 'Native save dialog approved in the isolated acceptance fixture'
    exit 0
    }
  }
  Start-Sleep -Milliseconds 200
}
throw 'Native save dialog not found'
