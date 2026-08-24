const { create, all } = require("mathjs");
const { createCanvas } = require("@napi-rs/canvas");

const math = create(all);

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

const BLOCKED_FUNCTIONS = new Set([
  "factorial",
  "gamma",
  "combination",
  "permutation",
  "gcd",
  "lcm",
  "bitAnd",
  "bitOr",
  "bitXor",
  "leftShift",
  "rightShift",
  "rightArithShift",
  "bellNumbers",
  "stirlingS2",
  "catalan",
]);

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

function validateAst(root) {
  const disallowed = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "ConstantNode":
        return;
      case "ParenthesisNode":
        walk(node.content);
        return;
      case "SymbolNode":
        if (!ALLOWED_SYMBOLS.has(node.name)) disallowed.push(node.name);
        return;
      case "FunctionNode": {
        const name = node.fn && node.fn.name;
        if (!ALLOWED_FUNCTIONS.has(name)) disallowed.push(name);
        (node.args || []).forEach(walk);
        return;
      }
      case "OperatorNode": {
        if (!ALLOWED_OPERATORS.has(node.fn)) disallowed.push(node.fn);
        (node.args || []).forEach(walk);
        return;
      }
      case "ArrayNode":
        (node.items || []).forEach(walk);
        return;
      case "RelationalNode":
        (node.params || []).forEach(walk);
        return;
      case "ConditionalNode":
        walk(node.condition);
        walk(node.trueExpr);
        walk(node.falseExpr);
        return;
      case "RangeNode":
        walk(node.start);
        walk(node.end);
        walk(node.step);
        return;
      default:
        disallowed.push(node.type);
        return;
    }
  };
  walk(root);
  return disallowed;
}

const MAX_EVAL_TIME_MS = 3000;

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

function validateAndParse(equationStr) {
  if (!equationStr || typeof equationStr !== "string") {
    return { error: "Empty equation." };
  }

  const sanitized = equationStr.trim();
  if (sanitized.length === 0) return { error: "Empty equation." };
  if (sanitized.length > 500) return { error: "Equation too long." };

  const dangerousPatterns =
    /(\bimport\b|\brequire\b|\beval\b|\bFunction\b|\bthis\b|\bglobal\b|\bprocess\b|\bconstructor\b|\bprototype\b)/i;
  if (dangerousPatterns.test(sanitized)) {
    return { error: "Disallowed tokens in expression." };
  }

  const blockedMatch = sanitized.match(
    /\b(factorial|gamma|combination|permutation|gcd|lcm|bellNumbers|stirlingS2|catalan|bitAnd|bitOr|bitXor|leftShift|rightShift)\b/i,
  );
  if (blockedMatch) {
    return { error: `Function "${blockedMatch[0]}" is not allowed.` };
  }

  const eqIndex = sanitized.indexOf("=");
  if (eqIndex !== -1) {
    return validateImplicit(sanitized, eqIndex);
  }

  return validateExplicit(sanitized);
}

function validateExplicit(sanitized) {
  let node;
  try {
    node = math.parse(sanitized);
  } catch (e) {
    return { error: "Syntax error: " + e.message };
  }

  const disallowed = validateAst(node);
  if (disallowed.length) {
    return { error: `Symbol or function "${disallowed[0]}" is not allowed.` };
  }

  let compiled;
  try {
    compiled = node.compile();
  } catch (e) {
    return { error: "Compilation error: " + e.message };
  }

  try {
    const result = compiled.evaluate({ x: 1 });
    if (typeof result !== "number") {
      return { error: "Expression must evaluate to a number." };
    }
  } catch (e) {
    return { error: "Evaluation error: " + e.message };
  }

  return { fn: compiled, implicit: false };
}

