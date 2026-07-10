# ============================================================================
# IQC System — Deploy Script (git-based → Render auto-deploy)
# รัน: .\deploy.ps1
#
# แทนที่ของเดิมที่ build+push image ขึ้น Docker Hub เอง — ตอนนี้ push ไป GitHub (branch main) แล้ว
# Render จะ build จาก Dockerfile ใน repo นี้เองอัตโนมัติ (ต้องตั้ง Render Web Service ให้ต่อกับ repo
# นี้ก่อนครั้งแรก — Runtime: Docker, Root Directory: iqc-system — ดู iqc-system/DEPLOYMENT.md §8)
#
# ขอบเขต commit: เฉพาะ iqc-system/ และ .github/ เท่านั้น (ส่วนที่ Render/CI ใช้จริง) — ไม่แตะไฟล์อื่นที่ root
# ของ repo โดยเจตนา เพราะมีเอกสาร/ภาพอ้างอิงหลายไฟล์ที่ root ที่ไม่ควร commit แบบไม่ได้ตรวจก่อน (เช่น
# ADAuthen.md/AD_*.jpg ที่มี credential จริงอยู่ในเนื้อหา — ถูก gitignore ไว้แล้วที่ root .gitignore ด้วย
# แต่ไฟล์อ้างอิงอื่นๆ ที่ root ก็ไม่ใช่ source code ของแอป ไม่จำเป็นต้องอยู่ใน commit ของการ deploy)
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') {
    Write-Host "`nอยู่ที่ branch '$branch' — Render deploy จาก 'main' เท่านั้น ยกเลิก" -ForegroundColor Red
    exit 1
}

Write-Host "`n[1/5] รัน server tests..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot\iqc-system\server"
npm test
$testExit = $LASTEXITCODE
Pop-Location
if ($testExit -ne 0) {
    Write-Host "`nTest ไม่ผ่าน — ยกเลิก deploy" -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/5] Build client (vite)..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot\iqc-system\client"
npm run build
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0) {
    Write-Host "`nClient build ล้มเหลว — ยกเลิก deploy" -ForegroundColor Red
    exit 1
}

Write-Host "`n[3/5] ตรวจการเปลี่ยนแปลงใน iqc-system/ และ .github/..." -ForegroundColor Cyan
$changed = git status --porcelain -- iqc-system .github
if (-not $changed) {
    Write-Host "ไม่มีอะไรเปลี่ยนแปลงใน iqc-system/ — ไม่มีอะไรให้ deploy ใหม่" -ForegroundColor Yellow
    exit 0
}
git status --short -- iqc-system .github

$msg = Read-Host "`nข้อความ commit (Enter = ใช้ข้อความ default)"
if (-not $msg) { $msg = "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }

Write-Host "`n[4/5] git add (เฉพาะ iqc-system/ + .github/) + commit..." -ForegroundColor Cyan
git add iqc-system .github
git commit -m $msg
if ($LASTEXITCODE -ne 0) { Write-Host "`nCommit ล้มเหลว" -ForegroundColor Red; exit 1 }

Write-Host "`nกำลังจะ push ไป origin/main → Render จะ build+deploy อัตโนมัติทันที" -ForegroundColor Yellow
$confirm = Read-Host "ยืนยัน push? (y/N)"
if ($confirm -ne 'y') {
    Write-Host "ยกเลิก push (commit ไว้ในเครื่องแล้ว — push เองทีหลังด้วย 'git push origin main')" -ForegroundColor Yellow
    exit 0
}

Write-Host "`n[5/5] Pushing..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "`nPush ล้มเหลว" -ForegroundColor Red; exit 1 }

Write-Host "`nสำเร็จ! Render กำลัง build/deploy อัตโนมัติ — เช็คสถานะที่ Render dashboard (Events tab)" -ForegroundColor Green
