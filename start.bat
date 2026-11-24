@echo off
cd /d "%~dp0"
if exist node.exe (
    node.exe server.mjs
) else (
    node server.mjs
)
pause