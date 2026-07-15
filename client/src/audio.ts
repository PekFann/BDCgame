const CARD_DRAW_SRC = "/Audios/cardDraw.wav";
const DICE_ROLL_SRC = "/Audios/Dice Roll 01.mp3";

let cardDrawAudio: HTMLAudioElement | null = null;
let diceRollAudio: HTMLAudioElement | null = null;

export function playCardDrawSound(): void {
  try {
    if (!cardDrawAudio) {
      cardDrawAudio = new Audio(CARD_DRAW_SRC);
      cardDrawAudio.preload = "auto";
    }
    const clip = cardDrawAudio.cloneNode() as HTMLAudioElement;
    void clip.play();
  } catch {
    // Autoplay blocked or audio unavailable — silent fail.
  }
}

export function playDiceRollSound(): void {
  try {
    if (!diceRollAudio) {
      diceRollAudio = new Audio(DICE_ROLL_SRC);
      diceRollAudio.preload = "auto";
    }
    const clip = diceRollAudio.cloneNode() as HTMLAudioElement;
    void clip.play();
  } catch {
    // Autoplay blocked or audio unavailable — silent fail.
  }
}
