import subprocess, json, os, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = "http://localhost:3001/api"
results = []
UNIQUE = str(int(time.time()))[-6:]
TMP = "c:\\Users\\Narabas.s\\AppData\\Local\\Temp"

def curl_json(method, path, data=None, cookie=None, files=None):
    cmd = ["curl", "-s", "-X", method, f"{BASE}{path}"]
    if data is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(data)]
    if cookie:
        cmd += ["-b", cookie, "-c", cookie]
    if files:
        for f in files:
            cmd += ["-F", f]
    r = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace')
    try:
        return json.loads(r.stdout)
    except:
        return {"_raw": (r.stdout or "").strip()}

def http_code(method, path, data=None, cookie=None):
    cmd = ["curl", "-s", "-w", "%{http_code}", "-o", "/dev/null", "-X", method, f"{BASE}{path}"]
    if data is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(data)]
    if cookie:
        cmd += ["-b", cookie]
    r = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace')
    return r.stdout.strip()

def check(tc, desc, cond, extra=""):
    sym = "OK" if cond else "XX"
    print(f"[{sym}] {tc} {desc}" + (f" | {extra}" if extra and not cond else ""))
    results.append((tc, cond))

def login(user, cookie):
    cmd = ["curl", "-s", "-X", "POST", f"{BASE}/auth/login",
           "-H", "Content-Type: application/json",
           "-d", json.dumps({"username": user, "password": "admin1234"}),
           "-c", cookie, "-b", cookie]
    subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace')

cookies = {
    "admin": f"{TMP}\\c_admin.txt", "staff": f"{TMP}\\c_staff.txt",
    "super": f"{TMP}\\c_super.txt", "mgr": f"{TMP}\\c_mgr.txt",
    "qmr": f"{TMP}\\c_qmr.txt", "pur": f"{TMP}\\c_pur.txt",
    "cco": f"{TMP}\\c_cco.txt", "cmo": f"{TMP}\\c_cmo.txt",
    "cpo": f"{TMP}\\c_cpo.txt", "prod": f"{TMP}\\c_prod.txt"
}
users = {
    "admin":"admin","staff":"qc_staff1","super":"supervisor1",
    "mgr":"manager1","qmr":"qmr1","pur":"purchasing1",
    "cco":"cco1","cmo":"cmo1","cpo":"cpo1","prod":"production1"
}
for k, v in users.items():
    login(v, cookies[k])

# ===== SETUP: สร้าง master data + bill ที่ approved แล้ว =====
print("=== SETUP ===")
r = curl_json("POST", "/master/suppliers", {"code":f"NS-{UNIQUE}","name":f"NCR Supplier {UNIQUE}","contact_name":"A","contact_email":"a@a.com","contact_phone":"0800000000"}, cookies["admin"])
SUP_ID = r.get("id")
r = curl_json("POST", "/master/product-groups", {"code":f"NPG-{UNIQUE}","name":"NCR TestGroup","require_inspection_doc":0}, cookies["admin"])
PG_ID = r.get("id")
r = curl_json("POST", "/master/units", {"code":f"NU-{UNIQUE}","name":"ชิ้น"}, cookies["admin"])
UNIT_ID = r.get("id")
r = curl_json("POST", "/master/products", {"code":f"NP-{UNIQUE}","name":f"NCR Product {UNIQUE}","supplier_id":SUP_ID,"product_group_id":PG_ID,"unit_id":UNIT_ID}, cookies["admin"])
PROD_ID = r.get("id")
r = curl_json("POST", "/master/defect-categories", {"code":f"NDC-{UNIQUE}","name":f"NCR Defect {UNIQUE}"}, cookies["admin"])
DC_ID = r.get("id")
print(f"  SUP={SUP_ID} PG={PG_ID} UNIT={UNIT_ID} PROD={PROD_ID} DC={DC_ID}")

r = curl_json("POST", "/bills", {"supplier_id":SUP_ID,"invoice_no":f"NCR-INV-{UNIQUE}","po_no":f"NCR-PO-{UNIQUE}","received_date":"2024-06-12"}, cookies["staff"])
BILL_ID = r.get("id")
r = curl_json("POST", f"/bills/{BILL_ID}/items", {"product_id":PROD_ID,"item_name":f"NCR Product {UNIQUE}","qty_received":100,"qty_sampled":50,"qty_passed":80,"qty_failed":20,"defect_category_id":DC_ID,"defect_detail":"รอยขีดข่วนที่พบ"}, cookies["staff"])
ITEM_ID = r.get("id")

