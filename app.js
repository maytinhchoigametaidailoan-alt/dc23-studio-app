const STORAGE_KEY = "dc23_pin_v1";

let STATE = {
  data: null,
  activeTab: "overview",
  chFilter: "ALL",
  chSort: "views_28d",
  chQuery: "",
  abFilter: "ALL"
};

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("vi-VN");
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

function fmtCompact(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(".", ",") + "M";
  if (n >= 10000) return (n / 1000).toFixed(1).replace(".", ",") + "N";
  return Math.round(n).toLocaleString("vi-VN");
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decryptPayload(encObj, passphrase) {
  const te = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    te.encode(passphrase.trim()),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: b64ToBytes(encObj.salt),
      iterations: encObj.iter || 250000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(encObj.iv) },
    aesKey,
    b64ToBytes(encObj.ct)
  );
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

async function fetchJson(url) {
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function ctrPillClass(ctrPct) {
  if (ctrPct === null || ctrPct === undefined) return "pill-muted";
  if (ctrPct >= 5) return "pill-ok";
  if (ctrPct >= 2.5) return "pill-warn";
  return "pill-bad";
}

function schedPill(daysLeft, schedCount) {
  if (!schedCount || schedCount === 0) return { cls: "pill-bad", text: "Hết lịch (0)" };
  if (daysLeft === null || daysLeft === undefined) return { cls: "pill-info", text: `${schedCount} lịch` };
  if (daysLeft < 0) return { cls: "pill-bad", text: `Quá hạn (${schedCount})` };
  if (daysLeft < 7) return { cls: "pill-warn", text: `Còn ${daysLeft}N (${schedCount})` };
  return { cls: "pill-ok", text: `Còn ${daysLeft}N (${schedCount})` };
}

function buildAreaChartSvg(points, height = 148) {
  if (!points || points.length < 2) {
    return `<div class="empty-box">Chưa đủ dữ liệu lịch sử để vẽ biểu đồ.</div>`;
  }
  const W = 460;
  const H = height;
  const padX = 8;
  const padTop = 14;
  const padBot = 10;
  const vals = points.map((p) => Number(p.views) || 0);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = Math.max(1, maxV - minV);

  const coords = vals.map((v, i) => {
    const x = padX + (i / (vals.length - 1)) * (W - padX * 2);
    const y = padTop + (1 - (v - minV) / span) * (H - padTop - padBot);
    return [x, y];
  });

  const linePath = coords
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const areaPath =
    linePath +
    ` L ${coords[coords.length - 1][0].toFixed(1)} ${H - padBot} L ${coords[0][0].toFixed(1)} ${H - padBot} Z`;
  const last = coords[coords.length - 1];
  const firstLabel = points[0].date.slice(5);
  const midLabel = points[Math.floor(points.length / 2)].date.slice(5);
  const lastLabel = points[points.length - 1].date.slice(5);

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10B981" stop-opacity="0.38"/>
            <stop offset="100%" stop-color="#10B981" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#areaGrad)"></path>
        <path d="${linePath}" fill="none" stroke="#10B981" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4.5" fill="#34D399" stroke="#090C12" stroke-width="2"></circle>
      </svg>
      <div class="chart-labels tabular">
        <span>${esc(firstLabel)} (${fmtCompact(vals[0])})</span>
        <span>${esc(midLabel)}</span>
        <span>${esc(lastLabel)} (${fmtCompact(vals[vals.length - 1])})</span>
      </div>
    </div>
  `;
}

function renderHeader() {
  const d = STATE.data;
  $("header-updated").textContent = `${d.snapshot_date_vi} • ${d.channels.length} kênh`;
  const mh = d.machine_health || {};
  const pill = $("health-pill");
  const den = mh.den || "—";
  pill.textContent = `Máy ${den}`;
  pill.className =
    "health-pill " +
    (den === "XANH" ? "pill-ok" : den === "VÀNG" ? "pill-warn" : den === "ĐỎ" ? "pill-bad" : "pill-muted");

  const cmts = d.comments || {};
  const pendingCount = (cmts.pending_approval || []).length;
  const badgeC = $("badge-comments");
  if (pendingCount > 0) {
    badgeC.textContent = String(pendingCount);
    badgeC.hidden = false;
  } else {
    badgeC.hidden = true;
  }

  const urgentSched = (d.channels || []).filter(
    (c) =>
      c.status_code !== "bo" &&
      c.status_code !== "DUNG-SX" &&
      (c.sched_count === 0 || (c.sched_days_left !== null && c.sched_days_left < 7))
  ).length;
  const badgeS = $("badge-schedule");
  if (urgentSched > 0) {
    badgeS.textContent = String(urgentSched);
    badgeS.hidden = false;
  } else {
    badgeS.hidden = true;
  }
}

function renderOverview() {
  const d = STATE.data;
  const s = d.summary || {};
  const deltaV = s.views_28d_delta;
  const deltaHtml =
    deltaV === null || deltaV === undefined
      ? `<span>So hôm trước: —</span>`
      : `<span class="${deltaV >= 0 ? "delta-up" : "delta-down"}">${deltaV >= 0 ? "+" : ""}${fmtNum(deltaV)} hôm trước</span>`;

  const alerts = d.alerts || [];
  const top5 = [...(d.channels || [])]
    .sort((a, b) => (b.views_28d || 0) - (a.views_28d || 0))
    .slice(0, 5);

  const mh = d.machine_health || {};
  const ramText = mh.ram_trong !== undefined ? `${mh.ram_trong}/${mh.ram_tong} GB trống` : "Chưa đo";
  const cpuText = mh.cpu !== undefined ? `CPU ${mh.cpu}%` : "";
  const diskText = mh.o_c !== undefined ? `C: ${mh.o_c}GB • E: ${mh.o_e}GB` : "";

  $("tab-overview").innerHTML = `
    <div class="kpi-grid tabular">
      <div class="kpi-card">
        <div class="kpi-label">Lượt xem 28 ngày</div>
        <div class="kpi-val">${fmtNum(s.total_views_28d)}</div>
        <div class="kpi-foot">${deltaHtml}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Giờ xem 28 ngày</div>
        <div class="kpi-val">${fmtNum(s.total_hours_28d)}</div>
        <div class="kpi-foot"><span>${fmtNum(s.total_impressions_7d)} imp / 7N</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Sub mới 28N</div>
        <div class="kpi-val">${s.total_subs_delta_28d >= 0 ? "+" : ""}${fmtNum(s.total_subs_delta_28d)}</div>
        <div class="kpi-foot"><span>Tổng ${fmtNum(s.total_subs)} sub</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Lượt xem 48 giờ</div>
        <div class="kpi-val">${fmtNum(s.total_views_48h)}</div>
        <div class="kpi-foot"><span>${fmtNum(s.channels_with_views)}/${d.channels.length} kênh có view</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title">Xu hướng tổng lượt xem 28 ngày</h3>
        <span class="card-sub">${(d.history_totals || []).length} mốc ngày</span>
      </div>
      ${buildAreaChartSvg(d.history_totals || [])}
    </div>

    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title">Việc cần xử lý &amp; cảnh báo</h3>
        <span class="health-pill ${alerts.length ? "pill-warn" : "pill-ok"}">${alerts.length} mục</span>
      </div>
      <div class="list-stack">
        ${
          alerts.length
            ? alerts
                .map(
                  (a) => `
                <button type="button" class="row-item" data-open-ma="${esc(a.ma || "")}">
                  <div class="row-main">
                    <div class="row-head">
                      ${a.ma ? `<span class="code-tag">${esc(a.ma)}</span>` : ""}
                      <span class="health-pill ${a.level === "bad" ? "pill-bad" : a.level === "info" ? "pill-info" : "pill-warn"}">${esc(a.tag)}</span>
                    </div>
                    <div class="row-desc">${esc(a.text)}</div>
                  </div>
                </button>`
                )
                .join("")
            : `<div class="empty-box">Không có cảnh báo gấp.</div>`
        }
      </div>
    </div>

    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title">Top 5 kênh dẫn đầu (28N)</h3>
        <span class="card-sub">Bấm xem chi tiết</span>
      </div>
      <div class="list-stack">
        ${top5
          .map((c, idx) => {
            const sp = schedPill(c.sched_days_left, c.sched_count);
            return `
              <button type="button" class="row-item" data-open-ma="${esc(c.ma)}">
                <div class="row-main">
                  <div class="row-head">
                    <span class="code-tag">#${idx + 1} ${esc(c.ma)}</span>
                    <span class="row-name">${esc(c.title)}</span>
                  </div>
                  <div class="row-desc">${esc(c.market)} • 48h: ${fmtNum(c.views_48h)} • ${sp.text}</div>
                </div>
                <div class="row-right tabular">
                  <div class="row-metric">${fmtCompact(c.views_28d)}</div>
                  <div class="row-metric-sub">CTR 7N ${esc(c.ctr_7d || "—")}</div>
                </div>
              </button>`;
          })
          .join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title">Sức khoẻ máy điều hành</h3>
        <span class="health-pill ${mh.den === "XANH" ? "pill-ok" : mh.den === "VÀNG" ? "pill-warn" : "pill-bad"}">${esc(mh.den || "—")}</span>
      </div>
      <div class="row-desc tabular" style="margin-top:0">
        RAM: ${esc(ramText)} ${cpuText ? "• " + esc(cpuText) : ""} ${diskText ? "• " + esc(diskText) : ""}
      </div>
      ${
        mh.viec && Object.keys(mh.viec).length
          ? `<div class="row-desc" style="color:#FBBF24;margin-top:6px">Đang chạy: ${esc(Object.keys(mh.viec).join(", "))}</div>`
          : `<div class="row-desc" style="margin-top:6px">Không có tác vụ render/Whisper nặng đang chạy.</div>`
      }
    </div>
  `;
}

function marketGroup(market) {
  const m = (market || "").toUpperCase();
  if (m.includes("MỸ") || m.includes("US")) return "US";
  if (m.includes("HÀN") || m.includes("KR")) return "KR";
  if (m.includes("NHẬT") || m.includes("JP")) return "JP";
  if (m.includes("ĐỨC") || m.includes("BA LAN") || m.includes("DE") || m.includes("PL")) return "EU";
  if (m.includes("TÂY BAN NHA") || m.includes("MEX") || m.includes("ES")) return "ES";
  return "OTHER";
}

function renderChannels() {
  const d = STATE.data;
  const list = d.channels || [];
  const q = STATE.chQuery.trim().toLowerCase();

  let filtered = list.filter((c) => {
    if (STATE.chFilter === "LOW_CTR") {
      if (c.ctr_7d_pct === null || c.ctr_7d_pct === undefined || c.ctr_7d_pct >= 5) return false;
    } else if (STATE.chFilter === "LOW_SCHED") {
      if (!(c.sched_count === 0 || (c.sched_days_left !== null && c.sched_days_left < 7))) return false;
    } else if (STATE.chFilter !== "ALL") {
      if (marketGroup(c.market) !== STATE.chFilter) return false;
    }
    if (q) {
      const hay = `${c.ma} ${c.title} ${c.market} ${c.perf_group || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (STATE.chSort === "views_48h") return (b.views_48h || 0) - (a.views_48h || 0);
    if (STATE.chSort === "ctr_7d_desc") return (b.ctr_7d_pct ?? -1) - (a.ctr_7d_pct ?? -1);
    if (STATE.chSort === "ctr_7d_asc") return (a.ctr_7d_pct ?? 999) - (b.ctr_7d_pct ?? 999);
    if (STATE.chSort === "sched_asc") return (a.sched_days_left ?? 999) - (b.sched_days_left ?? 999);
    return (b.views_28d || 0) - (a.views_28d || 0);
  });

  const filters = [
    ["ALL", `Tất cả (${list.length})`],
    ["US", "US"],
    ["KR", "KR"],
    ["JP", "JP"],
    ["EU", "DE/PL"],
    ["ES", "ES/MX"],
    ["LOW_CTR", "CTR < 5%"],
    ["LOW_SCHED", "Lịch < 7N"]
  ];

  $("tab-channels").innerHTML = `
    <div class="search-row">
      <input id="channel-search" class="search-input" type="search" placeholder="Tìm mã, tên kênh..." value="${esc(STATE.chQuery)}" />
      <select id="channel-sort" class="sort-select" aria-label="Sắp xếp">
        <option value="views_28d" ${STATE.chSort === "views_28d" ? "selected" : ""}>Xem 28N</option>
        <option value="views_48h" ${STATE.chSort === "views_48h" ? "selected" : ""}>Xem 48h</option>
        <option value="ctr_7d_desc" ${STATE.chSort === "ctr_7d_desc" ? "selected" : ""}>CTR cao</option>
        <option value="ctr_7d_asc" ${STATE.chSort === "ctr_7d_asc" ? "selected" : ""}>CTR thấp</option>
        <option value="sched_asc" ${STATE.chSort === "sched_asc" ? "selected" : ""}>Lịch gấp</option>
      </select>
    </div>

    <div class="chip-scroll">
      ${filters
        .map(
          ([k, lab]) =>
            `<button type="button" class="chip ${STATE.chFilter === k ? "active" : ""}" data-ch-filter="${k}">${esc(lab)}</button>`
        )
        .join("")}
    </div>

    <div class="list-stack">
      ${
        filtered.length
          ? filtered
              .map((c) => {
                const sp = schedPill(c.sched_days_left, c.sched_count);
                return `
                  <button type="button" class="channel-card" data-open-ma="${esc(c.ma)}">
                    <div class="channel-card-top">
                      <div class="row-main">
                        <div class="row-head">
                          <span class="code-tag">${esc(c.ma)}</span>
                          <span class="row-name">${esc(c.title)}</span>
                        </div>
                        <div class="row-desc">${esc(c.market)} • ${c.pub_count} pub${c.priority ? " • " + esc(c.priority) : ""}</div>
                      </div>
                      <span class="health-pill ${sp.cls}">${esc(sp.text)}</span>
                    </div>
                    <div class="channel-card-stats tabular">
                      <div>
                        <div class="stat-cell-label">Xem 28N</div>
                        <div class="stat-cell-val">${fmtCompact(c.views_28d)}</div>
                      </div>
                      <div>
                        <div class="stat-cell-label">48h</div>
                        <div class="stat-cell-val">${fmtNum(c.views_48h)}</div>
                      </div>
                      <div>
                        <div class="stat-cell-label">CTR 7N</div>
                        <div class="stat-cell-val"><span class="health-pill ${ctrPillClass(c.ctr_7d_pct)}">${esc(c.ctr_7d || "—")}</span></div>
                      </div>
                      <div>
                        <div class="stat-cell-label">AVD 7N</div>
                        <div class="stat-cell-val">${esc(c.avd_7d || c.avd_28d || "—")}</div>
                      </div>
                    </div>
                  </button>`;
              })
              .join("")
          : `<div class="card empty-box">Không có kênh phù hợp bộ lọc.</div>`
      }
    </div>
  `;

  $("channel-search").addEventListener("input", (e) => {
    STATE.chQuery = e.target.value;
    renderChannels();
  });
  $("channel-sort").addEventListener("change", (e) => {
    STATE.chSort = e.target.value;
    renderChannels();
  });
}

function renderComments() {
  const c = STATE.data.comments || {};
  const replied = c.replied || [];
  const pending = c.pending_approval || [];
  const spam = c.skipped_spam || [];

  $("tab-comments").innerHTML = `
    <div class="kpi-grid tabular" style="grid-template-columns: repeat(3, 1fr);">
      <div class="kpi-card">
        <div class="kpi-label">Đã trả lời</div>
        <div class="kpi-val" style="color:#34D399">${replied.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Chờ duyệt</div>
        <div class="kpi-val" style="color:#FBBF24">${pending.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Spam bỏ</div>
        <div class="kpi-val" style="color:#94A3B8">${spam.length}</div>
      </div>
    </div>

    ${
      pending.length
        ? `<div class="card">
            <div class="card-title-row">
              <h3 class="card-title">Cần anh duyệt trước khi trả lời</h3>
              <span class="health-pill pill-warn">${pending.length}</span>
            </div>
            <div class="list-stack">
              ${pending
                .map(
                  (p) => `
                  <div class="comment-card" style="border-color:rgba(245,158,11,0.4)">
                    <div class="row-head">
                      <span class="code-tag">${esc(p.ma)}</span>
                      <strong>${esc(p.author)}</strong>
                    </div>
                    <div class="comment-video">${esc(p.video)}</div>
                    <div class="comment-quote">${esc(p.comment)}</div>
                    <div class="row-desc" style="color:#FBBF24">Lý do: ${esc(p.reason_vi)}</div>
                  </div>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }

    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title">Bình luận đã phản hồi</h3>
        <span class="card-sub">${esc(c.date || STATE.data.snapshot_date)}</span>
      </div>
      <div class="list-stack">
        ${
          replied.length
            ? replied
                .map(
                  (r) => `
                  <div class="comment-card">
                    <div class="row-head">
                      <span class="code-tag">${esc(r.ma)}</span>
                      <strong>${esc(r.author)}</strong>
                      <span class="health-pill ${r.status === "OK" ? "pill-ok" : "pill-warn"}">${esc(r.status || "OK")}</span>
                    </div>
                    <div class="comment-video">${esc(r.video)}</div>
                    <div class="comment-quote">${esc(r.comment)}</div>
                    <div class="comment-reply">
                      <div><strong>Trả lời:</strong> ${esc(r.reply)}</div>
                      ${r.summary_vi ? `<div class="row-desc" style="margin-top:4px;color:#6EE7B7">Dịch ý: ${esc(r.summary_vi)}</div>` : ""}
                    </div>
                  </div>`
                )
                .join("")
            : `<div class="empty-box">Chưa phát sinh bình luận mới cần phản hồi trong ngày. Lịch 9:00 sáng hàng ngày sẽ tự quét và cập nhật nhật ký trả lời tại đây.</div>`
        }
      </div>
    </div>
  `;
}

function renderScheduleAndAb() {
  const d = STATE.data;
  const schedChannels = [...(d.channels || [])].sort(
    (a, b) => (a.sched_days_left ?? -99) - (b.sched_days_left ?? -99)
  );
  const abRowsAll = d.ab_tracker || [];
  const abRows = abRowsAll.filter((r) => {
    if (STATE.abFilter === "SCHED") return r.bucket === "SCHED";
    if (STATE.abFilter === "OLD") return r.bucket !== "SCHED";
    return true;
  });

  $("tab-schedule").innerHTML = `
    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title">Lịch hẹn đăng 23 kênh</h3>
        <span class="card-sub">Ưu tiên kênh &lt; 7 ngày</span>
      </div>
      <div class="list-stack">
        ${schedChannels
          .map((c) => {
            const sp = schedPill(c.sched_days_left, c.sched_count);
            return `
              <button type="button" class="row-item" data-open-ma="${esc(c.ma)}">
                <div class="row-main">
                  <div class="row-head">
                    <span class="code-tag">${esc(c.ma)}</span>
                    <span class="row-name">${esc(c.title)}</span>
                  </div>
                  <div class="row-desc">${esc(c.sched_range || "Chưa có video hẹn lịch")} ${c.cadence ? "• " + esc(c.cadence) : ""}</div>
                </div>
                <span class="health-pill ${sp.cls}">${esc(sp.text)}</span>
              </button>`;
          })
          .join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title">Theo dõi đợt đổi CTR 22/11 (23 video)</h3>
        <span class="health-pill pill-info">Soi lại 29/11</span>
      </div>
      <div class="chip-scroll" style="margin-bottom:10px">
        <button type="button" class="chip ${STATE.abFilter === "ALL" ? "active" : ""}" data-ab-filter="ALL">Tất cả (${abRowsAll.length})</button>
        <button type="button" class="chip ${STATE.abFilter === "SCHED" ? "active" : ""}" data-ab-filter="SCHED">Sắp lên (${abRowsAll.filter((r) => r.bucket === "SCHED").length})</button>
        <button type="button" class="chip ${STATE.abFilter === "OLD" ? "active" : ""}" data-ab-filter="OLD">Video cũ (${abRowsAll.filter((r) => r.bucket !== "SCHED").length})</button>
      </div>
      <div class="list-stack">
        ${abRows
          .map(
            (r) => `
            <div class="comment-card">
              <div class="row-head">
                <span class="code-tag">${esc(r.ma)}</span>
                <span class="health-pill ${r.bucket === "SCHED" ? "pill-info" : "pill-warn"}">${esc(r.bucket)}</span>
                <span class="row-name">${esc(r.ten_tap)}</span>
              </div>
              <div class="row-desc" style="color:#E2E8F0;margin-top:5px">${esc(r.tieu_de_moi)}</div>
              <div class="row-desc tabular">
                Nền 28N: ${esc(r.imp_28d || "—")} imp / ${esc(r.ctr_28d || "—")} • 7N: ${esc(r.imp_7d || "—")} imp / ${esc(r.ctr_7d || "—")} • Thumb: ${esc(r.thumb_moi)}
              </div>
            </div>`
          )
          .join("")}
      </div>
      <div class="row-desc" style="margin-top:10px">
        Đang chờ đủ 30 ngày cooldown: TH V01 v3 (08/12), NR Sahara v2 (14/12).
      </div>
    </div>
  `;
}

function openChannelModal(ma) {
  const c = (STATE.data.channels || []).find((x) => x.ma === ma);
  if (!c) return;
  const sp = schedPill(c.sched_days_left, c.sched_count);
  $("modal-badges").innerHTML = `
    <span class="code-tag">${esc(c.ma)}</span>
    <span class="health-pill pill-info">${esc(c.market)}</span>
    <span class="health-pill ${sp.cls}">${esc(sp.text)}</span>
  `;
  $("modal-title").textContent = c.title;

  const topVideos = c.top_videos || [];
  const schedItems = c.scheduled_items || [];
  const traffic = c.traffic_sources || {};

  $("modal-body").innerHTML = `
    <div class="kpi-grid tabular">
      <div class="kpi-card">
        <div class="kpi-label">Xem 28N / 48h</div>
        <div class="kpi-val">${fmtCompact(c.views_28d)}</div>
        <div class="kpi-foot">48h: ${fmtNum(c.views_48h)} • ${fmtNum(c.hours_28d)}h</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">CTR 7N / 28N</div>
        <div class="kpi-val">${esc(c.ctr_7d || "—")}</div>
        <div class="kpi-foot">28N: ${esc(c.ctr_28d || "—")} • ${fmtNum(c.imp_7d)} imp</div>
      </div>
    </div>

    ${
      c.history && c.history.length >= 2
        ? `<div class="info-block"><div class="info-block-label">Biểu đồ 28 ngày theo ngày</div>${buildAreaChartSvg(c.history, 110)}</div>`
        : ""
    }

    ${
      Object.keys(traffic).length
        ? `<div class="info-block">
            <div class="info-block-label">Nguồn Traffic (28N)</div>
            <div>${Object.entries(traffic).map(([k, v]) => `${esc(k)}: <strong>${esc(v)}</strong>`).join(" • ")}</div>
          </div>`
        : ""
    }

    ${
      c.strengths
        ? `<div class="info-block"><div class="info-block-label">Điểm mạnh</div><div>${esc(c.strengths)}</div></div>`
        : ""
    }
    ${
      c.weaknesses
        ? `<div class="info-block"><div class="info-block-label">Điểm yếu</div><div>${esc(c.weaknesses)}</div></div>`
        : ""
    }
    ${
      c.actions
        ? `<div class="info-block" style="border-color:rgba(16,185,129,0.35)"><div class="info-block-label" style="color:#34D399">Cần xử lý</div><div>${esc(c.actions)}</div></div>`
        : ""
    }

    ${
      topVideos.length
        ? `<div class="info-block">
            <div class="info-block-label">Top video gần đây</div>
            <div class="list-stack">
              ${topVideos
                .map(
                  (v) => `
                  <div class="row-desc tabular" style="color:#E2E8F0;border-bottom:1px solid var(--border);padding-bottom:6px">
                    <div>${esc(v.title)}</div>
                    <div style="color:var(--muted)">${fmtNum(v.views)} xem • ${fmtNum(v.impressions)} imp • CTR ${esc(v.ctr)} • AVD ${esc(v.avd)}</div>
                  </div>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }

    ${
      schedItems.length
        ? `<div class="info-block">
            <div class="info-block-label">Video đang lên lịch (${schedItems.length})</div>
            <div class="list-stack">
              ${schedItems
                .map((s) => `<div class="row-desc" style="color:#E2E8F0"><strong>${esc(s.date)}</strong> — ${esc(s.title)}</div>`)
                .join("")}
            </div>
          </div>`
        : ""
    }
  `;

  $("channel-modal").hidden = false;
}

function closeModal() {
  $("channel-modal").hidden = true;
}

function switchTab(tabName) {
  STATE.activeTab = tabName;
  ["overview", "channels", "comments", "schedule"].forEach((t) => {
    $(`tab-${t}`).hidden = t !== tabName;
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
}

function renderAll() {
  renderHeader();
  renderOverview();
  renderChannels();
  renderComments();
  renderScheduleAndAb();
  switchTab(STATE.activeTab);
}

async function unlockWithPin(pin) {
  const errBox = $("lock-error");
  const btn = $("unlock-btn");
  errBox.hidden = true;
  btn.disabled = true;
  btn.textContent = "Đang giải mã...";
  try {
    const encObj = await fetchJson("./data.enc.json");
    const plain = await decryptPayload(encObj, pin);
    STATE.data = plain;
    if ($("remember-pin").checked) {
      localStorage.setItem(STORAGE_KEY, pin.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    $("lock-screen").hidden = true;
    $("app-shell").hidden = false;
    renderAll();
  } catch (e) {
    console.error(e);
    localStorage.removeItem(STORAGE_KEY);
    errBox.textContent = "Mã PIN chưa đúng hoặc chưa tải được dữ liệu mã hoá.";
    errBox.hidden = false;
    $("lock-screen").hidden = false;
    $("app-shell").hidden = true;
  } finally {
    btn.disabled = false;
    btn.textContent = "Mở khoá bảng điều hành";
  }
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  try {
    const meta = await fetchJson("./meta.json");
    $("lock-meta").textContent = `Cập nhật: ${meta.updated_label || meta.snapshot_date} • ${meta.channel_count || 23} kênh`;
  } catch (_) {
    $("lock-meta").textContent = "Sẵn sàng giải mã cục bộ trên máy";
  }

  $("toggle-pin").addEventListener("click", () => {
    const inp = $("pin-input");
    inp.type = inp.type === "password" ? "text" : "password";
  });

  $("unlock-form").addEventListener("submit", (e) => {
    e.preventDefault();
    unlockWithPin($("pin-input").value);
  });

  $("btn-lock").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    STATE.data = null;
    $("pin-input").value = "";
    $("app-shell").hidden = true;
    $("lock-screen").hidden = false;
  });

  $("btn-refresh").addEventListener("click", async () => {
    const saved = localStorage.getItem(STORAGE_KEY) || $("pin-input").value;
    if (saved) await unlockWithPin(saved);
  });

  $("modal-close").addEventListener("click", closeModal);
  $("channel-modal").addEventListener("click", (e) => {
    if (e.target === $("channel-modal")) closeModal();
  });

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-open-ma]");
    if (openBtn && openBtn.dataset.openMa) {
      openChannelModal(openBtn.dataset.openMa);
      return;
    }
    const chChip = e.target.closest("[data-ch-filter]");
    if (chChip) {
      STATE.chFilter = chChip.dataset.chFilter;
      renderChannels();
      return;
    }
    const abChip = e.target.closest("[data-ab-filter]");
    if (abChip) {
      STATE.abFilter = abChip.dataset.abFilter;
      renderScheduleAndAb();
    }
  });

  const savedPin = localStorage.getItem(STORAGE_KEY);
  if (savedPin) {
    $("pin-input").value = savedPin;
    await unlockWithPin(savedPin);
  }
}

init();
