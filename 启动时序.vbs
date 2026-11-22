' ============================================================
'  ShiXu launcher
'  Starts the local sync server silently (only if it is not
'  already running) and opens the app in a standalone app
'  window -- no address bar, no tabs, looks like a native app.
'
'  The server started this way follows the page: the app pings
'  /api/here every 10s and beacons /api/bye when the window
'  closes, so the server shuts itself down shortly after the
'  app is closed instead of lingering in the background.
'
'  Just double-click this file, or use the desktop shortcut
'  created by:  npm run app
'
'  ASCII only on purpose: Windows Script Host reads .vbs with
'  the system ANSI codepage, so Chinese text here would show
'  up as garbage on some machines.
' ============================================================
Option Explicit

Dim fso, sh, root, url, browser, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
url  = "http://localhost:8787"
sh.CurrentDirectory = root

' ---------- 1. is the sync server already up? ----------
If Not ServerAlive(url) Then
  ' 0 = hidden window, False = do not wait for it to finish.
  ' SHIXU_AUTO_EXIT=1 -> the server exits once the page is gone.
  ' Note the quotes around the assignment: without them cmd would
  ' put the trailing space into the value and the flag would never match.
  sh.Run "cmd /c set ""SHIXU_AUTO_EXIT=1"" && npm start", 0, False
  For i = 1 To 60                 ' give it up to ~30 seconds
    WScript.Sleep 500
    If ServerAlive(url) Then Exit For
  Next
End If

If Not ServerAlive(url) Then
  MsgBox "Could not start the ShiXu server." & vbCrLf & vbCrLf & _
         "Open a terminal in:" & vbCrLf & root & vbCrLf & vbCrLf & _
         "and run:  npm start", 16, "ShiXu"
  WScript.Quit 1
End If

' ---------- 2. open the app window ----------
browser = FindBrowser(fso)
If browser = "" Then
  sh.Run url, 1, False            ' no Chromium browser: fall back to default browser
Else
  sh.Run """" & browser & """ --app=" & url & " --window-size=1500,960", 1, False
End If

' ============================================================
Function ServerAlive(u)
  Dim http
  ServerAlive = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", u & "/api/health", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ServerAlive = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

Function FindBrowser(f)
  Dim list, p
  list = Array( _
    "C:\Program Files\Google\Chrome\Application\chrome.exe", _
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe", _
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", _
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe" )
  FindBrowser = ""
  For Each p In list
    If f.FileExists(p) Then
      FindBrowser = p
      Exit Function
    End If
  Next
End Function
