const { create, all } = require("mathjs");

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

  return { implicit: false };
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

  return { implicit: true };
}

module.exports = { validateAndParse };
