; Kirari 扩展包 · 中文语音合成（AISHELL3）
;
; 这是一个**独立安装包**：它只往数据根里放一个扩展包目录，不碰桌宠本体。
; 目标是让「装扩展」和「装桌宠」完全解耦：卸载扩展不会影响桌宠，反之亦然。
;
; 默认安装位置：%USERPROFILE%\.kirari\extensions\com.akisaki.voice.aishell3
;   （与 electron/kirari-home.ts 的 LAYOUT.extensions 一致）
; 允许 /D=自定义目录覆盖（测试与高级用户用）。

Unicode true

!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "0.1.0"
!endif

!define PACK_ID "com.akisaki.voice.aishell3"
!define PRODUCT_NAME "Kirari 扩展 · 中文语音（AISHELL3）"
!define PUBLISHER "Aki"
; 本脚本在 installer/ 下，ROOT 指向扩展包根目录
!define ROOT "${__FILEDIR__}\.."

Name "${PRODUCT_NAME}"
OutFile "${ROOT}\release\kirari-voice-pack-aishell3-setup-${APP_VERSION}.exe"
InstallDir "$PROFILE\.kirari\extensions\${PACK_ID}"
InstallDirRegKey HKCU "Software\Kirari\Extensions\${PACK_ID}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "Kirari 语音扩展包安装程序"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 Aki"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 Kirari 中文语音扩展"
!define MUI_WELCOMEPAGE_TEXT "这个扩展包会让绮莉开口说话。$\r$\n$\r$\n内置 150 个中文音色，完全在本机运行：$\r$\n  · 不需要联网$\r$\n  · 不需要任何 API Key$\r$\n  · 不会把聊天内容发到任何服务器$\r$\n$\r$\n安装位置：$\r$\n  %USERPROFILE%\.kirari\extensions\${PACK_ID}$\r$\n$\r$\n装好后重启绮莉即可生效。"
!define MUI_FINISHPAGE_TITLE "装好了"
!define MUI_FINISHPAGE_TEXT "重启绮莉后，语音扩展会自动加载。$\r$\n$\r$\n要彻底移除，可在「设置 → 应用」里卸载本扩展，或运行安装目录下的 uninstall.exe。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "扩展包文件" SecMain
  SetOutPath "$INSTDIR"

  ; 只装运行必需的东西；scripts/（自测与构建脚本）不随包发布
  File "${ROOT}\manifest.json"
  File "${ROOT}\package.json"
  File /r "${ROOT}\bin\*.*"
  File /r "${ROOT}\node_modules\*.*"

  ; 卸载器 + 注册项（让用户在「设置 → 应用」里能看到它）
  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr HKCU "Software\Kirari\Extensions\${PACK_ID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Kirari\Extensions\${PACK_ID}" "Version" "${APP_VERSION}"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KirariExtAishell3" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KirariExtAishell3" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KirariExtAishell3" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KirariExtAishell3" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KirariExtAishell3" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KirariExtAishell3" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KirariExtAishell3" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; 只删自己装进来的文件；用户自己往 models/ 里补的音色也一并删掉（属于这个包）
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\voices"
  RMDir /r "$INSTDIR\node_modules"
  Delete "$INSTDIR\manifest.json"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\package-lock.json"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Kirari\Extensions\${PACK_ID}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KirariExtAishell3"
SectionEnd