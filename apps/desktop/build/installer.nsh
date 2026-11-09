!include "WinVer.nsh"
!include "x64.nsh"

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "SolidProps 需要 Windows 10 或 Windows 11（64 位）。当前系统版本过低，无法安装。"
    Quit
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "SolidProps 仅支持 64 位 Windows。"
    Quit
  ${EndIf}
!macroend
