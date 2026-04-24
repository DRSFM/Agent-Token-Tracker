Option Explicit

Dim shell, fso, scriptDir, projectDir, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)
command = "%ComSpec% /d /k cd /d " & Quote(projectDir) & " && set TOKEN_DASHBOARD_DEVTOOLS=1 && npm run dev"

shell.Run command, 1, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
