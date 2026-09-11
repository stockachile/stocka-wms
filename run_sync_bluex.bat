@echo off
cd /d "c:\Users\felip\Desktop\WMS STOCKA"
node sync_bluex.js >> "sync_bluex_cron.log" 2>&1
