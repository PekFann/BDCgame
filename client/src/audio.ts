import type { VfxSoundId } from "./vfx/types.js";

const CARD_DRAW_SRC = "/Audios/cardDraw.wav";
const DICE_ROLL_SRC = encodeURI("/Audios/Dice Roll 01.mp3");
const MAGIC_POP_SRC = encodeURI("/Audios/Magic Pop 01.mp3");
const MAGIC_POTION_SRC = encodeURI("/Audios/Magic Potion 02 Using.wav");
const DEMON_ATTACK_SRC = encodeURI("/Audios/Demon Attack 01.mp3");

let cardDrawAudio: HTMLAudioElement | null = null;
let diceRollAudio: HTMLAudioElement | null = null;
let magicPopAudio: HTMLAudioElement | null = null;
let magicPotionAudio: HTMLAudioElement | null = null;
let demonAttackAudio: HTMLAudioElement | null = null;

function playCachedSound(
  getCached: () => HTMLAudioElement | null,
  setCached: (a: HTMLAudioElement) => void,
  src: string
): void {
  try {
    let cached = getCached();
    if (!cached) {
      cached = new Audio(src);
      cached.preload = "auto";
      setCached(cached);
    }
    const clip = cached.cloneNode() as HTMLAudioElement;
    void clip.play();
  } catch {
    // Autoplay blocked or audio unavailable — silent fail.
  }
}

export function playCardDrawSound(): void {
  playCachedSound(
    () => cardDrawAudio,
    (a) => {
      cardDrawAudio = a;
    },
    CARD_DRAW_SRC
  );
}

export function playDiceRollSound(): void {
  playCachedSound(
    () => diceRollAudio,
    (a) => {
      diceRollAudio = a;
    },
    DICE_ROLL_SRC
  );
}

export function playMagicPopSound(): void {
  playCachedSound(
    () => magicPopAudio,
    (a) => {
      magicPopAudio = a;
    },
    MAGIC_POP_SRC
  );
}

export function playMagicPotionSound(): void {
  playCachedSound(
    () => magicPotionAudio,
    (a) => {
      magicPotionAudio = a;
    },
    MAGIC_POTION_SRC
  );
}

export function playDemonAttackSound(): void {
  playCachedSound(
    () => demonAttackAudio,
    (a) => {
      demonAttackAudio = a;
    },
    DEMON_ATTACK_SRC
  );
}

const DICE_ROLL_SOUND_DELAY_MS = 1000;
let pendingDiceRollSoundTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule dice roll sound after a short delay; cancels any previous pending play. */
export function playDiceRollSoundDelayed(delayMs = DICE_ROLL_SOUND_DELAY_MS): void {
  if (pendingDiceRollSoundTimer !== null) {
    clearTimeout(pendingDiceRollSoundTimer);
    pendingDiceRollSoundTimer = null;
  }
  pendingDiceRollSoundTimer = setTimeout(() => {
    pendingDiceRollSoundTimer = null;
    playDiceRollSound();
  }, delayMs);
}

export function cancelPendingDiceRollSound(): void {
  if (pendingDiceRollSoundTimer !== null) {
    clearTimeout(pendingDiceRollSoundTimer);
    pendingDiceRollSoundTimer = null;
  }
}

export const VFX_SOUND_CATALOG: { id: VfxSoundId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "magic_pop", label: "Magic Pop" },
  { id: "magic_potion", label: "Magic Potion" },
  { id: "demon_attack", label: "Demon Attack" },
  { id: "card_draw", label: "Card Draw" },
  { id: "dice_roll", label: "Dice Roll" },
];

function playSoundById(soundId: VfxSoundId): void {
  switch (soundId) {
    case "magic_pop":
      playMagicPopSound();
      break;
    case "magic_potion":
      playMagicPotionSound();
      break;
    case "demon_attack":
      playDemonAttackSound();
      break;
    case "card_draw":
      playCardDrawSound();
      break;
    case "dice_roll":
      playDiceRollSound();
      break;
    case "none":
    default:
      break;
  }
}

let pendingVfxSoundTimer: ReturnType<typeof setTimeout> | null = null;

export function playVfxSound(soundId: VfxSoundId, delayMs = 0): void {
  if (soundId === "none") return;
  if (pendingVfxSoundTimer !== null) {
    clearTimeout(pendingVfxSoundTimer);
    pendingVfxSoundTimer = null;
  }
  const play = () => playSoundById(soundId);
  if (delayMs > 0) {
    pendingVfxSoundTimer = setTimeout(() => {
      pendingVfxSoundTimer = null;
      play();
    }, delayMs);
  } else {
    play();
  }
}
