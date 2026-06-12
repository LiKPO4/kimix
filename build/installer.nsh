!macro customInit
  ; Older installers may not have written the KeepShortcuts marker. Seed it
  ; before the upgrade path invokes the old uninstaller, so desktop/start-menu
  ; shortcuts are preserved instead of being deleted and recreated.
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "KeepShortcuts" "true"
  SetRegView 64
  WriteRegStr HKLM "${INSTALL_REGISTRY_KEY}" "KeepShortcuts" "true"
  SetRegView lastused
  ClearErrors
!macroend
