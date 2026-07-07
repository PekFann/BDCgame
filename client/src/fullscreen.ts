let btn: HTMLButtonElement | null = null;

function isFullscreenSupported(): boolean {
  return document.fullscreenEnabled === true;
}

function getFullscreenElement(): Element | null {
  return document.fullscreenElement;
}

function updateLabel(): void {
  if (!btn) return;
  const on = getFullscreenElement() !== null;
  btn.textContent = on ? "⤢" : "⛶";
  btn.title = on ? "Exit fullscreen" : "Fullscreen";
  btn.setAttribute("aria-label", btn.title);
}

export function initFullscreenButton(mountRoot?: HTMLElement | null): void {
  if (!isFullscreenSupported()) return;

  if (!btn) {
    btn = document.createElement("button");
    btn.id = "fullscreen-btn";
    btn.type = "button";
    btn.className = "fullscreen-btn";
    btn.addEventListener("click", async () => {
      try {
        if (getFullscreenElement()) {
          await document.exitFullscreen();
        } else {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        /* user gesture or policy may block */
      }
    });
    document.addEventListener("fullscreenchange", updateLabel);
  }

  updateLabel();

  const parent = mountRoot ?? document.body;
  if (btn.parentElement !== parent) {
    parent.prepend(btn);
  }
}
