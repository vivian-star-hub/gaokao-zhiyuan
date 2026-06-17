#!/usr/bin/env python3
"""
山东高考数据导入工具

用法：
    # 1. 把新一年的 xls/xlsx 文件放进 data-raw/ 目录
    #    命名建议：YYYY-toudang-r1.xls / YYYY-yfdydb.xls / YYYY-pcx.pdf / YYYY-toudang-art.xls

    # 2. 跑导入
    python import.py                          # 自动处理所有 data-raw/ 文件
    python import.py --file data-raw/2025-toudang-r1.xls
    python import.py --year 2025 --dry-run    # 试运行不写文件

    # 3. 看生成结果
    ls -la data/
"""
import os, sys, json, re, shutil, argparse, subprocess
from pathlib import Path
from collections import defaultdict

try:
    import xlrd
except ImportError:
    print("❌ 缺少 xlrd. 运行: pip install xlrd")
    sys.exit(1)

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

PROJECT = Path(__file__).parent
RAW_DIR = PROJECT / "data-raw"
DATA_DIR = PROJECT / "data"

# ============================================================
# 解析器集合
# ============================================================

def parse_yfdydb(path):
    """解析一分一段表（表头跨多行：第一行类别，第二行字段）"""
    wb = xlrd.open_workbook(path)
    result = {}
    for sh in wb.sheets():
        # 找类别行（R1 通常含 "选考物理" "选考历史" 等）
        cat_row = -1
        for r in range(min(3, sh.nrows)):
            row_str = " ".join(str(sh.cell_value(r, c)).strip() for c in range(sh.ncols))
            if "选考物理" in row_str or "选考历史" in row_str:
                cat_row = r
                break
        if cat_row < 0: continue

        # 类别列
        cat_cols = {}
        for c in range(sh.ncols):
            v = str(sh.cell_value(cat_row, c)).strip()
            if v in ["选考物理", "物理"]: cat_cols["物理"] = c
            elif v in ["选考历史", "历史"]: cat_cols["历史"] = c
            elif v in ["全体", "全部", "总计", "考生"]: cat_cols["__全体__"] = c
        # 字段行（cat_row + 1）：本段人数 / 累计人数
        field_row = cat_row + 1
        # 对每个类别找"本段人数"和"累计人数"列
        cat_field_cols = {}
        for cat, start_col in cat_cols.items():
            # 找 start_col 后第一个 "本段人数" 和 "累计人数"
            for c in range(start_col, min(start_col + 4, sh.ncols)):
                v = str(sh.cell_value(field_row, c)).strip()
                if v == "本段人数" and "count" not in cat_field_cols.get(cat, {}):
                    cat_field_cols.setdefault(cat, {})["count"] = c
                elif v == "累计人数" and "cum" not in cat_field_cols.get(cat, {}):
                    cat_field_cols.setdefault(cat, {})["cum"] = c

        # 读数据
        for cat, fields in cat_field_cols.items():
            rows = []
            for r in range(field_row + 1, sh.nrows):
                score = sh.cell_value(r, 0)
                if not score or score == "": continue
                try:
                    score_i = int(float(score))
                except:
                    continue
                if score_i <= 0 or score_i > 800: continue
                count = sh.cell_value(r, fields.get("count", -1)) if "count" in fields else None
                cum = sh.cell_value(r, fields.get("cum", -1)) if "cum" in fields else None
                try: count_i = int(count) if count != "" and count is not None else None
                except: count_i = None
                try: cum_i = int(cum) if cum != "" and cum is not None else None
                except: cum_i = None
                rows.append({"score": score_i, "count": count_i, "cumulative": cum_i})
            if cat in cat_cols and cat != "__全体__":
                result[cat] = {
                    "verified": "verified",
                    "source": f"sdzk.cn {sh.name}",
                    "rows": rows
                }
    return result

def parse_pcx(path):
    """解析批次线（PDF）"""
    if not pdfplumber:
        print("⚠️ 跳过 PDF: 需要 pdfplumber")
        return {}
    result = {}
    with pdfplumber.open(path) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    # 简单规则匹配
    patterns = [
        ("本科批", r"本科批.*?(\d{3,4})"),
        ("特殊类型招生控制线", r"特殊类型.*?(\d{3,4})"),
        ("专科批", r"专科批.*?(\d{3,4})"),
    ]
    # 实际批次线 PDF 格式多变，建议人工对照
    return {"_raw_text": text[:500]}

