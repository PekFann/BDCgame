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
