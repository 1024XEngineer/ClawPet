cd /d "%~dp0"
start "GoClaw Electron Vite" cmd /k "npm run dev"
timeout /t 3 >nul
npm start
