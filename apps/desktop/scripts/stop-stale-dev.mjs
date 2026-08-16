import { execFileSync } from 'node:child_process';
import path from 'node:path';

const workspace = path.resolve(import.meta.dirname, '../../..');
const powershell = `
$workspace = $env:AVIATOR_DEV_WORKSPACE
$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like "*$workspace*" -and (
    ($_.Name -eq 'node.exe' -and $_.CommandLine -match '[\\\\/]vite[\\\\/]bin[\\\\/]vite\\.js') -or
    ($_.Name -eq 'electron.exe' -and $_.CommandLine -notmatch '--type=')
  )
}
foreach ($target in $targets) {
  Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Output "Instância antiga encerrada: $($target.Name) PID $($target.ProcessId)"
}
Start-Sleep -Milliseconds 500
`;

execFileSync('powershell.exe', ['-NoProfile', '-Command', powershell], {
  stdio: 'inherit',
  env: { ...process.env, AVIATOR_DEV_WORKSPACE: workspace }
});