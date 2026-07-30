import type { VfxAudioSettings, VfxPreset, VfxPresetCatalog } from "./types.js";
import { DEFAULT_VFX_AUDIO } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeAudio(
  base?: VfxAudioSettings,
  override?: VfxAudioSettings
): VfxAudioSettings {
  return { ...DEFAULT_VFX_AUDIO, ...base, ...override };
}

function mergePreset(base: VfxPreset, override: VfxPreset): VfxPreset {
  if (base.type !== override.type) return base;
  const audio = mergeAudio(base.audio, override.audio);
  if (base.type === "burst" && override.type === "burst") {
    return {
      ...base,
      ...override,
      audio,
      preset: { ...base.preset, ...override.preset },
      composition: override.composition ?? base.composition,
    };
  }
  if (base.type === "floater" && override.type === "floater") {
    return {
      ...base,
      ...override,
      audio,
      preset: { ...base.preset, ...override.preset },
    };
  }
  if (base.type === "slot" && override.type === "slot") {
    return {
      ...base,
      ...override,
      audio,
      preset: { ...base.preset, ...override.preset },
    };
  }
  return base;
}

export function mergeVfxCatalog(
  base: VfxPresetCatalog,
  overrides: VfxPresetCatalog
): VfxPresetCatalog {
  const merged = structuredClone(base);
  for (const [id, entry] of Object.entries(overrides)) {
    if (!isPlainObject(entry)) continue;
    if (merged[id]) {
      merged[id] = mergePreset(merged[id], entry as VfxPreset);
    } else {
      merged[id] = structuredClone(entry as VfxPreset);
    }
  }
  return merged;
}
