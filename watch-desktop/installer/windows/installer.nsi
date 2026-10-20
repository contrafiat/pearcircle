; PearCircle Watcher - Windows installer
;
; Compiled by watch-desktop/scripts/build-windows.sh. Expects:
;   - the install payload pre-staged in  payload/  beside this script
;   - the version passed as  makensis -DVERSION=<x.y.z>
;
; The first page asks whether to install for just this user (no admin
; rights, defaults to %LOCALAPPDATA%\Programs) or for everyone on the PC
; (admin prompt, defaults to Program Files). The next page lets the user
; change the folder. Either way it adds a Start Menu shortcut and an
; Add/Remove Programs entry. Nothing runs as a service. The watcher starts
; from the shortcut and quits a minute after its last browser tab closes.
; Its data folder is always the user's %LOCALAPPDATA%\PearCircle Watcher.

Unicode true
ManifestDPIAware true


!ifndef VERSION
  !define VERSION "0.0.0"
!endif

!define APP_NAME   "PearCircle Watcher"
!define APP_ID     "PearCircleWatcher"
!define PUBLISHER  "PeerLoom LLC"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_NAME}"
OutFile "PearCircleWatcher-Setup-${VERSION}.exe"

; MultiUser picks $INSTDIR, the registry hive (SHCTX) and the Start Menu
; (SetShellVarContext) from the chosen mode. An upgrade starts in the mode
; and folder of the existing install.
!define MULTIUSER_EXECUTIONLEVEL Highest
!define MULTIUSER_MUI
!define MULTIUSER_INSTALLMODE_COMMANDLINE
!define MULTIUSER_USE_PROGRAMFILES64
!define MULTIUSER_INSTALLMODE_INSTDIR "${APP_NAME}"
!define MULTIUSER_INSTALLMODE_INSTDIR_REGISTRY_KEY "${UNINST_KEY}"
!define MULTIUSER_INSTALLMODE_INSTDIR_REGISTRY_VALUENAME "InstallLocation"
!define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINST_KEY}"
!define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "InstallLocation"
!include "MultiUser.nsh"
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "FileVersion"     "${VERSION}"
VIAddVersionKey "ProductVersion"  "${VERSION}"
VIAddVersionKey "CompanyName"     "${PUBLISHER}"
VIAddVersionKey "LegalCopyright"  "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"

!define MUI_ICON   "payload/AppIcon.ico"
!define MUI_UNICON "payload/AppIcon.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MULTIUSER_PAGE_INSTALLMODE
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

; The uninstaller deletes $INSTDIR outright, so never install straight into
; a folder the user picked (e.g. C:\Tools). Always use a subfolder named
; after the app.
Function EnsureAppSubfolder
  StrCpy $0 $INSTDIR 1 -1
  StrCmp $0 "\" 0 +2
    StrCpy $INSTDIR $INSTDIR -1
  ${GetFileName} $INSTDIR $0
  StrCmp $0 "${APP_NAME}" +2
    StrCpy $INSTDIR "$INSTDIR\${APP_NAME}"
FunctionEnd

; The installer is 32-bit, so without SetRegView 64 the all-users entry
; lands under WOW6432Node. MULTIUSER_INIT overwrites $INSTDIR, so a /D=
; folder from the command line is put back afterwards.
Function .onInit
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
  StrCpy $R9 $INSTDIR
  !insertmacro MULTIUSER_INIT
  StrCmp $R9 "" +2
    StrCpy $INSTDIR $R9
FunctionEnd

Function un.onInit
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
  !insertmacro MULTIUSER_UNINIT
FunctionEnd

Function LaunchWatcher
  Exec 'wscript.exe "$INSTDIR\launch.vbs"'
FunctionEnd

!define MUI_FINISHPAGE_RUN ""
!define MUI_FINISHPAGE_RUN_TEXT "Open PearCircle Watcher"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchWatcher"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------

!macro StopWatcher
  ; A running watcher holds node.exe and bare.exe open. stop.ps1 stops only
  ; the copies started from this install folder.
  IfFileExists "$INSTDIR\stop.ps1" 0 +2
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\stop.ps1"'
  Sleep 1000
!macroend

Section "PearCircle Watcher" SecMain
  ; Here rather than on the folder page so a silent /D= install gets it too.
  Call EnsureAppSubfolder
  SetOutPath "$INSTDIR"
  File "payload/stop.ps1"
  !insertmacro StopWatcher
  File /r "payload/*"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "wscript.exe" '"$INSTDIR\launch.vbs"' "$INSTDIR\AppIcon.ico"

  WriteRegStr   SHCTX "${UNINST_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   SHCTX "${UNINST_KEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr   SHCTX "${UNINST_KEY}" "Publisher"       "${PUBLISHER}"
  WriteRegStr   SHCTX "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\AppIcon.ico"
  WriteRegStr   SHCTX "${UNINST_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr   SHCTX "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD SHCTX "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD SHCTX "${UNINST_KEY}" "NoRepair" 1
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  !insertmacro StopWatcher

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  DeleteRegKey SHCTX "${UNINST_KEY}"

  ; The data folder (%LOCALAPPDATA%\PearCircle Watcher) is left in place so
  ; a reinstall keeps the same watcher identity and circles.
  RMDir /r "$INSTDIR"
SectionEnd
