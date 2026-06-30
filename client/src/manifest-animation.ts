import type { ManifestPreview } from "../../shared/types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runManifestAnimation(
  boardRoot: HTMLElement,
  preview: ManifestPreview
): Promise<void> {
  if (preview.skipped) {
    await sleep(500);
    return;
  }

  const demon = boardRoot.querySelector(".card-slot.demon");
  const possessed = boardRoot.querySelector(".card-slot.possessed");

  if (!demon || !possessed) {
    await sleep(preview.totalDamage > 0 ? 1000 : 500);
    return;
  }

  if (preview.totalDamage <= 0) {
    await sleep(500);
    return;
  }

  demon.classList.add("manifest-lunge");
  await sleep(420);
  possessed.classList.add("manifest-hit");

  const flash = document.createElement("div");
  flash.className = "board-flash";
  boardRoot.appendChild(flash);
  void flash.offsetWidth;
  flash.classList.add("board-flash-active");

  await sleep(1000);

  flash.remove();
  demon.classList.remove("manifest-lunge");
  possessed.classList.remove("manifest-hit");
}
