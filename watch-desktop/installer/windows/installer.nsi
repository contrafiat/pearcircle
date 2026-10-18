; PearCircle Watcher - Windows installer
;
; Compiled by watch-desktop/scripts/build-windows.sh. Expects:
;   - the install payload pre-staged in  payload/  beside this script
;   - the version passed as  makensis -DVERSION=<x.y.z>
;
; A per-user install, so it needs no admin rights: the payload goes under
; %LOCALAPPDATA%\Programs, with a Start Menu shortcut and an Add/Remove
; Programs entry. Nothing runs as a service. The watcher starts from the
; shortcut and quits a minute after its last browser tab closes.

Unicode true
ManifestDPIAware true

!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif

!define APP_NAME   "PearCircle Watcher"
!define APP_ID     "PearCircleWatcher"
!define PUBLISHER  "PeerLoom LLC"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_NAME}"
OutFile "PearCircleWatcher-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel user
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
!insertmacro MUI_PAGE_INSTFILES

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
  SetOutPath "$INSTDIR"
  File "payload/stop.ps1"
  !insertmacro StopWatcher
  File /r "payload/*"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "wscript.exe" '"$INSTDIR\launch.vbs"' "$INSTDIR\AppIcon.ico"

  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher"       "${PUBLISHER}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\AppIcon.ico"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  !insertmacro StopWatcher

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"

  ; The data folder (%LOCALAPPDATA%\PearCircle Watcher) is left in place so
  ; a reinstall keeps the same watcher identity and circles.
  RMDir /r "$INSTDIR"
SectionEnd
