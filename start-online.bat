@echo off
chcp 65001 >nul
cd /d "%~dp0server"
where node >nul 2>nul || (echo Nuzhen Node.js: https://nodejs.org & pause & exit /b)
start "" http://localhost:3000
node server.js
pause
