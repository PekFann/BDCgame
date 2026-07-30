import {
  CARD_ICON,
  ENERGY_ICON,
  FRIENDSHIP_ICON,
  POSSESSED_HEALTH_ICON,
} from "../ui-icons.js";
import userOverrides from "./presets.user.json";
import { mergeVfxCatalog } from "./presets-merge.js";
import type {
  BurstComposition,
  BurstPreset,
  FloaterPreset,
  SlotAnimPreset,
  VfxAudioSettings,
  VfxPreset,
  VfxPresetCatalog,
} from "./types.js";
import { DEFAULT_VFX_AUDIO } from "./types.js";

const FRIENDSHIP_ICON_URL = encodeURI(FRIENDSHIP_ICON);
const ENERGY_ICON_URL = encodeURI(ENERGY_ICON);
const HEALTH_ICON_URL = encodeURI(POSSESSED_HEALTH_ICON);
const CARD_ICON_URL = encodeURI(CARD_ICON);

for (const url of [FRIENDSHIP_ICON_URL, ENERGY_ICON_URL, HEALTH_ICON_URL, CARD_ICON_URL]) {
  new Image().src = url;
}

export const DEFAULT_BURST_PRESET_FIELDS: Omit<BurstPreset, "iconUrl" | "glowColor"> = {
  playbackMode: "once",
  loopIntervalMs: 400,
  motionStyle: "radial_burst",
  easing: "auto",
  endSlowdown: 0,
  tintMode: "none",
  tintColor: null,
  tintRevealMs: 300,
  fadeOutStart: 70,
  blinkRadiusPx: 80,
  scaleTargetPx: 48,
  particleSizeSolo: 48,
  particleSizePhone: 36,
  particleSizeSoloAiScale: 0.75,
  countMin: 8,
  countMax: 24,
  countPerAmount: 6,
  durationMs: 550,
  staggerMs: 60,
  distanceMin: 120,
  distanceMax: 280,
  distanceSoloAiScale: 0.5,
};

const DEFAULT_FLOATER_MOTION: Pick<
  FloaterPreset,
  "motionStyle" | "easing" | "endSlowdown" | "fadeOutStart"
> = {
  motionStyle: "float_up",
  easing: "auto",
  endSlowdown: 0,
  fadeOutStart: 70,
};

export function createDefaultBurstPreset(
  iconUrl: string,
  glowColor: string,
  overrides?: Partial<BurstPreset>
): BurstPreset {
  return {
    ...DEFAULT_BURST_PRESET_FIELDS,
    iconUrl,
    glowColor,
    scaleTargetPx: overrides?.scaleTargetPx ?? DEFAULT_BURST_PRESET_FIELDS.scaleTargetPx,
    ...overrides,
  };
}

function burst(iconUrl: string, glowColor: string, overrides?: Partial<BurstPreset>): BurstPreset {
  return createDefaultBurstPreset(iconUrl, glowColor, overrides);
}

function floater(base: FloaterPreset, overrides?: Partial<FloaterPreset>): FloaterPreset {
  return { ...DEFAULT_FLOATER_MOTION, ...base, ...overrides };
}

function withAudio<T extends VfxPreset>(entry: T, audio?: Partial<VfxAudioSettings>): T {
  return {
    ...entry,
    audio: { ...DEFAULT_VFX_AUDIO, ...audio },
  };
}

