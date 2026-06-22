import subprocess, json, os, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = "http://localhost:3001/api"
results = []
UNIQUE = str(int(time.time()))[-6:]  # suffix for unique codes

def curl_json(method, path, data=None, cookie=None):
    cmd = ["curl", "-s", "-X", method, f"{BASE}{path}"]
    if data is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(data)]
    if cookie:
        cmd += ["-b", cookie, "-c", cookie]
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

TMP = "c:\\Users\\Narabas.s\\AppData\\Local\\Temp"

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

print("=== AUTH ===")
r = curl_json("POST", "/auth/login", {"username":"admin","password":"admin1234"})
check("AUTH-001","Login admin สำเร็จ", r.get("role") == "admin")

r = curl_json("POST", "/auth/login", {"username":"admin","password":"WRONG"})
check("AUTH-002","Login ผิด password -> error", "error" in r)
check("AUTH-002b","Error message มี 'ไม่ถูกต้อง'", "ไม่ถูกต้อง" in str(r.get("error","")), str(r))

r = curl_json("POST", "/auth/login", {"username":"nonexistent","password":"x"})
check("AUTH-003","Login ผิด username -> error", "error" in r)

code = http_code("GET", "/bills")
check("AUTH-007","GET /bills ไม่มี cookie -> 401", code == "401", f"got {code}")

code = http_code("GET", "/master/suppliers", cookie=cookies["staff"])
check("AUTH-009","qc_staff GET /master API (dropdown OK for forms)", code == "200", f"got {code}")

code = http_code("POST", "/ncr/999/approve", {"action":"approve"}, cookies["staff"])
check("SEC-002","qc_staff POST /ncr/approve -> 403 (role before DB)", code == "403", f"got {code}")

r_verbose = subprocess.run(["curl", "-sv", "-X", "POST", f"{BASE}/auth/login",
    "-H","Content-Type: application/json","-d",json.dumps({"username":"admin","password":"admin1234"})],
    capture_output=True, encoding='utf-8', errors='replace')
check("SEC-007","JWT ใน HttpOnly cookie", "HttpOnly" in r_verbose.stderr or "HttpOnly" in r_verbose.stdout)

print("\n=== MASTER LIST ===")
r = curl_json("POST", "/master/suppliers", {"code":f"SUP-{UNIQUE}-1","name":f"บริษัท ABC {UNIQUE} จำกัด","contact_name":"สมชาย","contact_email":"abc@test.com","contact_phone":"0812345678"}, cookies["admin"])
SUP_ID = r.get("id")
check("MST-001","เพิ่ม Supplier สำเร็จ", bool(SUP_ID), str(r))

r = curl_json("POST", "/master/suppliers", {"code":f"S-{UNIQUE}"}, cookies["admin"])
check("MST-002","เพิ่ม Supplier ไม่กรอกชื่อ -> error", "error" in r, str(r))

r = curl_json("PATCH", f"/master/suppliers/{SUP_ID}", {"name":f"บริษัท ABC {UNIQUE} Updated"}, cookies["admin"])
check("MST-003","แก้ไข Supplier", r.get("id") == SUP_ID, str(r))

r = curl_json("PATCH", f"/master/suppliers/{SUP_ID}/toggle", cookie=cookies["admin"])
check("MST-004","ปิดใช้งาน Supplier (is_active=0)", r.get("is_active") == 0, str(r))

r = curl_json("GET", "/master/suppliers", cookie=cookies["staff"])
ids_in_dropdown = [s["id"] for s in r] if isinstance(r, list) else []
check("MST-004c","Supplier ที่ปิดไม่ขึ้น dropdown", SUP_ID not in ids_in_dropdown, f"found {SUP_ID} in {ids_in_dropdown}")

r = curl_json("PATCH", f"/master/suppliers/{SUP_ID}/toggle", cookie=cookies["admin"])
check("MST-005","เปิดใช้งาน Supplier กลับ (is_active=1)", r.get("is_active") == 1, str(r))

r = curl_json("GET", f"/master/suppliers?search=ABC+{UNIQUE}", cookie=cookies["admin"])
check("MST-006","ค้นหา Supplier ด้วยชื่อ", isinstance(r, list) and len(r) > 0)

r = curl_json("POST", "/master/product-groups", {"code":f"PG-{UNIQUE}-1","name":"เส้น ALU","require_inspection_doc":1}, cookies["admin"])
PG_ID = r.get("id")
check("MST-010","Product Group require_inspection_doc=1", r.get("require_inspection_doc") == 1, str(r))

