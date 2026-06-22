@echo off
REM KQF Draft Tool — LIVE companion launcher.
REM Double-click this file to start the local server, then open http://localhost:5500
REM Keep this window OPEN while you draft. Close it to stop.
cd /d "%~dp0"
title KQF Draft Tool - companion (keep open)
echo Starting KQF Draft Tool companion...
echo Open http://localhost:5500 in your browser.
echo Keep this window open while you use the tool. Press Ctrl+C or close to stop.
echo.
node companion.js
echo.
echo Companion stopped. Press any key to close.
pause >nul
