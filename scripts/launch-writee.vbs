Option Explicit
Dim shell, fso, launcher, nodePath, result, command, arg
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
launcher = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "launch-writee.cjs")
nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(nodePath) Then nodePath = "node.exe"
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcher & Chr(34)
For Each arg In WScript.Arguments
  command = command & " " & Chr(34) & arg & Chr(34)
Next
result = shell.Run(command, 0, True)
If result <> 0 Then shell.Popup "Writee could not start. See writee-launch-error.log in the project folder.", 0, "Writee", 16