img_path = f"{TMP}\\ncr_img.jpg"
with open(img_path, "wb") as f:
    f.write(b"\xff\xd8\xff\xe0" + b"ncr test image data" * 10)
cmd = ["curl", "-s", "-X", "POST", f"{BASE}/bills/{BILL_ID}/items/{ITEM_ID}/images",
       "-F", f"images=@{img_path};type=image/jpeg", "-b", cookies["staff"]]
subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace')

r = curl_json("POST", f"/bills/{BILL_ID}/submit", cookie=cookies["staff"])
r = curl_json("POST", f"/bills/{BILL_ID}/approve", {}, cookies["super"])
print(f"  BILL={BILL_ID} ITEM={ITEM_ID} status={r.get('status')}")

# ===== NCR TESTS =====
print("\n=== NCR ===")

# NCR-005: ส่ง NCR ไม่กรอก description -> validation error
r = curl_json("POST", "/ncr", {"bill_id":BILL_ID,"bill_item_id":ITEM_ID,"severity":"major"}, cookies["staff"])
check("NCR-005", "ส่ง NCR ไม่กรอก description -> error", "error" in r, str(r))

# NCR-001: ออก NCR สำเร็จ
r = curl_json("POST", "/ncr", {
    "bill_id":BILL_ID,"bill_item_id":ITEM_ID,"severity":"major",
    "description":"พบรอยขีดข่วนจำนวนมากเกินมาตรฐาน"
}, cookies["staff"])
NCR_ID = r.get("id")
NCR_CODE = r.get("ncr_code","")
SUPPLIER_TOKEN = r.get("supplier_token","")
check("NCR-001", "ออก NCR สำเร็จ", bool(NCR_ID), str(r))

# NCR-004: รหัส NCR รูปแบบ NCR-YYYY-NNNN
check("NCR-004", "รหัส NCR รูปแบบ NCR-YYYY-NNNN", NCR_CODE.startswith("NCR-"), f"got {NCR_CODE}")

# NCR-003: severity บันทึกถูกต้อง
r_detail = curl_json("GET", f"/ncr/{NCR_ID}", cookie=cookies["staff"])
check("NCR-003", "severity = major บันทึกถูกต้อง", r_detail.get("severity") == "major", str(r_detail.get("severity")))

# NCR-002: ดึงข้อมูลอัตโนมัติ
check("NCR-002", "ข้อมูล NCR ดึงจาก bill_item ครบ (item_name, qty_failed)", bool(r_detail.get("item_name")) and r_detail.get("qty_failed") > 0, str(r_detail))

# NCR-014: qc_staff ไม่เห็นปุ่ม approve (role ผิด)
code = http_code("POST", f"/ncr/{NCR_ID}/approve", {"action":"approve"}, cookies["staff"])
check("NCR-014", "qc_staff POST /ncr/approve -> 403", code == "403", f"got {code}")

# NCR-010: QC Supervisor อนุมัติ NCR
r = curl_json("POST", f"/ncr/{NCR_ID}/approve", {"action":"approve","comment":"ดำเนินการต่อ"}, cookies["super"])
check("NCR-010", "QC Supervisor อนุมัติ -> pending_manager", r.get("status") == "pending_manager", str(r))

# NCR-011: QC Manager อนุมัติ
r = curl_json("POST", f"/ncr/{NCR_ID}/approve", {"action":"approve","comment":"อนุมัติเปิด NCR"}, cookies["mgr"])
check("NCR-011", "QC Manager อนุมัติ -> pending_qmr_open", r.get("status") == "pending_qmr_open", str(r))

# NCR-012: QMR อนุมัติเปิด
r = curl_json("POST", f"/ncr/{NCR_ID}/approve", {"action":"approve","comment":"QMR อนุมัติ"}, cookies["qmr"])
check("NCR-012", "QMR อนุมัติ -> pending_supplier", r.get("status") == "pending_supplier", str(r))

# NCR-013: Timeline แสดงครบ
r_detail = curl_json("GET", f"/ncr/{NCR_ID}", cookie=cookies["mgr"])
approvals = r_detail.get("approvals", [])
check("NCR-013", "Timeline มี 3 approvals", len(approvals) == 3, f"got {len(approvals)}")

