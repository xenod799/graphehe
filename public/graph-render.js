/* GRaPHeNe - Client-side rendering engine (browser canvas) - optimized <200ms */
"use strict";

(function (global) {
  const GRAPH_COLORS = [
    "#C62828",
    "#1565C0",
    "#2E7D32",
    "#6A1B9A",
    "#EF6C00",
    "#00838F",
    "#AD1457",
    "#4527A0",
    "#00695C",
    "#FF8F00",
  ];

  const GRID_COLOR = "#D8DCE4";
  const BG_COLOR = "#FFFFFF";
  const LABEL_BG = "#FFFFFF";
  const AXIS_COLOR = "#111111";
  const LABEL_COLOR = "#111111";

  function niceStep(range, targetTicks) {
    const rough = range / targetTicks;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / pow;
    let nice;
    if (norm < 1.5) nice = 1;
    else if (norm < 3.5) nice = 2;
    else if (norm < 7.5) nice = 5;
    else nice = 10;
    return nice * pow;
  }

  function snapToNice(step) {
    if (step <= 0) return step;
    const pow = Math.pow(10, Math.floor(Math.log10(step)));
    const norm = step / pow;
    let nice;
    if (norm < 1.4) nice = 1;
    else if (norm < 3) nice = 2;
    else if (norm < 7) nice = 5;
    else nice = 10;
    return nice * pow;
  }

  function formatNum(n) {
    if (Number.isInteger(n)) return n.toString();
    const s = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  function drawGrid(ctx, bounds) {
    const { xMin, xMax, yMin, yMax, width, height } = bounds;
    const toPixelX = (x) => ((x - xMin) / (xMax - xMin)) * width;
    const toPixelY = (y) => height - ((y - yMin) / (yMax - yMin)) * height;

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;

    const xRange = xMax - xMin;
    const yRange = yMax - yMin;
    const ppuX = width / xRange;
    const ppuY = height / yRange;

    let xStep, yStep;
    if (ppuX <= ppuY) {
      xStep = niceStep(xRange, 15);
      yStep = snapToNice((xStep * ppuX) / ppuY);
    } else {
      yStep = niceStep(yRange, 15);
      xStep = snapToNice((yStep * ppuY) / ppuX);
    }

    ctx.beginPath();
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      const px = toPixelX(x);
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
    }
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      const py = toPixelY(y);
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
    }
    ctx.stroke();

    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1.2;

    if (xMin <= 0 && xMax >= 0) {
      const px = toPixelX(0);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
    if (yMin <= 0 && yMax >= 0) {
      const py = toPixelY(0);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }

    if (xMin <= 0 && xMax >= 0 && yMin <= 0 && yMax >= 0) {
      ctx.fillStyle = AXIS_COLOR;
      ctx.beginPath();
      ctx.arc(toPixelX(0), toPixelY(0), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = "bold 12px 'DejaVu Sans Mono'";

    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      if (Math.abs(x) < xStep * 0.01) continue;
      const px = toPixelX(x);
      const label = formatNum(x);
      const tw = ctx.measureText(label).width;
      let py;
      if (yMin <= 0 && yMax >= 0) {
        py = toPixelY(0);
      } else {
        py = height;
      }
      const labelY = Math.min(py + 16, height - 2);
      if (px - tw / 2 < 2 || px + tw / 2 > width - 2) continue;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(px - tw / 2 - 2, labelY - 1, tw + 4, 14);
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(label, px, labelY);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      if (Math.abs(y) < yStep * 0.01) continue;
      const py = toPixelY(y);
      const label = formatNum(y);
      const tw = ctx.measureText(label).width;
      let px;
      if (xMin <= 0 && xMax >= 0) {
        px = toPixelX(0);
      } else {
        px = 0;
      }
      const labelX = Math.max(px - 8, tw + 4);
      if (py < 8 || py > height - 8) continue;
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(labelX - tw - 3, py - 8, tw + 6, 16);
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(label, labelX, py);
    }
  }

  // ---- fast compile: mathjs AST -> native JS function ----
  function nodeToJS(node) {
    switch (node.type) {
      case "ConstantNode":
        return JSON.stringify(node.value);
      case "SymbolNode": {
        const m = {
          x: "x",
          y: "y",
          pi: "Math.PI",
          e: "Math.E",
          tau: "(2*Math.PI)",
          phi: "1.618033988749895",
          Infinity: "Infinity",
          NaN: "NaN",
          LN2: "Math.LN2",
          LN10: "Math.LN10",
          LOG2E: "Math.LOG2E",
          LOG10E: "Math.LOG10E",
          SQRT1_2: "Math.SQRT1_2",
          SQRT2: "Math.SQRT2",
          i: "0",
        };
        if (m[node.name] !== undefined) return m[node.name];
        throw new Error("Unknown symbol " + node.name);
      }
      case "ParenthesisNode":
        return `(${nodeToJS(node.content)})`;
      case "FunctionNode": {
        const fn = node.fn.name;
        const args = node.args.map(nodeToJS);
        if (fn === "mod") return `((${args[0]} % ${args[1]}))`;
        if (fn === "log" && args.length === 2)
          return `(Math.log(${args[0]})/Math.log(${args[1]}))`;
        const map = {
          abs: "Math.abs",
          ceil: "Math.ceil",
          floor: "Math.floor",
          round: "Math.round",
          sign: "Math.sign",
          sqrt: "Math.sqrt",
          cbrt: "Math.cbrt",
          log: "Math.log",
          log2: "Math.log2",
          log10: "Math.log10",
          ln: "Math.log",
          sin: "Math.sin",
          cos: "Math.cos",
          tan: "Math.tan",
          asin: "Math.asin",
          acos: "Math.acos",
          atan: "Math.atan",
          atan2: "Math.atan2",
          sinh: "Math.sinh",
          cosh: "Math.cosh",
          tanh: "Math.tanh",
          asinh: "Math.asinh",
          acosh: "Math.acosh",
          atanh: "Math.atanh",
          exp: "Math.exp",
          pow: "Math.pow",
          min: "Math.min",
          max: "Math.max",
          hypot: "Math.hypot",
        };
        if (fn === "pow") return `Math.pow(${args.join(",")})`;
        const jsFn = map[fn];
        if (!jsFn) throw new Error("Unknown func " + fn);
        return `${jsFn}(${args.join(",")})`;
      }
      case "OperatorNode": {
        const op = node.fn;
        const a = node.args.map(nodeToJS);
        if (op === "add") return `(${a[0]}+${a[1]})`;
        if (op === "subtract") return `(${a[0]}-${a[1]})`;
        if (op === "multiply") return `(${a[0]}*${a[1]})`;
        if (op === "divide") return `(${a[0]}/${a[1]})`;
        if (op === "pow") return `Math.pow(${a[0]},${a[1]})`;
        if (op === "mod") return `(${a[0]} % ${a[1]})`;
        if (op === "unaryMinus") return `(-${a[0]})`;
        if (op === "unaryPlus") return `(+${a[0]})`;
        throw new Error("Unknown op " + op);
      }
      case "ConditionalNode":
        return `(${nodeToJS(node.condition)}?${nodeToJS(node.trueExpr)}:${nodeToJS(node.falseExpr)})`;
      default:
        throw new Error("unsupported " + node.type);
    }
  }

  function tryCompileFast(expr, isXY) {
    try {
      const math = global.math;
      if (!math) return null;
      const node = math.parse(expr);
      const js = nodeToJS(node);
      if (isXY) return new Function("x", "y", `return ${js};`);
      return new Function("x", `return ${js};`);
    } catch (e) {
      return null;
    }
  }

  function drawExplicitFast(ctx, fn, color, bounds) {
    const { xMin, xMax, yMin, yMax, width, height } = bounds;
    const toPixelX = (x) => ((x - xMin) / (xMax - xMin)) * width;
    const toPixelY = (y) => height - ((y - yMin) / (yMax - yMin)) * height;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    let drawing = false;
    const numSamples = width;
    let prevY = null;

    for (let i = 0; i <= numSamples; i++) {
      const x = xMin + (i / numSamples) * (xMax - xMin);
      let y;
      try {
        y = fn(x);
      } catch {
        drawing = false;
        continue;
      }
      if (typeof y !== "number" || !isFinite(y)) {
        drawing = false;
        continue;
      }
      const py = toPixelY(y);
      const px = toPixelX(x);
      if (prevY !== null && Math.abs(py - prevY) > height * 2) drawing = false;
      if (!drawing) {
        ctx.moveTo(px, py);
        drawing = true;
      } else {
        ctx.lineTo(px, py);
      }
      prevY = py;
    }
    ctx.stroke();
  }

  const _fastCache = new Map();
  function getFastFn(expr, isXY) {
    const key = (isXY ? "xy:" : "x:") + expr;
    if (_fastCache.has(key)) return _fastCache.get(key);
    const fn = tryCompileFast(expr, isXY);
    if (fn) _fastCache.set(key, fn);
    return fn;
  }

  function drawImplicitFast(ctx, fn, color, bounds) {
    const { xMin, xMax, yMin, yMax, width, height } = bounds;
    // adaptive downsample - keep field < ~150k cells to guarantee <100ms native
    let cols = width;
    let rows = height;
    while (cols * rows > 160000) {
      cols = Math.floor(cols / 2);
      rows = Math.floor(rows / 2);
    }
    // clamp min
    cols = Math.max(cols, 200);
    rows = Math.max(rows, 150);

    const field = new Float64Array((rows + 1) * (cols + 1));

    // fast fill - single native call per cell, no scope object, no Date.now per cell
    for (let j = 0; j <= rows; j++) {
      const y = yMax - (j / rows) * (yMax - yMin);
      const base = j * (cols + 1);
      for (let i = 0; i <= cols; i++) {
        const x = xMin + (i / cols) * (xMax - xMin);
        let v;
        try {
          v = fn(x, y);
        } catch {
          v = NaN;
        }
        field[base + i] = isFinite(v) ? v : NaN;
      }
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    const dx = width / cols;
    const dy = height / rows;

    for (let j = 0; j < rows; j++) {
      const rowOff = j * (cols + 1);
      const rowOff2 = (j + 1) * (cols + 1);
      for (let i = 0; i < cols; i++) {
        const v00 = field[rowOff + i];
        const v10 = field[rowOff + i + 1];
        const v01 = field[rowOff2 + i];
        const v11 = field[rowOff2 + i + 1];

        if (
          !isFinite(v00) ||
          !isFinite(v10) ||
          !isFinite(v01) ||
          !isFinite(v11)
        )
          continue;

        let code = 0;
        if (v00 > 0) code |= 1;
        if (v10 > 0) code |= 2;
        if (v11 > 0) code |= 4;
        if (v01 > 0) code |= 8;
        if (code === 0 || code === 15) continue;

        const x0 = i * dx;
        const y0 = j * dy;

        const lerp = (va, vb, pa, pb) => pa + (va / (va - vb)) * (pb - pa);

        const top = [lerp(v00, v10, x0, x0 + dx), y0];
        const right = [x0 + dx, lerp(v10, v11, y0, y0 + dy)];
        const bottom = [lerp(v01, v11, x0, x0 + dx), y0 + dy];
        const left = [x0, lerp(v00, v01, y0, y0 + dy)];

        // inline segments to avoid array alloc
        if (code === 1 || code === 14) {
          ctx.moveTo(left[0], left[1]);
          ctx.lineTo(top[0], top[1]);
        } else if (code === 2 || code === 13) {
          ctx.moveTo(top[0], top[1]);
          ctx.lineTo(right[0], right[1]);
        } else if (code === 3 || code === 12) {
          ctx.moveTo(left[0], left[1]);
          ctx.lineTo(right[0], right[1]);
        } else if (code === 4 || code === 11) {
          ctx.moveTo(right[0], right[1]);
          ctx.lineTo(bottom[0], bottom[1]);
        } else if (code === 5) {
          ctx.moveTo(left[0], left[1]);
          ctx.lineTo(top[0], top[1]);
          ctx.moveTo(right[0], right[1]);
          ctx.lineTo(bottom[0], bottom[1]);
        } else if (code === 6 || code === 9) {
          ctx.moveTo(top[0], top[1]);
          ctx.lineTo(bottom[0], bottom[1]);
        } else if (code === 7 || code === 8) {
          ctx.moveTo(left[0], left[1]);
          ctx.lineTo(bottom[0], bottom[1]);
        } else if (code === 10) {
          ctx.moveTo(top[0], top[1]);
          ctx.lineTo(left[0], left[1]);
          ctx.moveTo(bottom[0], bottom[1]);
          ctx.lineTo(right[0], right[1]);
        }
      }
    }
    ctx.stroke();
  }

  // fallback slow paths using mathjs compiled (kept for completeness)
  function drawExplicitSlow(ctx, compiled, color, bounds) {
    const { xMin, xMax, yMin, yMax, width, height } = bounds;
    const toPixelX = (x) => ((x - xMin) / (xMax - xMin)) * width;
    const toPixelY = (y) => height - ((y - yMin) / (yMax - yMin)) * height;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let drawing = false;
    let prevY = null;
    for (let i = 0; i <= width; i++) {
      const x = xMin + (i / width) * (xMax - xMin);
      let y;
      try {
        y = compiled.evaluate({ x });
      } catch {
        drawing = false;
        continue;
      }
      if (typeof y !== "number" || !isFinite(y)) {
        drawing = false;
        continue;
      }
      const py = toPixelY(y),
        px = toPixelX(x);
      if (prevY !== null && Math.abs(py - prevY) > height * 2) drawing = false;
      if (!drawing) {
        ctx.moveTo(px, py);
        drawing = true;
      } else ctx.lineTo(px, py);
      prevY = py;
    }
    ctx.stroke();
  }

  function drawImplicitSlow(ctx, leftC, rightC, color, bounds) {
    const { xMin, xMax, yMin, yMax, width, height } = bounds;
    const cols = width,
      rows = height;
    const field = new Float64Array((rows + 1) * (cols + 1));
    const scope = { x: 0, y: 0 };
    for (let j = 0; j <= rows; j++) {
      const y = yMax - (j / rows) * (yMax - yMin);
      for (let i = 0; i <= cols; i++) {
        const x = xMin + (i / cols) * (xMax - xMin);
        scope.x = x;
        scope.y = y;
        let v;
        try {
          v = leftC.evaluate(scope) - rightC.evaluate(scope);
        } catch {
          v = NaN;
        }
        field[j * (cols + 1) + i] = isFinite(v) ? v : NaN;
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    const dx = width / cols,
      dy = height / rows;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const v00 = field[j * (cols + 1) + i],
          v10 = field[j * (cols + 1) + i + 1],
          v01 = field[(j + 1) * (cols + 1) + i],
          v11 = field[(j + 1) * (cols + 1) + i + 1];
        if (
          !isFinite(v00) ||
          !isFinite(v10) ||
          !isFinite(v01) ||
          !isFinite(v11)
        )
          continue;
        let code = 0;
        if (v00 > 0) code |= 1;
        if (v10 > 0) code |= 2;
        if (v11 > 0) code |= 4;
        if (v01 > 0) code |= 8;
        if (code === 0 || code === 15) continue;
        const x0 = i * dx,
          y0 = j * dy;
        const lerp = (va, vb, pa, pb) => pa + (va / (va - vb)) * (pb - pa);
        const top = [lerp(v00, v10, x0, x0 + dx), y0],
          right = [x0 + dx, lerp(v10, v11, y0, y0 + dy)],
          bottom = [lerp(v01, v11, x0, x0 + dx), y0 + dy],
          left = [x0, lerp(v00, v01, y0, y0 + dy)];
        if (code === 1 || code === 14) {
          ctx.moveTo(left[0], left[1]);
          ctx.lineTo(top[0], top[1]);
        } else if (code === 2 || code === 13) {
          ctx.moveTo(top[0], top[1]);
          ctx.lineTo(right[0], right[1]);
        } else if (code === 3 || code === 12) {
          ctx.moveTo(left[0], left[1]);
          ctx.lineTo(right[0], right[1]);
        } else if (code === 4 || code === 11) {
          ctx.moveTo(right[0], right[1]);
          ctx.lineTo(bottom[0], bottom[1]);
        } else if (code === 5) {
          ctx.moveTo(left[0], left[1]);
          ctx.lineTo(top[0], top[1]);
          ctx.moveTo(right[0], right[1]);
          ctx.lineTo(bottom[0], bottom[1]);
        } else if (code === 6 || code === 9) {
          ctx.moveTo(top[0], top[1]);
          ctx.lineTo(bottom[0], bottom[1]);
        } else if (code === 7 || code === 8) {
          ctx.moveTo(left[0], left[1]);
          ctx.lineTo(bottom[0], bottom[1]);
        } else if (code === 10) {
          ctx.moveTo(top[0], top[1]);
          ctx.lineTo(left[0], left[1]);
          ctx.moveTo(bottom[0], bottom[1]);
          ctx.lineTo(right[0], right[1]);
        }
      }
    ctx.stroke();
  }

  function render(canvas, validated, bounds) {
    const dpr = Math.min(global.devicePixelRatio || 1, 1.5);
    const rectW = bounds.width;
    const rectH = bounds.height;
    const needW = Math.round(rectW * dpr);
    const needH = Math.round(rectH * dpr);
    if (canvas.width !== needW || canvas.height !== needH) {
      canvas.width = needW;
      canvas.height = needH;
      canvas.style.width = rectW + "px";
      canvas.style.height = rectH + "px";
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const math = global.math;
    if (!math) throw new Error("math.js not loaded");

    drawGrid(ctx, bounds);

    for (let i = 0; i < validated.length; i++) {
      const item = validated[i];
      const color = GRAPH_COLORS[item.index % GRAPH_COLORS.length];
      try {
        if (item.implicit) {
          const eqIndex = item.str.indexOf("=");
          const leftStr = item.str.substring(0, eqIndex).trim();
          const rightStr = item.str.substring(eqIndex + 1).trim();
          // single fast fn: left - right (cached)
          const expr = `(${leftStr})-(${rightStr})`;
          const fast = getFastFn(expr, true);
          if (fast) drawImplicitFast(ctx, fast, color, bounds);
          else {
            const leftC = math.parse(leftStr).compile();
            const rightC = math.parse(rightStr).compile();
            drawImplicitSlow(ctx, leftC, rightC, color, bounds);
          }
        } else {
          const fast = getFastFn(item.str, false);
          if (fast) drawExplicitFast(ctx, fast, color, bounds);
          else {
            const compiled = math.parse(item.str).compile();
            drawExplicitSlow(ctx, compiled, color, bounds);
          }
        }
      } catch (e) {
        console.warn("Render failed for", item.str, e);
      }
    }
  }

  global.GraphRender = {
    render,
    drawGrid,
    GRAPH_COLORS,
  };
})(typeof window !== "undefined" ? window : this);
