!macro NSIS_HOOK_POSTINSTALL
  ; Ask Shell to invalidate stale executable/shortcut icon caches after upgrades.
  ; No icon-cache files are deleted and Explorer is not restarted.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