# ===== SUPPLIER RESPONSE =====
print("\n=== SUPPLIER RESPONSE ===")

# NCR-021: token ผิด
code = http_code("GET", f"/supplier/ncr/invalid-token-xyz")
check("NCR-021", "token ผิด -> 404", code == "404", f"got {code}")

# NCR-020: Supplier เปิด link ด้วย token ถูกต้อง
r = curl_json("GET", f"/supplier/ncr/{SUPPLIER_TOKEN}")
check("NCR-020", "Supplier เปิด link ได้โดยไม่ login", bool(r.get("id")), str(r)[:80])

# NCR-023: ตอบไม่ครบ (ไม่มี root_cause)
r = curl_json("POST", f"/supplier/ncr/{SUPPLIER_TOKEN}/respond", {
    "corrective_action":"แก้ไขแล้ว","preventive_action":"ป้องกันแล้ว"
})
check("NCR-023", "Supplier ตอบไม่ครบ -> error", "error" in r, str(r))

# NCR-022: ตอบครบ 3 field
r = curl_json("POST", f"/supplier/ncr/{SUPPLIER_TOKEN}/respond", {
    "root_cause":"กระบวนการผลิตผิดปกติ",
    "corrective_action":"แก้ไขกระบวนการแล้ว",
    "preventive_action":"เพิ่มการตรวจสอบ"
})
check("NCR-022", "Supplier ตอบครบ -> success", r.get("ok") == True, str(r))

# NCR-024: ส่งซ้ำไม่ได้
r = curl_json("POST", f"/supplier/ncr/{SUPPLIER_TOKEN}/respond", {
    "root_cause":"ซ้ำ","corrective_action":"ซ้ำ","preventive_action":"ซ้ำ"
})
check("NCR-024", "ส่งซ้ำไม่ได้ -> error (already_responded)", "already_responded" in str(r) or "error" in r, str(r))

# NCR status ต้องเปลี่ยนเป็น pending_manager_review
r_detail = curl_json("GET", f"/ncr/{NCR_ID}", cookie=cookies["mgr"])
check("NCR-022b", "NCR status -> pending_manager_review หลัง Supplier ตอบ", r_detail.get("status") == "pending_manager_review", str(r_detail.get("status")))

# ===== NCR EXPORTS =====
print("\n=== NCR EXPORTS ===")
code = http_code("GET", f"/ncr/{NCR_ID}/pdf", cookie=cookies["staff"])
check("NCR-030", "Export NCR PDF (accessible any status)", code != "404" and code != "500", f"got {code}")
code = http_code("GET", f"/ncr/{NCR_ID}/excel", cookie=cookies["staff"])
check("NCR-031", "Export NCR Excel (accessible any status)", code != "404" and code != "500", f"got {code}")

# ===== UAI WORKFLOW =====
print("\n=== UAI WORKFLOW ===")

# UAI-002: ปุ่มไม่ปรากฏ (status ไม่ใช่ pending_supplier)
# NCR ตอนนี้เป็น pending_manager_review, purchasing ไม่ควรมีปุ่ม request-uai
code = http_code("POST", f"/ncr/{NCR_ID}/request-uai", {}, cookies["pur"])
check("UAI-002", "request-uai ไม่ได้ถ้า NCR ไม่ใช่ pending_supplier", code == "400", f"got {code}")

# QC Manager close review -> pending_qmr_close
r = curl_json("POST", f"/ncr/{NCR_ID}/approve", {"action":"approve","comment":"ตรวจสอบคำตอบแล้ว"}, cookies["mgr"])
check("NCR-close-1", "QC Manager review -> pending_qmr_close", r.get("status") == "pending_qmr_close", str(r))

# QMR close
r = curl_json("POST", f"/ncr/{NCR_ID}/approve", {"action":"close","comment":"ปิด NCR"}, cookies["qmr"])
check("NCR-close-2", "QMR ปิด NCR -> closed", r.get("status") == "closed", str(r))

