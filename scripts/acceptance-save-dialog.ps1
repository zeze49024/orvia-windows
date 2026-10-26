param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
if ($env:CI -ne 'true' -or !$env:ORVIA_ACCEPTANCE_EXE) { throw 'Only allowed in the disposable CI acceptance fixture' }
$fixtureExe=[IO.Path]::GetFullPath($env:ORVIA_ACCEPTANCE_EXE)
$targetFile=[IO.Path]::GetFullPath($Target)
$workspaceRoot=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE).TrimEnd('\')+'\'
if (!$targetFile.StartsWith($workspaceRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Target is outside the acceptance workspace' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$deadline=[DateTime]::UtcNow.AddSeconds(40)
while ([DateTime]::UtcNow -lt $deadline) {
  $fixturePids=@(Get-Process -Name orvia -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $fixtureExe } | Select-Object -ExpandProperty Id)
  $windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.Condition]::TrueCondition)
  foreach ($dialog in $windows) {
    if ($fixturePids -notcontains $dialog.Current.ProcessId -or $dialog.Current.ClassName -ne '#32770') { continue }
    $edit=$dialog.FindFirst([Windows.Automation.TreeScope]::Descendants,([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'1001')))
    $save=$dialog.FindFirst([Windows.Automation.TreeScope]::Descendants,([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'1')))
    if ($null -eq $edit -or $null -eq $save) { continue }
    $value=$edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
    $value.SetValue($targetFile)
    $action=$save.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    $action.Invoke()
    Write-Output 'Native save dialog approved in the isolated acceptance fixture'
    exit 0
  }
  Start-Sleep -Milliseconds 200
}
throw 'Native save dialog not found'
