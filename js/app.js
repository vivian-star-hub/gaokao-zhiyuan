/**
 * 山东高考志愿填报指导手册 - 应用逻辑
 */

(function () {
  "use strict";

  // ----- Tab 切换 -----
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === id));
    });
  });

  // ----- 工具：未核验数据提示 -----
  function warnStub(extra = "") {
    return `<div class="warn">⚠️ 当前数据为占位骨架（未从官方核验）${extra ? "，" + extra : ""}。</div>`;
  }

  function empty(msg = "暂无数据") {
    return `<div class="empty">${msg}</div>`;
  }

  // ----- 位次查询 -----
  document.getElementById("lookup-btn").addEventListener("click", () => {
    const year = document.getElementById("lookup-year").value;
    const cat = document.getElementById("lookup-category").value;
    const score = parseInt(document.getElementById("lookup-score").value, 10);
    const out = document.getElementById("lookup-result");
    if (isNaN(score) || score < 0 || score > 750) {
      out.innerHTML = empty("请输入 0-750 之间的有效分数");
      return;
    }
    const tbl = SD_ADMISSION_DATA.scoreTable[year]?.[cat];
    if (!tbl || tbl.verified === "stub") {
      out.innerHTML = warnStub(`无法查询 ${year} 年 ${cat} 类位次`);
      return;
    }
    const rank = lookupRank(year, cat, score);
    const reversed = lookupScoreByRank(year, cat, rank || 0);
    out.innerHTML = `
      ${dataStatusBar([{ year, category: cat, verified: tbl.verified }])}
      <table>
        <tr><th>项目</th><th>结果</th></tr>
        <tr><td>年份</td><td>${year}</td></tr>
        <tr><td>科类</td><td>${cat}</td></tr>
        <tr><td>分数</td><td>${score}</td></tr>
        <tr><td>对应位次</td><td>${rank == null ? "—" : rank.toLocaleString()}</td></tr>
        <tr><td>该位次对应分数</td><td>${reversed == null ? "—" : reversed}</td></tr>
      </table>
    `;
  });

  // ----- 等位分换算 -----
  document.getElementById("eq-btn").addEventListener("click", () => {
    const baseYear = parseInt(document.getElementById("eq-base-year").value, 10);
    const cat = document.getElementById("eq-category").value;
    const score = parseInt(document.getElementById("eq-score").value, 10);
    const out = document.getElementById("eq-result");

    if (isNaN(score) || score < 0 || score > 750) {
      out.innerHTML = empty("请输入 0-750 之间的有效分数");
      return;
    }

    // 对比年份：除了基准年之外的其他年份
    const allYears = SD_ADMISSION_DATA.meta.years;
    const compareYears = allYears.filter((y) => y !== baseYear).sort((a, b) => b - a);

    const result = convertEquivalentScore(baseYear, cat, score, compareYears);

    if (result.error) {
      out.innerHTML = `<div class="warn">⚠️ ${result.error}</div>`;
      return;
    }

    // 渲染结果
    const base = result.base;
    const rows = result.compare.map((r) => {
      let deltaClass = "delta-flat";
      let deltaStr = "—";
      if (r.delta != null) {
        if (r.delta > 0) { deltaClass = "delta-up"; deltaStr = `+${r.delta}`; }
        else if (r.delta < 0) { deltaClass = "delta-down"; deltaStr = `${r.delta}`; }
        else { deltaStr = "0"; }
      }
      return `<tr>
        <td>${r.year}</td>
        <td>${r.score == null ? "—" : r.score}</td>
        <td class="${deltaClass}">${deltaStr}</td>
        <td>${r.deltaPct == null ? "—" : (r.deltaPct > 0 ? "+" : "") + r.deltaPct + "%"}</td>
        <td>${r.verified}</td>
      </tr>`;
    }).join("");

    // 警告
    const warnHtml = result.warnings.length
      ? `<div class="warn">⚠️ ${result.warnings.join("；")}</div>`
      : "";

    // 顶部数据状态条：基准年 + 所有对比年
    const barItems = [{ year: base.year, category: base.category, verified: base.verified }]
      .concat(result.compare.map(c => ({
        year: c.year, category: base.category, verified: c.verified
      })));
    out.innerHTML = `
      ${dataStatusBar(barItems)}
      <div class="hint" style="margin-bottom:12px">
        <strong>${base.year} 年 ${base.category}类</strong> 考了
        <strong style="color:#2a5298;font-size:18px">${base.score}</strong> 分，
        对应位次 <strong style="color:#2a5298">${base.rank.toLocaleString()}</strong>。
        该位次在历年的等效分数如下：
      </div>
      ${warnHtml}
      <table>
        <tr>
          <th>年份</th>
          <th>等位分</th>
          <th>差值（vs 基准）</th>
          <th>差值 %</th>
          <th>状态</th>
        </tr>
        <tr class="eq-baseline">
          <td>${base.year}（基准）${statusBadge("verified", false)}</td>
          <td>${base.score}</td>
          <td>—</td>
          <td>—</td>
          <td>${statusBadge("verified")}</td>
        </tr>
        ${rows}
      </table>
      <p class="hint" style="margin-top:12px">
        💡 <strong>读法</strong>：差值为正 = 该年份同位次需要更高分（题目更简单/竞争更小）；
        差值为负 = 该年份同位次分数更低（题目更难/竞争更大）。
      </p>
    `;
  });

  // ----- 冲稳保 -----
  document.getElementById("rush-btn").addEventListener("click", async () => {
    const year = parseInt(document.getElementById("rush-year").value, 10);
    const cat = document.getElementById("rush-category").value;
    const score = parseInt(document.getElementById("rush-score").value, 10);
    const out = document.getElementById("rush-result");

    if (isNaN(score) || score < 0 || score > 750) {
      out.innerHTML = empty("请输入 0-750 之间的有效分数");
      return;
    }

    const options = {
      range: {
        rush:   [parseInt(document.getElementById("rush-lo").value, 10) || 1000,
                 parseInt(document.getElementById("rush-hi").value, 10) || 5000],
        stable: [0,
                 parseInt(document.getElementById("stable-hi").value, 10) || 1000],
        safe:   [-(parseInt(document.getElementById("safe-lo").value, 10) || 2000),
                 -(parseInt(document.getElementById("safe-hi").value, 10) || 8000)]
      },
      limits: { rush: 10, stable: 15, safe: 10 }
    };

    // 异步加载该年投档表（如未加载）
    out.innerHTML = `<div class="hint">⏳ 正在加载 ${year} 年投档表...</div>`;
    const toudang = await loadToudang(year);
    if (!toudang) {
      out.innerHTML = `<div class="warn">⚠️ ${year} 年投档表加载失败，请检查网络或刷新重试</div>`;
      return;
    }

    const r = recommendByRank(year, cat, score, options);

    if (r.error) {
      out.innerHTML = dataStatusBar([{ year, category: cat, verified: r.dataVerified }]) +
        `<div class="warn">⚠️ ${r.error}</div>`;
      return;
    }

    // 顶部状态条
    const barItems = [{ year, category: cat, verified: r.dataVerified }];
    const warnHtml = r.warnings.length ? `<div class="warn">⚠️ ${r.warnings.join("；")}</div>` : "";

    // 表格渲染（按位次推荐）
    function renderTable(title, color, items, hint) {
      const rows = items.length === 0
        ? `<tr><td colspan="5" class="empty">该档位无院校（试调高阈值）</td></tr>`
        : items.map((it, i) => {
            // 从 majorName 提取专业组代码（前缀字母+数字）
            const m = /^([A-Za-z0-9]+)/.exec(it.majorName || "");
            const code = m ? m[1] : "";
            const rDelta = it.rankDelta > 0 ? `+${it.rankDelta.toLocaleString()}` : it.rankDelta.toLocaleString();
            return `<tr>
              <td>${i + 1}</td>
              <td>${it.schoolName}</td>
              <td title="${it.majorName}">${code}${code ? ' — ' : ''}${(it.majorName || '').replace(/^[A-Za-z0-9]+/, '').slice(0, 18)}</td>
              <td>${it.minRank.toLocaleString()}</td>
              <td class="${it.rankDelta > 0 ? 'delta-up' : it.rankDelta < 0 ? 'delta-down' : 'delta-flat'}">${rDelta}</td>
            </tr>`;
          }).join("");
      return `
        <h3 style="margin-top:16px;color:${color}">${title}（${items.length} 所）</h3>
        <p class="hint">${hint}</p>
        <table>
          <tr><th>#</th><th>院校</th><th>专业组（含专业）</th><th>投档位次</th><th>位次差</th></tr>
          ${rows}
        </table>`;
    }

    out.innerHTML = `
      ${dataStatusBar(barItems)}
      <div class="hint" style="margin-bottom:12px">
        <strong>${year} 年 ${cat}类</strong> 考了
        <strong style="color:#2a5298;font-size:18px">${r.base.score}</strong> 分，
        位次 <strong style="color:#2a5298">${r.base.rank.toLocaleString()}</strong>。
        阈值：冲(${options.range.rush.join('~')})、稳(0~${options.range.stable[1]})、保(-${options.range.safe[1]}~-${options.range.safe[0]})
      </div>
      ${warnHtml}
      ${renderTable("🟧 冲一冲", "#fa8c16", r.rush, "位次比你好 1000~5000 名：跳一跳够得着，有一定风险。")}
      ${renderTable("🟦 稳一稳", "#2a5298", r.stable, "位次与你接近（±1000）：核心志愿区，匹配度最高。")}
      ${renderTable("🟩 保一保", "#389e0d", r.safe, "位次比你低 2000~8000 名：保底有学上。")}
      <p class="hint" style="margin-top:16px">
        ⚠️ 差值规则：<span class="delta-up">正值</span> = 该校投档位次比你位次高（位次数字小=分高），难度大；<span class="delta-down">负值</span> = 该校投档位次比你低（位次数字大=分低），保底。
        <br>📊 本表数据当前状态：<strong>${statusBadge(r.dataVerified)}</strong>。数据已从 sdzk.cn ${year} 年 3 次志愿投档表合并导入，共 ${toudang[cat]?.length?.toLocaleString() || '?'} 条专业组记录。
      </p>
    `;
  });

  // ----- 选科匹配（3+3 模式）-----
  document.getElementById("subj-btn").addEventListener("click", async () => {
    const firstEl = document.querySelector('input[name="subj-first"]:checked');
    const first = firstEl ? firstEl.value : "物理";
    const reChecks = Array.from(document.querySelectorAll('input[name="subj-re"]:checked')).map(el => el.value);
    const year = parseInt(document.getElementById("subj-year").value, 10);
    const school = document.getElementById("subj-school").value.trim();
    const out = document.getElementById("subj-result");

    const user = { first, re: reChecks };
    out.innerHTML = `<div class="hint">⏳ 加载 ${year} 年招生计划...</div>`;
    await loadPlans();
    const r = matchBySubjects(user, { year, schoolName: school || undefined });

    if (r.error) {
      out.innerHTML = `<div class="warn">⚠️ ${r.error}</div>`;
      return;
    }

    const barItems = [{ year, category: first, verified: r.dataVerified }];
    const warnHtml = r.warnings.length
      ? `<div class="warn">⚠️ ${r.warnings.join("；")}</div>`
      : "";

    // 汇总统计
    const statsHtml = `
      <div class="status-bar">
        <span class="status-label">匹配结果：</span>
        <span class="status-item">总专业组 <span class="year">${r.stats.total}</span></span>
        <span class="status-item">可报 <span class="year">${r.stats.matched}</span>（${r.stats.byFirst.物理} 物理 + ${r.stats.byFirst.历史} 历史）</span>
        <span class="status-item">${statusBadge(r.dataVerified)}</span>
      </div>
    `;

    // 表格
    const rows = r.matched.length === 0
      ? `<tr><td colspan="7" class="empty">未匹配到任何专业组（可能是选科限制或院校名过滤太严）</td></tr>`
      : r.matched.map((m, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${m.schoolName}</td>
            <td>${m.majorGroupCode}</td>
            <td>${m.firstSubject}</td>
            <td>${m.matchType}</td>
            <td>${m.planCount}</td>
            <td style="font-size:12px;color:#5a6c7d">${(m.majors || []).slice(0, 3).join("、")}${(m.majors || []).length > 3 ? "…" : ""}</td>
          </tr>
        `).join("");

    out.innerHTML = `
      ${dataStatusBar(barItems)}
      ${statsHtml}
      ${warnHtml}
      <div class="hint" style="margin:12px 0">
        👤 你的选科：
        <span class="subj-pick"><strong>${first}</strong>（首选）</span>
        <span class="subj-pick">${re1}</span>
        <span class="subj-pick">${re2}</span>
      </div>
      <table>
        <tr>
          <th>#</th><th>院校</th><th>专业组</th><th>首选</th><th>选科要求</th><th>计划数</th><th>主要专业</th>
        </tr>
        ${rows}
      </table>
    `;
  });

  // ----- 趋势对比 -----
  document.getElementById("trend-btn").addEventListener("click", async () => {
    const school = document.getElementById("trend-school").value.trim();
    const cat = document.getElementById("trend-category").value;
    const yearSel = document.getElementById("trend-year").value;
    const years = yearSel === "all"
      ? [2021, 2022, 2023, 2024, 2025]
      : [parseInt(yearSel, 10)];
    const out = document.getElementById("trend-result");

    if (!school) { out.innerHTML = empty("请输入院校名称"); return; }

    // 异步加载需要的年份投档表
    out.innerHTML = `<div class="hint">⏳ 正在加载 ${years.length === 1 ? years[0] : '5'} 年投档表...</div>`;
    const results = await Promise.all(years.map(y => loadToudang(y)));
    const loadedCount = results.filter(Boolean).length;
    if (loadedCount === 0) {
      out.innerHTML = `<div class="warn">⚠️ 所有年份投档表加载失败，请检查网络或刷新重试</div>`;
      return;
    }

    const r = getSchoolTrend(school, cat, years);

    if (!r.data.some(d => d.rank != null)) {
      const barItems = years.map(y => ({ year: y, category: cat, verified: "missing" }));
      out.innerHTML = `
        ${dataStatusBar(barItems)}
        <div class="warn">⚠️ 未找到 “<strong>${school}</strong>” 在 ${cat} 类的任何年份数据。可能原因：</div>
        <ul style="margin:8px 0 8px 24px;color:#5a6c7d">
          <li>院校名称写错（请检查错别字，如“山东大学”别写成“山大”）</li>
          <li>该科类下该校在该年份无招生（如某些院校只在物理类招生）</li>
          <li>该校是合并后的新名称（投档表里可能是旧名，如“青岛海洋大学”还在用）</li>
        </ul>
        <p class="hint">提示：可尝试用院校简称关键词（如“清华”、“北大”、“复旦”）。本系统已覆盖 2021-2025 5 年山东所有本科批投档记录。</p>
      `;
      return;
    }

    // 状态条
    const barItems = r.data.map(d => ({ year: d.year, category: cat, verified: d.verified || "stub" }));
    const warnHtml = r.warnings.length ? `<div class="warn">⚠️ ${r.warnings.join("；")}</div>` : "";

    // 渲染 SVG 折线图
    const chart = renderTrendSVG(r);

    out.innerHTML = `
      ${dataStatusBar(barItems)}
      <div class="hint" style="margin:12px 0">
        <strong>${school}</strong> · ${cat}类 · ${r.data.filter(d => d.score != null).length} 个有效数据点
      </div>
      ${warnHtml}
      ${chart}
      <div class="trend-legend">
        <span class="trend-legend-item"><span class="trend-legend-swatch" style="background:#2a5298"></span>投档分（左轴）</span>
        <span class="trend-legend-item"><span class="trend-legend-swatch" style="background:#fa8c16"></span>投档位次（右轴）</span>
      </div>
    `;
  });

  // 轻量 SVG 折线图（零依赖）
  function renderTrendSVG(r) {
    const W = 800, H = 360;
    const padL = 60, padR = 60, padT = 30, padB = 50;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // 仅画有数据的点（位次轴）
    const valid = r.data.filter(d => d.rank != null);
    if (valid.length === 0) {
      return `<div class="empty">无有效数据点</div>`;
    }

    // X 轴: 年份
    const xs = r.data.map((_, i) => padL + (plotW * i) / Math.max(1, r.data.length - 1));
    // Y 轴: 位次（反转——位次小=靠前=上）
    const ranks = r.data.map(d => d.rank).filter(rk => rk != null);
    const minR = Math.min(...ranks) - 1000;
    const maxR = Math.max(...ranks) + 1000;
    const yRank = rk => padT + plotH * (rk - minR) / (maxR - minR);

    // 网格线
    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      const rVal = Math.round(minR + (maxR - minR) * (i / 4));
      grid += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`;
      grid += `<text class="axis-text" x="${padL - 8}" y="${y + 4}" text-anchor="end">${rVal.toLocaleString()}</text>`;
    }

    // 坐标轴
    const axes = `
      <line class="axis-line" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}"/>
      <line class="axis-line" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}"/>
      <text class="axis-text" x="${padL - 30}" y="${padT - 12}">位次</text>
      <text class="axis-text" x="${W - padR + 30}" y="${padT - 12}" text-anchor="end">位次小=靠前=上</text>
    `;

    // X 轴标签
    let xLabels = "";
    r.data.forEach((d, i) => {
      xLabels += `<text class="axis-text" x="${xs[i]}" y="${padT + plotH + 18}" text-anchor="middle">${d.year}</text>`;
      // 数据状态徽章
      const v = d.verified || "stub";
      const vChar = v === "verified" ? "✓" : v === "pending" ? "…" : v === "missing" ? "✗" : "○";
      const vColor = v === "verified" ? "#389e0d" : v === "missing" ? "#a8071a" : "#8898a8";
      xLabels += `<text class="axis-text" x="${xs[i]}" y="${padT + plotH + 33}" text-anchor="middle" fill="${vColor}">${vChar}</text>`;
    });

    // 折线 - 位次
    let lineRank = "", pointsRank = "";
    let prevValidIdx = -1;
    r.data.forEach((d, i) => {
      if (d.rank == null) { prevValidIdx = -1; return; }
      const x = xs[i], y = yRank(d.rank);
      if (prevValidIdx >= 0) {
        const prev = r.data[prevValidIdx];
        if (prev.rank != null) {
          lineRank += `<line class="line-rank" x1="${xs[prevValidIdx]}" y1="${yRank(prev.rank)}" x2="${x}" y2="${y}"/>`;
        }
      }
      pointsRank += `<circle class="point-rank" cx="${x}" cy="${y}" r="5">
        <title>${d.year} 年：平均位次 ${d.rank.toLocaleString()}${d.groups ? `（${d.groups} 个专业组平均）` : ""}</title>
      </circle>`;
      // 数据值标签
      pointsRank += `<text class="axis-text" x="${x}" y="${y - 10}" text-anchor="middle" fill="#2a5298" font-size="11" font-weight="bold">${d.rank.toLocaleString()}</text>`;
      prevValidIdx = i;
    });

    return `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${grid}
      ${axes}
      ${xLabels}
      ${lineRank}
      ${pointsRank}
    </svg>`;
  }

  // ----- 批次线 -----
  document.getElementById("lines-btn").addEventListener("click", () => {
    const year = document.getElementById("lines-year").value;
    const out = document.getElementById("lines-result");
    const data = SD_ADMISSION_DATA.admissionLines[year];
    if (!data) {
      out.innerHTML = empty(`无 ${year} 年数据`);
      return;
    }
    const rows = [];
    let anyStub = false;
    for (const cat of ["物理", "历史"]) {
      const d = data[cat];
      if (d.verified === "stub") anyStub = true;
      for (const [k, v] of Object.entries(d)) {
        if (k === "verified") continue;
        rows.push(`<tr><td>${cat}</td><td>${k}</td><td>${v == null ? "—" : v}</td></tr>`);
      }
    }
    // 顶部数据状态条
    const barItems = ["物理", "历史"].map(c => ({
      year,
      category: c,
      verified: data[c].verified
    }));
    out.innerHTML =
      dataStatusBar(barItems) +
      (anyStub ? warnStub("批次线数值未填入") : "") +
      `<table><tr><th>科类</th><th>批次</th><th>分数</th><th>状态</th></tr>` +
      rows.map((r, i) => {
        // 为每一行加徽章（行序号：物理 3 行、历史 3 行）
        const cat = i < 3 ? "物理" : "历史";
        return r.replace("</tr>", `<td>${statusBadge(data[cat].verified, false)}</td></tr>`);
      }).join("") +
      `</table>`;
  });

  // ----- 一分一段表 -----
  document.getElementById("table-btn").addEventListener("click", () => {
    const year = document.getElementById("table-year").value;
    const cat = document.getElementById("table-category").value;
    const out = document.getElementById("table-result");
    const tbl = SD_ADMISSION_DATA.scoreTable[year]?.[cat];
    if (!tbl) {
      out.innerHTML = empty("无数据");
      return;
    }
    if (tbl.verified === "stub") {
      out.innerHTML = dataStatusBar([{ year, category: cat, verified: tbl.verified }]) +
        warnStub(`${year} 年 ${cat} 类一分一段表数值为空`) +
        `<table><tr><th>分数</th><th>本分人数</th><th>累计人数</th></tr>` +
        tbl.rows.map((r) => `<tr><td>${r.score}</td><td>—</td><td>—</td></tr>`).join("") +
        `</table>`;
      return;
    }
    out.innerHTML = dataStatusBar([{ year, category: cat, verified: tbl.verified }]) +
      `<table>
        <tr><th>分数</th><th>本分人数</th><th>累计人数</th></tr>
        ${tbl.rows.map((r) => `<tr><td>${r.score}</td><td>${r.count ?? "—"}</td><td>${r.cumulative ?? "—"}</td></tr>`).join("")}
      </table>`;
  });

  // ----- 数据状态 -----
  function renderStatus() {
    const out = document.getElementById("status-result");
    const s = dataStatus();

    // 总体统计
    const allItems = [];
    for (const y of Object.keys(s.scoreTable)) {
      allItems.push({ year: y, category: "物理", verified: s.scoreTable[y].物理 });
      allItems.push({ year: y, category: "历史", verified: s.scoreTable[y].历史 });
    }
    const tally = { verified: 0, pending: 0, stub: 0, missing: 0, "out-of-range": 0 };
    for (const it of allItems) tally[it.verified] = (tally[it.verified] || 0) + 1;
    const total = allItems.length;
    const completed = tally.verified;
    const pct = total ? Math.round(completed / total * 100) : 0;

    let html = `
      <div class="status-bar">
        <span class="status-label">总体进度：</span>
        <span class="status-item"><span class="year">${completed}/${total}</span> (${pct}%)</span>
        <span class="legend">
          <span class="legend-item">${statusBadge("verified")} ${tally.verified}</span>
          <span class="legend-item">${statusBadge("pending")} ${tally.pending}</span>
          <span class="legend-item">${statusBadge("stub")} ${tally.stub}</span>
          <span class="legend-item">${statusBadge("missing")} ${tally.missing || 0}</span>
        </span>
      </div>
      <h3>一分一段表</h3>
      <table>
        <tr><th>年份</th><th>物理</th><th>历史</th></tr>`;
    for (const y of Object.keys(s.scoreTable)) {
      html += `<tr>
        <td>${y}</td>
        <td>${statusBadge(s.scoreTable[y].物理)}</td>
        <td>${statusBadge(s.scoreTable[y].历史)}</td>
      </tr>`;
    }
    html += "</table><h3 style='margin-top:16px'>批次线</h3><table><tr><th>年份</th><th>物理</th><th>历史</th></tr>";
    for (const y of Object.keys(s.admissionLines)) {
      html += `<tr>
        <td>${y}</td>
        <td>${statusBadge(s.admissionLines[y].物理)}</td>
        <td>${statusBadge(s.admissionLines[y].历史)}</td>
      </tr>`;
    }
    html += "</table>";

    out.innerHTML = html;
  }
  renderStatus();

  // ----- 学校查询 -----
  function renderSchoolDetail(school) {
    const trend5y = school.trend_5y || { 物理: {}, 历史: {} };
    const years = ["2021", "2022", "2023", "2024", "2025"];
    const renderRank = (y) => {
      const v = trend5y.物理[y] ?? trend5y.历史[y];
      return v != null ? `#${v.toLocaleString()}` : "-";
    };
    const tagHtml = (school.tags || []).map(t => `<span class="tag">${t}</span>`).join("");
    const badges = [];
    if (school.is985) badges.push('<span class="badge badge-985">985</span>');
    if (school.is211) badges.push('<span class="badge badge-211">211</span>');
    if (school.isDoubleFirst) badges.push('<span class="badge badge-df">双一流</span>');
    if (school.schoolLevel === '高职(专科)' || school.schoolLevel === '职业本科') {
      badges.push('<span class="badge badge-zhuan">专科</span>');
    }
    const introHtml = school.intro
      ? `<p class="school-intro">${school.intro}</p>`
      : `<p class="hint">该学校暂未收录简介。查看 5 年录取线作为参考。</p>`;
    const majorsHtml = school.strongMajors && school.strongMajors.length
      ? `<p><strong>强势专业：</strong>${school.strongMajors.join("、")}</p>`
      : "";
    const subjectsHtml = school.subjects_5y && school.subjects_5y.length
      ? `<p><strong>5 年选科要求：</strong>${school.subjects_5y.join(" | ")}</p>`
      : "";
    const tuitionHtml = school.tuition_range && school.tuition_range[0]
      ? `<p><strong>学费范围：</strong>${school.tuition_range[0].toLocaleString()} - ${school.tuition_range[1].toLocaleString()} 元/年</p>`
      : "";

    // 5 年位次表格
    const trendRows = years.map(y => {
      const wl = trend5y.物理[y];
      const lz = trend5y.历史[y];
      return `<tr>
        <td>${y}</td>
        <td>${wl != null ? "#" + wl.toLocaleString() : "-"}</td>
        <td>${lz != null ? "#" + lz.toLocaleString() : "-"}</td>
      </tr>`;
    }).join("");

    // 专科位次块
    const zhuanHtml = school.zhuan_min_rank_2025
      ? `<h4>2025 专科批录取数据</h4>
         <p>最低位次：<strong>#${school.zhuan_min_rank_2025.toLocaleString()}</strong> · 计划数：<strong>${(school.zhuan_plans_2025 || 0).toLocaleString()}</strong> 个</p>
         <p class="hint">注：以上为 2025 年普通类常规批第 2 次志愿投档数据（实际位次）。专科批考生可参考。</p>`
      : "";

    return `
      <div class="school-detail">
        <h3>${school.name} ${badges.join(" ")}</h3>
        <p class="school-meta">
          <span class="level-tag ${school.schoolLevel === '高职(专科)' ? 'level-zhuan' : school.schoolLevel === '职业本科' ? 'level-zhiye' : 'level-ben'}">${school.schoolLevel || school.level}</span>
          ${school.category ? `<span class="cat-tag">${school.category}</span>` : ''}
          <span>${school.location || "未知地区"}</span>
          ${tagHtml ? " · " + tagHtml : ""}
        </p>
        ${introHtml}
        ${majorsHtml}
        ${subjectsHtml}
        ${tuitionHtml}
        ${zhuanHtml}
        <h4>5 年本科录取最低位次（物理 / 历史）</h4>
        <table class="trend-table">
          <thead><tr><th>年份</th><th>物理类</th><th>历史类</th></tr></thead>
          <tbody>${trendRows}</tbody>
        </table>
        <p class="hint">注：上表为该院校 <strong>最低位次</strong>（所有专业组中的最小值）。同分多专业组会导致同一名次多院校。</p>
      </div>
    `;
  }

  async function searchAndRender() {
    const out = document.getElementById("sch-list");
    const kw = document.getElementById("sch-kw").value.trim();
    const is985 = document.getElementById("sch-985").checked;
    const is211 = document.getElementById("sch-211").checked;
    const isDoubleFirst = document.getElementById("sch-double").checked;
    const isZhuan = document.getElementById("sch-zhuan").checked;

    out.innerHTML = `<div class="hint">⏳ 加载院校信息表...</div>`;
    await loadSchoolsInfo();

    if (!kw && !is985 && !is211 && !isDoubleFirst && !isZhuan) {
      out.innerHTML = `<div class="warn">请输入学校名或选择过滤条件。</div>`;
      return;
    }

    const results = searchSchools(kw, { is985, is211, isDoubleFirst, isZhuan, limit: 50 });
    if (results.length === 0) {
      out.innerHTML = `<div class="warn">未找到匹配的院校。试试其他关键词。</div>`;
      return;
    }

    // 默认展示第一个详情，下面是列表
    let html = `<div class="school-count">共找到 <strong>${results.length}</strong> 所院校</div>`;
    html += `<div class="school-list">`;
    for (const s of results) {
      const badges = [];
      if (s.is985) badges.push('<span class="badge-mini">985</span>');
      if (s.is211) badges.push('<span class="badge-mini">211</span>');
      if (s.isDoubleFirst) badges.push('<span class="badge-mini">双一流</span>');
      const trendWl = s.trend_5y?.物理?.["2025"];
      const trendLz = s.trend_5y?.历史?.["2025"];
      const zhuanRank = s.zhuan_min_rank_2025;
      html += `
        <div class="school-card" data-name="${s.name}">
          <h4>${s.name} ${badges.join(" ")}</h4>
          <p class="meta">
            <span class="level-tag ${s.schoolLevel === '高职(专科)' ? 'level-zhuan' : s.schoolLevel === '职业本科' ? 'level-zhiye' : 'level-ben'}">${s.schoolLevel || s.level}</span>
            ${s.category ? `<span class="cat-tag">${s.category}</span>` : ''}
            ${s.location ? `· ${s.location}` : ''}
          </p>
          <p class="trend-mini">
            ${trendWl != null || trendLz != null ? `<span>本科 物理：${trendWl != null ? "#" + trendWl.toLocaleString() : "-"}</span><span>历史：${trendLz != null ? "#" + trendLz.toLocaleString() : "-"}</span>` : ''}
            ${zhuanRank ? `<span class="zhuan-rank">专科：#${zhuanRank.toLocaleString()}</span>` : ''}
          </p>
        </div>
      `;
    }
    html += `</div>`;
    html += `<div id="sch-detail">${renderSchoolDetail(results[0])}</div>`;
    out.innerHTML = html;

    // 点击卡片显示详情
    out.querySelectorAll(".school-card").forEach(card => {
      card.addEventListener("click", () => {
        const name = card.getAttribute("data-name");
        const detail = getSchoolDetail(name);
        if (detail) {
          const detailDiv = document.getElementById("sch-detail");
          detailDiv.innerHTML = renderSchoolDetail(detail);
          detailDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    });
  }

  document.getElementById("sch-btn").addEventListener("click", searchAndRender);
  document.getElementById("sch-kw").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchAndRender();
  });

  // ----- 志愿政策 -----
  async function renderPolicy() {
    const out = document.getElementById("policy-result");
    out.innerHTML = `<div class="hint">⏳ 加载中...</div>`;
    try {
      const resp = await fetch("data/policy-2026-summer.json");
      if (!resp.ok) throw new Error("加载失败");
      const data = await resp.json();
      let html = `<h3>${data.title}</h3>`;
      html += `<p class="meta">发布日期：${data.date} · <a href="${data.url}" target="_blank">原文链接</a></p>`;
      for (const part of data.keyPoints) {
        html += `<div class="policy-block"><h4>${part.title}</h4><ul>`;
        for (const item of part.items) {
          // **...** 转 <strong>...</strong>
          item = item.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
          html += `<li>${item}</li>`;
        }
        html += `</ul></div>`;
      }
      out.innerHTML = html;
    } catch (e) {
      out.innerHTML = `<div class="warn">政策文档加载失败：${e.message}</div>`;
    }
  }
  renderPolicy();

})();