# สร้าง NCR ใหม่สำหรับทดสอบ UAI (ต้องผ่านถึง pending_supplier)
r = curl_json("POST", "/bills", {"supplier_id":SUP_ID,"invoice_no":f"UAI-INV-{UNIQUE}","po_no":f"UAI-PO-{UNIQUE}","received_date":"2024-06-12"}, cookies["staff"])
BILL2_ID = r.get("id")
r = curl_json("POST", f"/bills/{BILL2_ID}/items", {"product_id":PROD_ID,"item_name":f"UAI Product {UNIQUE}","qty_received":100,"qty_sampled":50,"qty_passed":70,"qty_failed":30,"defect_category_id":DC_ID,"defect_detail":"ขนาดผิดสเปค"}, cookies["staff"])
ITEM2_ID = r.get("id")
cmd = ["curl", "-s", "-X", "POST", f"{BASE}/bills/{BILL2_ID}/items/{ITEM2_ID}/images",
       "-F", f"images=@{img_path};type=image/jpeg", "-b", cookies["staff"]]
subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace')
curl_json("POST", f"/bills/{BILL2_ID}/submit", cookie=cookies["staff"])
curl_json("POST", f"/bills/{BILL2_ID}/approve", {}, cookies["super"])
r = curl_json("POST", "/ncr", {"bill_id":BILL2_ID,"bill_item_id":ITEM2_ID,"severity":"minor","description":"ขนาดผิดสเปคต้องทำ UAI"}, cookies["staff"])
NCR2_ID = r.get("id")
SUPPLIER_TOKEN2 = r.get("supplier_token","")
# Advance NCR to pending_supplier
curl_json("POST", f"/ncr/{NCR2_ID}/approve", {"action":"approve"}, cookies["super"])
curl_json("POST", f"/ncr/{NCR2_ID}/approve", {"action":"approve"}, cookies["mgr"])
r = curl_json("POST", f"/ncr/{NCR2_ID}/approve", {"action":"approve"}, cookies["qmr"])
check("UAI-SETUP", "NCR2 -> pending_supplier", r.get("status") == "pending_supplier", str(r))

# UAI-001: ปุ่ม request-uai ปรากฏ (status = pending_supplier)
code = http_code("POST", f"/ncr/{NCR2_ID}/request-uai", {}, cookies["pur"])
check("UAI-001", "purchasing POST /request-uai สำเร็จ (200)", code == "200", f"got {code}")

# ตรวจ NCR status -> uai_pending_qc_manager
r_ncr2 = curl_json("GET", f"/ncr/{NCR2_ID}", cookie=cookies["mgr"])
check("UAI-004", "NCR status -> uai_pending_qc_manager", r_ncr2.get("status") == "uai_pending_qc_manager", str(r_ncr2.get("status")))

# ดึง UAI ที่สร้างขึ้น
uai_list = curl_json("GET", f"/uai?status=uai_pending_qc_manager", cookie=cookies["mgr"])
UAI_ID = uai_list[0]["id"] if isinstance(uai_list, list) and len(uai_list) > 0 else None
UAI_CODE = uai_list[0].get("uai_code","") if UAI_ID else ""
check("UAI-013", "รหัส UAI รูปแบบ UAI-YYYY-NNNN", UAI_CODE.startswith("UAI-"), f"got {UAI_CODE}")

# UAI-040: ปุ่ม Export ซ่อนก่อนปิด (API ต้อง 403 หรือ 400)
code = http_code("GET", f"/uai/{UAI_ID}/pdf", cookie=cookies["mgr"])
check("UAI-040", "Export UAI PDF ก่อนปิด -> 400/403", code in ["400","403"], f"got {code}")

# UAI-012: QC Manager ไม่อนุมัติ -> uai_rejected
r_rej = curl_json("POST", f"/uai/{UAI_ID}/qc-manager-review", {"decision":"reject","comment":"ไม่อนุมัติ"}, cookies["mgr"])
check("UAI-012", "QC Manager ไม่อนุมัติ -> uai_rejected", r_rej.get("status") == "uai_rejected", str(r_rej))

# สร้าง NCR/UAI ใหม่อีกครั้งสำหรับทดสอบ signing flow
r = curl_json("POST", "/bills", {"supplier_id":SUP_ID,"invoice_no":f"UAI2-INV-{UNIQUE}","po_no":f"UAI2-PO-{UNIQUE}","received_date":"2024-06-12"}, cookies["staff"])
BILL3_ID = r.get("id")
r = curl_json("POST", f"/bills/{BILL3_ID}/items", {"product_id":PROD_ID,"item_name":f"UAI2 Product {UNIQUE}","qty_received":50,"qty_sampled":25,"qty_passed":35,"qty_failed":15,"defect_category_id":DC_ID,"defect_detail":"ขนาดเกิน"}, cookies["staff"])
ITEM3_ID = r.get("id")
cmd = ["curl", "-s", "-X", "POST", f"{BASE}/bills/{BILL3_ID}/items/{ITEM3_ID}/images",
       "-F", f"images=@{img_path};type=image/jpeg", "-b", cookies["staff"]]
subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace')
curl_json("POST", f"/bills/{BILL3_ID}/submit", cookie=cookies["staff"])
curl_json("POST", f"/bills/{BILL3_ID}/approve", {}, cookies["super"])
r = curl_json("POST", "/ncr", {"bill_id":BILL3_ID,"bill_item_id":ITEM3_ID,"severity":"major","description":"ต้องทำ UAI flow ครบ"}, cookies["staff"])
NCR3_ID = r.get("id")
curl_json("POST", f"/ncr/{NCR3_ID}/approve", {"action":"approve"}, cookies["super"])
curl_json("POST", f"/ncr/{NCR3_ID}/approve", {"action":"approve"}, cookies["mgr"])
r = curl_json("POST", f"/ncr/{NCR3_ID}/approve", {"action":"approve"}, cookies["qmr"])
curl_json("POST", f"/ncr/{NCR3_ID}/request-uai", {}, cookies["pur"])

uai_list3 = curl_json("GET", "/uai?status=uai_pending_qc_manager", cookie=cookies["mgr"])
UAI3_ID = uai_list3[0]["id"] if isinstance(uai_list3, list) and len(uai_list3) > 0 else None
check("UAI-003-SETUP", "สร้าง UAI รอ QC Manager อนุมัติ", bool(UAI3_ID))

# UAI-011: QC Manager อนุมัติเปิด UAI
r = curl_json("POST", f"/uai/{UAI3_ID}/qc-manager-review", {"decision":"approve","comment":"อนุมัติเปิดเอกสาร"}, cookies["mgr"])
check("UAI-011", "QC Manager อนุมัติเปิด UAI", r.get("status") == "uai_pending_purchasing", str(r))

# UAI-020: ดึงข้อมูล UAI
r_uai = curl_json("GET", f"/uai/{UAI3_ID}", cookie=cookies["pur"])
check("UAI-020", "ข้อมูล NCR ปรากฏใน UAI", bool(r_uai.get("ncr_code")) or bool(r_uai.get("item_name")), str(r_uai)[:100])

# UAI-022: Purchasing กรอกข้อมูล + ลงนาม
with open(img_path, "rb") as f:
    img_data = f.read()
import base64
sig_b64 = "data:image/png;base64," + base64.b64encode(img_data).decode()

r = curl_json("PATCH", f"/uai/{UAI3_ID}/details", {
    "reason":"สินค้ายังอยู่ในช่วงค่าที่ยอมรับได้",
    "conditions":"ใช้ได้ไม่เกิน 30 วัน",
    "department":"ฝ่ายผลิต",
    "issued_date":"2024-06-12"
}, cookies["pur"])
check("UAI-022a", "Purchasing บันทึกรายละเอียด UAI", r.get("ok") == True, str(r))

r = curl_json("POST", f"/uai/{UAI3_ID}/sign", {
    "role":"purchasing","signature_image": sig_b64
}, cookies["pur"])
check("UAI-022b", "Purchasing ลงนาม -> uai_pending_cco", r.get("status") == "uai_pending_cco", str(r))

# UAI-023: ช่อง CCO ยังล็อก (ก่อน purchasing ลงนาม = UAI เพิ่งย้ายไป uai_pending_cco)
# ทดสอบว่า cmo ลงนามใน cco slot ไม่ได้
r = curl_json("POST", f"/uai/{UAI3_ID}/sign", {"role":"cco","signature_image": sig_b64}, cookies["cmo"])
check("UAI-026", "cmo ลงนามใน cco slot ไม่ได้ -> error", "error" in r, str(r))

# UAI-025: CCO ลงนาม
r = curl_json("POST", f"/uai/{UAI3_ID}/sign", {"role":"cco","signature_image": sig_b64}, cookies["cco"])
check("UAI-025", "CCO ลงนาม -> uai_pending_cmo", r.get("status") == "uai_pending_cmo", str(r))

# UAI-027: CMO ลงนาม
r = curl_json("POST", f"/uai/{UAI3_ID}/sign", {"role":"cmo","signature_image": sig_b64}, cookies["cmo"])
check("UAI-027", "CMO ลงนาม -> uai_pending_cpo", r.get("status") == "uai_pending_cpo", str(r))

