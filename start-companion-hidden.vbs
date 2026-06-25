' KQF Draft Tool companion — launches it HIDDEN (no console window).
' A shortcut to this file lives in the Windows Startup folder so the companion
' auto-runs every time you log in. To DISABLE: delete "KQF Draft Tool (auto-start)"
' from your Startup folder (Win+R -> shell:startup).
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Program Files\nodejs\node.exe"" ""C:\Users\adaml\.claude\CCLOL\companion.js""", 0, False
