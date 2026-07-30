export type VfxMode = "solo" | "phone";

export type FloaterClassName =
  | "friendship-gain-float"
  | "draw-reward-float"
  | "board-damage-float"
  | "manifest-damage-float";

export type SlotAnimKind =
  | "toggle_class"
  | "add_remove_class"
  | "flash_overlay";

export type ParticleMotionStyle =
  | "radial_burst"
  | "float_up"
  | "float_down"
  | "drift"
  | "scale_fade"
  | "star_blink";

export type FloaterMotionStyle = "float_up" | "float_down" | "none";

export type VfxPlaybackMode = "once" | "loop";

export type VfxEasingMode = "auto" | "ease-out" | "ease-in-out" | "linear";

export type VfxTintMode = "none" | "solid" | "white_reveal";

export type VfxSoundId =
  | "none"
  | "magic_pop"
  | "magic_potion"
  | "demon_attack"
  | "card_draw"
  | "dice_roll";

export interface VfxAudioSettings {
  soundId: VfxSoundId;
  soundDelayMs: number;
}

export const DEFAULT_VFX_AUDIO: VfxAudioSettings = {
  soundId: "none",
  soundDelayMs: 0,
};

export interface BurstPreset {
  iconUrl: string;
  particleSizeSolo: number;
  particleSizePhone: number;
  particleSizeSoloAiScale: number;
  countMin: number;
  countMax: number;
  countPerAmount: number;
  durationMs: number;
  staggerMs: number;
  distanceMin: number;
  distanceMax: number;
  distanceSoloAiScale: number;
  glowColor: string;
  playbackMode: VfxPlaybackMode;
  loopIntervalMs: number;
  motionStyle: ParticleMotionStyle;
  easing: VfxEasingMode;
  endSlowdown: number;
  tintMode: VfxTintMode;
  tintColor: string | null;
  tintRevealMs: number;
  fadeOutStart: number;
  blinkRadiusPx: number;
  scaleTargetPx: number;
}

export interface BurstLayerPreset {
  id: string;
  label: string;
  enabled: boolean;
  preset: BurstPreset;
}

export interface BurstComposition {
  layers: BurstLayerPreset[];
}

export interface FloaterPreset {
  className: FloaterClassName;
  activeClass: string;
  textPrefix: string;
  color?: string;
  fontSize?: string;
  durationMs: number;
  anchorYRatio: number;
  risePx?: number;
  motionStyle: FloaterMotionStyle;
  easing: VfxEasingMode;
  endSlowdown: number;
  fadeOutStart: number;
}

export interface SlotAnimPreset {
  kind: SlotAnimKind;
  durationMs: number;
  addClasses?: string[];
  removeClasses?: string[];
  pendingClasses?: string[];
  revealClasses?: string[];
  flashClass?: string;
  flashActiveClass?: string;
  pulseClass?: string;
  pulseDurationMs?: number;
}

export type VfxPresetId =
  | "friendship_burst"
  | "heal_burst"
  | "energy_burst"
  | "friendship_floater"
  | "draw_reward_floater"
  | "rest_reward_floater"
  | "damage_floater"
  | "manifest_damage_floater"
  | "demon_contract_hidden"
  | "demon_contract_reveal"
  | "demon_revealed_hit"
  | "possessed_perk_pulse"
  | "manifest_lunge"
  | "manifest_hit"
  | "board_flash";

export type VfxPreset =
  | {
      type: "burst";
      id: VfxPresetId;
      label: string;
      preset: BurstPreset;
      composition?: BurstComposition;
      audio?: VfxAudioSettings;
    }
  | {
      type: "floater";
      id: VfxPresetId;
      label: string;
      preset: FloaterPreset;
      audio?: VfxAudioSettings;
    }
  | {
      type: "slot";
      id: VfxPresetId;
      label: string;
      preset: SlotAnimPreset;
      audio?: VfxAudioSettings;
    };

export interface VfxPresetCatalog {
  [key: string]: VfxPreset;
}
