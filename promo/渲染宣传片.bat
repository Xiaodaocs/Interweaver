@echo off
chcp 936 >nul
cd /d %~dp0
echo === 交织者宣传片：1/2 合成音频 ===
node audio.mjs || (echo 音频合成失败 & pause & exit /b 1)
echo === 交织者宣传片：2/2 渲染视频并合成（约 10-25 分钟）===
node render.mjs full --workers 4 || (echo 渲染失败 & pause & exit /b 1)
echo === 完成：out\interweaver-promo.mp4 ===
explorer out
pause
