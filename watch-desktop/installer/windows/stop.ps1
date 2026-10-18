# Stop a running PearCircle Watcher started from this install folder, so the
# installer and uninstaller can replace or delete node.exe and bare.exe.
# Other Node processes on the machine are left alone. Uses CIM because the
# installer is 32-bit, and a 32-bit Get-Process cannot read the path of a
# 64-bit process.
$dir = $PSScriptRoot + '\'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'bare.exe'" |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
