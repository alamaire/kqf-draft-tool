@echo off
title LoL Draft Assistant - Dev Mode

:: Start backend in a new window
start "Backend" cmd /k "backend\venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir backend --reload"

:: Start frontend dev server
cd frontend
npm run dev
