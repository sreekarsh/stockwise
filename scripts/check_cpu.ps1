$p = Get-Process -Id 32924 -ErrorAction SilentlyContinue
if ($null -eq $p) { Write-Output 'PROCESS_NOT_FOUND'; exit 0 }
$t1 = $p.CPU
Start-Sleep -Seconds 5
$p2 = Get-Process -Id 32924 -ErrorAction SilentlyContinue
if ($null -eq $p2) { Write-Output 'PROCESS_EXITED'; exit 0 }
$t2 = $p2.CPU
$delta = $t2 - $t1
Write-Output "CPU_SECONDS_DELTA=$delta"
Write-Output ("CPU_PER_SECOND={0:N3}" -f ($delta/5))
