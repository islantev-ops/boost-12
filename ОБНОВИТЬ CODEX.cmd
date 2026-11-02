@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-codex-home.ps1"
if errorlevel 1 echo ОШИБКА. Сохраните текст выше для Codex.
pause
