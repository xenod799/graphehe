(() => {
  const plotBtn = document.getElementById("plot-btn");
  const graphImg = document.getElementById("graph-img");
  const placeholder = document.getElementById("placeholder");
  const eqInputs = document.querySelectorAll(".eq-input");
  const eqErrors = document.querySelectorAll(".eq-error");

  graphImg.style.display = "none";

  const bounds = document.getElementById("bounds");
  if (bounds && window.matchMedia("(max-width: 768px)").matches) {
    bounds.removeAttribute("open");
  }

  plotBtn.addEventListener("click", () => {
    plotAll();
  });

  eqInputs.forEach((input, i) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") plotAll();
    });
    input.addEventListener("input", () => {
      eqErrors[i].textContent = "";
    });
  });

  function clearErrors() {
    eqErrors.forEach((el) => (el.textContent = ""));
  }

  async function plotAll() {
    clearErrors();

    const equations = [];
    eqInputs.forEach((input) => {
      equations.push(input.value.trim());
    });

    const hasAny = equations.some((e) => e.length > 0);
    if (!hasAny) return;

    const bounds = getBounds();
    const viewport = getViewport();

    try {
      const resp = await fetch("/api/generate-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equations,
          ...bounds,
          ...viewport,
        }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        if (data.errors) {
          Object.keys(data.errors).forEach((i) => {
            eqErrors[Number(i)].textContent = data.errors[i];
          });
        } else if (data.error) {
          eqErrors[0].textContent = data.error;
        }
        return;
      }

      const errHeader = resp.headers.get("X-Equation-Errors");
      if (errHeader) {
        const serverErrors = JSON.parse(errHeader);
        Object.keys(serverErrors).forEach((i) => {
          eqErrors[Number(i)].textContent = serverErrors[i];
        });
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      graphImg.onload = () => URL.revokeObjectURL(url);
      graphImg.src = url;
      graphImg.style.display = "block";
      placeholder.style.display = "none";
    } catch (err) {
      eqErrors[0].textContent = "Network error: " + err.message;
    }
  }

  function getBounds() {
    return {
      xMin: parseFloat(document.getElementById("xmin").value) || -10,
      xMax: parseFloat(document.getElementById("xmax").value) || 10,
      yMin: parseFloat(document.getElementById("ymin").value) || -7.5,
      yMax: parseFloat(document.getElementById("ymax").value) || 7.5,
    };
  }

  function getViewport() {
    const el = document.getElementById("viewport");
    return {
      width: Math.floor(el.clientWidth) - 40,
      height: Math.floor(el.clientHeight) - 40,
    };
  }
})();