def parse_toudang(path):
    """解析投档表（普通类 / 艺体）"""
    wb = xlrd.open_workbook(path)
    records = []
    category = None
    is_artsports = False

    for sh in wb.sheets():
        # 检测标题
        title_str = ""
        for r in range(min(3, sh.nrows)):
            for c in range(min(sh.ncols, 4)):
                v = str(sh.cell_value(r, c)).strip()
                if any(k in v for k in ["艺术", "体育", "春季", "美术", "音乐", "舞蹈"]):
                    title_str = v
                    break
            if title_str: break

        is_artsports = bool(title_str)
        if is_artsports:
            from re import search
            if "美术" in title_str or "设计" in title_str: category = "美术与设计类"
            elif "音乐" in title_str: category = "音乐类"
            elif "舞蹈" in title_str: category = "舞蹈类"
            elif "表(导)演" in title_str or "表演" in title_str: category = "表(导)演类"
            elif "播音" in title_str: category = "播音与主持类"
            elif "书法" in title_str: category = "书法类"
            elif "体育" in title_str: category = "体育类"
            elif "航空服务" in title_str: category = "航空服务艺术类"
            else: category = "其他"

        # 找表头
        header_row = -1
        for r in range(min(3, sh.nrows)):
            row_str = " ".join(str(sh.cell_value(r, c)).strip() for c in range(min(sh.ncols, 10)))
            if ("院校" in row_str or "学校" in row_str) and "计划" in row_str:
                header_row = r
                break
        if header_row < 0: continue

        cols = {}
        for c in range(sh.ncols):
            v = str(sh.cell_value(header_row, c)).strip()
            if "专业" in v: cols["major"] = c
            elif "院校" in v or "学校" in v: cols["school"] = c
            elif "计划" in v: cols["plan"] = c
            elif "位次" in v: cols["rank"] = c
            elif "分数" in v or "最低" in v: cols["score"] = c

        for r in range(header_row + 1, sh.nrows):
            try:
                major = str(sh.cell_value(r, cols.get("major", 0))).strip() if "major" in cols else ""
                school = str(sh.cell_value(r, cols.get("school", 1))).strip() if "school" in cols else ""
                if not school: continue
                m = re.match(r'([A-Z]\d+)(.*)', school)
                school_code = m.group(1) if m else ""
                school_name = m.group(2) if m else school
                plan = 0
                if "plan" in cols:
                    try: plan = int(float(sh.cell_value(r, cols["plan"])))
                    except: pass
                rec = {
                    "schoolCode": school_code,
                    "schoolName": school_name,
                    "majorName": major,
                    "planCount": plan
                }
                if "rank" in cols:
                    try: rec["minRank"] = int(float(sh.cell_value(r, cols["rank"])))
                    except: rec["minRank"] = 0
                if "score" in cols:
                    try: rec["minScore"] = float(sh.cell_value(r, cols["score"]))
                    except: rec["minScore"] = 0
                if is_artsports:
                    rec["category"] = category
                if school_name and (rec.get("minRank", 0) > 0 or rec.get("minScore", 0) > 0):
                    records.append(rec)
            except: pass
    return records, is_artsports

def parse_plan(path):
    """解析院校专业计划"""
    wb = xlrd.open_workbook(path)
    records = []
    for sh in wb.sheets():
        # 找表头
        header_row = -1
        for r in range(min(6, sh.nrows)):
            row_str = " ".join(str(sh.cell_value(r, c)).strip() for c in range(min(sh.ncols, 10)))
            if "科目要求" in row_str and "计划" in row_str:
                header_row = r
                break
        if header_row < 0: continue

        cols = {}
        for c in range(sh.ncols):
            v = str(sh.cell_value(header_row, c)).strip()
            if "院校代号" in v: cols["code"] = c
            elif "院校" in v and ("专业" in v or "名称" in v): cols["name"] = c
            elif "科目要求" in v: cols["subjects"] = c
            elif "学制" in v: cols["duration"] = c
            elif "计划" in v: cols["plan"] = c
            elif "收费" in v: cols["tuition"] = c

        if "name" not in cols: continue

        current_school = ""
        current_code = ""
        for r in range(header_row + 1, sh.nrows):
            try:
                row = [str(sh.cell_value(r, c)).strip() for c in range(sh.ncols)]
                if "code" in cols and cols["code"] < len(row):
                    code = row[cols["code"]]
                    if code: current_code = code
                name = row[cols["name"]] if cols["name"] < len(row) else ""
                if not name: continue
                # 学校行
                if "code" in cols and cols["code"] < len(row) and row[cols["code"]]:
                    current_school = name
                    continue
                # 专业行
                m = re.match(r'^(\d+)\s*(.*?)(?:[（(]([^）)]+)[）)])?\s*$', name)
                if m:
                    major_code = m.group(1)
                    major_name = m.group(2).strip()
                    major_note = m.group(3).strip() if m.group(3) else ""
                else:
                    major_code, major_name, major_note = "", name, ""
                plan = 0
                if "plan" in cols:
                    try: plan = int(float(row[cols["plan"]]))
                    except: pass
                if current_school and major_name and plan > 0:
                    records.append({
                        "schoolCode": current_code,
                        "schoolName": current_school,
                        "majorCode": major_code,
                        "majorName": major_name,
                        "majorNote": major_note,
                        "subjects": row[cols["subjects"]] if "subjects" in cols and cols["subjects"] < len(row) else "",
                        "duration": row[cols["duration"]] if "duration" in cols and cols["duration"] < len(row) else "",
                        "planCount": plan,
                        "tuition": int(float(row[cols["tuition"]])) if "tuition" in cols and cols["tuition"] < len(row) else 0
                    })
            except: pass
    return records

