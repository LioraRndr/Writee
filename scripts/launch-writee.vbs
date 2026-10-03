Option Explicit
Dim shell, fso, launcher, nodePath, result
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
launcher = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "launch-writee.cjs")
nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(nodePath) Then nodePath = "node.exe"
result = shell.Run(Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcher & Chr(34), 0, True)
If result <> 0 Then shell.Popup "Writee could not start. See writee-launch-error.log in the project folder.", 0, "Writee", 16
