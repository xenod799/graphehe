# GRaPHeNe

GRaPHeNe is a server-validated mathematical graphing app. You enter equations in a browser, the server validates them against a strict allowlist, renders the graph server-side, and returns a PNG.

Live at [graph.xermore.com](https://graph.xermore.com).

## Features

- **Explicit functions** — `sin(x)`, `x^2`, `log(x)` and more
- **Implicit equations** — `x^2 + y^2 = 25`, `sin(x) = cos(y)` (marching squares contouring)
- Up to 5 equations per graph, each drawn in its own color
- Configurable x/y bounds and output size
- Anti-aliased rendering with grid, axes, and tick labels

## Security

GRaPHeNe never evaluates arbitrary code. Equations are parsed with [mathjs](https://mathjs.org) and the resulting AST is checked against an explicit allowlist of symbols, functions, and operators before evaluation. On top of that:

- No `eval`, `Function`, `import`, or `require` tokens are accepted
- `helmet` Content-Security-Policy restricts everything to same-origin
- Rate limiting on the API (30 req/min per client)
- Rendering runs in a bounded worker pool with timeouts and a max queue
- Equation length, range, and output size are all capped

## Architecture

```
Browser (public/)          Server (server/)
 ── POST /api/generate-graph ──► Express + express-rate-limit
                                  └─► graph.js   (mathjs parse + AST validation)
                                  └─► RenderPool (worker_threads pool, 2 workers)
                                       └─► render-worker.js
                                            └─► graph.js renderMultiGraph()
                                                 └─► @napi-rs/canvas → PNG
```

## Running locally

```bash
npm install
npm start
```

The server listens on `http://127.0.0.1:8888`.

## API

`POST /api/generate-graph`

```json
{
  "equations": ["sin(x)", "x^2 + y^2 = 25"],
  "xMin": -10, "xMax": 10,
  "yMin": -7.5, "yMax": 7.5,
  "width": 800, "height": 600
}
```

Returns an `image/png` response. Per-equation validation errors are returned in the `X-Equation-Errors` header, or as JSON with a 400 status.

## License

MIT
