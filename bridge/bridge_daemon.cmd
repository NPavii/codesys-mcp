@echo off
rem Warm CODESYS bridge daemon - headless start + companion monitor window.
rem Environment switches (set before calling):
rem   CB_MONITOR=0  - no monitor window
rem   CB_KEEP=1     - do not kill existing CODESYS processes first
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge_daemon.ps1"
