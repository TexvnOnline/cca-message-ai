@echo off
setlocal
title CCA Message AI - Iniciar IA local

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-ai.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo iniciar la IA local. Revisa el error de arriba.
  pause
  exit /b 1
)

echo.
echo Ya puedes usar Corregir o Mejorar en WhatsApp Web.
echo Puedes cerrar esta ventana; el servidor seguira funcionando.
pause