r = curl_json("POST", "/master/product-groups", {"code":f"PG-{UNIQUE}-2","name":"อะไหล่ Hardware","require_inspection_doc":0}, cookies["admin"])
PG2_ID = r.get("id")
check("MST-011","Product Group require_inspection_doc=0", r.get("require_inspection_doc") == 0, str(r))

r = curl_json("POST", "/master/units", {"code":f"PCS-{UNIQUE}","name":"ชิ้น"}, cookies["admin"])
UNIT_ID = r.get("id")
check("UNIT-1","เพิ่ม Unit", bool(UNIT_ID), str(r))

r = curl_json("POST", "/master/products", {"code":f"P-{UNIQUE}-1","name":"เพลาเหล็ก 10mm","supplier_id":SUP_ID,"product_group_id":PG_ID,"unit_id":UNIT_ID}, cookies["admin"])
PROD_ID = r.get("id")
check("MST-020","เพิ่มสินค้าครบทุกฟิลด์", bool(PROD_ID), str(r))

r = curl_json("GET", f"/master/products?supplier_id={SUP_ID}", cookie=cookies["staff"])
check("MST-024","dropdown Product กรองตาม Supplier", isinstance(r, list) and len(r) > 0 and r[0].get("supplier_id") == SUP_ID)
r2 = curl_json("GET", "/master/products?supplier_id=99999", cookie=cookies["staff"])
check("MST-024b","ไม่แสดงสินค้า Supplier อื่น (empty)", r2 == [], f"got {r2}")

r = curl_json("POST", "/master/defect-categories", {"code":f"DC-{UNIQUE}-1","name":"ขนาดไม่ตรงสเปค"}, cookies["admin"])
DC_ID = r.get("id")
check("MST-030","เพิ่มกลุ่มปัญหา", bool(DC_ID), str(r))

r = curl_json("PATCH", f"/master/defect-categories/{DC_ID}/toggle", cookie=cookies["admin"])
check("MST-031a","ปิดกลุ่มปัญหา (is_active=0)", r.get("is_active") == 0)
r = curl_json("GET", "/master/defect-categories", cookie=cookies["staff"])
dc_ids = [d["id"] for d in r] if isinstance(r, list) else []
check("MST-031b","กลุ่มปัญหาที่ปิดไม่ขึ้น dropdown", DC_ID not in dc_ids, f"found {DC_ID} in {dc_ids}")
curl_json("PATCH", f"/master/defect-categories/{DC_ID}/toggle", cookie=cookies["admin"])

r2s = curl_json("POST", "/master/suppliers", {"code":f"SUP-{UNIQUE}-2","name":f"บริษัท XYZ {UNIQUE} จำกัด","contact_name":"มานะ","contact_email":"xyz@test.com","contact_phone":"0899"}, cookies["admin"])
SUP2_ID = r2s.get("id")

# Product ที่ไม่ต้องแนบ inspection doc (PG2_ID)
r = curl_json("POST", "/master/products", {"code":f"P-{UNIQUE}-2","name":"น็อตสแตนเลส","supplier_id":SUP_ID,"product_group_id":PG2_ID,"unit_id":UNIT_ID}, cookies["admin"])
PROD2_ID = r.get("id")

img_path = f"{TMP}\\fake_img.jpg"
with open(img_path, "wb") as f:
    f.write(b"\xff\xd8\xff\xe0" + b"fake jpeg for test" * 10)

print("\n=== BILL ===")
r = curl_json("POST", "/bills", {"supplier_id":SUP_ID,"invoice_no":f"INV-{UNIQUE}","po_no":f"PO-{UNIQUE}","received_date":"2024-06-12"}, cookies["staff"])
BILL_ID = r.get("id")
check("BILL-001","สร้างบิลสำเร็จ", bool(BILL_ID), str(r))

r = curl_json("POST", "/bills", {"supplier_id":1}, cookies["staff"])
check("BILL-002","สร้างบิลไม่ครบ field -> error", "error" in r, str(r))

# เพิ่มรายการผ่านโดยใช้ PROD2 (group ไม่ต้องแนบ inspection doc)
r = curl_json("POST", f"/bills/{BILL_ID}/items", {
    "product_id":PROD2_ID,"item_name":"น็อตสแตนเลส",
    "qty_received":100,"qty_sampled":50,"qty_passed":100,"qty_failed":0
}, cookies["staff"])
ITEM_PASS_ID = r.get("id")
check("BILL-010","เพิ่มรายการสินค้าผ่าน (qty_failed=0)", bool(ITEM_PASS_ID), str(r))
check("BILL-035","qty_failed=0 บันทึกสำเร็จ", r.get("qty_failed") == 0)

