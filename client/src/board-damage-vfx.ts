import type { PublicGameState } from "../../shared/types.js";

const prevHp = new Map<string, number>();

function hpKey(kind: "demon" | "imp", id: string): string {
  return `${kind}:${id}`;
}

function spawnDamageFloater(anchor: HTMLElement, amount: number): void {
  const rect = anchor.getBoundingClientRect();
  const el = document.createElement("span");
  el.className = "board-damage-float";
  el.textContent = `-${amount}`;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height * 0.35}px`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("board-damage-float--active"));
  setTimeout(() => el.remove(), 900);
}

function flashElement(el: HTMLElement): void {
  el.classList.remove("board-attachment--hit", "demon-slot--hit");
  void el.offsetWidth;
  el.classList.add(el.classList.contains("card-slot") ? "demon-slot--hit" : "board-attachment--hit");
  setTimeout(() => el.classList.remove("board-attachment--hit", "demon-slot--hit"), 550);
}

export function playBoardDamageVfx(boardRoot: HTMLElement, pub: PublicGameState): void {
  if (pub.demon) {
    const key = hpKey("demon", pub.demon.instanceId);
    const before = prevHp.get(key);
    if (before !== undefined && pub.demon.hp < before) {
      const delta = before - pub.demon.hp;
      const slot = boardRoot.querySelector(".card-slot.demon") as HTMLElement | null;
      if (slot) {
        flashElement(slot);
        spawnDamageFloater(slot, delta);
      }
    }
    prevHp.set(key, pub.demon.hp);
  }

  for (const imp of pub.imps) {
    const key = hpKey("imp", imp.instanceId);
    const before = prevHp.get(key);
    if (before !== undefined && imp.hp < before) {
      const delta = before - imp.hp;
      const el = boardRoot.querySelector(
        `.imp-attachment[data-imp-id="${imp.instanceId}"]`
      ) as HTMLElement | null;
      if (el) {
        flashElement(el);
        spawnDamageFloater(el, delta);
      }
    }
    prevHp.set(key, imp.hp);
  }

  for (const key of [...prevHp.keys()]) {
    const [, id] = key.split(":");
    const stillDemon = pub.demon?.instanceId === id;
    const stillImp = pub.imps.some((i) => i.instanceId === id);
    if (!stillDemon && !stillImp) prevHp.delete(key);
  }
}

export function resetBoardDamageVfx(): void {
  prevHp.clear();
}
