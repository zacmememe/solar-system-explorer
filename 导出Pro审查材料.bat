@echo off
setlocal
cd /d "%~dp0"
set "REVIEW_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "D:\Apps\NodeJS\current\node.exe" (
    set "REVIEW_NODE=D:\Apps\NodeJS\current\node.exe"
  ) else (
    echo Node.js was not found. No export was created.
    if /i not "%~1"=="--no-pause" pause
    exit /b 1
  )
)
"%REVIEW_NODE%" "%~dp0scripts\export-review.mjs" --with-images
set "REVIEW_EXIT=%errorlevel%"
if not "%REVIEW_EXIT%"=="0" (
  echo Export failed. See the message above. Existing files may be from earlier runs.
) else (
  echo Export succeeded. The new ZIP path is shown above.
  echo review-exports\LATEST.txt points to the last successful export.
)
if /i not "%~1"=="--no-pause" pause
exit /b %REVIEW_EXIT%
