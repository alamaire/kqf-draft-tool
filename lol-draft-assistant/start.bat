@echo off
title LoL Draft Assistant

echo ================================
echo   LoL Draft Assistant - KQF
echo ================================
echo.

:: Check for .env
if not exist "backend\.env" (
    echo [SETUP] Creating .env from template...
    copy "backend\.env.example" "backend\.env"
    echo [!] Open backend\.env and add your Riot API key before continuing.
    echo     Get one at: https://developer.riotgames.com
    pause
)

:: Install Python deps if needed
if not exist "backend\venv" (
    echo [SETUP] Creating Python virtual environment...
    python -m venv backend\venv
    echo [SETUP] Installing Python dependencies...
    backend\venv\Scripts\pip install -r backend\requirements.txt
)

:: Install Node deps if needed
if not exist "frontend\node_modules" (
    echo [SETUP] Installing frontend dependencies...
    cd frontend
    npm install
    cd ..
)

:: Build frontend
echo [BUILD] Building frontend...
cd frontend
call npm run build
cd ..

:: Start backend (serves built frontend too)
echo.
echo [START] Starting server at http://localhost:8000
echo [INFO]  Open your browser to http://localhost:8000
echo [INFO]  Press Ctrl+C to stop
echo.
backend\venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir backend
