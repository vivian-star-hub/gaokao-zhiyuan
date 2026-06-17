// ============================================================
// 本地数据导入 / 解析工具
// 浏览器端运行，不上传文件，使用 SheetJS (xlsx.js) 解析 .xls/.xlsx
// ============================================================

(function () {
  "use strict";

  // ============================================================
  // 自动识别类型
  // ============================================================
  function autoDetectType(records) {
    if (!records || records.length === 0) return "unknown";
    // 检查前 3 行的所有列
    const topRows = records.slice(0, 3).map(r => (r || []).map(c => String(c || "")).join("|")).join("\n");

    // 一分一段表：标题含"一分一段"
    if (topRows.includes("一分一段") || topRows.includes("分数段")) return "yfdydb";
    // 头部含"选考物理/历史"
    if (topRows.includes("选考物理") && topRows.includes("选考历史")) return "yfdydb";

    // 检查 R1/R2 表头
    const header1 = records[1] ? records[1].map(c => String(c || "")).join("|") : "";
    const header2 = records[2] ? records[2].map(c => String(c || "")).join("|") : "";

    // 艺体：标题含"体育"/"艺术"+"综合分"
    const titleStr = records.slice(0, 3).map(r => (r || []).map(c => String(c || "")).join("|")).join("\n");
    if ((titleStr.includes("艺术") || titleStr.includes("体育")) && (header1.includes("综合分") || header2.includes("综合分"))) {
      return "artsports";
    }
    if (titleStr.includes("艺术") && titleStr.includes("志愿投档")) return "artsports";

    // 计划：表头含"科目要求"
    if (header1.includes("科目要求") || header2.includes("科目要求")) return "plan";
    if (header1.includes("选考") && header1.includes("专业")) return "plan";

    // 普通投档表
    if (header1.includes("位次") || header1.includes("综合分")) return "toudang";

    return "toudang"; // 兜底
  }

  function autoDetectYear(records, fileName) {
    // 优先文件名
    const m = String(fileName || "").match(/(20\d{2})/);
    if (m) return parseInt(m[1]);
    // 兜底：抽样内容
    for (const r of records.slice(0, 3)) {
      for (const c of r || []) {
        const s = String(c || "");
        const y = s.match(/20\d{2}/);
        if (y) return parseInt(y[0]);
      }
    }
    return new Date().getFullYear() - 1;
  }

  // ============================================================
  // 解析器
  // ============================================================

  function parseYfdydb(records) {
    // 表头跨多行：R1 类别 + R2 字段
    let catRow = -1, fieldRow = -1;
    for (let r = 0; r < Math.min(3, records.length); r++) {
      const row = records[r].map(c => String(c || "").trim());
      if (row.some(c => c.includes("选考物理") || c.includes("选考历史"))) {
        catRow = r;
        fieldRow = r + 1;
        break;
      }
    }
    if (catRow < 0) return { error: "未找到类别行（应为『选考物理/选考历史』）" };

    const catCols = {};
    records[catRow].forEach((c, i) => {
      const v = String(c || "").trim();
      if (v === "选考物理" || v === "物理") catCols["物理"] = i;
      else if (v === "选考历史" || v === "历史") catCols["历史"] = i;
    });

    const catFields = {};
    for (const [cat, startCol] of Object.entries(catCols)) {
      const f = {};
      for (let c = startCol; c < Math.min(startCol + 4, records[fieldRow].length); c++) {
        const v = String(records[fieldRow][c] || "").trim();
        if (v === "本段人数" && f.count === undefined) f.count = c;
        else if (v === "累计人数" && f.cum === undefined) f.cum = c;
      }
      catFields[cat] = f;
    }

    const result = {};
    for (const [cat, fields] of Object.entries(catFields)) {
      const rows = [];
      for (let r = fieldRow + 1; r < records.length; r++) {
        const score = records[r][0];
        if (score === undefined || score === null || score === "") continue;
        const scoreI = Math.floor(Number(score));
        if (isNaN(scoreI) || scoreI <= 0 || scoreI > 800) continue;
        const count = fields.count !== undefined ? Number(records[r][fields.count]) : null;
        const cum = fields.cum !== undefined ? Number(records[r][fields.cum]) : null;
        rows.push({
          score: scoreI,
          count: isNaN(count) ? null : count,
          cumulative: isNaN(cum) ? null : cum
        });
      }
      if (rows.length > 0) {
        result[cat] = {
          verified: "verified",
          source: "本地导入 - 一分一段表",
          rows: rows
        };
      }
    }
    return result;
  }

  function parseToudang(records, isArtsports) {
    // 找表头
    let headerRow = -1;
    for (let r = 0; r < Math.min(3, records.length); r++) {
      const row = records[r].map(c => String(c || "")).join("|");
      if ((row.includes("院校") || row.includes("学校")) && row.includes("计划")) {
        headerRow = r;
        break;
      }
    }
    if (headerRow < 0) return { records: [], category: "未知" };

    // 类别（仅艺体）
    let category = "其他";
    if (isArtsports) {
      for (let r = 0; r < Math.min(3, records.length); r++) {
        const row = (records[r] || []).map(c => String(c || "")).join("|");
        if (row.includes("美术") || row.includes("设计")) category = "美术与设计类";
        else if (row.includes("音乐")) category = "音乐类";
        else if (row.includes("舞蹈")) category = "舞蹈类";
        else if (row.includes("表(导)演") || row.includes("表演")) category = "表(导)演类";
        else if (row.includes("播音")) category = "播音与主持类";
        else if (row.includes("书法")) category = "书法类";
        else if (row.includes("体育")) category = "体育类";
        else if (row.includes("航空服务")) category = "航空服务艺术类";
        if (category !== "其他") break;
      }
    }

    const cols = {};
    records[headerRow].forEach((c, i) => {
      const v = String(c || "").trim();
      if (v.includes("专业")) cols.major = i;
      else if (v.includes("院校") || v.includes("学校")) cols.school = i;
      else if (v.includes("计划")) cols.plan = i;
      else if (v.includes("位次")) cols.rank = i;
      else if (v.includes("分数") || v.includes("最低")) cols.score = i;
    });

    const out = [];
    for (let r = headerRow + 1; r < records.length; r++) {
      const row = records[r] || [];
      const major = cols.major !== undefined ? String(row[cols.major] || "").trim() : "";
      const school = cols.school !== undefined ? String(row[cols.school] || "").trim() : "";
      if (!school) continue;
      const m = school.match(/^([A-Z]\d+)(.*)$/);
      const schoolCode = m ? m[1] : "";
      const schoolName = m ? m[2].trim() : school;
      const plan = cols.plan !== undefined ? Math.floor(Number(row[cols.plan]) || 0) : 0;
      const rec = {
        schoolCode: schoolCode,
        schoolName: schoolName,
        majorName: major,
        planCount: plan
      };
      if (cols.rank !== undefined) {
        const rank = Math.floor(Number(row[cols.rank]) || 0);
        if (rank > 0) rec.minRank = rank;
      }
      if (cols.score !== undefined) {
        const score = Number(row[cols.score]) || 0;
        if (score > 0) rec.minScore = score;
      }
      if (isArtsports) rec.category = category;
      if (schoolName && (rec.minRank || rec.minScore)) out.push(rec);
    }
    return { records: out, category };
  }

  function parsePlan(records) {
    let headerRow = -1;
    for (let r = 0; r < Math.min(6, records.length); r++) {
      const row = (records[r] || []).map(c => String(c || "")).join("|");
      if (row.includes("科目要求") && row.includes("计划")) {
        headerRow = r;
        break;
      }
    }
    if (headerRow < 0) return { records: [] };

    const cols = {};
    records[headerRow].forEach((c, i) => {
      const v = String(c || "").trim();
      if (v === "院校代号" || v.includes("院校代号")) cols.code = i;
      else if ((v.includes("院校") && v.includes("名称")) || v === "院校名称") cols.name = i;
      else if (v.includes("科目要求")) cols.subjects = i;
      else if (v.includes("学制")) cols.duration = i;
      else if (v.includes("计划")) cols.plan = i;
      else if (v.includes("收费")) cols.tuition = i;
    });

    if (cols.name === undefined) return { records: [] };

    const out = [];
    let curSchool = "", curCode = "";
    for (let r = headerRow + 1; r < records.length; r++) {
      const row = records[r] || [];
      const code = cols.code !== undefined ? String(row[cols.code] || "").trim() : "";
      if (code) {
        curCode = code;
        curSchool = String(row[cols.name] || "").trim();
        continue;
      }
      const name = String(row[cols.name] || "").trim();
      if (!name) continue;
      const plan = cols.plan !== undefined ? Math.floor(Number(row[cols.plan]) || 0) : 0;
      if (!curSchool || plan <= 0) continue;
      const subjects = cols.subjects !== undefined ? String(row[cols.subjects] || "").trim() : "";
      const duration = cols.duration !== undefined ? String(row[cols.duration] || "").trim() : "";
      const tuition = cols.tuition !== undefined ? Math.floor(Number(row[cols.tuition]) || 0) : 0;
      // 提取专业代码
      const m = name.match(/^(\d+)\s*(.+?)(?:[（(]([^）)]+)[）)])?\s*$/);
      const majorCode = m ? m[1] : "";
      const majorName = m ? m[2].trim() : name;
      const majorNote = m && m[3] ? m[3].trim() : "";
      out.push({
        schoolCode: curCode,
        schoolName: curSchool,
        majorCode: majorCode,
        majorName: majorName,
        majorNote: majorNote,
        subjects: subjects,
        duration: duration,
        planCount: plan,
        tuition: tuition
      });
    }
    return { records: out };
  }

  // ============================================================
  // 主流程
  // ============================================================

  function processFile(file, opts) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array", cellDates: false });
          // 把所有 sheet 合并成 records 数组
          const allRecords = [];
          const sheetInfo = [];
          wb.SheetNames.forEach((sn, idx) => {
            const sh = wb.Sheets[sn];
            const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", blankrows: false });
            sheetInfo.push({ name: sn, rows: rows.length });
            if (idx === 0) allRecords.push(...rows);
            // 多个 sheet 暂只处理第一个
          });

          if (allRecords.length === 0) {
            return reject(new Error("文件无数据"));
          }

          // 自动识别
          let type = opts.type || "auto";
          if (type === "auto") {
            type = autoDetectType(allRecords);
          }
          const year = opts.year || autoDetectYear(allRecords, file.name);

          let result = null;
          let output = null;
          let filename = "";

          if (type === "yfdydb") {
            const data = parseYfdydb(allRecords);
            if (data.error) return reject(new Error(data.error));
            output = { [String(year)]: data };
            filename = `yfdydb-${year}-new.json`;
            result = {
              type: "yfdydb",
              year: year,
              categories: Object.keys(data),
              preview: Object.entries(data).map(([cat, d]) => ({ cat, rows: d.rows.length, sample: d.rows.slice(0, 3) }))
            };
          } else if (type === "toudang" || type === "artsports") {
            const isArt = type === "artsports";
            const parsed = parseToudang(allRecords, isArt);
            const records = parsed.records;
            if (records.length === 0) return reject(new Error("解析出 0 条记录（可能表头格式不识别）"));
            if (isArt) {
              output = {
                [String(year)]: {
                  verified: "verified",
                  source: `本地导入 - ${year} 年艺体类`,
                  totalRecords: records.length,
                  records: records
                }
              };
              filename = `artsports-${year}-new.json`;
            } else {
              // 按物理/历史分（暂存一起，让用户后续手动分）
              output = {
                [String(year)]: {
                  verified: "verified",
                  source: `本地导入 - ${year} 年普通类投档`,
                  totalRecords: records.length,
                  records: records
                }
              };
              filename = `toudang-${year}-new.json`;
            }
            result = {
              type: isArt ? "artsports" : "toudang",
              year: year,
              category: parsed.category,
              records: records.length,
              preview: records.slice(0, 3)
            };
          } else if (type === "plan") {
            const parsed = parsePlan(allRecords);
            if (parsed.records.length === 0) return reject(new Error("解析出 0 条记录"));
            output = {
              [String(year)]: {
                verified: "verified",
                source: `本地导入 - ${year} 年招生计划`,
                records: parsed.records
              }
            };
            filename = `plans-${year}-new.json`;
            result = {
              type: "plan",
              year: year,
              records: parsed.records.length,
              preview: parsed.records.slice(0, 3)
            };
          } else {
            return reject(new Error(`无法识别类型: ${type}。请手动选择。`));
          }

          resolve({ result, output, filename, sheetInfo });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsArrayBuffer(file);
    });
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================================================
  // UI 绑定
  // ============================================================
  function bindUI() {
    const fileInput = document.getElementById("imp-file");
    const typeSelect = document.getElementById("imp-type");
    const yearInput = document.getElementById("imp-year");
    const resultDiv = document.getElementById("imp-result");
    let lastOutput = null, lastFilename = null;

    if (!fileInput) return;

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      resultDiv.innerHTML = `<div class="hint">⏳ 解析 ${file.name}...</div>`;
      try {
        const opts = {
          type: typeSelect.value,
          year: yearInput.value ? parseInt(yearInput.value) : null
        };
        const { result, output, filename, sheetInfo } = await processFile(file, opts);
        lastOutput = output;
        lastFilename = filename;
        // 自动填年份
        if (!yearInput.value) yearInput.value = result.year;
        // 自动选类型
        if (typeSelect.value === "auto") {
          const map = { yfdydb: "yfdydb", toudang: "toudang", plan: "plan", artsports: "artsports" };
          typeSelect.value = map[result.type] || "auto";
        }

        const sheetHtml = sheetInfo.map(s => `<li>${s.name}: ${s.rows} 行</li>`).join("");
        let previewHtml = "";
        if (result.preview) {
          if (result.type === "yfdydb") {
            previewHtml = result.preview.map(c =>
              `<details><summary>${c.cat}: ${c.rows} 行</summary><pre>${JSON.stringify(c.sample, null, 2)}</pre></details>`
            ).join("");
          } else {
            previewHtml = `<pre>${JSON.stringify(result.preview, null, 2)}</pre>`;
          }
        }

        resultDiv.innerHTML = `
          <div class="card success">
            <h3>✅ 解析成功</h3>
            <table>
              <tr><td>类型</td><td><strong>${result.type}</strong></td></tr>
              <tr><td>年份</td><td><strong>${result.year}</strong></td></tr>
              ${result.category ? `<tr><td>子类</td><td>${result.category}</td></tr>` : ""}
              ${result.categories ? `<tr><td>类别</td><td>${result.categories.join(", ")}</td></tr>` : ""}
              <tr><td>记录数</td><td><strong>${result.records || result.preview?.reduce((s, c) => s + c.rows, 0) || 0}</strong></td></tr>
              <tr><td>Sheet</td><td><ul>${sheetHtml}</ul></td></tr>
              <tr><td>文件名</td><td><code>${filename}</code></td></tr>
            </table>
            <h4>📋 数据预览</h4>
            ${previewHtml}
            <button id="imp-download" class="btn">⬇️ 下载 JSON</button>
          </div>
        `;
        const dlBtn = document.getElementById("imp-download");
        if (dlBtn) dlBtn.addEventListener("click", () => {
          downloadJSON(lastOutput, lastFilename);
        });
      } catch (err) {
        resultDiv.innerHTML = `<div class="warn">❌ 解析失败: ${err.message}<br>试试手动指定类型 + 年份。</div>`;
      }
    });
  }

  if (typeof window !== "undefined") {
    window.__importerProcessFile = processFile;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bindUI);
    } else {
      bindUI();
    }
  }
})();
