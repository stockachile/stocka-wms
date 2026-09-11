@echo off
cd /d "c:\Users\felip\Desktop\WMS STOCKA"
node sync_starken.js >> "sync_starken_cron.log" 2>&1
