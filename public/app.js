(() => {
  "use strict";

  const MAX_EQ = 5;
  const EQ_COLORS = ["#ef5350", "#42a5f5", "#66bb6a", "#ab47bc", "#ffa726"];
  const DEFAULT_BOUNDS = { xMin: -10, xMax: 10, yMin: -7.5, yMax: 7.5 };
  const LIVE_DEBOUNCE_MS = 180;

  // --- client-side validator (mirrors server/graph.js for instant feedback) ---
  const ALLOWED_FUNCTIONS = new Set([
    "abs",
    "ceil",
    "floor",
    "round",
    "sign",
    "sqrt",
    "cbrt",
    "log",
    "log2",
    "log10",
    "ln",
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "atan2",
    "sinh",
    "cosh",
    "tanh",
    "asinh",
    "acosh",
    "atanh",
    "exp",
    "pow",
    "mod",
    "min",
    "max",
    "hypot",
    "pi",
    "e",
    "i",
  ]);
  const BLOCKED_RE =
    /\b(factorial|gamma|combination|permutation|gcd|lcm|bellNumbers|stirlingS2|catalan|bitAnd|bitOr|bitXor|leftShift|rightShift)\b/i;
  const DANGEROUS_RE =
    /(\bimport\b|\brequire\b|\beval\b|\bFunction\b|\bthis\b|\bglobal\b|\bprocess\b|\bconstructor\b|\bprototype\b)/i;
  const ALLOWED_SYMBOLS = new Set([
    "x",
    "y",
    "pi",
    "e",
    "i",
    "tau",
    "phi",
    "Infinity",
    "NaN",
    "LN2",
    "LN10",
    "LOG2E",
    "LOG10E",
    "SQRT1_2",
    "SQRT2",
  ]);
  const ALLOWED_OPERATORS = new Set([
    "add",
    "subtract",
    "multiply",
    "divide",
    "pow",
    "mod",
    "unaryMinus",
    "unaryPlus",
  ]);
  function validateAstLocal(root) {
    const bad = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      switch (n.type) {
        case "ConstantNode":
          return;
        case "ParenthesisNode":
          walk(n.content);
          return;
        case "SymbolNode":
          if (!ALLOWED_SYMBOLS.has(n.name)) bad.push(n.name);
          return;
        case "FunctionNode": {
          const fn = n.fn && n.fn.name;
          if (!ALLOWED_FUNCTIONS.has(fn)) bad.push(fn);
          (n.args || []).forEach(walk);
          return;
        }
        case "OperatorNode": {
          if (!ALLOWED_OPERATORS.has(n.fn)) bad.push(n.fn);
          (n.args || []).forEach(walk);
          return;
        }
        case "ArrayNode":
          (n.items || []).forEach(walk);
          return;
        case "RelationalNode":
          (n.params || []).forEach(walk);
          return;
        case "ConditionalNode":
          walk(n.condition);
          walk(n.trueExpr);
          walk(n.falseExpr);
          return;
        case "RangeNode":
          walk(n.start);
          walk(n.end);
          walk(n.step);
          return;
        default:
          bad.push(n.type);
          return;
      }
    };
    walk(root);
    return bad;
  }
  function getLocalError(eqRaw) {
    if (eqRaw == null) return null;
    const s = eqRaw.trim();
    if (s === "") return null;
    if (s.length > 500) return "Equation too long.";
    if (DANGEROUS_RE.test(s)) return "Disallowed tokens in expression.";
    const bm = s.match(BLOCKED_RE);
    if (bm) return `Function "${bm[0]}" is not allowed.`;
    const eqIdx = s.indexOf("=");
    const checkOne = (expr, isLeft) => {
      let node;
      try {
        node = math.parse(expr);
      } catch (e) {
        return "Syntax error: " + e.message;
      }
      const bad = validateAstLocal(node);
      if (bad.length)
        return `Symbol or function "${bad[0]}" is not allowed${isLeft ? " (left side)" : ""}.`;
      try {
        const c = node.compile();
        const scope = isLeft ? { x: 0, y: 0 } : { x: 1 };
        const r = c.evaluate(scope);
        if (typeof r !== "number")
          return isLeft
            ? "Both sides must evaluate to numbers."
            : "Expression must evaluate to a number.";
      } catch (e) {
        return "Evaluation error: " + e.message;
      }
      return null;
    };
    if (eqIdx !== -1) {
      const left = s.substring(0, eqIdx).trim(),
        right = s.substring(eqIdx + 1).trim();
      if (!left) return "Missing left side of equation.";
      if (!right) return "Missing right side of equation.";
      const le = checkOne(left, true);
      if (le) return le;
      const re = checkOne(right, false);
      if (re) {
        // server appends (left side)/(right side) handling, keep simple
        if (re.includes("not allowed") && !re.includes("side"))
          return `Symbol or function "${re.match(/"([^"]+)"/)?.[1] || "?"}" is not allowed (right side).`;
        return re;
      }
      // full implicit compile test
      try {
        const lc = math.parse(left).compile(),
          rc = math.parse(right).compile();
        const l = lc.evaluate({ x: 0, y: 0 }),
          r = rc.evaluate({ x: 0, y: 0 });
        if (typeof l !== "number" || typeof r !== "number")
          return "Both sides must evaluate to numbers.";
      } catch (e) {
        return "Evaluation error: " + e.message;
      }
      return null;
    } else {
      return checkOne(s, false);
    }
  }

  const eqList = document.getElementById("eq-list");
  const addEqBtn = document.getElementById("add-eq");
  const liveIndicator = document.getElementById("live-indicator");
  const graphCanvas = document.getElementById("graph-canvas");
  const placeholder = document.getElementById("placeholder");
  const viewport = document.getElementById("viewport");
  const statusChip = document.getElementById("status-chip");
  const toastStack = document.getElementById("toast-stack");
  const boundsPanel = document.getElementById("bounds");

  let rows = [];
  let lastValidated = null;
  let lastBounds = null;
  let liveTimer = null;
  let abortCtrl = null;
  let seq = 0;

  function createRow(index) {
    const row = document.createElement("div");
    row.className = "eq-row";
    row.dataset.index = String(index);

    const chip = document.createElement("span");
    chip.className = "color-chip";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "eq-input";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Equation " + (index + 1));
    input.placeholder =
      index === 0 ? "e.g. sin(x)" : index === 1 ? "e.g. x^2" : "e.g. cos(x)*x";

    const err = document.createElement("div");
    err.className = "eq-error";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-eq";
    remove.title = "Remove equation";
    remove.setAttribute("aria-label", "Remove equation " + (index + 1));
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

    row.append(chip, input, remove, err);
    eqList.appendChild(row);
    const r = { row, input, err, remove };
    wireRow(r);
    chipColor(r, index);
    return r;
  }

  function rebuildRows(count) {
    rows.forEach((r) => r.row.remove());
    rows = [];
    for (let i = 0; i < count; i++) rows.push(createRow(i));
    updateAddButton();
  }

  function updateAddButton() {
    addEqBtn.disabled = rows.length >= MAX_EQ;
    addEqBtn.classList.toggle("disabled", rows.length >= MAX_EQ);
  }

  addEqBtn.addEventListener("click", () => {
    if (rows.length >= MAX_EQ) return;
    const r = createRow(rows.length);
    rows.push(r);
    requestAnimationFrame(() => r.row.classList.add("enter"));
    updateAddButton();
    r.input.focus();
    scheduleLive();
  });

  function wireRow(r) {
    r.remove.addEventListener("click", () => {
      if (rows.length <= 1) {
        r.input.value = "";
        setRowError(r, "");
        scheduleLive();
        return;
      }
      const idx = () => rows.indexOf(r);
      r.row.classList.add("leaving");
      setTimeout(() => {
        r.row.remove();
        const i = idx();
        if (i !== -1) rows.splice(i, 1);
        rows.forEach((row, n) => {
          row.row.dataset.index = String(n);
          chipColor(row, n);
        });
        updateAddButton();
        scheduleLive();
      }, 180);
    });
    r.input.addEventListener("input", () => {
      // instant local validation (no network lag)
      const raw = r.input.value;
      if (raw.trim() === "") {
        setRowError(r, "");
      } else {
        const err = getLocalError(raw);
        // don't flash syntax error while mid-typing an open paren/comma/operator
        const t = raw.trim();
        const isMidTyping =
          t.endsWith("(") ||
          t.endsWith(",") ||
          t.endsWith("=") ||
          /[\+\-\*\/\^]$/.test(t);
        if (err && !isMidTyping) setRowError(r, err);
        else if (!err) setRowError(r, "");
        else setRowError(r, "");
      }
      scheduleLive();
    });
    // keep Enter for convenience but live already does it
    r.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // force immediate local error show on Enter
        const err = getLocalError(r.input.value);
        if (err) setRowError(r, err);
        scheduleLive(true);
      }
    });
    // also validate on blur for immediate feedback
    r.input.addEventListener("blur", () => {
      const err = getLocalError(r.input.value);
      if (err) setRowError(r, err);
    });
  }

  function chipColor(r, i) {
    r.row.querySelector(".color-chip").style.background =
      EQ_COLORS[i % EQ_COLORS.length];
  }

  function setRowError(r, msg) {
    r.err.textContent = msg;
    r.row.classList.toggle("has-error", !!msg);
  }

  function clearErrors() {
    rows.forEach((r) => setRowError(r, ""));
  }

  function getEquations() {
    const arr = [];
    for (let i = 0; i < Math.max(rows.length, 1); i++) {
      arr.push(rows[i] ? rows[i].input.value.trim() : "");
    }
    return arr;
  }

  function getBounds() {
    const num = (id, fb) => {
      const v = parseFloat(document.getElementById(id).value);
      return isFinite(v) ? v : fb;
    };
    return {
      xMin: num("xmin", DEFAULT_BOUNDS.xMin),
      xMax: num("xmax", DEFAULT_BOUNDS.xMax),
      yMin: num("ymin", DEFAULT_BOUNDS.yMin),
      yMax: num("ymax", DEFAULT_BOUNDS.yMax),
    };
  }

  function getViewportSize() {
    const vw = viewport.clientWidth || window.innerWidth || 900;
    const vh = viewport.clientHeight || window.innerHeight || 600;
    const w = Math.floor(vw) - 40;
    const h = Math.floor(vh) - 40;
    // cap to 900x700 to keep implicit <200ms even on large monitors (was 1600x1200 → 1.9M cols → 1572ms)
    return {
      width: Math.min(Math.max(w, 200), 900),
      height: Math.min(Math.max(h, 200), 700),
    };
  }

  function toast(msg, kind) {
    const t = document.createElement("div");
    t.className = "toast " + (kind || "info");
    t.textContent = msg;
    toastStack.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, 3200);
  }

  function encodeState(equations, bounds) {
    try {
      return (
        "#s=" + encodeURIComponent(JSON.stringify({ e: equations, b: bounds }))
      );
    } catch {
      return "";
    }
  }

  function decodeState() {
    const m = location.hash.match(/#s=([^&]+)/);
    if (!m) return null;
    try {
      const s = JSON.parse(decodeURIComponent(m[1]));
      if (!Array.isArray(s.e)) return null;
      return s;
    } catch {
      return null;
    }
  }

  let shareSyncTimer = null;
  let lastShareKey = null;
  function syncHash(equations, bounds) {
    // new: create readable server link instead of ugly #s= hash
    // keep hash for backward-compat fallback if server fails
    const filtered = equations.filter((e) => e && e.trim() !== "");
    if (filtered.length === 0) {
      if (!location.pathname.startsWith("/s/"))
        history.replaceState(null, "", location.pathname);
      return;
    }
    const key = JSON.stringify({ e: filtered, b: bounds });
    if (key === lastShareKey) return;
    lastShareKey = key;
    clearTimeout(shareSyncTimer);
    shareSyncTimer = setTimeout(async () => {
      try {
        const resp = await fetch("/api/share", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-id": getSessionId() || "",
          },
          body: JSON.stringify({
            equations: filtered,
            ...bounds,
            sessionId: getSessionId(),
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.slug) {
          history.replaceState(null, "", "/s/" + data.slug);
        } else {
          // fallback to hash if server fails
          if (!location.pathname.startsWith("/s/"))
            history.replaceState(
              null,
              "",
              encodeState(filtered, bounds) || location.pathname,
            );
        }
      } catch {
        if (!location.pathname.startsWith("/s/"))
          history.replaceState(
            null,
            "",
            encodeState(filtered, bounds) || location.pathname,
          );
      }
    }, 700);
  }

  function getSessionId() {
    try {
      let id = localStorage.getItem("graphene-session");
      if (!id) {
        id =
          Math.random().toString(36).slice(2, 10) +
          "-" +
          Date.now().toString(36);
        localStorage.setItem("graphene-session", id);
      }
      return id;
    } catch {
      return null;
    }
  }

  function getSlugFromPath() {
    const m = location.pathname.match(/^\/s\/([a-z0-9-]+)/);
    return m ? m[1] : null;
  }

  function renderLocal(validated, bounds) {
    const size = getViewportSize();
    const fullBounds = { ...bounds, width: size.width, height: size.height };
    try {
      const t0 = performance.now();
      GraphRender.render(graphCanvas, validated, fullBounds);
      graphCanvas.classList.add("loaded");
      placeholder.classList.add("hidden");
      const ms = Math.round(performance.now() - t0);
      statusChip.textContent = "rendered in " + ms + " ms (client)";
      statusChip.classList.add("show");
      lastValidated = validated;
      lastBounds = bounds;
      return true;
    } catch (e) {
      console.error(e);
      toast("Render failed: " + e.message, "error");
      return false;
    }
  }

  function clearCanvas() {
    graphCanvas.classList.remove("loaded");
    placeholder.classList.remove("hidden");
    statusChip.classList.remove("show");
    statusChip.textContent = "";
  }

  function setLiveBusy(busy) {
    if (liveIndicator) liveIndicator.classList.toggle("busy", !!busy);
  }

  // ---------- live rendering ----------
  function scheduleLive(immediate) {
    clearTimeout(liveTimer);
    const delay = immediate ? 80 : LIVE_DEBOUNCE_MS;
    liveTimer = setTimeout(() => doLiveRender(), delay);
    // subtle hint that pending
    if (liveIndicator && !immediate) {
      liveIndicator.querySelector(".live-text").textContent = "…";
      setTimeout(() => {
        if (liveIndicator.querySelector(".live-text").textContent === "…") {
          // still pending
        }
      }, delay);
    }
  }

  function tryLocalValidated(equations) {
    const out = [];
    for (let i = 0; i < equations.length; i++) {
      const eq = equations[i];
      if (!eq || eq.trim() === "") continue;
      const err = getLocalError(eq);
      if (err) continue;
      const eqIndex = eq.indexOf("=");
      out.push({ str: eq, index: i, implicit: eqIndex !== -1 });
    }
    return out;
  }

  async function doLiveRender() {
    if (!window.math || !window.GraphRender) {
      if (liveIndicator)
        liveIndicator.querySelector(".live-text").textContent = "loading…";
      setTimeout(() => scheduleLive(true), 300);
      return;
    }
    if (liveIndicator)
      liveIndicator.querySelector(".live-text").textContent = "Live";

    const equations = getEquations();
    const hasAny = equations.some((e) => e.length > 0);
    if (!hasAny) {
      clearErrors();
      clearCanvas();
      syncHash([], getBounds());
      if (abortCtrl) {
        abortCtrl.abort();
        abortCtrl = null;
      }
      setLiveBusy(false);
      return;
    }

    const bounds = getBounds();
    if (bounds.xMin >= bounds.xMax || bounds.yMin >= bounds.yMax) {
      return;
    }

    const overallStarted = performance.now();

    // --- optimistic local render (no network) for instant feedback ---
    const localValidated = tryLocalValidated(equations);
    let didOptimistic = false;
    let optimisticMs = 0;
    if (localValidated.length > 0) {
      clearErrors();
      const t0 = performance.now();
      didOptimistic = renderLocal(localValidated, bounds);
      optimisticMs = Math.round(performance.now() - t0);
      if (didOptimistic) {
        statusChip.textContent = `rendered in ${optimisticMs} ms (client) · optimistic`;
      }
    }

    // abort previous fetch
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    const mySeq = ++seq;
    setLiveBusy(true);

    const started = overallStarted;
    try {
      const resp = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equations, ...bounds }),
        signal: abortCtrl.signal,
      });

      let data = {};
      try {
        data = await resp.json();
      } catch {}

      // stale check
      if (mySeq !== seq) return;

      clearErrors();

      if (!resp.ok) {
        if (data.errors) {
          Object.keys(data.errors).forEach((i) => {
            const r = rows[Number(i)];
            if (r) setRowError(r, data.errors[i]);
          });
        }
        if (data.error && resp.status !== 400) {
          toast(data.error, resp.status === 429 ? "warn" : "error");
        }
        // For 400 with only field errors don't toast loudly, but clear canvas if nothing valid
        if (!data.validated || data.validated.length === 0) {
          clearCanvas();
        }
        return;
      }

      if (data.errors) {
        Object.keys(data.errors).forEach((i) => {
          const r = rows[Number(i)];
          if (r) setRowError(r, data.errors[i]);
        });
      }

      const validated = data.validated || [];
      const serverBounds = data.bounds || bounds;

      if (validated.length === 0) {
        clearCanvas();
        return;
      }

      // if optimistic already rendered identical validated + bounds, skip re-render
      const sameAsLocal =
        didOptimistic &&
        localValidated.length === validated.length &&
        localValidated.every(
          (v, idx) =>
            v.str === validated[idx].str &&
            v.index === validated[idx].index &&
            v.implicit === validated[idx].implicit,
        ) &&
        serverBounds.xMin === bounds.xMin &&
        serverBounds.xMax === bounds.xMax &&
        serverBounds.yMin === bounds.yMin &&
        serverBounds.yMax === bounds.yMax;

      if (sameAsLocal) {
        const total = Math.round(performance.now() - overallStarted);
        statusChip.textContent = `rendered in ${optimisticMs} ms (client) · total ${total} ms (confirmed)`;
        syncHash(
          equations.filter((e) => e.length > 0),
          serverBounds,
        );
      } else {
        const t1 = performance.now();
        const ok = renderLocal(validated, serverBounds);
        if (ok) {
          const total = Math.round(performance.now() - overallStarted);
          const renderMs = Math.round(performance.now() - t1);
          statusChip.textContent = `rendered in ${renderMs} ms (client) · total ${total} ms`;
          syncHash(
            equations.filter((e) => e.length > 0),
            serverBounds,
          );
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      toast("Network error: " + err.message, "error");
    } finally {
      if (mySeq === seq) setLiveBusy(false);
    }
  }

  // bounds live
  ["xmin", "xmax", "ymin", "ymax"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => scheduleLive());
  });

  // examples
  document.querySelectorAll(".chip[data-eq]").forEach((chip) => {
    chip.addEventListener("click", () => {
      let target = rows.find((r) => r.input.value.trim() === "");
      if (!target && rows.length < MAX_EQ) {
        target = createRow(rows.length);
        rows.push(target);
        requestAnimationFrame(() => target.row.classList.add("enter"));
        updateAddButton();
      }
      if (!target) {
        toast("Max " + MAX_EQ + " equations reached", "warn");
        return;
      }
      target.input.value = chip.dataset.eq;
      setRowError(target, "");
      target.input.focus();
      scheduleLive(true);
    });
  });

  // zoom / reset / download / share
  function rePlotWithBounds(newBounds) {
    ["xMin", "xMax", "yMin", "yMax"].forEach((k) => {
      document.getElementById(
        { xMin: "xmin", xMax: "xmax", yMin: "ymin", yMax: "ymax" }[k],
      ).value = newBounds[k];
    });
    if (!getEquations().some((e) => e)) {
      toast("Nothing to plot yet — add an equation", "warn");
      return;
    }
    const currentEqs = getEquations();
    const canReuse =
      lastValidated &&
      lastValidated.length > 0 &&
      lastValidated.every((v) => currentEqs[v.index] === v.str);

    if (canReuse) {
      clearErrors();
      const b = newBounds;
      if (b.xMin >= b.xMax || b.yMin >= b.yMax) {
        toast("Invalid bounds", "warn");
        return;
      }
      renderLocal(lastValidated, b);
      syncHash(
        currentEqs.filter((e) => e.length > 0),
        b,
      );
    } else {
      scheduleLive(true);
    }
  }

  function zoom(factor) {
    const b = getBounds();
    const cx = (b.xMin + b.xMax) / 2;
    const cy = (b.yMin + b.yMax) / 2;
    const hw = ((b.xMax - b.xMin) / 2) * factor;
    const hh = ((b.yMax - b.yMin) / 2) * factor;
    rePlotWithBounds({
      xMin: +(cx - hw).toFixed(6),
      xMax: +(cx + hw).toFixed(6),
      yMin: +(cy - hh).toFixed(6),
      yMax: +(cy + hh).toFixed(6),
    });
  }

  document.getElementById("zoom-in").addEventListener("click", () => zoom(0.7));
  document
    .getElementById("zoom-out")
    .addEventListener("click", () => zoom(1 / 0.7));
  document
    .getElementById("reset-view")
    .addEventListener("click", () => rePlotWithBounds({ ...DEFAULT_BOUNDS }));
  document
    .getElementById("reset-bounds")
    .addEventListener("click", () => rePlotWithBounds({ ...DEFAULT_BOUNDS }));

  document.getElementById("download").addEventListener("click", () => {
    if (!graphCanvas.classList.contains("loaded")) {
      toast("Plot something first", "warn");
      return;
    }
    const a = document.createElement("a");
    a.href = graphCanvas.toDataURL("image/png");
    a.download = "graphene.png";
    a.click();
  });

  document.getElementById("share").addEventListener("click", async () => {
    const equations = getEquations().filter((e) => e);
    if (!equations.length) {
      toast("Nothing to share yet", "warn");
      return;
    }
    const bounds = getBounds();
    const btn = document.getElementById("share");
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = ".6";
    try {
      const resp = await fetch("/api/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": getSessionId() || "",
        },
        body: JSON.stringify({
          equations,
          ...bounds,
          sessionId: getSessionId(),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg =
          data.error || data.errors
            ? JSON.stringify(data.errors)
            : "Share failed";
        toast(msg, "error");
        return;
      }
      const url = data.url || location.origin + "/s/" + data.slug;
      try {
        await navigator.clipboard.writeText(url);
        toast(`Link copied — ${data.slug} · expires in 30 days`, "ok");
      } catch {
        history.pushState(null, "", "/s/" + data.slug);
        toast(`Link: ${url} · expires in 30 days`, "ok");
      }
      // update URL to readable short link without reload
      history.pushState(null, "", "/s/" + data.slug);
    } catch (e) {
      toast("Share failed: " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.style.opacity = "";
    }
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!lastValidated) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (lastValidated && lastBounds) {
        renderLocal(lastValidated, lastBounds);
      }
    }, 150);
  });

  if (window.matchMedia("(max-width: 768px)").matches)
    boundsPanel.removeAttribute("open");

  (async function init() {
    const slug = getSlugFromPath();
    if (slug) {
      // try server short link first (30 days, session-tied)
      try {
        const resp = await fetch("/api/share/" + encodeURIComponent(slug));
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && Array.isArray(data.equations)) {
          const count = Math.min(Math.max(data.equations.length, 1), MAX_EQ);
          rebuildRows(count);
          data.equations.slice(0, MAX_EQ).forEach((v, i) => {
            rows[i].input.value = typeof v === "string" ? v : "";
          });
          if (data.bounds) {
            ["xMin", "xMax", "yMin", "yMax"].forEach((k) => {
              const el = document.getElementById(
                { xMin: "xmin", xMax: "xmax", yMin: "ymin", yMax: "ymax" }[k],
              );
              if (el && isFinite(Number(data.bounds[k])))
                el.value = data.bounds[k];
            });
          }
          updateAddButton();
          if (data.equations.some((e) => e && e.trim())) scheduleLive(true);
          const exp = data.expiresAt
            ? new Date(data.expiresAt).toLocaleDateString()
            : "30 days";
          toast(`Loaded ${slug} · expires ${exp}`, "ok");
          return;
        } else {
          toast("Share link expired or not found (30 days)", "warn");
        }
      } catch {}
      // fallback to empty
      rebuildRows(3);
      updateAddButton();
      return;
    }

    const state = decodeState();
    const count =
      state && Array.isArray(state.e)
        ? Math.min(Math.max(state.e.length, 1), MAX_EQ)
        : 3;
    rebuildRows(count);
    if (state) {
      state.e.slice(0, MAX_EQ).forEach((v, i) => {
        rows[i].input.value = typeof v === "string" ? v : "";
      });
      if (state.b) {
        ["xMin", "xMax", "yMin", "yMax"].forEach((k) => {
          const el = document.getElementById(
            { xMin: "xmin", xMax: "xmax", yMin: "ymin", yMax: "ymax" }[k],
          );
          if (el && isFinite(Number(state.b[k]))) el.value = state.b[k];
        });
      }
      if (state.e.some((e) => e)) {
        scheduleLive(true);
      }
    }
    updateAddButton();
    if (!state) {
      // optional: show placeholder until typed
    }
  })();
})();
