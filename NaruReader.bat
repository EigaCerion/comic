@echo off
rem Klik dua kali berkas ini untuk menjalankan NaruReader.
rem Hanya alamat yang bisa dibuka yang ditampilkan; log API, bot importir, dan
rem bot pengawas dialirkan ke apps\api\logs\server.log.
cd /d "%~dp0"
title NaruReader
node apps\api\scripts\launch.js
if errorlevel 1 pause
