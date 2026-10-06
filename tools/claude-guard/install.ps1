# Cài "hàng rào" cho Claude Code: chỉ được truy cập D:\n8n_data\webapp.
# Chạy bằng PowerShell "Run as administrator":
#   powershell -ExecutionPolicy Bypass -File D:\n8n_data\webapp\tools\claude-guard\install.ps1
# Chạy lại script này mỗi khi tạo thêm ổ đĩa / folder mới ở D:\ hoặc D:\n8n_data.

$allowed = 'D:\n8n_data\webapp'
$dest    = 'C:\Program Files\ClaudeCode'

function ToRule([string]$p) { '//' + $p.Substring(0,1).ToLower() + ($p.Substring(2) -replace '\\','/') }

$deny = New-Object System.Collections.Generic.List[string]
# 1. Mọi ổ đĩa khác (kể cả ổ mạng W:, Y:, Z:)
foreach ($d in Get-PSDrive -PSProvider FileSystem) {
  if ($d.Name -ne $allowed.Substring(0,1)) { $deny.Add("//$($d.Name.ToLower())/**") }
}
# 2. Trên ổ D: chặn mọi "anh em" dọc đường D:\ -> n8n_data -> webapp
$cur = $allowed.Substring(0,3)                       # D:\
foreach ($part in $allowed.Substring(3).Split('\')) {
  foreach ($item in Get-ChildItem -LiteralPath $cur -Force -ErrorAction SilentlyContinue) {
    if ($item.Name -ne $part) {
      $r = ToRule $item.FullName
      if ($item.PSIsContainer) { $r += '/**' }
      $deny.Add($r)
    }
  }
  $cur = Join-Path $cur $part
}
$rules = foreach ($r in $deny) { "Read($r)"; "Edit($r)" }

$settings = [ordered]@{
  permissions = [ordered]@{
    deny = @($rules)
    disableBypassPermissionsMode = 'disable'
  }
  hooks = @{
    PreToolUse = @(@{
      matcher = '*'
      hooks = @(@{ type = 'command'; command = 'node "C:/Program Files/ClaudeCode/guard.js"'; timeout = 10 })
    })
  }
}

New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'guard.js') -Destination (Join-Path $dest 'guard.js') -Force
$json = $settings | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText((Join-Path $dest 'managed-settings.json'), $json, (New-Object Text.UTF8Encoding $false))

Write-Host "Đã ghi $dest\managed-settings.json với $($rules.Count) quy tắc chặn và hook guard.js." -ForegroundColor Green
Write-Host "Khởi động lại app Claude, rồi gõ /status để kiểm tra dòng 'Enterprise managed settings (file)'."
