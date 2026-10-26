param([Parameter(Mandatory=$true)][string]$Target,[ValidateSet('Save','Folder')][string]$Mode='Save')
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
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OrviaDialogMessages {
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
    foreach ($dialog in $dialogs) {
    if ($fixturePids -notcontains $dialog.Current.ProcessId) { continue }
    $edit=$dialog.FindFirst([Windows.Automation.TreeScope]::Descendants,([Windows.Automation.AndCondition]::new(([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,$filenameId)),([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Edit')))))
    $save=$dialog.FindFirst([Windows.Automation.TreeScope]::Descendants,([Windows.Automation.AndCondition]::new(([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'1')),([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Button')))))
    if ($null -eq $edit -or $null -eq $save) { continue }
    $editHandle=[IntPtr]$edit.Current.NativeWindowHandle
    $saveHandle=[IntPtr]$save.Current.NativeWindowHandle
    if ($editHandle -eq [IntPtr]::Zero -or $saveHandle -eq [IntPtr]::Zero) { continue }
    [void][OrviaDialogMessages]::SendMessage($editHandle,0x000C,[IntPtr]::Zero,$targetFile)
    [void][OrviaDialogMessages]::SendMessage($saveHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    Write-Output 'Native save dialog approved in the isolated acceptance fixture'
    exit 0
    }
  }
  Start-Sleep -Milliseconds 200
}
throw 'Native save dialog not found'
