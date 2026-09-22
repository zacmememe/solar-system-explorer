@echo off
cd /d "%~dp0"
node scripts\launch.mjs %*
if %errorlevel% neq 0 pause
