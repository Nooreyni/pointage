@echo off
REM CFB Pointage : demarrage local en un double-clic (Windows)
cd /d "%~dp0app"
where node >nul 2>nul || (echo Node.js est requis : installe la version LTS depuis https://nodejs.org puis relance ce fichier. & pause & exit /b 1)
if not exist node_modules (echo Premiere installation, patiente une minute... & call npm ci)
call npm run dev -- --open
pause
