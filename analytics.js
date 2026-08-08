/* Trading Journal — analytics engine.
 * Pure computation + inline SVG renderers. No DOM lookups here:
 * every render function takes a container element, so app.js stays
 * the only place that knows about page structure.
 * Exposed as the global `Analytics` (plain script, file:// safe).
 */
(function () {
  "use strict";

  var EPS = 0.0000001; // treats tiny float residue as breakeven

  /* ---- per-trade math ---- */

  function grossPnl(t) {
    var diff = t.side === "short" ? t.entry - t.exit : t.exit - t.entry;
    return diff * t.size;
  }

  function netPnl(t) {
    return grossPnl(t) - (t.fees || 0);
  }

  // R multiple: net result relative to planned risk (entry→stop distance × size).
  // Returns null when no stop loss was recorded.
  function rMultiple(t) {
    if (!t.stopLoss || t.stopLoss <= 0) return null;
    var riskPerUnit = t.side === "short" ? t.stopLoss - t.entry : t.entry - t.stopLoss;
    var risk = riskPerUnit * t.size;
    if (risk <= 0) return null;
    return netPnl(t) / risk;
  }

  function isWin(t) { return netPnl(t) > EPS; }
  function isLoss(t) { return netPnl(t) < -EPS; }

  /* ---- aggregate stats ---- */

  function computeStats(trades) {
    var s = {
      count: trades.length,
      wins: 0, losses: 0, breakeven: 0,
      totalPnl: 0, grossWin: 0, grossLoss: 0,
      best: null, worst: null,
      winRate: 0, profitFactor: null, expectancy: 0,
      avgWin: 0, avgLoss: 0
    };
    trades.forEach(function (t) {
      var pnl = netPnl(t);
      s.totalPnl += pnl;
      if (pnl > EPS) { s.wins++; s.grossWin += pnl; }
      else if (pnl < -EPS) { s.losses++; s.grossLoss += -pnl; }
      else s.breakeven++;
      if (!s.best || pnl > netPnl(s.best)) s.best = t;
      if (!s.worst || pnl < netPnl(s.worst)) s.worst = t;
    });
    if (s.count) {
      s.winRate = (s.wins / s.count) * 100;
      s.expectancy = s.totalPnl / s.count;
    }
    if (s.wins) s.avgWin = s.grossWin / s.wins;
    if (s.losses) s.avgLoss = s.grossLoss / s.losses;
    // profit factor is undefined when there are no losses (infinite edge)
    if (s.grossLoss > 0) s.profitFactor = s.grossWin / s.grossLoss;
    else if (s.grossWin > 0) s.profitFactor = Infinity;
    return s;
  }

  /* ---- grouping helpers ---- */

  function pnlBySetup(trades) {
    var map = {};
    trades.forEach(function (t) {
      var k = t.setup || "(untagged)";
      if (!map[k]) map[k] = { name: k, pnl: 0, count: 0 };
      map[k].pnl += netPnl(t);
      map[k].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return Math.abs(b.pnl) - Math.abs(a.pnl); });
  }

  var WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function pnlByWeekday(trades) {
    var out = WEEKDAYS.map(function (d) { return { name: d, pnl: 0, count: 0 }; });
    trades.forEach(function (t) {
      // parse "YYYY-MM-DD" as local noon to dodge DST edge cases
      var parts = t.date.split("-").map(Number);
      var dow = (new Date(parts[0], parts[1] - 1, parts[2]).getDay() + 6) % 7; // Mon = 0
      out[dow].pnl += netPnl(t);
      out[dow].count++;
    });
    return out;
  }

  // Daily P&L map keyed by "YYYY-MM-DD", plus cumulative equity series.
  function dailySeries(trades) {
    var sorted = trades.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    var byDay = {};
    sorted.forEach(function (t) {
      if (!byDay[t.date]) byDay[t.date] = { date: t.date, pnl: 0, count: 0 };
      byDay[t.date].pnl += netPnl(t);
      byDay[t.date].count++;
    });
    var days = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
    var equity = 0;
    days.forEach(function (d) { equity += d.pnl; d.equity = equity; });
    return { byDay: byDay, days: days };
  }

  /* ---- formatting ---- */

  function fmtMoney(v, opts) {
    opts = opts || {};
    if (v == null || isNaN(v)) return "—";
    var sign = v < 0 ? "-" : (opts.plus && v > 0 ? "+" : "");
    return sign + "$" + Math.abs(v).toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  function fmtR(r) {
    return r == null ? "—" : (r > 0 ? "+" : "") + r.toFixed(2) + "R";
  }

  /* ---- SVG helpers ---- */

  var SVGNS = "http://www.w3.org/2000/svg";

  function el(name, attrs, text) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---- equity curve ---- */

  function renderEquityCurve(container, trades) {
    container.innerHTML = "";
    var data = dailySeries(trades).days;
    if (!data.length) {
      container.innerHTML = '<p class="chart-empty">No trades yet — the equity curve appears once you log some.</p>';
      return { first: null, last: null };
    }

    var W = 760, H = 240, padL = 56, padR = 14, padT = 16, padB = 28;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });

    var values = [0].concat(data.map(function (d) { return d.equity; }));
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    min -= span * 0.06; max += span * 0.06;

    function x(i) { return padL + (i / Math.max(data.length - 1, 1)) * (W - padL - padR); }
    function y(v) { return padT + (1 - (v - min) / (max - min)) * (H - padT - padB); }

    // horizontal gridlines + y labels
    for (var g = 0; g <= 4; g++) {
      var gv = min + (g / 4) * (max - min);
      svg.appendChild(el("line", { x1: padL, y1: y(gv), x2: W - padR, y2: y(gv), "class": "grid-line" }));
      svg.appendChild(el("text", {
        x: padL - 8, y: y(gv) + 4, "text-anchor": "end", "class": "bar-label"
      }, "$" + Math.round(gv).toLocaleString("en-US")));
    }

    // zero baseline
    if (min < 0 && max > 0) {
      svg.appendChild(el("line", { x1: padL, y1: y(0), x2: W - padR, y2: y(0), "class": "axis-line" }));
    }

    // area + line
    var pts = data.map(function (d, i) { return x(i) + "," + y(d.equity); });
    var baseY = y(Math.max(min, 0));
    var area = "M" + x(0) + "," + baseY + " L" + pts.join(" L") + " L" + x(data.length - 1) + "," + baseY + " Z";
    var finalPnl = data[data.length - 1].equity;
    var stroke = finalPnl >= 0 ? cssVar("--green") : cssVar("--red");

    var gradId = "eqGrad" + (finalPnl >= 0 ? "G" : "R");
    var defs = el("defs", {});
    var grad = el("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(el("stop", { offset: "0%", "stop-color": stroke, "stop-opacity": 0.32 }));
    grad.appendChild(el("stop", { offset: "100%", "stop-color": stroke, "stop-opacity": 0.02 }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    svg.appendChild(el("path", { d: area, fill: "url(#" + gradId + ")" }));
    svg.appendChild(el("polyline", {
      points: pts.join(" "), fill: "none", stroke: stroke, "stroke-width": 2.2,
      "stroke-linejoin": "round", "stroke-linecap": "round"
    }));

    // x labels: first / mid / last date
    [0, Math.floor((data.length - 1) / 2), data.length - 1].forEach(function (i, idx) {
      if (idx > 0 && data.length < 3) return;
      var d = data[i];
      svg.appendChild(el("text", {
        x: x(i), y: H - 8, "text-anchor": idx === 2 ? "end" : idx === 0 ? "start" : "middle",
        "class": "bar-label"
      }, d.date.slice(5)));
    });

    container.appendChild(svg);
    return { first: data[0].date, last: data[data.length - 1].date };
  }

  /* ---- horizontal bar chart (shared by setup + weekday) ---- */

  function renderBars(container, rows) {
    container.innerHTML = "";
    if (!rows.length) {
      container.innerHTML = '<p class="chart-empty">No data.</p>';
      return;
    }
    var rowH = 30, padTop = 6, labelW = 110, valueW = 84, W = 420;
    var H = padTop * 2 + rows.length * rowH;
    var maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.pnl); }).concat([1]));
    var midX = labelW + (W - labelW - valueW) / 2;
    var halfW = (W - labelW - valueW) / 2 - 6;

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H });
    svg.appendChild(el("line", { x1: midX, y1: 2, x2: midX, y2: H - 2, "class": "axis-line" }));

    rows.forEach(function (r, i) {
      var cy = padTop + i * rowH + rowH / 2;
      svg.appendChild(el("text", { x: labelW - 10, y: cy + 4, "text-anchor": "end", "class": "bar-label" },
        r.name + (r.count ? " (" + r.count + ")" : "")));
      var w = Math.max((Math.abs(r.pnl) / maxAbs) * halfW, r.pnl === 0 ? 0 : 2);
      var pos = r.pnl >= 0;
      svg.appendChild(el("rect", {
        x: pos ? midX : midX - w, y: cy - 8, width: w, height: 16, rx: 3,
        fill: pos ? cssVar("--green") : cssVar("--red"), opacity: 0.85
      }));
      svg.appendChild(el("text", {
        x: pos ? midX + w + 7 : midX - w - 7, y: cy + 4,
        "text-anchor": pos ? "start" : "end",
        fill: pos ? cssVar("--green") : cssVar("--red"), "font-size": 11.5, "font-weight": 600
      }, fmtMoney(r.pnl, { plus: true })));
    });
    container.appendChild(svg);
  }

  /* ---- public API ---- */

  window.Analytics = {
    EPS: EPS,
    grossPnl: grossPnl,
    netPnl: netPnl,
    rMultiple: rMultiple,
    isWin: isWin,
    isLoss: isLoss,
    computeStats: computeStats,
    pnlBySetup: pnlBySetup,
    pnlByWeekday: pnlByWeekday,
    dailySeries: dailySeries,
    WEEKDAYS: WEEKDAYS,
    fmtMoney: fmtMoney,
    fmtR: fmtR,
    renderEquityCurve: renderEquityCurve,
    renderBars: renderBars
  };
})();
