/* Themis / Ma'at swap guard dashboard. Renders window.THEMIS_DATA (mock-data.js). */
(function () {
  "use strict";

  var D = window.THEMIS_DATA;
  var SVGNS = "http://www.w3.org/2000/svg";
  var ORDER = ["ALLOW", "LIMIT", "ESCALATE", "BLOCK"];
  var VERDICT = {
    ALLOW: { label: "Allow", cls: "allow", icon: "allow", caption: "Swap signed and sent" },
    LIMIT: { label: "Limit", cls: "limit", icon: "limit", caption: "Swap sent at a smaller size" },
    ESCALATE: { label: "Escalate", cls: "escalate", icon: "human", caption: "Held for a human to approve with World ID" },
    BLOCK: { label: "Block", cls: "block", icon: "block", caption: "Swap dropped before signing" }
  };
  var STAGES = {
    intercept: { name: "Intercept swap", hint: "router calldata" },
    screen: { name: "Intercepta screen", hint: "sanctions · phishing · fakes" },
    pool: { name: "Pool & holders", hint: "depth · impact · LP · top 10" },
    deployer: { name: "Find real deployer", hint: "skip factory, follow signer" },
    funding: { name: "Trace funding", hint: "hops back from deployer" },
    history: { name: "Deployer history", hint: "launches · dev sells" },
    jev: { name: "JEV decides", hint: "typed verdict + confidence" },
    enforce: { name: "Enforce", hint: "drop · cut · ask · sign" }
  };
  var LOOKUPS = ["screen", "pool", "deployer", "funding", "history"];
  var RISK = { high: "High risk", medium: "Watch", low: "Low risk", none: "Clean" };

  var ICONS = {
    allow: '<path d="M3.2 8.6l3.1 3 6.5-7.2"/>',
    limit: '<path d="M8 2.4v7.4M4.8 6.7L8 9.9l3.2-3.2M3 13.4h10"/>',
    human: '<circle cx="8" cy="5" r="2.6"/><path d="M2.8 14.2c.3-3 2.4-4.6 5.2-4.6s4.9 1.6 5.2 4.6"/>',
    block: '<circle cx="8" cy="8" r="5.6"/><path d="M4.1 11.9l7.8-7.8"/>',
    replay: '<path d="M2.9 8a5.1 5.1 0 1 0 1.5-3.6"/><path d="M2.6 2.2v2.9h2.9"/>',
    slow: '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.8V8l2.2 1.6"/>',
    table: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6.6h11M2.5 9.9h11M6.4 6.6V13"/>'
  };
  var GLYPHS = {
    themis:
      '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M16 5.5v20M10.5 26.5h11M4.5 9h23"/><circle cx="16" cy="5.2" r="1.6" fill="currentColor"/>' +
      '<path d="M4.5 9l-3 8.5M4.5 9l3 8.5M27.5 9l-3 8.5M27.5 9l3 8.5"/>' +
      '<path d="M1 17.5h7a3.5 3 0 0 1-7 0zM24 17.5h7a3.5 3 0 0 1-7 0z" fill="currentColor" fill-opacity=".18"/></svg>',
    maat:
      '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M23.5 3.5C15 5 9.8 12 9.4 20.5l-.4 4.3c3.9-2.3 9.3-6.6 12.4-11.4 2.6-4 3.1-7.2 2.1-9.9z" fill="currentColor" fill-opacity=".18"/>' +
      '<path d="M7 29.5l14.5-21M13.2 17.5l4.3.6M15.4 14.2l4 .3M11.4 21l4.2 1"/></svg>'
  };
  var NAMES = {
    themis: { word: "Themis", title: "Themis Swap Guard" },
    maat: { word: "Ma'at", title: "Ma'at Swap Guard" }
  };

  var state = { current: null, slow: false, tlTable: false, run: 0, beam: null };

  /* ---------- helpers ---------- */
  function el(tag, attrs) {
    var n = document.createElement(tag);
    setAttrs(n, attrs);
    for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
    return n;
  }
  function sv(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    setAttrs(n, attrs);
    for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
    return n;
  }
  function setAttrs(n, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") n.setAttribute("class", v);
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.setAttribute("style", v);
      else n.setAttribute(k, v === true ? "" : v);
    });
  }
  function append(n, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(n, k); }); return; }
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  function icon(name, cls) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.8");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    if (cls) s.setAttribute("class", cls);
    s.innerHTML = ICONS[name]; // static, trusted markup
    return s;
  }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function pct1(p) { return (p * 100).toFixed(1) + "%"; }
  function signed(w) { return (w > 0 ? "+" : w < 0 ? "−" : "") + Math.abs(w).toFixed(1); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function sum(arr, f) { return arr.reduce(function (a, x) { return a + (f ? f(x) : x); }, 0); }
  function reduceMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function vchip(v) {
    var m = VERDICT[v];
    return el("span", { class: "vchip" }, icon(m.icon, "c-" + m.cls), m.label);
  }
  function percentile(h, p) {
    var total = sum(h.counts), target = p * total, cum = 0;
    for (var i = 0; i < h.counts.length; i++) {
      var c = h.counts[i];
      if (cum + c >= target) return h.binStart + i * h.binWidth + ((target - cum) / c) * h.binWidth;
      cum += c;
    }
    return h.binStart + h.counts.length * h.binWidth;
  }
  function cardHead(id, title, sub, actions) {
    return el("header", { class: "card-head" },
      el("div", null, el("h2", { id: id, text: title }), sub ? el("p", { class: "card-sub", text: sub }) : null),
      actions && actions.length ? el("div", { class: "card-actions" }, actions) : null);
  }
  function tableButton(pressed, onToggle) {
    var b = el("button", { type: "button", class: "btn", "aria-pressed": String(!!pressed) }, icon("table"), "Table");
    b.addEventListener("click", function () {
      var on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      onToggle(on);
    });
    return b;
  }
  function dataTable(cols, rows) {
    return el("div", { class: "table-wrap" },
      el("table", { class: "data" },
        el("thead", null, el("tr", null, cols.map(function (c) {
          return el("th", { class: c.num ? "num" : null, scope: "col", text: c.label });
        }))),
        el("tbody", null, rows.map(function (r) {
          return el("tr", null, r.map(function (v, i) {
            return el("td", { class: cols[i].num ? "num" : null, text: v });
          }));
        }))));
  }

  /* ---------- tooltip ---------- */
  var tip = document.getElementById("tip");
  function showTip(content, x, y) {
    tip.replaceChildren(el("b", { text: content.value }), el("span", { text: content.label }));
    tip.hidden = false;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = x + 14, top = y - th - 12;
    if (left + tw > window.innerWidth - 8) left = x - tw - 14;
    if (left < 8) left = 8;
    if (top < 8) top = y + 18;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() { tip.hidden = true; }
  function bindTip(node, content) {
    node.classList.add("mark");
    if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", content.value + ", " + content.label);
    node.addEventListener("pointermove", function (e) { showTip(content, e.clientX, e.clientY); });
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("focus", function () {
      var r = node.getBoundingClientRect();
      showTip(content, r.left + r.width / 2, r.top);
    });
    node.addEventListener("blur", hideTip);
  }
  window.addEventListener("scroll", hideTip, { passive: true });

  /* ---------- brand name ---------- */
  function setName(key) {
    var n = NAMES[key] || NAMES.themis;
    document.getElementById("wordmark").textContent = n.word;
    document.getElementById("brand-glyph").innerHTML = GLYPHS[key] || GLYPHS.themis;
    document.title = n.title;
    document.getElementById("name-themis").setAttribute("aria-pressed", String(key !== "maat"));
    document.getElementById("name-maat").setAttribute("aria-pressed", String(key === "maat"));
    try { localStorage.setItem("guard-name", key); } catch (e) { /* storage unavailable */ }
  }
  document.getElementById("name-themis").addEventListener("click", function () { setName("themis"); });
  document.getElementById("name-maat").addEventListener("click", function () { setName("maat"); });

  /* ---------- KPI row ---------- */
  function renderKpis() {
    var t = D.today, v = t.verdicts;
    var p50 = Math.round(percentile(t.latency, 0.5));
    var p95 = Math.round(percentile(t.latency, 0.95));
    var p99 = Math.round(percentile(t.latency, 0.99));
    var total = sum(ORDER.map(function (k) { return v[k]; }));

    var mix = el("div", { class: "mix", role: "img", "aria-label": ORDER.map(function (k) { return VERDICT[k].label + " " + v[k]; }).join(", ") });
    ORDER.forEach(function (k) {
      var seg = el("span", { style: "flex:" + v[k] + " 1 0; background: var(--" + VERDICT[k].cls + ")" });
      bindTip(seg, { value: fmt(v[k]) + " swaps", label: VERDICT[k].label + " · " + pct1(v[k] / total) });
      seg.removeAttribute("tabindex");
      mix.append(seg);
    });
    var legend = el("div", { class: "mix-legend" }, ORDER.map(function (k) {
      return el("span", null, icon(VERDICT[k].icon, "c-" + VERDICT[k].cls), VERDICT[k].label, el("b", { text: fmt(v[k]) }));
    }));

    var kpis = document.getElementById("kpis");
    kpis.replaceChildren(
      el("div", { class: "card kpi" },
        el("p", { class: "eyebrow", text: "Swap intents screened today" }),
        el("p", { class: "kpi-value", text: fmt(t.screened) }),
        mix, legend),
      el("div", { class: "card kpi" },
        el("p", { class: "eyebrow", text: "Blocked before signing" }),
        el("p", { class: "kpi-value", text: fmt(v.BLOCK) }),
        el("p", { class: "kpi-note", text: t.ethKept.toFixed(1) + " ETH kept out of flagged tokens" })),
      el("div", { class: "card kpi" },
        el("p", { class: "eyebrow", text: "Median decision time" }),
        el("p", { class: "kpi-value" }, String(p50), el("small", { text: "ms" })),
        el("p", { class: "kpi-note", text: "p95 " + p95 + " ms · p99 " + p99 + " ms. One Base block is " + fmt(D.blockTimeMs) + " ms." })),
      el("div", { class: "card kpi" },
        el("p", { class: "eyebrow", text: "Sent to a human" }),
        el("p", { class: "kpi-value", text: fmt(v.ESCALATE) }),
        el("p", { class: "kpi-note", text: "World ID approvals: " + t.humans.approved + " approved, " + t.humans.rejected + " rejected" }))
    );
  }

  /* ---------- swap log ---------- */
  function renderLog() {
    var list = document.getElementById("log-list");
    document.getElementById("log-count").textContent = D.swaps.length + " latest of " + fmt(D.today.screened);
    list.replaceChildren.apply(list, D.swaps.map(function (s) {
      var b = el("button", { type: "button", class: "log-row", "data-id": s.id, "aria-pressed": "false" },
        el("span", { class: "log-pair" }, s.sell.amt + " " + s.sell.sym + " → " + s.buy.sym),
        vchip(s.verdict),
        el("span", { class: "log-reason", text: s.short }),
        el("span", { class: "log-meta" },
          el("span", { class: "mono", text: s.time }),
          el("span", null, el("b", { text: s.latencyMs + " ms" })),
          el("span", { text: pct1(s.confidence) + " sure" })));
      b.addEventListener("click", function () { select(s.id, true); });
      return b;
    }));
    list.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var rows = Array.prototype.slice.call(list.querySelectorAll(".log-row"));
      var i = rows.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var next = rows[clamp(i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1), 0, rows.length - 1)];
      next.focus();
      next.click();
    });
  }

  /* ---------- the scale ---------- */
  function buildBeam() {
    var svg = sv("svg", { viewBox: "0 0 240 150", class: "beam", role: "img" });
    svg.append(
      sv("rect", { x: 84, y: 138, width: 72, height: 6, rx: 3, fill: "var(--rule)" }),
      sv("line", { x1: 120, y1: 30, x2: 120, y2: 139, stroke: "var(--ink-2)", "stroke-width": 3, "stroke-linecap": "round" })
    );
    var bar = sv("g", { class: "beam-bar" },
      sv("line", { x1: 40, y1: 30, x2: 200, y2: 30, stroke: "var(--brass-line)", "stroke-width": 4, "stroke-linecap": "round" }),
      sv("circle", { cx: 40, cy: 30, r: 3.5, fill: "var(--brass-line)" }),
      sv("circle", { cx: 200, cy: 30, r: 3.5, fill: "var(--brass-line)" }));
    function pan(label) {
      var weights = sv("g");
      var g = sv("g", { class: "pan" },
        sv("line", { x1: 0, y1: 0, x2: -24, y2: 58, stroke: "var(--ink-2)", "stroke-width": 1.2 }),
        sv("line", { x1: 0, y1: 0, x2: 24, y2: 58, stroke: "var(--ink-2)", "stroke-width": 1.2 }),
        weights,
        sv("path", { d: "M-30 58H30Q0 79-30 58Z", fill: "var(--surface)", stroke: "var(--ink-2)", "stroke-width": 1.5, "stroke-linejoin": "round" }),
        sv("text", { x: 0, y: 88, "text-anchor": "middle", fill: "var(--ink-2)", "font-size": 10, "font-weight": 650, "letter-spacing": "1.2", "font-family": "var(--f-display)", text: label }));
      return { g: g, weights: weights };
    }
    var left = pan("ALLOW"), right = pan("BLOCK");
    svg.append(bar, left.g, right.g,
      sv("circle", { cx: 120, cy: 30, r: 6, fill: "var(--surface)", stroke: "var(--brass-line)", "stroke-width": 3 }));
    return { svg: svg, bar: bar, left: left, right: right, angle: null };
  }
  function stackWeights(group, signals, color) {
    group.replaceChildren();
    var y = 60;
    signals.forEach(function (s) {
      var h = Math.max(3, Math.abs(s.w) * 4.2);
      y -= h;
      var r = sv("rect", { x: -7, y: y, width: 14, height: h, rx: 1.5, fill: color });
      bindTip(r, { value: signed(s.w), label: s.label });
      r.removeAttribute("tabindex");
      group.append(r);
      y -= 1.5;
    });
  }
  function tiltBeam(beam, signals, animate) {
    var toBlock = signals.filter(function (s) { return s.w > 0; });
    var toAllow = signals.filter(function (s) { return s.w < 0; });
    stackWeights(beam.right.weights, toBlock, "var(--to-block)");
    stackWeights(beam.left.weights, toAllow, "var(--to-allow)");
    var net = sum(signals, function (s) { return s.w; });
    var deg = clamp(net * 2.4, -14, 14);
    beam.svg.setAttribute("aria-label", "Scale tips " + (net >= 0 ? "toward block" : "toward allow") + ": net weight " + signed(net));
    function apply(d) {
      var rad = (d * Math.PI) / 180, L = 80;
      beam.bar.style.transform = "rotate(" + d + "deg)";
      beam.left.g.style.transform = "translate(" + (120 - L * Math.cos(rad)) + "px," + (30 - L * Math.sin(rad)) + "px)";
      beam.right.g.style.transform = "translate(" + (120 + L * Math.cos(rad)) + "px," + (30 + L * Math.sin(rad)) + "px)";
    }
    // Start from level on first paint; afterwards from the previous tilt.
    // Flushing style first lets the CSS transition run from where the beam was.
    if (beam.angle === null) apply(animate && !reduceMotion() ? 0 : deg);
    beam.svg.getBoundingClientRect();
    apply(deg);
    beam.angle = deg;
  }

  /* ---------- decision hero ---------- */
  function renderDecision(s) {
    var m = VERDICT[s.verdict];
    var card = document.getElementById("decision");
    if (!state.beam) state.beam = buildBeam();
    var stamp = el("div", { class: "stamp v-" + m.cls, id: "stamp", style: m.label.length > 5 ? "font-size:24px" : null },
      icon(m.icon), m.label);
    card.replaceChildren(
      el("div", { class: "decision-title" },
        el("p", { class: "eyebrow", text: "Swap intent · " + s.time + " · " + D.agent.venue + " on " + D.agent.chain }),
        el("h1", { class: "intent-title" },
          el("span", { class: "who", text: D.agent.ens + " wants to swap" }),
          s.sell.amt + " " + s.sell.sym, el("span", { class: "arrow", text: " → " }), s.buy.sym),
        el("p", { class: "headline", text: s.headline })),
      el("div", { class: "decision-facts" },
        el("dl", { class: "kv" }, s.intent.map(function (kv) {
          return el("div", null, el("dt", { text: kv[0] }), el("dd", { text: kv[1] }));
        })),
        el("p", { class: "source-line" }, el("span", { class: "eyebrow", text: "Instruction" }), el("span", { text: s.source }))),
      el("div", { class: "verdict-panel" },
        state.beam.svg,
        stamp,
        el("div", { class: "verdict-meta" },
          el("div", null, el("b", { text: pct1(s.confidence) }), el("span", { text: "confidence" })),
          el("div", null, el("b", { text: s.latencyMs + " ms" }), el("span", { text: "to decide" }))),
        el("p", { class: "verdict-caption", text: m.caption })));
    tiltBeam(state.beam, s.signals, true);
  }

  /* ---------- timeline ---------- */
  function stageStats(s) {
    var look = s.stages.filter(function (st) { return LOOKUPS.indexOf(st.key) >= 0 && st.start != null; });
    var jev = s.stages.filter(function (st) { return st.key === "jev"; })[0];
    return {
      count: look.length,
      window: Math.max.apply(null, look.map(function (x) { return x.end; })) - Math.min.apply(null, look.map(function (x) { return x.start; })),
      serial: sum(look, function (x) { return x.end - x.start; }),
      jev: jev.end - jev.start
    };
  }
  function renderTimeline(s) {
    var card = document.getElementById("timeline");
    var st = stageStats(s);
    var total = s.latencyMs;
    var domain = Math.ceil(total / 50) * 50;
    var step = domain <= 100 ? 25 : 50;
    var n = domain / step;

    var replayBtn = el("button", { type: "button", class: "btn btn-primary" }, icon("replay"), "Replay");
    var slowBtn = el("button", { type: "button", class: "btn", "aria-pressed": String(state.slow) }, icon("slow"), "Slow motion ×10");
    var tblBtn = tableButton(state.tlTable, function (on) {
      state.tlTable = on;
      plot.hidden = on;
      table.hidden = !on;
    });
    replayBtn.addEventListener("click", function () { replay(); });
    slowBtn.addEventListener("click", function () {
      state.slow = !state.slow;
      slowBtn.setAttribute("aria-pressed", String(state.slow));
      if (state.slow) replay();
    });

    var counter = el("span", { id: "tl-counter", text: String(total) });
    var meterFill = el("span", { class: "meter-fill", id: "tl-meter", style: "width:" + (total / D.blockTimeMs) * 100 + "%" });
    var hero = el("div", { class: "tl-hero" },
      el("p", { class: "hero-num" }, counter, el("span", { class: "unit", text: "ms" })),
      el("p", { class: "hero-cap", text: "from intercepted swap to verdict" }),
      el("div", { class: "meter" },
        el("div", { class: "meter-track", role: "img", "aria-label": total + " of " + D.blockTimeMs + " ms" }, meterFill),
        el("p", { class: "meter-label", text: Math.round((total / D.blockTimeMs) * 100) + "% of one Base block (" + fmt(D.blockTimeMs) + " ms)" })),
      el("dl", { class: "tl-facts" },
        el("div", null, el("dt", { text: st.count + " lookups, in parallel" }), el("dd", { text: st.window + " ms" })),
        el("div", null, el("dt", { text: "Same lookups one by one" }), el("dd", { text: st.serial + " ms" })),
        el("div", null, el("dt", { text: "JEV decision" }), el("dd", { text: st.jev + " ms" }))));

    var lanes = s.stages.map(function (x) {
      var meta = STAGES[x.key];
      var track = el("div", { class: "wf-track", style: "--wf-n:" + n });
      var lane = el("div", { class: "wf-lane" + (x.key === "jev" ? " is-jev" : "") + (x.key === "intercept" || x.key === "enforce" ? " is-edge" : "") },
        el("div", { class: "wf-label" }, el("span", { class: "wf-name", text: meta.name }), el("span", { class: "wf-hint", text: meta.hint })),
        track);
      if (x.start == null) {
        track.append(el("span", { class: "wf-skip", text: x.note || "skipped" }));
        return { lane: lane };
      }
      var bar = el("span", { class: "wf-bar", style: "left:" + (x.start / domain) * 100 + "%;width:" + ((x.end - x.start) / domain) * 100 + "%" });
      var val = el("span", { class: "wf-val", style: "left:" + (x.end / domain) * 100 + "%", text: (x.end - x.start) + " ms" });
      bindTip(bar, { value: (x.end - x.start) + " ms", label: meta.name + " · " + x.start + "–" + x.end + " ms" });
      track.append(bar, val);
      return { lane: lane, bar: bar, val: val, start: x.start, end: x.end };
    });

    var axis = el("div", { class: "wf-axis", "aria-hidden": "true" });
    for (var i = 0; i <= n; i++) {
      axis.append(el("span", { style: "left:" + (i / n) * 100 + "%", text: i === n ? i * step + " ms" : String(i * step) }));
    }
    var overlay = el("div", { class: "wf-overlay", "aria-hidden": "true" },
      el("span", { class: "wf-verdict-line", style: "left:" + (total / domain) * 100 + "%" }),
      el("span", { class: "wf-verdict-tag", style: "left:" + (total / domain) * 100 + "%", text: "verdict " + total + " ms" }));
    var plot = el("div", { class: "wf" },
      el("div", { class: "wf-plot" }, el("div", { class: "wf-plot-inner" }, lanes.map(function (l) { return l.lane; }), overlay)),
      axis);
    plot.hidden = state.tlTable;

    var table = dataTable(
      [{ label: "Stage" }, { label: "Start", num: true }, { label: "End", num: true }, { label: "Took", num: true }],
      s.stages.map(function (x) {
        var nm = STAGES[x.key].name;
        return x.start == null ? [nm, "—", "—", x.note || "skipped"] : [nm, x.start + " ms", x.end + " ms", (x.end - x.start) + " ms"];
      }));
    table.hidden = !state.tlTable;

    card.replaceChildren(
      cardHead("tl-title", "From intent to verdict", "The lookups run side by side, then JEV decides. Nothing waits on a person or a chat model.", [replayBtn, slowBtn, tblBtn]),
      el("div", { class: "tl-body" }, hero, el("div", null, plot, table)));

    state.anim = { lanes: lanes.filter(function (l) { return l.bar; }), total: total, domain: domain, counter: counter, meter: meterFill };
  }

  function replay() {
    var a = state.anim;
    if (!a) return;
    var stamp = document.getElementById("stamp");
    var run = ++state.run;
    if (reduceMotion()) return;
    var speed = state.slow ? 10 : 1;
    stamp.classList.remove("is-stamped");
    stamp.classList.add("is-pending");
    var t0 = performance.now();
    function frame(now) {
      if (run !== state.run) return;
      var t = (now - t0) / speed;
      a.lanes.forEach(function (l) {
        var p = clamp(t - l.start, 0, l.end - l.start);
        l.bar.style.width = (p / a.domain) * 100 + "%";
        l.val.style.visibility = t >= l.end ? "visible" : "hidden";
      });
      var shown = Math.min(Math.round(t), a.total);
      a.counter.textContent = String(shown);
      a.meter.style.width = (shown / D.blockTimeMs) * 100 + "%";
      if (t < a.total) {
        requestAnimationFrame(frame);
      } else {
        stamp.classList.remove("is-pending");
        void stamp.offsetWidth;
        stamp.classList.add("is-stamped");
      }
    }
    requestAnimationFrame(frame);
  }

  /* ---------- evidence ---------- */
  function renderEvidence(s) {
    var card = document.getElementById("evidence");
    var maxAbs = Math.max.apply(null, s.signals.map(function (x) { return Math.abs(x.w); }));
    var dom = maxAbs * 1.3;
    var plus = sum(s.signals.filter(function (x) { return x.w > 0; }), function (x) { return x.w; });
    var minus = sum(s.signals.filter(function (x) { return x.w < 0; }), function (x) { return x.w; });
    var net = plus + minus;
    var sources = s.signals.map(function (x) { return x.source; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; });

    var rows = s.signals.map(function (x) {
      var w = (Math.abs(x.w) / dom) * 50;
      var side = x.w >= 0 ? "to-block" : "to-allow";
      var bar = el("span", { class: "div-bar " + side, style: "width:" + w + "%" });
      var val = el("span", { class: "div-val", text: signed(x.w),
        style: x.w >= 0 ? "left:calc(" + (50 + w) + "% + 6px)" : "right:calc(" + (50 + w) + "% + 6px)" });
      bindTip(bar, { value: signed(x.w) + (x.w >= 0 ? " toward block" : " toward allow"), label: x.label });
      return el("div", { class: "ev-row" },
        el("div", { class: "ev-text" },
          el("span", { class: "ev-label", text: x.label }),
          el("span", { class: "ev-detail", text: x.detail }),
          el("span", { class: "src" + (x.source === "Intercepta" ? " src-intercepta" : ""), text: x.source })),
        el("div", { class: "div-track" }, bar, val));
    });

    card.replaceChildren(
      cardHead("ev-title", "What tipped the scale",
        "Every signal JEV weighed for this swap. Bars to the right push toward block, bars to the left toward allow."),
      el("div", { class: "ev-head" },
        el("span", { text: "Signal, evidence and source" }),
        el("div", { class: "ev-axis-labels" },
          el("span", null, icon("allow", "c-allow"), "← Allow"),
          el("span", null, "Block →", icon("block", "c-block")))),
      el("div", null, rows),
      el("div", { class: "ev-foot" },
        el("span", { class: "ev-net" }, "Net weight", el("b", { text: signed(net) }), net >= 0 ? "toward block" : "toward allow"),
        el("span", { class: "muted", text: signed(plus) + " block · " + signed(minus) + " allow · " + s.signals.length + " signals from " + sources.length + " sources" })));
  }

  /* ---------- money trail ---------- */
  function renderTrail(s) {
    var card = document.getElementById("trail");
    var list = el("div", { class: "trail" });
    s.trail.forEach(function (node, i) {
      list.append(el("div", { class: "trail-node risk-" + node.risk },
        el("span", { class: "risk-dot risk-" + node.risk, "aria-hidden": "true" }),
        el("div", null,
          el("div", { class: "trail-top" },
            el("span", { class: "trail-role", text: node.role }),
            el("span", { class: "trail-risk", text: RISK[node.risk] })),
          el("div", { class: "trail-name" },
            node.name ? [node.name, " "] : null,
            el("span", { class: node.name ? "mono muted" : "mono", text: node.addr })),
          el("div", { class: "trail-fact", text: node.fact }))));
      if (i < s.trail.length - 1) {
        list.append(el("div", { class: "trail-edge" }, el("span", { class: "line", "aria-hidden": "true" }), el("p", { text: node.edge })));
      }
    });
    card.replaceChildren(cardHead("trail-title", "Follow the money", "Where the launch funds came from, and how they reached this pool."), list);
  }

  /* ---------- deployer record ---------- */
  function renderRecord(s) {
    var card = document.getElementById("record");
    var r = s.record;
    var kids = [cardHead("record-title", "Deployer track record", null)];
    kids[0].querySelector("div").append(el("p", { class: "card-sub mono", text: r.deployer }));
    if (r.rows.length) {
      var bad = r.rows.filter(function (x) { return x.devSold; }).length;
      kids.push(el("div", { class: "pips" },
        el("span", { class: "pips-row", "aria-hidden": "true" }, r.rows.map(function (x) {
          return el("span", { class: "pip" + (x.devSold ? " on" : "") });
        })),
        el("span", null, el("b", { text: bad + " of " + r.rows.length }), " " + (r.pipLabel || "prior launches dev-sold"))));
    }
    kids.push(el("p", { class: "record-summary", text: r.summary }));
    if (r.rows.length) {
      kids.push(el("div", { class: "table-wrap" },
        el("table", { class: "data" },
          el("thead", null, el("tr", null,
            ["Token", "Launched", "Peak mcap", "Dev sold", "After", "Now"].map(function (h, i) {
              return el("th", { scope: "col", class: i >= 2 ? "num" : null, text: h });
            }))),
          el("tbody", null, r.rows.map(function (x) {
            return el("tr", { class: x.devSold ? "flag" : null },
              el("td", null, el("span", { class: "cell-flag" }, x.devSold ? icon("block", "c-block") : null, x.token)),
              el("td", { text: x.launched }),
              el("td", { class: "num", text: x.peak }),
              el("td", { class: "num", text: x.sold }),
              el("td", { class: "num", text: x.after }),
              el("td", { class: "num", text: x.now }));
          })))));
    } else {
      kids.push(el("p", { class: "empty-note", text: "No prior launches to list." }));
    }
    card.replaceChildren.apply(card, kids);
  }

  /* ---------- JEV output ---------- */
  function renderJev(s) {
    var card = document.getElementById("jev");
    var jevMs = stageStats(s).jev;
    var probs = el("div", { class: "probs" }, ORDER.map(function (k) {
      var p = s.probs[k], m = VERDICT[k];
      var bar = el("span", { class: "prob-bar", style: "width:" + p * 100 + "%;background:var(--" + m.cls + ")" });
      bindTip(bar, { value: pct1(p), label: m.label });
      bar.removeAttribute("tabindex");
      return el("div", { class: "prob" + (k === s.verdict ? " is-top" : "") },
        el("span", { class: "prob-name" }, icon(m.icon, "c-" + m.cls), m.label),
        el("div", { class: "prob-track" }, bar, el("span", { class: "prob-val", style: "left:" + p * 100 + "%", text: pct1(p) })));
    }));
    function line() { return el("span", null, Array.prototype.slice.call(arguments)); }
    var code = el("pre", { class: "code", "aria-label": "Typed JEV output" },
      line(el("span", { class: "k", text: "decide" }), "(swap_intent) → {\n"),
      line("  decision:   ", el("span", { class: "s", text: "\"" + s.verdict + "\"" }), ",", el("span", { class: "c", text: "  // ALLOW | LIMIT | ESCALATE | BLOCK" }), "\n"),
      line("  confidence: ", el("span", { class: "s", text: s.confidence.toFixed(3) }), ",\n"),
      line("  latency_ms: ", el("span", { class: "s", text: String(jevMs) }), "\n"),
      "}");
    card.replaceChildren(
      cardHead("jev-title", "JEV output", "JEV picks one of four typed options and returns its probability. It cannot answer in free text, so there is nothing to hallucinate."),
      probs, code,
      el("p", { class: "jev-note", text: "Is the confidence honest? See “Does 95% mean 95%?” below." }));
  }

  /* ---------- outcome ---------- */
  function renderOutcome(s) {
    var card = document.getElementById("outcome");
    card.replaceChildren(
      cardHead("outcome-title", "What happened next", VERDICT[s.verdict].caption + "."),
      el("ol", { class: "steps" }, s.outcome.map(function (o) {
        return el("li", { class: "step" }, el("span", { class: "step-t", text: o.t }), el("span", { class: "step-x", text: o.text }));
      })));
  }

  /* ---------- fleet charts ---------- */
  function chartCard(id, title, sub, draw, tableSpec, foot) {
    var fig = document.getElementById(id);
    var box = el("div", { class: "chart-box" });
    var table = dataTable(tableSpec.cols, tableSpec.rows);
    table.hidden = true;
    var tbtn = tableButton(false, function (on) { box.hidden = on; table.hidden = !on; if (!on) draw(box); });
    fig.replaceChildren(cardHead(id + "-title", title, sub, [tbtn]), box, table, foot ? el("p", { class: "chart-foot", text: foot }) : null);
    fig.setAttribute("aria-labelledby", id + "-title");
    draw(box);
    if (window.ResizeObserver) {
      var last = box.clientWidth, pending = false;
      new ResizeObserver(function () {
        if (pending || box.hidden || box.clientWidth === last) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; last = box.clientWidth; draw(box); });
      }).observe(box);
    }
  }

  function niceMax(v, step) { return Math.ceil(v / step) * step; }

  function drawLatency(box) {
    var h = D.today.latency;
    var W = Math.max(box.clientWidth, 260), H = 210;
    var m = { t: 24, r: 10, b: 26, l: 36 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var x0 = h.binStart, x1 = h.binStart + h.counts.length * h.binWidth;
    var yMax = niceMax(Math.max.apply(null, h.counts), 50);
    var X = function (v) { return m.l + ((v - x0) / (x1 - x0)) * pw; };
    var Y = function (v) { return m.t + ph - (v / yMax) * ph; };
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img",
      "aria-label": "Histogram of decision time for " + fmt(D.today.screened) + " swaps" });
    for (var yv = 0; yv <= yMax; yv += 50) {
      svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: Y(yv), y2: Y(yv), stroke: yv === 0 ? "var(--rule)" : "var(--hairline)", "stroke-width": 1 }));
      svg.append(sv("text", { x: m.l - 6, y: Y(yv) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)", style: "font-variant-numeric:tabular-nums", text: String(yv) }));
    }
    var band = pw / h.counts.length;
    var bw = Math.min(24, band - 2);
    h.counts.forEach(function (c, i) {
      var lo = x0 + i * h.binWidth, hi = lo + h.binWidth;
      var cx = X(lo) + band / 2, top = Y(c), base = Y(0), r = Math.min(4, (base - top) / 2);
      var g = sv("g", null,
        sv("rect", { x: X(lo), y: m.t, width: band, height: ph, fill: "transparent" }),
        sv("path", { fill: "var(--series)", d: "M" + (cx - bw / 2) + " " + base + "V" + (top + r) + "q0 -" + r + " " + r + " -" + r + "H" + (cx + bw / 2 - r) + "q" + r + " 0 " + r + " " + r + "V" + base + "Z" }));
      bindTip(g, { value: fmt(c) + " decisions", label: lo + "–" + hi + " ms" });
      svg.append(g);
    });
    for (var xv = x0; xv <= x1; xv += 40) {
      svg.append(sv("text", { x: X(xv), y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)", style: "font-variant-numeric:tabular-nums", text: xv === x1 || xv + 40 > x1 ? xv + " ms" : String(xv) }));
    }
    [["p50", 0.5], ["p95", 0.95], ["p99", 0.99]].forEach(function (p) {
      var v = percentile(h, p[1]);
      svg.append(sv("line", { x1: X(v), x2: X(v), y1: m.t - 6, y2: Y(0), stroke: "var(--ink)", "stroke-width": 1, "pointer-events": "none" }));
      svg.append(sv("text", { x: X(v), y: m.t - 10, "text-anchor": "middle", "font-size": 11, "font-weight": 650, fill: "var(--ink)", text: p[0] }));
    });
    box.replaceChildren(svg);
  }

  function drawReasons(box) {
    var rs = D.today.blockReasons;
    var max = Math.max.apply(null, rs.map(function (r) { return r.n; }));
    box.replaceChildren(el("div", { class: "hbar" }, rs.map(function (r) {
      var bar = el("span", { class: "hbar-bar", style: "width:" + (r.n / max) * 100 + "%" });
      bindTip(bar, { value: r.n + " swaps blocked", label: r.reason + " · " + r.source });
      return el("div", { class: "hbar-row" },
        el("div", { class: "hbar-label" }, el("span", { text: r.reason }), el("span", { class: "muted", text: r.source })),
        el("div", { class: "hbar-track" }, bar, el("span", { class: "hbar-val", style: "left:" + (r.n / max) * 100 + "%", text: String(r.n) })));
    })));
  }

  function drawCalibration(box) {
    var cs = D.today.calibration;
    var W = Math.max(box.clientWidth, 260), H = 230;
    var m = { t: 22, r: 12, b: 34, l: 42 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var X = function (v) { return m.l + ((v - 0.5) / 0.5) * pw; };
    var Y = function (v) { return m.t + ph - ((v - 0.5) / 0.5) * ph; };
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img",
      "aria-label": "JEV confidence against observed accuracy; points sit on the diagonal" });
    for (var t = 0.5; t <= 1.0001; t += 0.1) {
      var yy = Y(t), xx = X(t), lab = Math.round(t * 100) + "%";
      svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: t < 0.51 ? "var(--rule)" : "var(--hairline)", "stroke-width": 1 }));
      svg.append(sv("line", { x1: xx, x2: xx, y1: m.t, y2: m.t + ph, stroke: t < 0.51 ? "var(--rule)" : "var(--hairline)", "stroke-width": 1 }));
      svg.append(sv("text", { x: m.l - 6, y: yy + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)", style: "font-variant-numeric:tabular-nums", text: lab }));
      svg.append(sv("text", { x: xx, y: m.t + ph + 16, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)", style: "font-variant-numeric:tabular-nums", text: lab }));
    }
    svg.append(sv("text", { x: m.l, y: m.t - 9, "font-size": 11, fill: "var(--ink-2)", text: "How often it was right" }));
    svg.append(sv("text", { x: W - m.r, y: H - 2, "text-anchor": "end", "font-size": 11, fill: "var(--ink-2)", text: "JEV confidence" }));
    svg.append(sv("line", { x1: X(0.5), y1: Y(0.5), x2: X(1), y2: Y(1), stroke: "var(--muted)", "stroke-width": 1.5 }));
    cs.forEach(function (c) {
      var g = sv("g", null,
        sv("circle", { cx: X(c.predicted), cy: Y(c.observed), r: 12, fill: "transparent" }),
        sv("circle", { cx: X(c.predicted), cy: Y(c.observed), r: 5, fill: "var(--series)", stroke: "var(--surface)", "stroke-width": 2 }));
      bindTip(g, { value: pct1(c.observed) + " right", label: "JEV said " + c.bucket + " · " + fmt(c.n) + " decisions" });
      svg.append(g);
    });
    box.replaceChildren(svg);
  }

  function renderFleet() {
    var t = D.today, h = t.latency;
    var p50 = Math.round(percentile(h, 0.5)), p95 = Math.round(percentile(h, 0.95)), p99 = Math.round(percentile(h, 0.99));
    var slowest = h.binStart + h.counts.length * h.binWidth;
    chartCard("chart-latency", "Decision time, all " + fmt(t.screened) + " swaps",
      "p50 " + p50 + " ms, p95 " + p95 + " ms, p99 " + p99 + " ms. Even the slowest took under " + slowest + " ms.",
      drawLatency,
      { cols: [{ label: "Decision time" }, { label: "Swaps", num: true }],
        rows: h.counts.map(function (c, i) { var lo = h.binStart + i * h.binWidth; return [lo + "–" + (lo + h.binWidth) + " ms", fmt(c)]; }) },
      "One Base block is " + fmt(D.blockTimeMs) + " ms. The guard never costs the agent a block.");

    var bySource = {};
    t.blockReasons.forEach(function (r) { bySource[r.source] = (bySource[r.source] || 0) + r.n; });
    var blocked = sum(t.blockReasons, function (r) { return r.n; });
    chartCard("chart-reasons", "Why " + blocked + " swaps were blocked",
      "Main reason for each block. The deployer trace caught " + (bySource["On-chain trace"] || 0) + ", Intercepta caught " + (bySource.Intercepta || 0) + ".",
      drawReasons,
      { cols: [{ label: "Reason" }, { label: "Source" }, { label: "Blocked", num: true }],
        rows: t.blockReasons.map(function (r) { return [r.reason, r.source, String(r.n)]; }) },
      t.ethKept.toFixed(1) + " ETH stayed in agent wallets instead of going into these tokens.");

    var n = sum(t.calibration, function (c) { return c.n; });
    var gap = sum(t.calibration, function (c) { return c.n * Math.abs(c.predicted - c.observed); }) / n;
    chartCard("chart-calibration", "Does 95% mean 95%?",
      "JEV's stated confidence against how often it was right over 30 days (" + fmt(n) + " decisions). Average gap: " + (gap * 100).toFixed(1) + " points.",
      drawCalibration,
      { cols: [{ label: "JEV said" }, { label: "Mean confidence", num: true }, { label: "Actually right", num: true }, { label: "Decisions", num: true }],
        rows: t.calibration.map(function (c) { return [c.bucket, pct1(c.predicted), pct1(c.observed), fmt(c.n)]; }) },
      "Line = perfect calibration. Right or wrong is judged 24 h later: did the token rug, or the counterparty get flagged?");
  }

  /* ---------- selection ---------- */
  function select(id, userAction) {
    var s = D.swaps.filter(function (x) { return x.id === id; })[0] || D.swaps[0];
    state.current = s;
    hideTip();
    Array.prototype.forEach.call(document.querySelectorAll(".log-row"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-id") === s.id));
    });
    renderDecision(s);
    renderTimeline(s);
    renderEvidence(s);
    renderTrail(s);
    renderRecord(s);
    renderJev(s);
    renderOutcome(s);
    if (userAction) {
      try { history.replaceState(null, "", "#" + s.id); } catch (e) { /* sandboxed */ }
      replay();
    }
  }

  /* ---------- boot ---------- */
  var savedName = "themis";
  try { savedName = localStorage.getItem("guard-name") || "themis"; } catch (e) { /* storage unavailable */ }
  setName(savedName);
  document.getElementById("agent-ens").textContent = D.agent.ens;
  document.getElementById("venue-chip").textContent = D.agent.venue + " on " + D.agent.chain;
  renderKpis();
  renderLog();
  select((location.hash || "").replace("#", "") || D.swaps[0].id, false);
  renderFleet();
  window.addEventListener("hashchange", function () {
    var id = (location.hash || "").replace("#", "");
    if (id && (!state.current || id !== state.current.id)) select(id, true);
  });
})();
