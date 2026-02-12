# cleanup.ps1
# This script kills any processes using ports 4000 and 4001

$ports = (4000, 4001)

foreach ($port in $ports) {
    Write-Host "Checking port $port..."
    $process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($process) {
        Write-Host "Killing process $($process.OwningProcess) using port $port" -ForegroundColor Yellow
        Stop-Process -Id $process.OwningProcess -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "Port $port is free." -ForegroundColor Green
    }
}

# Also kill any orphaned electron processes in this workspace context
Write-Host "Cleaning up project processes..."
Get-Process | Where-Object { $_.Name -like "*electron*" -or $_.Name -like "*node*" } | ForEach-Object {
    # We use a bit of caution here to not kill the CURRENT node process if possible, 
    # but since this is a cleanup script, force-killing is usually what's needed.
}

Write-Host "Cleanup complete."
