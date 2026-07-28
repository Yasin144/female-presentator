param (
    [string]$MobileUrl
)

if (-not $MobileUrl) {
    Write-Host "Missing MobileUrl"
    exit 1
}

$text = [System.Uri]::EscapeDataString("📱 Presentator 4G/5G Mobile Link:`n$MobileUrl")
$waUrl = "https://api.whatsapp.com/send?phone=917386726193&text=$text"

# 1. Open WhatsApp click-to-send window
Start-Process $waUrl

# 2. Wait 3.5 seconds for WhatsApp window to gain focus
Start-Sleep -Milliseconds 3500

# 3. Simulate ENTER key to send automatically without user clicking!
$wshell = New-Object -ComObject WScript.Shell
$wshell.SendKeys("{ENTER}")

# 4. Also push to ntfy.sh instant notification channel for 7386726193
try {
    Invoke-RestMethod -Uri "https://ntfy.sh/pattan_7386726193" -Method Post -Body "📱 Presentator 4G/5G Link:`n$MobileUrl"
} catch {}
