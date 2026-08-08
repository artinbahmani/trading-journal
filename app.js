/* Trading Journal — app state, UI wiring, persistence, CSV.
 * Depends on the global `Analytics` from analytics.js (loaded first).
 * Plain script (no modules) so the app runs from file://.
 */
(function () {
  "use strict";

  var A = window.Analytics;
  var LS_KEY = "trading-journal.trades.v1";
  var LS_RULES_KEY = "trading-journal.rules.v1";

  var DEFAULT_RULES = [
    "Trade matches my written plan (setup + strategy identified)",
    "Risk is sized so one loss costs at most 1R",
    "Stop loss placed before entry — not mental",
    "Risk/reward of at least 2:1 at my target",
    "No major news/event in the next hour",
    "I am calm, rested, and not revenge-trading"
  ];

  /* ================= state ================= */

  var state = {
    trades: [],
    rules: DEFAULT_RULES.slice(),
    view: "dashboard",
    sort: { key: "date", dir: -1 }, // newest first
    filters: { pair: "", setup: "", result: "", from: "", to: "" },
    calCursor: null, // Date, first of displayed month
    editingId: null
  };

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) state.trades = arr.filter(validTrade);
      }
      var rules = localStorage.getItem(LS_RULES_KEY);
      if (rules) {
        var r = JSON.parse(rules);
        if (Array.isArray(r) && r.length) state.rules = r;
      }
    } catch (e) {
      console.warn("Failed to load saved data:", e);
    }
    if (!state.trades.length) {
      state.trades = seedTrades();
      save();
    }
  }

  function save() {
    localStorage.setItem(LS_KEY, JSON.stringify(state.trades));
    localStorage.setItem(LS_RULES_KEY, JSON.stringify(state.rules));
  }

  function validTrade(t) {
    return t && typeof t.date === "string" && typeof t.pair === "string" &&
      isFinite(+t.entry) && isFinite(+t.exit) && isFinite(+t.size);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ================= seed data ================= */

  // Deterministic-ish sample: ~48 trades over the past ~75 days across
  // several pairs/setups so every chart and filter has something to show.
  function seedTrades() {
    var pairs = ["BTCUSD", "ETHUSD", "EURUSD", "XAUUSD", "SOLUSD"];
    var setups = ["Breakout", "Pullback", "Range fade", "Liquidity sweep", "Trend continuation"];
    var strategies = ["Trend following", "Mean reversion", "Momentum"];
    var notesPool = [
      "Clean execution, followed plan.",
      "Entered slightly early, watch patience.",
      "Sized down due to choppy conditions.",
      "Textbook setup, let winner run.",
      "Exited at target, no regrets.",
      "Chased entry — reduce size next time.",
      "News spike stopped me out.",
      "Held through drawdown, paid off.",
      ""
    ];
    var rng = mulberry32(20260808);
    var out = [];
    var today = new Date();

    for (var i = 0; i < 48; i++) {
      var daysAgo = Math.floor(rng() * 75);
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
      var pair = pairs[Math.floor(rng() * pairs.length)];
      var setup = setups[Math.floor(rng() * setups.length)];
      var side = rng() < 0.55 ? "long" : "short";
      var entry = round2(50 + rng() * 950);
      var stopDist = round2(entry * (0.005 + rng() * 0.01));
      var stopLoss = side === "long" ? round2(entry - stopDist) : round2(entry + stopDist);
      // outcome: ~58% winners, winners average bigger than losers (positive expectancy)
      var win = rng() < 0.58;
      var move = stopDist * (win ? (1.2 + rng() * 2.2) : -(0.4 + rng() * 0.9));
      var exit = side === "long" ? round2(entry + move) : round2(entry - move);
      var size = round2(0.1 + rng() * 1.9);
      var fees = round2(1 + rng() * 6);

      out.push({
        id: uid() + i,
        date: isoDate(d),
        pair: pair,
        side: side,
        entry: entry,
        exit: exit,
        stopLoss: stopLoss,
        size: size,
        fees: fees,
        setup: setup,
        strategy: strategies[Math.floor(rng() * strategies.length)],
        rating: 1 + Math.floor(rng() * 5),
        notes: notesPool[Math.floor(rng() * notesPool.length)]
      });
    }
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  // Small seeded PRNG so "Sample Data" reloads look consistent.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  function isoDate(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  /* ================= helpers ================= */

  function $(sel) { return document.querySelector(sel); }

  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.add("hidden"); }, 2600);
  }

  function pnlClass(v) { return v > A.EPS ? "pos" : v < -A.EPS ? "neg" : ""; }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ================= view switching ================= */

  function switchView(name) {
    state.view = name;
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.view === name);
    });
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.id === "view-" + name);
    });
    if (name === "calendar") renderCalendar();
    if (name === "dashboard") renderDashboard();
    if (name === "trades") renderTable();
  }

  /* ================= dashboard ================= */

  function renderDashboard() {
    var trades = state.trades;
    var s = A.computeStats(trades);
    var grid = $("#statGrid");

    var pf = s.profitFactor == null ? "—"
      : s.profitFactor === Infinity ? "∞"
      : s.profitFactor.toFixed(2);

    var cards = [
      { label: "Total P&L", value: A.fmtMoney(s.totalPnl, { plus: true }), cls: pnlClass(s.totalPnl), sub: s.count + " trades" },
      { label: "Win rate", value: s.count ? s.winRate.toFixed(1) + "%" : "—", sub: s.wins + "W / " + s.losses + "L / " + s.breakeven + "BE" },
      { label: "Profit factor", value: pf, cls: s.profitFactor > 1 ? "pos" : s.profitFactor != null && s.profitFactor < 1 ? "neg" : "" },
      { label: "Expectancy", value: A.fmtMoney(s.expectancy, { plus: true }), cls: pnlClass(s.expectancy), sub: "per trade" },
      { label: "Avg win", value: s.wins ? A.fmtMoney(s.avgWin, { plus: true }) : "—", cls: "pos" },
      { label: "Avg loss", value: s.losses ? A.fmtMoney(-s.avgLoss) : "—", cls: "neg" },
      {
        label: "Best trade", cls: "pos",
        value: s.best ? A.fmtMoney(A.netPnl(s.best), { plus: true }) : "—",
        sub: s.best ? s.best.pair + " · " + s.best.date : ""
      },
      {
        label: "Worst trade", cls: "neg",
        value: s.worst ? A.fmtMoney(A.netPnl(s.worst), { plus: true }) : "—",
        sub: s.worst ? s.worst.pair + " · " + s.worst.date : ""
      }
    ];

    grid.innerHTML = cards.map(function (c) {
      return '<div class="stat-card"><div class="label">' + c.label + '</div>' +
        '<div class="value ' + (c.cls || "") + '">' + c.value + '</div>' +
        (c.sub ? '<div class="sub">' + escapeHtml(c.sub) + '</div>' : "") + '</div>';
    }).join("");

    var range = A.renderEquityCurve($("#equityChart"), trades);
    $("#equityHint").textContent = range.first ? range.first + " → " + range.last : "";
    A.renderBars($("#setupChart"), A.pnlBySetup(trades));
    A.renderBars($("#weekdayChart"), A.pnlByWeekday(trades));
  }

  /* ================= trades table ================= */

  function filteredTrades() {
    var f = state.filters;
    return state.trades.filter(function (t) {
      if (f.pair && t.pair.toUpperCase().indexOf(f.pair.toUpperCase()) === -1) return false;
      if (f.setup && t.setup !== f.setup) return false;
      if (f.result === "win" && !A.isWin(t)) return false;
      if (f.result === "loss" && !A.isLoss(t)) return false;
      if (f.result === "be" && (A.isWin(t) || A.isLoss(t))) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      return true;
    }).sort(sorter);
  }

  function sorter(a, b) {
    var k = state.sort.key, dir = state.sort.dir;
    var va, vb;
    switch (k) {
      case "pnl": va = A.netPnl(a); vb = A.netPnl(b); break;
      case "r": va = A.rMultiple(a); vb = A.rMultiple(b);
        // nulls sort last regardless of direction
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        break;
      case "rating": case "entry": case "exit": case "size":
        va = +a[k] || 0; vb = +b[k] || 0; break;
      default:
        va = (a[k] || "").toString().toLowerCase();
        vb = (b[k] || "").toString().toLowerCase();
    }
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  }

  function renderTable() {
    var rows = filteredTrades();
    var tbody = $("#tradeTbody");

    tbody.innerHTML = rows.map(function (t) {
      var pnl = A.netPnl(t);
      var r = A.rMultiple(t);
      var stars = "";
      for (var i = 0; i < 5; i++) stars += i < t.rating ? "★" : "☆";
      return '<tr data-id="' + t.id + '">' +
        "<td>" + t.date + "</td>" +
        "<td><strong>" + escapeHtml(t.pair) + "</strong></td>" +
        '<td><span class="pill ' + t.side + '">' + t.side.toUpperCase() + "</span></td>" +
        '<td class="num">' + t.entry + "</td>" +
        '<td class="num">' + t.exit + "</td>" +
        '<td class="num">' + t.size + "</td>" +
        '<td class="num ' + pnlClass(pnl) + '"><strong>' + A.fmtMoney(pnl, { plus: true }) + "</strong></td>" +
        '<td class="num">' + A.fmtR(r) + "</td>" +
        '<td>' + (t.setup ? '<span class="pill tag">' + escapeHtml(t.setup) + "</span>" : "") + "</td>" +
        '<td>' + (t.strategy ? '<span class="pill tag">' + escapeHtml(t.strategy) + "</span>" : "") + "</td>" +
        '<td class="num stars" title="Execution rating">' + stars + "</td>" +
        '<td class="row-notes">' + escapeHtml(t.notes || "") + "</td>" +
        "</tr>";
    }).join("");

    $("#emptyTrades").classList.toggle("hidden", rows.length > 0);

    var s = A.computeStats(rows);
    $("#tableFoot").innerHTML =
      "<span>" + rows.length + " trade" + (rows.length === 1 ? "" : "s") + "</span>" +
      '<span>Net: <strong class="' + pnlClass(s.totalPnl) + '">' + A.fmtMoney(s.totalPnl, { plus: true }) + "</strong></span>" +
      "<span>Win rate: " + (s.count ? s.winRate.toFixed(1) + "%" : "—") + "</span>";

    document.querySelectorAll("#tradeTable th").forEach(function (th) {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === state.sort.key) {
        th.classList.add(state.sort.dir === 1 ? "sorted-asc" : "sorted-desc");
      }
    });
  }

  function refreshTagLists() {
    var setups = {}, strategies = {}, pairs = {};
    state.trades.forEach(function (t) {
      if (t.setup) setups[t.setup] = 1;
      if (t.strategy) strategies[t.strategy] = 1;
      if (t.pair) pairs[t.pair] = 1;
    });
    $("#setupList").innerHTML = Object.keys(setups).sort().map(opt).join("");
    $("#strategyList").innerHTML = Object.keys(strategies).sort().map(opt).join("");
    $("#pairList").innerHTML = Object.keys(pairs).sort().map(opt).join("");

    var setupSel = $("#fSetup");
    var cur = setupSel.value;
    setupSel.innerHTML = '<option value="">All setups</option>' +
      Object.keys(setups).sort().map(function (s) { return "<option>" + escapeHtml(s) + "</option>"; }).join("");
    setupSel.value = cur;
  }

  function opt(v) { return "<option>" + escapeHtml(v) + "</option>"; }

  /* ================= calendar ================= */

  function renderCalendar() {
    if (!state.calCursor) {
      var now = new Date();
      state.calCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    var year = state.calCursor.getFullYear(), month = state.calCursor.getMonth();
    $("#calLabel").textContent = state.calCursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    $("#calWeekdays").innerHTML = A.WEEKDAYS.map(function (d) { return "<span>" + d + "</span>"; }).join("");

    var byDay = A.dailySeries(state.trades).byDay;
    var firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first offset
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var todayStr = isoDate(new Date());

    var html = "";
    // leading cells from previous month
    for (var i = firstDow - 1; i >= 0; i--) {
      html += calCell(new Date(year, month, -i), true, byDay, todayStr);
    }
    for (var day = 1; day <= daysInMonth; day++) {
      html += calCell(new Date(year, month, day), false, byDay, todayStr);
    }
    // trailing cells to complete the last week
    var total = firstDow + daysInMonth;
    var trail = (7 - (total % 7)) % 7;
    for (var t = 1; t <= trail; t++) {
      html += calCell(new Date(year, month + 1, t), true, byDay, todayStr);
    }
    $("#calGrid").innerHTML = html;

    // month summary
    var mStats = A.computeStats(state.trades.filter(function (tr) {
      var p = tr.date.split("-").map(Number);
      return p[0] === year && p[1] === month + 1;
    }));
    $("#calSummary").innerHTML =
      "<span>Month: <strong class='" + pnlClass(mStats.totalPnl) + "'>" + A.fmtMoney(mStats.totalPnl, { plus: true }) + "</strong></span>" +
      "<span>" + mStats.count + " trades</span>" +
      "<span>Win rate: " + (mStats.count ? mStats.winRate.toFixed(1) + "%" : "—") + "</span>" +
      "<span>Green days: " + countDays(byDay, year, month, true) + " · Red days: " + countDays(byDay, year, month, false) + "</span>";
  }

  function countDays(byDay, year, month, wantWin) {
    var n = 0;
    Object.keys(byDay).forEach(function (k) {
      var p = k.split("-").map(Number);
      if (p[0] === year && p[1] === month + 1) {
        var pnl = byDay[k].pnl;
        if (wantWin ? pnl > A.EPS : pnl < -A.EPS) n++;
      }
    });
    return n;
  }

  function calCell(d, outOfMonth, byDay, todayStr) {
    var key = isoDate(d);
    var info = byDay[key];
    var cls = "cal-cell" + (outOfMonth ? " out" : "") + (key === todayStr ? " today" : "");
    var inner = '<span class="day">' + d.getDate() + "</span>";
    if (info) {
      cls += info.pnl > A.EPS ? " win" : info.pnl < -A.EPS ? " loss" : "";
      inner += '<span class="pnl">' + A.fmtMoney(info.pnl, { plus: true }) + "</span>" +
        '<span class="count">' + info.count + " trade" + (info.count === 1 ? "" : "s") + "</span>";
    }
    return '<div class="' + cls + '" title="' + key + '">' + inner + "</div>";
  }

  /* ================= trade modal ================= */

  function buildRulesChecklist(checkedCount) {
    $("#rulesList").innerHTML = state.rules.map(function (r, i) {
      var checked = checkedCount == null ? false : i < checkedCount;
      return "<label><input type='checkbox' data-rule='" + i + "'" + (checked ? " checked" : "") + ">" +
        "<span>" + escapeHtml(r) + "</span></label>";
    }).join("");
    updateSaveGate();
  }

  function rulesChecked() {
    var boxes = document.querySelectorAll("#rulesList input[type=checkbox]");
    var n = 0;
    boxes.forEach(function (b) { if (b.checked) n++; });
    return { checked: n, total: boxes.length };
  }

  function updateSaveGate() {
    var r = rulesChecked();
    var ok = r.checked === r.total;
    $("#btnSaveTrade").disabled = !ok;
    var hint = $("#rulesHint");
    hint.textContent = ok ? "All rules checked — good to go." :
      "Check every rule before saving (" + r.checked + "/" + r.total + ").";
    hint.classList.toggle("ok", ok);
  }

  function openModal(trade) {
    state.editingId = trade ? trade.id : null;
    $("#modalTitle").textContent = trade ? "Edit Trade" : "Log Trade";
    $("#btnDeleteTrade").classList.toggle("hidden", !trade);

    var f = $("#tradeForm");
    f.reset();
    f.elements.date.value = trade ? trade.date : isoDate(new Date());
    if (trade) {
      f.elements.pair.value = trade.pair;
      f.elements.side.value = trade.side;
      f.elements.entry.value = trade.entry;
      f.elements.exit.value = trade.exit;
      f.elements.stopLoss.value = trade.stopLoss || "";
      f.elements.size.value = trade.size;
      f.elements.fees.value = trade.fees || 0;
      f.elements.setup.value = trade.setup || "";
      f.elements.strategy.value = trade.strategy || "";
      f.elements.rating.value = String(trade.rating || 3);
      f.elements.notes.value = trade.notes || "";
    }
    // editing an existing trade skips the gate (it was checked when logged)
    buildRulesChecklist(trade ? state.rules.length : null);
    $("#tradeModal").classList.remove("hidden");
    f.elements.pair.focus();
  }

  function closeModal() {
    $("#tradeModal").classList.add("hidden");
    state.editingId = null;
  }

  function saveTrade(e) {
    e.preventDefault();
    var f = $("#tradeForm");
    var trade = {
      id: state.editingId || uid(),
      date: f.elements.date.value,
      pair: f.elements.pair.value.trim().toUpperCase(),
      side: f.elements.side.value,
      entry: +f.elements.entry.value,
      exit: +f.elements.exit.value,
      stopLoss: f.elements.stopLoss.value === "" ? null : +f.elements.stopLoss.value,
      size: +f.elements.size.value,
      fees: +f.elements.fees.value || 0,
      setup: f.elements.setup.value.trim(),
      strategy: f.elements.strategy.value.trim(),
      rating: +f.elements.rating.value,
      notes: f.elements.notes.value.trim()
    };
    if (!trade.date || !trade.pair || !(trade.entry > 0) || !(trade.exit > 0) || !(trade.size > 0)) {
      toast("Fill in date, pair, and positive entry / exit / size.");
      return;
    }
    // guard against double-click saving the trade twice before the modal closes
    $("#btnSaveTrade").disabled = true;

    if (state.editingId) {
      var idx = state.trades.findIndex(function (t) { return t.id === state.editingId; });
      if (idx >= 0) state.trades[idx] = trade;
      toast("Trade updated.");
    } else {
      state.trades.push(trade);
      toast("Trade logged — " + A.fmtMoney(A.netPnl(trade), { plus: true }));
    }
    save();
    closeModal();
    refreshTagLists();
    renderCurrentView();
  }

  function deleteTrade() {
    if (!state.editingId) return;
    state.trades = state.trades.filter(function (t) { return t.id !== state.editingId; });
    save();
    closeModal();
    refreshTagLists();
    renderCurrentView();
    toast("Trade deleted.");
  }

  function renderCurrentView() {
    renderDashboard();
    renderTable();
    renderCalendar();
  }

  /* ================= CSV export / import ================= */

  var CSV_HEADERS = ["date", "pair", "side", "entry", "exit", "stopLoss", "size", "fees", "setup", "strategy", "rating", "notes", "pnl", "rMultiple"];

  function csvEscape(v) {
    v = v == null ? "" : String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function exportCsv() {
    var lines = [CSV_HEADERS.join(",")];
    state.trades.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) {
      lines.push([
        t.date, t.pair, t.side, t.entry, t.exit, t.stopLoss == null ? "" : t.stopLoss,
        t.size, t.fees, t.setup, t.strategy, t.rating, t.notes,
        round2(A.netPnl(t)),
        A.rMultiple(t) == null ? "" : A.rMultiple(t).toFixed(3)
      ].map(csvEscape).join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "trading-journal-" + isoDate(new Date()) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Exported " + state.trades.length + " trades.");
  }

  function parseCsv(text) {
    // RFC-4180-ish parser: handles quoted fields, escaped quotes, CRLF
    var rows = [], row = [], field = "", inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function importCsv(text) {
    var rows = parseCsv(text);
    if (rows.length < 2) { toast("CSV looks empty."); return; }
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var col = function (name) { return head.indexOf(name); };
    var ci = {
      date: col("date"), pair: col("pair"), side: col("side"),
      entry: col("entry"), exit: col("exit"), stopLoss: col("stoploss"),
      size: col("size"), fees: col("fees"), setup: col("setup"),
      strategy: col("strategy"), rating: col("rating"), notes: col("notes")
    };
    if (ci.date < 0 || ci.pair < 0 || ci.entry < 0 || ci.exit < 0 || ci.size < 0) {
      toast("CSV needs at least: date, pair, entry, exit, size.");
      return;
    }
    var added = 0, skipped = 0;
    var existing = {};
    state.trades.forEach(function (t) { existing[t.id] = 1; });

    rows.slice(1).forEach(function (r) {
      var get = function (i) { return i < 0 ? "" : (r[i] || "").trim(); };
      var side = get(ci.side).toLowerCase() === "short" ? "short" : "long";
      var t = {
        id: uid() + "_" + added,
        date: get(ci.date),
        pair: get(ci.pair).toUpperCase(),
        side: side,
        entry: +get(ci.entry),
        exit: +get(ci.exit),
        stopLoss: get(ci.stopLoss) === "" ? null : +get(ci.stopLoss),
        size: +get(ci.size),
        fees: +get(ci.fees) || 0,
        setup: get(ci.setup),
        strategy: get(ci.strategy),
        rating: Math.min(5, Math.max(1, +get(ci.rating) || 3)),
        notes: get(ci.notes)
      };
      if (validTrade(t) && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) { state.trades.push(t); added++; }
      else skipped++;
    });
    save();
    refreshTagLists();
    renderCurrentView();
    toast("Imported " + added + " trades" + (skipped ? " (" + skipped + " rows skipped)" : "") + ".");
  }

  /* ================= events ================= */

  function bind() {
    document.querySelectorAll(".tab").forEach(function (b) {
      b.addEventListener("click", function () { switchView(b.dataset.view); });
    });

    $("#btnNewTrade").addEventListener("click", function () { openModal(null); });
    $("#btnCloseModal").addEventListener("click", closeModal);
    $("#btnCancelModal").addEventListener("click", closeModal);
    $("#tradeModal").addEventListener("click", function (e) {
      if (e.target === this) closeModal();
    });
    $("#tradeForm").addEventListener("submit", saveTrade);
    $("#btnDeleteTrade").addEventListener("click", deleteTrade);
    $("#rulesList").addEventListener("change", updateSaveGate);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("#tradeModal").classList.contains("hidden")) closeModal();
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && $("#tradeModal").classList.contains("hidden") &&
          !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        openModal(null);
      }
    });

    // filters
    $("#fPair").addEventListener("input", function () { state.filters.pair = this.value.trim(); renderTable(); });
    $("#fSetup").addEventListener("change", function () { state.filters.setup = this.value; renderTable(); });
    $("#fResult").addEventListener("change", function () { state.filters.result = this.value; renderTable(); });
    $("#fFrom").addEventListener("change", function () { state.filters.from = this.value; renderTable(); });
    $("#fTo").addEventListener("change", function () { state.filters.to = this.value; renderTable(); });
    $("#btnClearFilters").addEventListener("click", function () {
      state.filters = { pair: "", setup: "", result: "", from: "", to: "" };
      $("#fPair").value = ""; $("#fSetup").value = ""; $("#fResult").value = "";
      $("#fFrom").value = ""; $("#fTo").value = "";
      renderTable();
    });

    // sorting
    document.querySelectorAll("#tradeTable th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.dataset.sort;
        if (state.sort.key === k) state.sort.dir *= -1;
        else state.sort = { key: k, dir: k === "date" ? -1 : 1 };
        renderTable();
      });
    });

    // row click → edit
    $("#tradeTbody").addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      var t = state.trades.find(function (x) { return x.id === tr.dataset.id; });
      if (t) openModal(t);
    });

    // calendar nav
    $("#calPrev").addEventListener("click", function () {
      state.calCursor = new Date(state.calCursor.getFullYear(), state.calCursor.getMonth() - 1, 1);
      renderCalendar();
    });
    $("#calNext").addEventListener("click", function () {
      state.calCursor = new Date(state.calCursor.getFullYear(), state.calCursor.getMonth() + 1, 1);
      renderCalendar();
    });

    // CSV
    $("#btnExport").addEventListener("click", exportCsv);
    $("#btnImport").addEventListener("click", function () { $("#fileInput").click(); });
    $("#fileInput").addEventListener("change", function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { importCsv(reader.result); };
      reader.readAsText(file);
      this.value = "";
    });

    // sample data
    $("#btnSeed").addEventListener("click", function () {
      state.trades = seedTrades();
      save();
      refreshTagLists();
      renderCurrentView();
      toast("Loaded " + state.trades.length + " sample trades.");
    });
  }

  /* ================= boot ================= */

  load();
  bind();
  refreshTagLists();
  renderDashboard();
  renderTable();
  renderCalendar();
})();