const BUILTIN_VFX_PRESETS: VfxPresetCatalog = {
  friendship_burst: withAudio(
    {
      type: "burst",
      id: "friendship_burst",
      label: "Friendship gain burst",
      preset: burst(FRIENDSHIP_ICON_URL, "rgba(236, 64, 122, 0.9)"),
    },
    { soundId: "magic_pop", soundDelayMs: 0 }
  ),
  heal_burst: withAudio(
    {
      type: "burst",
      id: "heal_burst",
      label: "Heal burst",
      preset: burst(HEALTH_ICON_URL, "rgba(76, 175, 80, 0.85)"),
    },
    { soundId: "magic_potion", soundDelayMs: 0 }
  ),
  energy_burst: withAudio({
    type: "burst",
    id: "energy_burst",
    label: "Energy gain burst",
    preset: burst(ENERGY_ICON_URL, "rgba(255, 193, 7, 0.9)"),
  }),
  friendship_floater: withAudio({
    type: "floater",
    id: "friendship_floater",
    label: "Friendship / heal +N floater",
    preset: floater({
      className: "friendship-gain-float",
      activeClass: "friendship-gain-float--active",
      textPrefix: "+",
      color: "#ec407a",
      fontSize: "1.35rem",
      durationMs: 900,
      anchorYRatio: 0.2,
      risePx: 48,
    }),
  }),
  draw_reward_floater: withAudio({
    type: "floater",
    id: "draw_reward_floater",
    label: "Draw reward floater",
    preset: floater({
      className: "draw-reward-float",
      activeClass: "draw-reward-float--active",
      textPrefix: "",
      durationMs: 900,
      anchorYRatio: 0.55,
    }),
  }),
  rest_reward_floater: withAudio({
    type: "floater",
    id: "rest_reward_floater",
    label: "Rest reward floater",
    preset: floater({
      className: "draw-reward-float",
      activeClass: "draw-reward-float--active",
      textPrefix: "",
      durationMs: 900,
      anchorYRatio: 0.55,
    }),
  }),
  damage_floater: withAudio({
    type: "floater",
    id: "damage_floater",
    label: "Board damage floater",
    preset: floater({
      className: "board-damage-float",
      activeClass: "board-damage-float--active",
      textPrefix: "-",
      color: "#ff6b6b",
      fontSize: "1.35rem",
      durationMs: 900,
      anchorYRatio: 0.35,
      risePx: 36,
    }),
  }),
  manifest_damage_floater: withAudio({
    type: "floater",
    id: "manifest_damage_floater",
    label: "Manifest possessed damage floater",
    preset: floater({
      className: "manifest-damage-float",
      activeClass: "manifest-damage-float--active",
      textPrefix: "-",
      color: "#ff6b6b",
      fontSize: "1.15rem",
      durationMs: 1000,
      anchorYRatio: 0.35,
      risePx: 48,
    }),
  }),
  demon_contract_hidden: withAudio({
    type: "slot",
    id: "demon_contract_hidden",
    label: "Demon contract hidden",
    preset: {
      kind: "toggle_class",
      durationMs: 0,
      pendingClasses: ["hero-intro-pending"],
      revealClasses: [],
    },
  }),
  demon_contract_reveal: withAudio({
    type: "slot",
    id: "demon_contract_reveal",
    label: "Demon / hero reveal",
    preset: {
      kind: "add_remove_class",
      durationMs: 730,
      addClasses: ["hero-intro-reveal"],
      removeClasses: ["hero-intro-pending", "hero-intro-reveal"],
    },
  }),
  demon_revealed_hit: withAudio({
    type: "slot",
    id: "demon_revealed_hit",
    label: "Demon hit shake",
    preset: {
      kind: "add_remove_class",
      durationMs: 500,
      addClasses: ["demon-slot--hit"],
      removeClasses: ["demon-slot--hit"],
    },
  }),
  possessed_perk_pulse: withAudio({
    type: "slot",
    id: "possessed_perk_pulse",
    label: "Possessed perk pulse",
    preset: {
      kind: "add_remove_class",
      durationMs: 600,
      addClasses: ["possessed--friendship-hit"],
      removeClasses: ["possessed--friendship-hit"],
    },
  }),
  manifest_lunge: withAudio({
    type: "slot",
    id: "manifest_lunge",
    label: "Manifest lunge (demon)",
    preset: {
      kind: "add_remove_class",
      durationMs: 420,
      addClasses: ["manifest-lunge"],
      removeClasses: ["manifest-lunge"],
    },
  }),
  manifest_hit: withAudio({
    type: "slot",
    id: "manifest_hit",
    label: "Manifest hit (possessed)",
    preset: {
      kind: "add_remove_class",
      durationMs: 550,
      addClasses: ["manifest-hit"],
      removeClasses: ["manifest-hit"],
    },
  }),
  board_flash: withAudio({
    type: "slot",
    id: "board_flash",
    label: "Board flash overlay",
    preset: {
      kind: "flash_overlay",
      durationMs: 1000,
      flashClass: "board-flash",
      flashActiveClass: "board-flash-active",
    },
  }),
};

export const DEFAULT_VFX_PRESETS: VfxPresetCatalog = mergeVfxCatalog(
  BUILTIN_VFX_PRESETS,
  userOverrides as VfxPresetCatalog
);

export let VFX_PRESETS: VfxPresetCatalog = structuredClone(DEFAULT_VFX_PRESETS);

export function resetVfxPresets(): void {
  VFX_PRESETS = structuredClone(DEFAULT_VFX_PRESETS);
}

export function getBurstPreset(id: keyof typeof BUILTIN_VFX_PRESETS): BurstPreset {
  const entry = VFX_PRESETS[id];
  if (entry?.type !== "burst") throw new Error(`Not a burst preset: ${id}`);
  return entry.preset;
}

export function getBurstEntry(id: string): Extract<VfxPreset, { type: "burst" }> | null {
  const entry = VFX_PRESETS[id];
  return entry?.type === "burst" ? entry : null;
}

export function getFloaterPreset(id: keyof typeof BUILTIN_VFX_PRESETS): FloaterPreset {
  const entry = VFX_PRESETS[id];
  if (entry?.type !== "floater") throw new Error(`Not a floater preset: ${id}`);
  return entry.preset;
}

export function getSlotPreset(id: keyof typeof BUILTIN_VFX_PRESETS): SlotAnimPreset {
  const entry = VFX_PRESETS[id];
  if (entry?.type !== "slot") throw new Error(`Not a slot preset: ${id}`);
  return entry.preset;
}

export function hasActiveComposition(composition?: BurstComposition): boolean {
  return Boolean(composition?.layers?.some((l) => l.enabled));
}

export const DRAW_FLOATER_MS = 900;
export const BURST_CLEANUP_PAD_MS = 60;

export { CARD_ICON_URL, ENERGY_ICON_URL, FRIENDSHIP_ICON_URL, HEALTH_ICON_URL };
