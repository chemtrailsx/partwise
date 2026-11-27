# Starts PartWise on http://localhost:8000 (API + built React app in one process).
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path "$root\frontend\dist\index.html")) {
    Write-Host "Building the frontend (first run only)..."
    Push-Location "$root\frontend"
    if (-not (Test-Path "node_modules")) { npm install }
    npm run build
    Pop-Location
}

Write-Host "PartWise running at http://localhost:8000  (Ctrl+C to stop)"
python -m uvicorn --app-dir "$root\backend" app.main:app --host 0.0.0.0 --port 8000
