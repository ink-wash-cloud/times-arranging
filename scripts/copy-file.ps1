# Put the apk on the clipboard so it survives this process exiting.
# Clipboard.SetFileDropList alone uses delayed rendering owned by this process,
# so the file disappears the moment PowerShell quits - that is why the earlier
# copy looked fine and then pasted nothing. SetDataObject(..., $true) flushes it.
param([Parameter(Mandatory=$true)][string]$Path)
Add-Type -AssemblyName System.Windows.Forms
$full = (Resolve-Path -LiteralPath $Path).Path
$files = New-Object System.Collections.Specialized.StringCollection
[void]$files.Add($full)
$obj = New-Object System.Windows.Forms.DataObject
$obj.SetFileDropList($files)
[System.Windows.Forms.Clipboard]::SetDataObject($obj, $true)
$check = [System.Windows.Forms.Clipboard]::GetFileDropList()
Write-Output ('COPIED=' + $check.Count + ' FIRST=' + $check[0])
Write-Output ('EXISTS=' + (Test-Path $check[0]))
