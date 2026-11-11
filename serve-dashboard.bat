@echo off
rem Safari 等浏览器：用本地 http:// 打开，存储和跨域都比 file:// 稳
chcp 65001 >nul
cd /d "%~dp0"
start "" "http://localhost:8791/"
node tools\serve.mjs
pause
