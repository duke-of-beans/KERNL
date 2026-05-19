@echo off
set "PATH=D:\Program Files\nodejs;%PATH%"
cd /d "D:\Projects\Project Mind\kernl-mcp"
call npx tsc --noEmit 2>&1
