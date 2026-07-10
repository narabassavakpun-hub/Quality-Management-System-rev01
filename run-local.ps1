# ============================================================================
# IQC System — Local Build & Test
# Build image จาก code ปัจจุบัน แล้วรันบน localhost:3001
# มือถือที่ WiFi เดียวกันเข้าได้ที่ http://<IP>:3001
# ============================================================================

$ComposeDir  = Join-Path $PSScriptRoot "iqc-system"
$EnvFile     = Join-Path $ComposeDir ".env.local"
$ComposeFile = Join-Path $ComposeDir "docker-compose.local.yml"

# ---------- 1. สร้าง .env.local ถ้ายังไม่มี ----------
if (-not (Test-Path $EnvFile)) {
    Write-Host ">> สร้าง JWT_SECRET ใหม่..." -ForegroundColor Cyan
    $secret = -join ((1..48) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
    Set-Content -Path $EnvFile -Encoding utf8 -Value "JWT_SECRET=$secret"
    Write-Host "   บันทึกแล้ว: iqc-system/.env.local" -ForegroundColor Green
} else {
    Write-Host ">> ใช้ .env.local ที่มีอยู่แล้ว" -ForegroundColor Green
}

# ---------- 2. หยุด container เก่าก่อน (ถ้ามี) ----------
Write-Host ""
Write-Host ">> หยุด container เก่า (ถ้ามี)..." -ForegroundColor Cyan
docker compose -f $ComposeFile down --remove-orphans
# ไม่ตรวจ exit code — ถ้าไม่มี container อยู่ก็ไม่เป็นไร

# ---------- 3. Build image จาก local code ----------
Write-Host ""
Write-Host ">> Building image จาก local code... (อาจใช้เวลา 2-5 นาทีครั้งแรก)" -ForegroundColor Cyan
docker compose -f $ComposeFile build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! ดู error ด้านบน" -ForegroundColor Red
    exit 1
}

# ---------- 4. รัน container ----------
Write-Host ""
Write-Host ">> Starting container..." -ForegroundColor Cyan
docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Start failed! ดู error ด้านบน" -ForegroundColor Red
    exit 1
}

# ---------- 5. หา IP สำหรับมือถือ ----------
# ลำดับ: Wi-Fi → Ethernet จริง (ข้าม 169.254.x.x / docker / vEthernet)
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object {
           $_.IPAddress -notlike '127.*' -and
           $_.IPAddress -notlike '169.254.*' -and
           $_.InterfaceAlias -notmatch 'Loopback|docker|vEthernet|Bluetooth|OpenVPN|Local Area Connection\*'
       } |
       Sort-Object { if ($_.InterfaceAlias -match 'Wi-Fi|Wireless') { 0 } else { 1 } } |
       Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  IQC System พร้อมใช้งาน!" -ForegroundColor Green
Write-Host ""
Write-Host "  บนเครื่องนี้  : http://localhost:3001" -ForegroundColor White
if ($ip) {
    Write-Host "  มือถือ (WiFi)  : http://${ip}:3001" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  หยุด  : docker compose -f iqc-system/docker-compose.local.yml down" -ForegroundColor Gray
Write-Host "  Log   : docker logs iqc-local -f" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green

