[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
Get-Process | Where-Object { $_.Name -match 'Vmmem|wsl' } | ForEach-Object {
    "killing $($_.Name) $($_.Id)"
    Stop-Process -Id $_.Id -Force -ErrorAction Continue
}
Start-Sleep -Seconds 4
"== remaining vmmem/wsl processes:"
Get-Process | Where-Object { $_.Name -match 'Vmmem|wsl' } | Select-Object Name,Id
"== excluded ranges after kill:"
netsh interface ipv4 show excludedportrange protocol=tcp
