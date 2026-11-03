[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
"== LxssManager before: $((Get-Service LxssManager -ErrorAction SilentlyContinue).Status)"
Stop-Service LxssManager -Force -ErrorAction SilentlyContinue
"== LxssManager after:  $((Get-Service LxssManager -ErrorAction SilentlyContinue).Status)"
netsh interface ipv4 delete excludedportrange protocol=tcp startport=18252 numberofports=100
netsh interface ipv4 show excludedportrange protocol=tcp
"== vmms: $((Get-Service vmms -ErrorAction SilentlyContinue).Status)"
