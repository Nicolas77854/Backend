@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Iniciando el backend JavaScript de CONSTRUCALC...
echo Deja esta ventana abierta mientras uses la pagina.
node server.js
pause
