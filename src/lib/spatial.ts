/**
 * Minimal spatial navigation: arrow keys move focus to the nearest
 * `.focusable` element in that direction, like a TV remote / D-pad.
 * Inputs keep their own left/right handling.
 */
type Dir = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function scope(): ParentNode {
  // If a modal/player is open, keep focus inside it.
  const layers = document.querySelectorAll<HTMLElement>("[data-focus-scope]");
  return layers.length ? layers[layers.length - 1] : document;
}

export function focusFirst(root: ParentNode = scope()) {
  const el = root.querySelector<HTMLElement>("[data-autofocus].focusable, .focusable");
  el?.focus({ preventScroll: false });
}

function move(dir: Dir) {
  const active = document.activeElement as HTMLElement | null;
  const all = [...scope().querySelectorAll<HTMLElement>(".focusable")].filter(visible);
  if (!all.length) return;
  if (!active || !all.includes(active)) {
    all[0].focus();
    return;
  }
  const a = active.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === active) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - ax;
    const dy = y - ay;
    let main: number, cross: number;
    switch (dir) {
      case "ArrowRight":
        if (r.left < a.right - 4) continue;
        main = dx;
        cross = Math.abs(dy);
        break;
      case "ArrowLeft":
        if (r.right > a.left + 4) continue;
        main = -dx;
        cross = Math.abs(dy);
        break;
      case "ArrowDown":
        if (r.top < a.bottom - 4) continue;
        main = dy;
        cross = Math.abs(dx);
        break;
      default:
        if (r.bottom > a.top + 4) continue;
        main = -dy;
        cross = Math.abs(dx);
    }
    const score = main + cross * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

export function installSpatialNav(onBack: () => void) {
  const handler = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
    if (e.key.startsWith("Arrow")) {
      if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      if (t.closest("[data-nav-ignore]")) return;
      e.preventDefault();
      move(e.key as Dir);
    } else if (e.key === "Escape" || (e.key === "Backspace" && !typing)) {
      if (document.querySelector("[data-focus-scope]")) return; // overlays handle their own back
      e.preventDefault();
      onBack();
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
