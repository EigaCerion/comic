@echo off
rem Matikan NaruReader, termasuk proses yang sudah tidak punya jendela.
cd /d "%~dp0"
title NaruReader - Stop
node apps\api\scripts\stop.js
pause