# UAI-028: CPO ลงนาม
r = curl_json("POST", f"/uai/{UAI3_ID}/sign", {"role":"cpo","signature_image": sig_b64}, cookies["cpo"])
check("UAI-028", "CPO ลงนาม -> uai_pending_qc_ack", r.get("status") == "uai_pending_qc_ack", str(r))

# UAI-029: QC Manager รับทราบ
r = curl_json("POST", f"/uai/{UAI3_ID}/sign", {"role":"qc_manager","signature_image": sig_b64}, cookies["mgr"])
check("UAI-029", "QC Manager รับทราบ -> uai_pending_production_ack", r.get("status") == "uai_pending_production_ack", str(r))

# UAI-030: Production Manager รับทราบ
r = curl_json("POST", f"/uai/{UAI3_ID}/sign", {"role":"production_manager","signature_image": sig_b64}, cookies["prod"])
check("UAI-030", "Production Manager รับทราบ -> uai_pending_qmr_ack", r.get("status") == "uai_pending_qmr_ack", str(r))

# UAI-031: QMR รับทราบ ปิดเอกสาร
r = curl_json("POST", f"/uai/{UAI3_ID}/sign", {"role":"qmr","signature_image": sig_b64}, cookies["qmr"])
check("UAI-031", "QMR รับทราบ -> uai_completed", r.get("status") == "uai_completed", str(r))

# UAI-041: Export ปรากฏหลังปิด
code = http_code("GET", f"/uai/{UAI3_ID}/pdf", cookie=cookies["mgr"])
check("UAI-041", "Export UAI PDF หลัง uai_completed -> 200", code == "200", f"got {code}")
code = http_code("GET", f"/uai/{UAI3_ID}/excel", cookie=cookies["mgr"])
check("UAI-043", "Export UAI Excel -> 200", code == "200", f"got {code}")

# ===== REPORTS =====
print("\n=== REPORTS ===")
code = http_code("GET", "/reports/summary", cookie=cookies["mgr"])
check("RPT-001", "qc_manager เข้า /reports ได้", code == "200", f"got {code}")
code = http_code("GET", "/reports/summary", cookie=cookies["staff"])
check("RPT-002", "qc_staff เข้า /reports ไม่ได้ -> 403", code == "403", f"got {code}")

r = curl_json("GET", "/reports/receiving?from=2024-01-01&to=2026-12-31", cookie=cookies["mgr"])
check("RPT-003", "Report receiving มีข้อมูล", "summary" in r, str(r)[:80])
r = curl_json("GET", "/reports/ncr?from=2024-01-01&to=2026-12-31", cookie=cookies["mgr"])
check("RPT-003b", "Report NCR มีข้อมูล", "summary" in r, str(r)[:80])
r = curl_json("GET", "/reports/uai?from=2024-01-01&to=2026-12-31", cookie=cookies["mgr"])
check("RPT-003c", "Report UAI มีข้อมูล", "summary" in r, str(r)[:80])
r = curl_json("GET", "/reports/summary?from=2024-01-01&to=2026-12-31", cookie=cookies["mgr"])
check("RPT-008", "Supplier scorecard แสดง", "supplier_scorecard" in r, str(r)[:80])

code = http_code("GET", "/reports/receiving/excel?from=2024-01-01&to=2026-12-31", cookie=cookies["mgr"])
check("RPT-006", "Export Excel receiving -> 200", code == "200", f"got {code}")
code = http_code("GET", "/reports/ncr/excel?from=2024-01-01&to=2026-12-31", cookie=cookies["mgr"])
check("RPT-006b", "Export Excel NCR -> 200", code == "200", f"got {code}")

# ===== NOTIFICATIONS =====
print("\n=== NOTIFICATIONS ===")
r = curl_json("GET", "/notifications", cookie=cookies["super"])
check("NOTIF-001", "notifications endpoint returns list", isinstance(r, list), str(r)[:80])

r = curl_json("PATCH", "/notifications/read-all", cookie=cookies["super"])
check("NOTIF-004", "mark-all-read -> ok", r.get("ok") == True, str(r))

p = sum(1 for _, ok in results if ok)
f = sum(1 for _, ok in results if not ok)
print(f"\n=== RESULTS: {p} passed, {f} failed ===")
print(f"UAI3_ID={UAI3_ID} NCR_ID={NCR_ID} NCR3_ID={NCR3_ID}")