# ทดสอบ BILL-031: เพิ่ม item fail ไม่มี defect_category
r_nc = curl_json("POST", f"/bills/{BILL_ID}/items", {
    "product_id":PROD2_ID,"item_name":"น็อตสแตนเลส (fail)",
    "qty_received":50,"qty_sampled":25,"qty_passed":15,"qty_failed":10,
    "defect_detail":"รอยขีดข่วน"
}, cookies["staff"])
FAIL_NC_ID = r_nc.get("id")
r = curl_json("POST", f"/bills/{BILL_ID}/submit", cookie=cookies["staff"])
check("BILL-031","บล็อก submit ไม่มี defect_category", "error" in r and "กลุ่มปัญหา" in str(r.get("error","")), str(r))

# ลบ item ที่ไม่ครบ
curl_json("DELETE", f"/bills/{BILL_ID}/items/{FAIL_NC_ID}", cookie=cookies["staff"])

# ทดสอบ BILL-032: เพิ่ม item fail ไม่มี defect_detail
r_nd = curl_json("POST", f"/bills/{BILL_ID}/items", {
    "product_id":PROD2_ID,"item_name":"น็อตสแตนเลส (fail)",
    "qty_received":50,"qty_sampled":25,"qty_passed":15,"qty_failed":10,
    "defect_category_id":DC_ID
}, cookies["staff"])
FAIL_ND_ID = r_nd.get("id")
r = curl_json("POST", f"/bills/{BILL_ID}/submit", cookie=cookies["staff"])
check("BILL-032","บล็อก submit ไม่มี defect_detail", "error" in r and "รายละเอียด" in str(r.get("error","")), str(r))
curl_json("DELETE", f"/bills/{BILL_ID}/items/{FAIL_ND_ID}", cookie=cookies["staff"])

# เพิ่ม item fail ครบ
r = curl_json("POST", f"/bills/{BILL_ID}/items", {
    "product_id":PROD2_ID,"item_name":"น็อตสแตนเลส (fail)",
    "qty_received":50,"qty_sampled":25,"qty_passed":15,"qty_failed":10,
    "defect_category_id":DC_ID,"defect_detail":"พบรอยขีดข่วน"
}, cookies["staff"])
FAIL_ITEM_ID = r.get("id")
check("BILL-030","เพิ่มรายการ qty_failed=10 พร้อม defect info", bool(FAIL_ITEM_ID), str(r))

# BILL-033: submit ไม่มีรูปภาพ
r = curl_json("POST", f"/bills/{BILL_ID}/submit", cookie=cookies["staff"])
check("BILL-033","บล็อก submit ไม่มีรูปภาพ", "error" in r and "รูปภาพ" in str(r.get("error","")), str(r))

# อัปโหลดรูปภาพปัญหา
cmd = ["curl", "-s", "-X", "POST", f"{BASE}/bills/{BILL_ID}/items/{FAIL_ITEM_ID}/images",
       "-F", f"images=@{img_path};type=image/jpeg", "-b", cookies["staff"]]
res = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace')
try:
    img_r = json.loads(res.stdout)
    upload_ok = img_r.get("ok") == True and img_r.get("count", 0) > 0
except:
    upload_ok = False
check("UPLOAD-1","อัปโหลดรูปภาพปัญหา {ok:true,count:N}", upload_ok, (res.stdout or "")[:80])

# Submit หลังครบ
r = curl_json("POST", f"/bills/{BILL_ID}/submit", cookie=cookies["staff"])
check("BILL-SUBMIT","Submit บิล -> pending_approval", r.get("status") == "pending_approval", str(r))

code = http_code("POST", f"/bills/{BILL_ID}/approve", {}, cookies["staff"])
check("BILL-041","qc_staff POST /bills/approve -> 403", code == "403", f"got {code}")

r = curl_json("POST", f"/bills/{BILL_ID}/approve", {}, cookies["super"])
check("BILL-040","QC Supervisor อนุมัติบิล -> approved", r.get("status") == "approved", str(r))

p = sum(1 for _, ok in results if ok)
f = sum(1 for _, ok in results if not ok)
print(f"\n=== RESULTS: {p} passed, {f} failed ===")
print(f"IDs: BILL={BILL_ID} FAIL_ITEM={FAIL_ITEM_ID} SUP={SUP_ID} DC={DC_ID} PROD={PROD_ID} PROD2={PROD2_ID} PG={PG_ID}")
