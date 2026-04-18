@echo off
cd /d "D:\Projects\Project Mind\kernl-mcp"
git add -A
git commit -F commit-msg.txt
git push origin main
echo DONE