function validateImplicit(sanitized, eqIndex) {
  const leftStr = sanitized.substring(0, eqIndex).trim();
  const rightStr = sanitized.substring(eqIndex + 1).trim();

  if (!leftStr) return { error: "Missing left side of equation." };
  if (!rightStr) return { error: "Missing right side of equation." };

  let leftNode, rightNode;
  try {
    leftNode = math.parse(leftStr);
  } catch (e) {
    return { error: "Syntax error (left side): " + e.message };
  }
  try {
    rightNode = math.parse(rightStr);
  } catch (e) {
    return { error: "Syntax error (right side): " + e.message };
  }

  const leftDisallowed = validateAst(leftNode);
  if (leftDisallowed.length) {
    return {
      error: `Symbol or function "${leftDisallowed[0]}" is not allowed (left side).`,
    };
  }
  const rightDisallowed = validateAst(rightNode);
  if (rightDisallowed.length) {
    return {
      error: `Symbol or function "${rightDisallowed[0]}" is not allowed (right side).`,
    };
  }

  let leftCompiled, rightCompiled;
  try {
    leftCompiled = leftNode.compile();
  } catch (e) {
    return { error: "Compilation error (left): " + e.message };
  }
  try {
    rightCompiled = rightNode.compile();
  } catch (e) {
    return { error: "Compilation error (right): " + e.message };
  }

  try {
    const scope = { x: 0, y: 0 };
    const l = leftCompiled.evaluate(scope);
    const r = rightCompiled.evaluate(scope);
    if (typeof l !== "number" || typeof r !== "number") {
      return { error: "Both sides must evaluate to numbers." };
    }
  } catch (e) {
    return { error: "Evaluation error: " + e.message };
  }

  return { fn: leftCompiled, fn2: rightCompiled, implicit: true };
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

function safeEval(compiled, scope) {
  const start = Date.now();
  const result = compiled.evaluate(scope);
  if (Date.now() - start > MAX_EVAL_TIME_MS) {
    throw new Error("Expression evaluation timeout");
  }
  return result;
}

function drawExplicit(ctx, compiled, color, bounds) {
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
  let evalCount = 0;
  const start = Date.now();

  for (let i = 0; i <= numSamples; i++) {
    const x = xMin + (i / numSamples) * (xMax - xMin);
    let y;
    try {
      y = safeEval(compiled, { x });
      evalCount++;
      if (evalCount % 500 === 0 && Date.now() - start > MAX_EVAL_TIME_MS) break;
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

    if (prevY !== null && Math.abs(py - prevY) > height * 2) {
      drawing = false;
    }

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

function drawImplicit(ctx, leftCompiled, rightCompiled, color, bounds) {
  const { xMin, xMax, yMin, yMax, width, height } = bounds;
  const cols = width;
  const rows = height;

  const field = new Float64Array((rows + 1) * (cols + 1));
  const start = Date.now();
  let timedOut = false;

  for (let j = 0; j <= rows; j++) {
    if (j % 200 === 0 && Date.now() - start > MAX_EVAL_TIME_MS) {
      timedOut = true;
      break;
    }
    for (let i = 0; i <= cols; i++) {
      const x = xMin + (i / cols) * (xMax - xMin);
      const y = yMax - (j / rows) * (yMax - yMin);
      let left, right;
      try {
        left = safeEval(leftCompiled, { x, y });
        right = safeEval(rightCompiled, { x, y });
      } catch {
        left = NaN;
        right = NaN;
      }
      const val = left - right;
      field[j * (cols + 1) + i] = isFinite(val) ? val : NaN;
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
    for (let i = 0; i < cols; i++) {
      const v00 = field[j * (cols + 1) + i];
      const v10 = field[j * (cols + 1) + i + 1];
      const v01 = field[(j + 1) * (cols + 1) + i];
      const v11 = field[(j + 1) * (cols + 1) + i + 1];

      if (!isFinite(v00) || !isFinite(v10) || !isFinite(v01) || !isFinite(v11))
        continue;

      let code = 0;
      if (v00 > 0) code |= 1;
      if (v10 > 0) code |= 2;
      if (v11 > 0) code |= 4;
      if (v01 > 0) code |= 8;

      if (code === 0 || code === 15) continue;

      const x0 = i * dx;
      const y0 = j * dy;

      const lerp = (va, vb, pa, pb) => {
        const t = va / (va - vb);
        return pa + t * (pb - pa);
      };

      const top = [lerp(v00, v10, x0, x0 + dx), y0];
      const right = [x0 + dx, lerp(v10, v11, y0, y0 + dy)];
      const bottom = [lerp(v01, v11, x0, x0 + dx), y0 + dy];
      const left = [x0, lerp(v00, v01, y0, y0 + dy)];

      const segments = [];
      switch (code) {
        case 1:
        case 14:
          segments.push([left, top]);
          break;
        case 2:
        case 13:
          segments.push([top, right]);
          break;
        case 3:
        case 12:
          segments.push([left, right]);
          break;
        case 4:
        case 11:
          segments.push([right, bottom]);
          break;
        case 5:
          segments.push([left, top], [right, bottom]);
          break;
        case 6:
        case 9:
          segments.push([top, bottom]);
          break;
        case 7:
        case 8:
          segments.push([left, bottom]);
          break;
        case 10:
          segments.push([top, left], [bottom, right]);
          break;
      }

      for (const seg of segments) {
        ctx.moveTo(seg[0][0], seg[0][1]);
        ctx.lineTo(seg[1][0], seg[1][1]);
      }
    }
  }

  ctx.stroke();
}

function renderMultiGraph(fns, bounds) {
  const canvas = createCanvas(bounds.width, bounds.height);
  const ctx = canvas.getContext("2d");

  drawGrid(ctx, bounds);

  for (let i = 0; i < fns.length; i++) {
    const color = GRAPH_COLORS[fns[i].index % GRAPH_COLORS.length];
    if (fns[i].implicit) {
      drawImplicit(ctx, fns[i].fn, fns[i].fn2, color, bounds);
    } else {
      drawExplicit(ctx, fns[i].fn, color, bounds);
    }
  }

  return canvas.toBuffer("image/png");
}

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

module.exports = { validateAndParse, renderMultiGraph };