# ============================================================
# 主流程
# ============================================================

def detect_type(filename):
    """根据文件名推断类型"""
    name = filename.lower()
    if "yfdydb" in name or "一分" in name: return "yfdydb"
    if "pcx" in name or "批次" in name: return "pcx"
    if "toudang" in name or "投档" in name: return "toudang"
    if "plan" in name or "计划" in name: return "plan"
    return None

def detect_year(filename):
    m = re.search(r'(20\d{2})', filename)
    return int(m.group(1)) if m else None

def main():
    parser = argparse.ArgumentParser(description="山东高考数据导入工具")
    parser.add_argument("--file", help="指定单个文件")
    parser.add_argument("--year", type=int, help="指定年份")
    parser.add_argument("--dry-run", action="store_true", help="试运行，不写文件")
    args = parser.parse_args()

    files = []
    if args.file:
        files.append(Path(args.file))
    else:
        for f in sorted(RAW_DIR.iterdir()):
            if f.suffix.lower() in [".xls", ".xlsx", ".pdf"]:
                files.append(f)

    if not files:
        print(f"⚠️ 在 {RAW_DIR} 没找到 .xls/.xlsx/.pdf 文件")
        print("把 sdzk.cn 下载的文件放进来即可，文件名示例：")
        print("  2025-yfdydb.xls")
        print("  2025-toudang-r1.xls")
        print("  2025-toudang-r1-art.xls  (艺术/体育)")
        print("  2025-pcx.pdf")
        return

    DATA_DIR.mkdir(exist_ok=True)

    summary = defaultdict(lambda: defaultdict(int))

    for f in files:
        year = args.year or detect_year(f.name)
        ftype = detect_type(f.name)
        if not year or not ftype:
            print(f"⚠️ 跳过 {f.name} (无法识别年份/类型)")
            continue

        print(f"\n📄 {f.name} → {year} 年 {ftype}")

        try:
            if ftype == "yfdydb":
                data = parse_yfdydb(f)
                out_path = DATA_DIR / "score-table-new.json"
                # 合并到主表
                main_path = PROJECT / "data_segments" / f"score-{year}.js"
                print(f"  解析: {len(data)} 个类别")
                if not args.dry_run:
                    # 增量更新主表
                    pass
            elif ftype == "pcx":
                data = parse_pcx(f)
                print(f"  提取批次线文本（前 200 字）: {data.get('_raw_text', '')[:200]}")
            elif ftype == "toudang":
                records, is_artsports = parse_toudang(f)
                print(f"  解析: {len(records)} 条 ({'艺术体育' if is_artsports else '普通类'})")
                if is_artsports:
                    target = DATA_DIR / "artsports-new.json"
                else:
                    target = DATA_DIR / f"toudang-{year}-new.json"
                if not args.dry_run:
                    with open(target, "w", encoding="utf-8") as out:
                        json.dump({"year": year, "type": "artsports" if is_artsports else "toudang", "records": records}, out, ensure_ascii=False, indent=2)
                    print(f"  ✅ 写入 {target.name}")
                summary[year]["toudang"] += len(records)
            elif ftype == "plan":
                records = parse_plan(f)
                print(f"  解析: {len(records)} 条专业")
                target = DATA_DIR / f"plans-{year}-new.json"
                if not args.dry_run:
                    with open(target, "w", encoding="utf-8") as out:
                        json.dump({"year": year, "records": records}, out, ensure_ascii=False, indent=2)
                    print(f"  ✅ 写入 {target.name}")
                summary[year]["plans"] += len(records)
        except Exception as e:
            print(f"  ❌ 失败: {e}")

    print(f"\n{'='*40}")
    print(f"📊 汇总:")
    for y in sorted(summary):
        for t, n in summary[y].items():
            print(f"  {y} {t}: {n} 条")
    print(f"\n{'试运行' if args.dry_run else '完成'}。新文件在 data/*-new.json")
    print("确认无误后运行:")
    print("  mv data/toudang-2025-new.json data/toudang-2025.json")
    print("  mv data/plans-2025-new.json + 合并到 data/plans.json")

if __name__ == "__main__":
    main()
