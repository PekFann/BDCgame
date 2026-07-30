import { burstDurationMs, spawnBurstComposition, spawnParticles } from "./particles.js";
import type { BurstComposition, BurstPreset, VfxMode } from "./types.js";

export interface SpawnBurstOptions {
  mode?: VfxMode;
  soloAi?: boolean;
  particleSize?: number;
}

export function spawnBurst(
  layer: HTMLElement,
  anchor: DOMRect,
  amount: number,
  preset: BurstPreset,
  options: SpawnBurstOptions = {},
  composition?: BurstComposition
): HTMLElement[] {
  if (composition?.layers?.some((l) => l.enabled)) {
    return spawnBurstComposition(layer, anchor, amount, composition, options).particles;
  }
  return spawnParticles(layer, anchor, amount, preset, options).particles;
}

export { burstDurationMs, spawnBurstComposition, spawnParticles };
