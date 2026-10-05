@echo off
rem Double-click to install the AV Overlay on a rooted LG TV from Windows.
rem Needs the Windows "OpenSSH Client" (on by default in Windows 10/11) and SSH enabled on the TV.
rem Extra arguments are passed through, for example:  Install-AVOverlay.cmd -TvHost root@192.168.1.50
title AV Overlay installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" %*
echo.
pause
