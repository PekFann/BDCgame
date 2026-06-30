const REVEAL_MS = 650;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function revealHeroSlot(slot: HTMLElement): Promise<void> {
  slot.classList.add("hero-intro-pending");
  await waitForLayout();

  slot.classList.remove("hero-intro-pending");
  slot.classList.add("hero-intro-reveal");
  await sleep(REVEAL_MS + 80);
  slot.classList.remove("hero-intro-reveal");
}

export async function runBoardHeroIntro(boardRoot: HTMLElement): Promise<void> {
  const possessed = boardRoot.querySelector(".card-slot.possessed");
  const demon = boardRoot.querySelector(".card-slot.demon");

  if (demon) (demon as HTMLElement).classList.add("hero-intro-pending");

  if (possessed) await revealHeroSlot(possessed as HTMLElement);
  if (demon) await revealHeroSlot(demon as HTMLElement);

  if (!possessed && !demon) await sleep(REVEAL_MS);
}
