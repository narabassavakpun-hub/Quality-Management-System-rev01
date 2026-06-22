#!/usr/bin/env python3
"""
clear_database.py — ล้างข้อมูลใน IQC Database
================================================
โหมด 1 (ค่าเริ่มต้น) : ล้างข้อมูล Transaction ทั้งหมด + รีเซ็ต Sequence
                        คง Master Data ไว้ (Users, Suppliers, Products ฯลฯ)
โหมด 2              : ล้าง ทุกอย่าง รวม Master Data และ Users ด้วย

ใช้งาน:
    python clear_database.py              # โหมด 1 — ล้าง transaction เท่านั้น
    python clear_database.py --all        # โหมด 2 — ล้างทั้งหมด
    python clear_database.py --yes        # ข้าม confirmation prompt

ต้องการ: Python 3.6+ (ใช้ sqlite3 built-in ไม่ต้อง install เพิ่ม)
"""

import sqlite3
import os
import sys
import shutil
import argparse
from datetime import datetime

# ============================================================
# PATH CONFIG
# ============================================================
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH      = os.path.join(SCRIPT_DIR, 'iqc-system', 'iqc.db')
BACKUP_DIR   = os.path.join(SCRIPT_DIR, 'db_backups')

# ============================================================
# TABLES TO DELETE — เรียงลำดับ leaf → parent (FK-safe)
# ============================================================

# ตาราง Transaction ทั้งหมด (ล้างเสมอในโหมด 1 และ 2)
TRANSACTION_TABLES = [
    # Delivery (leaf ก่อน)
    'delivery_schedule_attachments',
    'delivery_schedule_items',
    'delivery_schedules',

    # UAI (leaf → parent)
    'uai_signatures',
    'uai_documents',

    # NCR (leaf → parent)
    're_inspection_images',
    're_inspections',
    'supplier_response_attachments',
    'supplier_responses',
    'ncr_images',
    'ncr_approvals',
    'ncr_items',
    'ncrs',

    # Bill (leaf → parent)
    'bill_item_equipment',
    'bill_item_certificates',
    'bill_item_inspection_docs',
    'bill_item_images',
    'bill_items',
    'bill_images',
    'bills',

    # Notification + Audit
    'notifications',
    'audit_logs',
    'password_reset_logs',
]

# ตาราง Master Data (ล้างเฉพาะโหมด 2 -- --all)
MASTER_TABLES = [
    # Product relationships (leaf ก่อน)
    'product_suppliers',
    'product_colors',
    'product_images',
    'product_drawings',
    'products',

    # Supplier relationships
    'supplier_evaluations',
    'supplier_risks',
    'supplier_approval_history',
    'suppliers',

    # Lookup tables
    'aql_tables',
    'measuring_equipment',
    'defect_categories',
    'product_groups',
    'units',
    'colors',
    'models',

    # Settings (reset ค่า ไม่ได้ลบ row)
    # จัดการแยกด้านล่าง
]

# Sequences ที่ต้อง reset
SEQUENCE_DOC_TYPES = ['NCR', 'UAI', 'NCP']

# ============================================================
# UTILITY
# ============================================================

RESET  = '\033[0m'
RED    = '\033[91m'
GREEN  = '\033[92m'
YELLOW = '\033[93m'
CYAN   = '\033[96m'
BOLD   = '\033[1m'

def cprint(color, msg):
    print(f"{color}{msg}{RESET}")

def hr(char='─', width=60):
    print(char * width)

# ============================================================
# BACKUP
# ============================================================

def backup_db(db_path: str) -> str:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts      = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup  = os.path.join(BACKUP_DIR, f'iqc_backup_{ts}.db')
    shutil.copy2(db_path, backup)
    return backup

# ============================================================
# CLEAR LOGIC
# ============================================================

def get_row_count(cur: sqlite3.Cursor, table: str) -> int:
    try:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        return cur.fetchone()[0]
    except sqlite3.OperationalError:
        return -1  # table ไม่มี

def clear_tables(cur: sqlite3.Cursor, tables: list[str]) -> dict:
    counts = {}
    for table in tables:
        before = get_row_count(cur, table)
        if before == -1:
            counts[table] = ('SKIP', 0)
            continue
        cur.execute(f"DELETE FROM {table}")
        counts[table] = ('OK', before)
    return counts

def reset_sequences(cur: sqlite3.Cursor, doc_types: list[str]):
    year = datetime.now().year
    for dt in doc_types:
        cur.execute(
            "UPDATE document_sequences SET last_seq = 0, year = ? WHERE doc_type = ?",
            (year, dt)
        )
        if cur.rowcount == 0:
            cur.execute(
                "INSERT INTO document_sequences (doc_type, year, last_seq) VALUES (?, ?, 0)",
                (dt, year)
            )

def reset_autoincrement(cur: sqlite3.Cursor, tables: list[str]):
    for table in tables:
        cur.execute(
            "DELETE FROM sqlite_sequence WHERE name = ?", (table,)
        )

def clear_master_data(cur: sqlite3.Cursor) -> dict:
    return clear_tables(cur, MASTER_TABLES)

def reset_settings(cur: sqlite3.Cursor):
    """Reset settings กลับค่า default — ไม่ลบ row"""
    defaults = {
        'telegram_bot_token': '',
        'telegram_group_qc': '',
        'telegram_group_purchasing': '',
        'app_url': 'http://localhost:5173',
        'token_expiry_days': '90',
        'company_name': '',
        'company_address': '',
        'company_logo': '',
        'ncr_img_cols': '3',
        'ncr_img_max_width': '180',
        'uai_img_cols': '3',
        'uai_img_max_width': '160',
    }
    for key, val in defaults.items():
        cur.execute(
            "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?",
            (val, key)
        )

