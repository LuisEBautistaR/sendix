; sendix:// for the current user. The app registers it again on every start
; (app.setAsDefaultProtocolClient); the installer does it too so a link from
; Mockix works before the first start, and the uninstaller removes it only if
; it still points to this installation.
;
; An update runs the previous version's uninstaller with --updated before the
; new files go in. That is not an uninstall, so the link stays: deleting it
; there left the protocol unregistered until the app was started again.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\sendix" "" "URL:sendix"
  WriteRegStr HKCU "Software\Classes\sendix" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\sendix\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Classes\sendix\shell\open\command" ""
    StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' 0 +2
      DeleteRegKey HKCU "Software\Classes\sendix"
  ${endIf}
!macroend
