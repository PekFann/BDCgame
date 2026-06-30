import type { PublicGameState } from "../../shared/types.js";

let toastEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let lastToastKey = "";

function ensureToast(): HTMLElement {
  if (toastEl) return toastEl;
  toastEl = document.createElement("div");
  toastEl.id = "phase-toast";
  toastEl.className = "phase-toast";
  toastEl.hidden = true;
  document.body.appendChild(toastEl);
  return toastEl;
}

function showToast(title: string, detail: string): void {
  const el = ensureToast();
  if (hideTimer) clearTimeout(hideTimer);

  el.textContent = "";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const sub = document.createElement("span");
  sub.className = "phase-toast-detail";
  sub.textContent = detail;
  el.appendChild(heading);
  el.appendChild(sub);

  el.hidden = false;
  el.classList.remove("phase-toast-out");
  void el.offsetWidth;
  el.classList.add("phase-toast-in");

  hideTimer = setTimeout(() => {
    el.classList.remove("phase-toast-in");
    el.classList.add("phase-toast-out");
    setTimeout(() => {
      el.hidden = true;
      el.classList.remove("phase-toast-out");
    }, 280);
  }, 2000);
}

export function refreshPhaseToast(pub: PublicGameState): void {
  const key = `${pub.cycle}-${pub.phase}`;
  if (key === lastToastKey) return;
  lastToastKey = key;

  if (pub.phase === "draw") {
    showToast("Draw Phase", "Choose card + energy or gain friendship.");
    return;
  }
  if (pub.phase === "triggers") {
    showToast("Triggers & Events", "Roll the dice when prompted.");
    return;
  }
  if (pub.phase !== "day" && pub.phase !== "night") return;

  if (pub.phase === "day") {
    showToast("Day Phase", `${pub.dayActionsRemaining} action${pub.dayActionsRemaining === 1 ? "" : "s"} remaining`);
  } else {
    showToast("Night Phase", `${pub.nightActionsRemaining} action${pub.nightActionsRemaining === 1 ? "" : "s"} remaining`);
  }
}

export function resetPhaseToast(): void {
  lastToastKey = "";
}