# ============================================================
# PRINT REPORT
# ============================================================

def print_report(results: dict, title: str):
    hr()
    cprint(CYAN, f"  {title}")
    hr()
    total_rows = 0
    for table, (status, rows) in results.items():
        if status == 'SKIP':
            print(f"  {'⚠️ ':3} {table:<45} (ไม่มีตารางนี้)")
        elif status == 'OK':
            marker = GREEN + '✓' + RESET
            print(f"  {marker}  {table:<45} ลบ {rows:>6} แถว")
            total_rows += rows
    hr()
    print(f"  รวม: {total_rows} แถว\n")

# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description='ล้างข้อมูลใน IQC Database',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--all', action='store_true',
                        help='ล้างทุกอย่างรวม Master Data และ Users')
    parser.add_argument('--yes', '-y', action='store_true',
                        help='ข้าม confirmation prompt')
    args = parser.parse_args()

    # ─── ตรวจหา DB ─────────────────────────────────────────
    if not os.path.exists(DB_PATH):
        cprint(RED, f"\n❌  ไม่พบไฟล์ database: {DB_PATH}")
        cprint(YELLOW, "   ตรวจสอบ path หรือรัน server ก่อนเพื่อสร้าง DB\n")
        sys.exit(1)

    db_size_mb = os.path.getsize(DB_PATH) / 1024 / 1024

    # ─── แสดง banner ────────────────────────────────────────
    hr('═')
    cprint(BOLD, '  IQC Database Cleaner')
    hr('═')
    print(f"  DB path : {DB_PATH}")
    print(f"  DB size : {db_size_mb:.2f} MB")
    if args.all:
        cprint(RED, "  โหมด    : ล้าง ทุกอย่าง (รวม Master Data + Users)")
    else:
        cprint(YELLOW, "  โหมด    : ล้างเฉพาะ Transaction (คง Master Data ไว้)")
    hr('═')

    # ─── Confirmation ────────────────────────────────────────
    if not args.yes:
        if args.all:
            cprint(RED, "\n⚠️  คำเตือน: การดำเนินการนี้จะลบ Master Data และ Users ทั้งหมด!")
            cprint(RED, "   ระบบจะต้อง seed ข้อมูลใหม่ก่อนใช้งาน\n")
        confirm = input("  พิมพ์ 'YES' เพื่อยืนยัน หรือ กด Enter เพื่อยกเลิก: ").strip()
        if confirm != 'YES':
            cprint(YELLOW, "\n  ยกเลิกการดำเนินการ\n")
            sys.exit(0)
        print()

    # ─── Backup ─────────────────────────────────────────────
    print("  กำลังสำรองข้อมูล...")
    backup_path = backup_db(DB_PATH)
    cprint(GREEN, f"  ✓ Backup: {backup_path}\n")

    # ─── Connect และ Clear ──────────────────────────────────
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()

    try:
        # ปิด FK ชั่วคราวเพื่อลบข้ามตาราง
        cur.execute("PRAGMA foreign_keys = OFF")
        cur.execute("BEGIN TRANSACTION")

        # 1. ล้าง Transaction tables
        tx_results = clear_tables(cur, TRANSACTION_TABLES)

        # 2. ล้าง Master Data (โหมด --all เท่านั้น)
        master_results = {}
        if args.all:
            master_results = clear_master_data(cur)
            reset_settings(cur)

        # 3. Reset document sequences
        reset_sequences(cur, SEQUENCE_DOC_TYPES)

        # 4. Reset AUTOINCREMENT counters
        all_cleared = list(TRANSACTION_TABLES)
        if args.all:
            all_cleared += MASTER_TABLES
        reset_autoincrement(cur, all_cleared)

        conn.commit()

    except Exception as e:
        conn.rollback()
        cprint(RED, f"\n❌  เกิดข้อผิดพลาด: {e}")
        cprint(YELLOW, f"   ข้อมูลไม่ถูกเปลี่ยนแปลง (rollback แล้ว)")
        cprint(YELLOW, f"   Backup อยู่ที่: {backup_path}\n")
        sys.exit(1)
    finally:
        cur.execute("PRAGMA foreign_keys = ON")
        conn.close()

    # ─── VACUUM (คืนพื้นที่) ─────────────────────────────────
    print("  กำลัง VACUUM database...")
    conn2 = sqlite3.connect(DB_PATH)
    conn2.execute("VACUUM")
    conn2.close()

    new_size_mb = os.path.getsize(DB_PATH) / 1024 / 1024
    cprint(GREEN, f"  ✓ ลดขนาด DB: {db_size_mb:.2f} MB → {new_size_mb:.2f} MB\n")

    # ─── รายงาน ─────────────────────────────────────────────
    print_report(tx_results, "Transaction Tables")
    if master_results:
        print_report(master_results, "Master Data Tables")

    # ─── สรุป ────────────────────────────────────────────────
    hr('═')
    cprint(GREEN + BOLD, "  ✓ เคลียร์ข้อมูลเสร็จสมบูรณ์")
    if args.all:
        cprint(YELLOW, "  → รัน server ใหม่เพื่อ seed ข้อมูลเริ่มต้น (AQL tables, sequences, settings)")
    else:
        cprint(CYAN, "  → Master Data คงอยู่ สามารถใช้งานได้ทันที")
    cprint(CYAN, f"  → Backup: {backup_path}")
    hr('═')
    print()


if __name__ == '__main__':
    main()
