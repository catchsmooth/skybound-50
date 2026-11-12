@echo off
chcp 65001 >nul
cd /d "%~dp0game"
where node >nul 2>nul
if errorlevel 1 (
 echo 请先安装 Node.js 24，然后重新打开此文件。
 pause
 exit /b 1
)
echo 极限航域 0.4.0 - 请在浏览器打开 http://127.0.0.1:5179
echo 关闭此窗口将停止服务。如果端口已占用，请使用原有预览网址。
node tools/serve.mjs
pause
