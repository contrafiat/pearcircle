' PearCircle Watcher - start the watcher with no console window.
'
' The Start Menu shortcut targets this file through wscript. The host opens
' the map in the default browser, and a second launch while it runs just
' reopens the page.

Option Explicit

Dim fso, shell, dir

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
shell.Run """" & dir & "\node.exe"" """ & dir & "\host-bundled.js""", 0, False
