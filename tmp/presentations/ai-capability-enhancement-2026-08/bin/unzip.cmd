@echo off
if "%~1"=="-Z1" goto list
if "%~1"=="-p" goto print
echo Unsupported unzip arguments 1>&2
exit /b 2

:list
tar -tf "%~2"
exit /b %ERRORLEVEL%

:print
tar -xOf "%~2" "%~3"
exit /b %ERRORLEVEL%
