@echo off
chcp 936 >nul
cd /d %~dp0
echo === v2 全片渲染（带 BGM）===
call npx remotion render src/index.ts InterweaverPromo out/interweaver-promo-v2.mp4 || (echo 渲染失败 & pause & exit /b 1)
echo === v2 无 BGM 版 ===
call npx remotion render src/index.ts InterweaverPromo out/interweaver-promo-v2-nobgm.mp4 --props=props-nobgm.json || (echo 渲染失败 & pause & exit /b 1)
echo === 完成：out\interweaver-promo-v2.mp4 ===
explorer out
pause
