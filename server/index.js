const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { validateAndParse } = require("./graph");
const { RenderPool } = require("./render-pool");

const app = express();
const PORT = 8888;

const MAX_EQUATIONS = 5;
const MAX_X_RANGE = 1e6;
const MAX_Y_RANGE = 1e6;

app.set("trust proxy", "loopback");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "blob:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(express.json({ limit: "16kb" }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: true },
  message: { error: "Too many requests, slow down." },
});
app.use("/api/", apiLimiter);

app.use(express.static(path.join(__dirname, "..", "public")));

const pool = new RenderPool({ size: 2, timeoutMs: 15000, maxQueue: 4 });

app.post("/api/generate-graph", async (req, res) => {
  const body = req.body || {};
  const { equations, xMin, xMax, yMin, yMax, width, height } = body;

  if (!Array.isArray(equations) || equations.length === 0) {
    return res.status(400).json({ error: "No equations provided." });
  }

  if (equations.length > MAX_EQUATIONS) {
    return res
      .status(400)
      .json({ error: `Max ${MAX_EQUATIONS} equations allowed.` });
  }

  const w = Math.min(Math.max(Number(width) || 800, 200), 1600);
  const h = Math.min(Math.max(Number(height) || 600, 200), 1200);

  const xMinN = Number(xMin);
  const xMaxN = Number(xMax);
  const yMinN = Number(yMin);
  const yMaxN = Number(yMax);

  const xMinVal = isFinite(xMinN) ? xMinN : -10;
  const xMaxVal = isFinite(xMaxN) ? xMaxN : 10;
  const yMinVal = isFinite(yMinN) ? yMinN : -7.5;
  const yMaxVal = isFinite(yMaxN) ? yMaxN : 7.5;

  if (xMinVal >= xMaxVal) {
    return res.status(400).json({ error: "xMin must be less than xMax." });
  }
  if (yMinVal >= yMaxVal) {
    return res.status(400).json({ error: "yMin must be less than yMax." });
  }
  if (xMaxVal - xMinVal > MAX_X_RANGE) {
    return res
      .status(400)
      .json({ error: `X range too large (max ${MAX_X_RANGE}).` });
  }
  if (yMaxVal - yMinVal > MAX_Y_RANGE) {
    return res
      .status(400)
      .json({ error: `Y range too large (max ${MAX_Y_RANGE}).` });
  }

  const bounds = {
    xMin: xMinVal,
    xMax: xMaxVal,
    yMin: yMinVal,
    yMax: yMaxVal,
    width: w,
    height: h,
  };

  const errors = {};
  const items = [];

  for (let i = 0; i < equations.length; i++) {
    const eq = equations[i];
    if (!eq || typeof eq !== "string" || eq.trim() === "") continue;

    const parsed = validateAndParse(eq);
    if (parsed.error) {
      errors[i] = parsed.error;
    } else {
      items.push({ str: eq, index: i });
    }
  }

  if (items.length === 0) {
    return res.status(400).json({ errors });
  }

  let result;
  try {
    result = await pool.run({ items, bounds });
  } catch (e) {
    return res.status(e.status || 500).json({
      errors,
      error:
        e.status === 503
          ? "Server is busy, please try again shortly."
          : "Render failed.",
    });
  }

  if (result.renderError) {
    return res.status(400).json({ errors, detail: "Render failed." });
  }

  if (result.buffer) {
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    if (Object.keys(errors).length > 0) {
      res.set("X-Equation-Errors", JSON.stringify(errors));
    }
    return res.send(Buffer.from(result.buffer));
  }

  return res.status(400).json({ errors });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  res
    .status(err.status || err.statusCode || 500)
    .json({ error: "Bad request." });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`GRaPHeNe server running at http://127.0.0.1:${PORT}`);
});
