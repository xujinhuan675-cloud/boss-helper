@echo off
cd /d "%~dp0"
call bun run release:chrome
set "release_status=%errorlevel%"
pause
exit /b %release_status%
