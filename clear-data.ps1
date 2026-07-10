# clear-data.ps1 — เครื่องมือเคลียร์ข้อมูล IQC System
# ─────────────────────────────────────────────────────
# วิธีใช้:
#   .\clear-data.ps1                  แสดงรายการทั้งหมด
#   .\clear-data.ps1 bills            เคลียร์ใบรับสินค้า
#   .\clear-data.ps1 ncr              เคลียร์ NCR
#   .\clear-data.ps1 uai              เคลียร์ UAI
#   .\clear-data.ps1 delivery         เคลียร์ Delivery Schedule
#   .\clear-data.ps1 ipqc             เคลียร์ IPQC
#   .\clear-data.ps1 fqc              เคลียร์ FQC
#   .\clear-data.ps1 pdplan           เคลียร์ PDPlan
#   .\clear-data.ps1 procode          เคลียร์ ProCodeSAP
#   .\clear-data.ps1 kpi              เคลียร์ KPI
#   .\clear-data.ps1 issue-talk       เคลียร์ Issue Talk
#   .\clear-data.ps1 notifications    เคลียร์ Notifications
#   .\clear-data.ps1 audit            เคลียร์ Audit Logs
#   .\clear-data.ps1 master-iqc       เคลียร์ Master Data IQC
#   .\clear-data.ps1 prod-master      เคลียร์ Production Master
#   .\clear-data.ps1 attendance       เคลียร์ QC Attendance
#   .\clear-data.ps1 all              *** เคลียร์ทั้งหมด ***

param([string]$Module = '')

$ScriptPath = Join-Path $PSScriptRoot 'iqc-system\server\scripts\clear-data.js'
$ServerPath = Join-Path $PSScriptRoot 'iqc-system\server'

if (-not (Test-Path $ScriptPath)) {
    Write-Error "ไม่พบไฟล์: $ScriptPath"
    exit 1
}

# ตรวจสอบ Node.js
try { $null = node --version } catch {
    Write-Error "ไม่พบ Node.js — กรุณาติดตั้งก่อน"
    exit 1
}

# ตรวจสอบ better-sqlite3
$NodeModules = Join-Path $ServerPath 'node_modules\better-sqlite3'
if (-not (Test-Path $NodeModules)) {
    Write-Host "กำลังติดตั้ง dependencies..." -ForegroundColor Yellow
    Push-Location $ServerPath
    npm install
    Pop-Location
}

# รัน script
node $ScriptPath $Module
