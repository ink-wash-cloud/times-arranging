# Put a plain text string on the clipboard (persist past this process).
param([Parameter(Mandatory=$true)][string]$Text)
Add-Type -AssemblyName System.Windows.Forms
$obj = New-Object System.Windows.Forms.DataObject
$obj.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $Text)
[System.Windows.Forms.Clipboard]::SetDataObject($obj, $true)
$back = [System.Windows.Forms.Clipboard]::GetText()
Write-Output ('COPIED_TEXT=' + $back)
