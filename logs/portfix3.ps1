[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
"== wslservice before: $((Get-Service wslservice -ErrorAction SilentlyContinue).Status) starttype=$((Get-Service wslservice -ErrorAction SilentlyContinue).StartType)"
Stop-Service wslservice -Force -ErrorAction Continue
Start-Sleep -Seconds 3
"== wslservice after:  $((Get-Service wslservice -ErrorAction SilentlyContinue).Status)"
"== remaining wsl/vm processes:"
Get-Process | Where-Object { $_.Name -match 'vmms|Vmmem|wsl|hv' } | Select-Object Name,Id
"== excluded ranges after stop:"
netsh interface ipv4 show excludedportrange protocol=tcp
