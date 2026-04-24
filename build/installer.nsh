!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
Var DesktopShortcutCheckbox
Var ShouldCreateDesktopShortcut

!macro customInit
  StrCpy $ShouldCreateDesktopShortcut ${BST_CHECKED}
!macroend

!macro customPageAfterChangeDir
  Page custom DesktopShortcutPageCreate DesktopShortcutPageLeave
!macroend

Function DesktopShortcutPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 26u "Choose whether Agent Token Tracker should add a shortcut to your desktop."
  Pop $0

  ${NSD_CreateCheckbox} 0 34u 100% 14u "Create a desktop shortcut"
  Pop $DesktopShortcutCheckbox

  ${If} $ShouldCreateDesktopShortcut == ${BST_CHECKED}
    ${NSD_Check} $DesktopShortcutCheckbox
  ${Else}
    ${NSD_Uncheck} $DesktopShortcutCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $ShouldCreateDesktopShortcut
FunctionEnd

!macro customInstall
  ${If} $ShouldCreateDesktopShortcut != ${BST_CHECKED}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
!endif
