const { parentPort } = require("worker_threads");
const { validateAndParse, renderMultiGraph } = require("./graph");

parentPort.on("message", (msg) => {
  const { items, bounds } = msg;
  const errors = {};
  const fns = [];

  for (const item of items) {
    const parsed = validateAndParse(item.str);
    if (parsed.error) {
      errors[item.index] = parsed.error;
    } else {
      fns.push({
        fn: parsed.fn,
        fn2: parsed.fn2,
        implicit: !!parsed.implicit,
        index: item.index,
      });
    }
  }

  let buffer = null;
  let renderError = null;
  if (fns.length > 0) {
    try {
      buffer = renderMultiGraph(fns, bounds);
    } catch (e) {
      renderError = e && e.message ? e.message : String(e);
    }
  }

  parentPort.postMessage({ errors, buffer, renderError });
});