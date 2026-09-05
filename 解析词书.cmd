@echo off
setlocal
cd /d "%~dp0"
py -X utf8 "scripts\wordbook_extractor_gui.py" %*
