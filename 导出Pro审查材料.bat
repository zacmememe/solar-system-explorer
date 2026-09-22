@echo off
cd /d "%~dp0"
call npm run review:export -- --with-images
if errorlevel 1 (
  echo Export failed. See the message above.
) else (
  echo Review files are in the review-exports folder.
)
pause
