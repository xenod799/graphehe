(() => {
    "use strict";

    const MAX_EQ = 5;
    const EQ_COLORS = ["#ef5350", "#42a5f5", "#66bb6a", "#ab47bc", "#ffa726"];
    const DEFAULT_BOUNDS = { xMin: -10, xMax: 10, yMin: -7.5, yMax: 7.5 };

    const eqList = document.getElementById("eq-list");
    const addEqBtn = document.getElementById("add-eq");
    const plotBtn = document.getElementById("plot-btn");
    const graphImg = document.getElementById("graph-img");
    const placeholder = document.getElementById("placeholder");
    const viewport = document.getElementById("viewport");
    const loadingOverlay = document.getElementById("loading-overlay");
    const statusChip = document.getElementById("status-chip");
    const toastStack = document.getElementById("toast-stack");
    const boundsPanel = document.getElementById("bounds");

    let rows = [];
    let plotting = false;

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
        input.placeholder = index === 0 ? "e.g. sin(x)" : index === 1 ? "e.g. x^2" : "e.g. cos(x)*x";

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
    });

    function wireRow(r) {
        r.remove.addEventListener("click", () => {
            if (rows.length <= 1) {
                r.input.value = "";
                setRowError(r, "");
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
            }, 180);
        });
        r.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") plotAll();
        });
        r.input.addEventListener("input", () => setRowError(r, ""));
    }

    function chipColor(r, i) {
        r.row.querySelector(".color-chip").style.background = EQ_COLORS[i % EQ_COLORS.length];
    }

    function setRowError(r, msg) {
        r.err.textContent = msg;
        r.row.classList.toggle("has-error", !!msg);
        if (msg) {
            r.row.classList.remove("shake");
            void r.row.offsetWidth;
            r.row.classList.add("shake");
        }
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
        return {
            width: Math.floor(viewport.clientWidth) - 40,
            height: Math.floor(viewport.clientHeight) - 40,
        };
    }

    // ---------- toast ----------
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

    // ---------- hash state ----------
    function encodeState(equations, bounds) {
        try {
            return "#s=" + encodeURIComponent(JSON.stringify({ e: equations, b: bounds }));
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

    function syncHash(equations, bounds) {
        history.replaceState(null, "", encodeState(equations, bounds) || location.pathname);
    }

    // ---------- plotting ----------
    async function plotAll() {
        if (plotting) return;
        clearErrors();

        const equations = getEquations();
        if (!equations.some((e) => e.length > 0)) {
            toast("Enter at least one equation", "warn");
            return;
        }

        const bounds = getBounds();
        if (bounds.xMin >= bounds.xMax) {
            toast("xMin must be less than xMax", "warn");
            return;
        }
        if (bounds.yMin >= bounds.yMax) {
            toast("yMin must be less than yMax", "warn");
            return;
        }

        plotting = true;
        plotBtn.classList.add("busy");
        plotBtn.disabled = true;
        loadingOverlay.hidden = false;
        statusChip.textContent = "";

        const started = performance.now();
        try {
            const resp = await fetch("/api/generate-graph", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    equations,
                    ...bounds,
                    ...getViewportSize(),
                }),
            });

            if (!resp.ok) {
                let data = {};
                try {
                    data = await resp.json();
                } catch {}
                if (data.errors) {
                    Object.keys(data.errors).forEach((i) => {
                        const r = rows[Number(i)];
                        if (r) setRowError(r, data.errors[i]);
                    });
                } else if (data.error) {
                    toast(data.error, resp.status === 429 ? "warn" : "error");
                }
                return;
            }

            const errHeader = resp.headers.get("X-Equation-Errors");
            if (errHeader) {
                try {
                    const serverErrors = JSON.parse(errHeader);
                    Object.keys(serverErrors).forEach((i) => {
                        const r = rows[Number(i)];
                        if (r) setRowError(r, serverErrors[i]);
                    });
                } catch {}
            }

            const blob = await resp.blob();
            showImage(blob);

            const ms = Math.round(performance.now() - started);
            statusChip.textContent = "rendered in " + ms + " ms";
            statusChip.classList.add("show");
            syncHash(equations.filter((e) => e.length > 0), bounds);
        } catch (err) {
            toast("Network error: " + err.message, "error");
        } finally {
            plotting = false;
            plotBtn.classList.remove("busy");
            plotBtn.disabled = false;
            loadingOverlay.hidden = true;
        }
    }

    function showImage(blob) {
        const url = URL.createObjectURL(blob);
        graphImg.classList.remove("pop-in", "loaded");
        placeholder.classList.remove("hidden");

        graphImg.onload = () => {
            URL.revokeObjectURL(url);
            requestAnimationFrame(() => {
                graphImg.classList.add("loaded", "pop-in");
                placeholder.classList.add("hidden");
            });
        };
        graphImg.onerror = () => {
            URL.revokeObjectURL(url);
            graphImg.removeAttribute("src");
            toast("Failed to load render", "error");
        };
        graphImg.src = url;
    }

    plotBtn.addEventListener("click", plotAll);

    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            plotAll();
        }
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
            target.input.focus();
        });
    });

    // zoom / reset / download / share
    function rePlotWithBounds(newBounds) {
        ["xMin", "xMax", "yMin", "yMax"].forEach((k) => {
            document.getElementById(
                { xMin: "xmin", xMax: "xmax", yMin: "ymin", yMax: "ymax" }[k]
            ).value = newBounds[k];
        });
        if (!getEquations().some((e) => e)) {
            toast("Nothing to plot yet — add an equation", "warn");
            return;
        }
        plotAll();
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
    document.getElementById("zoom-out").addEventListener("click", () => zoom(1 / 0.7));
    document.getElementById("reset-view").addEventListener("click", () => rePlotWithBounds({ ...DEFAULT_BOUNDS }));
    document.getElementById("reset-bounds").addEventListener("click", () =>
        rePlotWithBounds({ ...DEFAULT_BOUNDS })
    );

    document.getElementById("download").addEventListener("click", () => {
        if (!graphImg.src || !graphImg.classList.contains("loaded")) {
            toast("Plot something first", "warn");
            return;
        }
        const a = document.createElement("a");
        a.href = graphImg.src;
        a.download = "graphene.png";
        a.click();
    });

    document.getElementById("share").addEventListener("click", async () => {
        const equations = getEquations().filter((e) => e);
        if (!equations.length) {
            toast("Nothing to share yet", "warn");
            return;
        }
        const url = location.origin + location.pathname + encodeState(equations, getBounds());
        try {
            await navigator.clipboard.writeText(url);
            toast("Link copied to clipboard", "ok");
        } catch {
            history.replaceState(null, "", url);
            toast("Link is in the address bar", "ok");
        }
    });

    // mobile: collapse bounds panel
    if (window.matchMedia("(max-width: 768px)").matches) boundsPanel.removeAttribute("open");

    // init from shared link or defaults
    (function init() {
        const state = decodeState();
        const count = state && Array.isArray(state.e) ? Math.min(Math.max(state.e.length, 1), MAX_EQ) : 3;
        rebuildRows(count);
        if (state) {
            state.e.slice(0, MAX_EQ).forEach((v, i) => {
                rows[i].input.value = typeof v === "string" ? v : "";
            });
            if (state.b) {
                ["xMin", "xMax", "yMin", "yMax"].forEach((k) => {
                    const el = document.getElementById(
                        { xMin: "xmin", xMax: "xmax", yMin: "ymin", yMax: "ymax" }[k]
                    );
                    if (el && isFinite(Number(state.b[k]))) el.value = state.b[k];
                });
            }
            if (state.e.some((e) => e)) plotAll();
        }
        updateAddButton();
    })();
})();
