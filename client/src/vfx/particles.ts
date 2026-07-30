import { resolveVfxEase } from "./easing.js";
import { ensureFadeKeyframes } from "./fade-keyframes.js";
import type { BurstComposition, BurstPreset, VfxMode } from "./types.js";

export interface SpawnParticlesOptions {
  mode?: VfxMode;
  soloAi?: boolean;
  particleSize?: number;
}

export interface SpawnParticlesResult {
  particles: HTMLElement[];
  loopId?: string;
}

interface ActiveLoop {
  intervalId: number;
  particles: Set<HTMLElement>;
  stopFns: Array<() => void>;
}

const activeLoops = new Map<string, ActiveLoop>();
let loopCounter = 0;

function particleSizeFor(preset: BurstPreset, mode: VfxMode, soloAi: boolean): number {
  const base = mode === "solo" ? preset.particleSizeSolo : preset.particleSizePhone;
  return soloAi ? base * preset.particleSizeSoloAiScale : base;
}

function burstCount(preset: BurstPreset, amount: number): number {
  if (preset.motionStyle === "scale_fade") return 1;
  return Math.min(preset.countMax, Math.max(preset.countMin, amount * preset.countPerAmount));
}

function applyGlowFilter(el: HTMLElement, glowColor: string): void {
  if (!glowColor) return;
  el.style.filter = `drop-shadow(0 0 6px ${glowColor}) drop-shadow(0 0 14px ${glowColor})`;
}

function needsTintWrap(preset: BurstPreset): boolean {
  return preset.tintMode === "solid" || preset.tintMode === "white_reveal";
}

function createParticleElement(
  preset: BurstPreset,
  mode: VfxMode,
  particleSize: number,
  originX: number,
  originY: number,
  distanceScale: number
): HTMLElement {
  const img = document.createElement("img");
  img.src = preset.iconUrl;
  img.alt = "";
  img.decoding = "async";
  img.loading = "eager";

  const ease = resolveVfxEase(preset.easing, preset.endSlowdown);
  const fadeName = ensureFadeKeyframes(preset.fadeOutStart);
  const scaleTarget = preset.scaleTargetPx || particleSize;

  const travel =
    (preset.distanceMin + Math.random() * (preset.distanceMax - preset.distanceMin)) * distanceScale;

  const motionVars: [string, string][] = [
    ["--vfx-duration", `${preset.durationMs}ms`],
    ["--vfx-ease", ease],
    ["--fade-out-start", String(preset.fadeOutStart / 100)],
    ["--scale-target", String(scaleTarget / particleSize)],
  ];

  let posX = originX;
  let posY = originY;

  if (preset.motionStyle === "radial_burst") {
    const angle = Math.random() * Math.PI * 2;
    motionVars.push(["--burst-x", `${Math.cos(angle) * travel}px`]);
    motionVars.push(["--burst-y", `${Math.sin(angle) * travel}px`]);
  } else if (preset.motionStyle === "float_up") {
    const drift = (Math.random() - 0.5) * travel * 0.4;
    motionVars.push(["--float-y", `${-travel}px`]);
    motionVars.push(["--drift-x", `${drift}px`]);
  } else if (preset.motionStyle === "float_down") {
    const drift = (Math.random() - 0.5) * travel * 0.4;
    motionVars.push(["--float-y", `${travel}px`]);
    motionVars.push(["--drift-x", `${drift}px`]);
  } else if (preset.motionStyle === "star_blink") {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * preset.blinkRadiusPx;
    posX += Math.cos(angle) * radius;
    posY += Math.sin(angle) * radius;
  } else if (preset.motionStyle === "scale_fade") {
    motionVars.push(["--scale-target", String(scaleTarget / particleSize)]);
  } else {
    const drift = (Math.random() - 0.5) * travel;
    motionVars.push(["--drift-x", `${drift}px`]);
    motionVars.push(["--float-y", `${(Math.random() - 0.5) * travel * 0.3}px`]);
  }

  applyGlowFilter(img, preset.glowColor);

  const motionClass = `friendship-particle--burst friendship-particle--${mode} friendship-particle--motion-${preset.motionStyle}`;
  const moveAnim = `vfxMove${preset.motionStyle.replace(/_/g, "")} var(--vfx-duration) var(--vfx-ease) forwards`;
  const fadeAnim = `${fadeName} var(--vfx-duration) var(--vfx-ease) forwards`;

  let root: HTMLElement = img;
  if (needsTintWrap(preset)) {
    const wrap = document.createElement("span");
    wrap.className = `vfx-particle-wrap ${motionClass}`;
    if (preset.tintMode === "white_reveal") {
      wrap.classList.add("vfx-tint--white-reveal");
      wrap.style.setProperty("--tint-reveal-duration", `${preset.tintRevealMs}ms`);
    } else if (preset.tintColor) {
      wrap.style.setProperty("--vfx-tint", preset.tintColor);
    }
    wrap.style.left = `${posX}px`;
    wrap.style.top = `${posY}px`;
    wrap.style.width = `${particleSize}px`;
    wrap.style.height = `${particleSize}px`;
    for (const [k, v] of motionVars) wrap.style.setProperty(k, v);
    wrap.style.animation = `${moveAnim}, ${fadeAnim}`;
    img.className = "vfx-particle-img";
    img.style.width = "100%";
    img.style.height = "100%";
    wrap.appendChild(img);
    root = wrap;
  } else {
    img.className = `friendship-particle ${motionClass}`;
    img.style.width = `${particleSize}px`;
    img.style.height = `${particleSize}px`;
    img.style.left = `${posX}px`;
    img.style.top = `${posY}px`;
    for (const [k, v] of motionVars) img.style.setProperty(k, v);
    img.style.animation = `${moveAnim}, ${fadeAnim}`;
  }

  root.style.animationDelay = `${Math.random() * preset.staggerMs}ms`;
  return root;
}

function spawnParticleBatch(
  layer: HTMLElement,
  anchor: DOMRect,
  amount: number,
  preset: BurstPreset,
  options: SpawnParticlesOptions,
  track?: Set<HTMLElement>
): HTMLElement[] {
  const mode = options.mode ?? "solo";
  const soloAi = options.soloAi ?? false;
  const count = burstCount(preset, amount);
  const particles: HTMLElement[] = [];
  const originX = anchor.left + anchor.width / 2;
  const originY = anchor.top + anchor.height / 2;
  const particleSize = options.particleSize ?? particleSizeFor(preset, mode, soloAi);
  const distanceScale = soloAi ? preset.distanceSoloAiScale : 1;

  for (let i = 0; i < count; i++) {
    const el = createParticleElement(
      preset,
      mode,
      particleSize,
      originX,
      originY,
      distanceScale
    );
    layer.appendChild(el);
    particles.push(el);
    track?.add(el);
  }

  const cleanupMs = preset.durationMs + preset.staggerMs;
  setTimeout(() => {
    for (const p of particles) {
      p.remove();
      track?.delete(p);
    }
  }, cleanupMs);

  return particles;
}

export function spawnParticles(
  layer: HTMLElement,
  anchor: DOMRect,
  amount: number,
  preset: BurstPreset,
  options: SpawnParticlesOptions = {}
): SpawnParticlesResult {
  if (preset.playbackMode === "loop") {
    const loopId = `vfx-loop-${++loopCounter}`;
    const track = new Set<HTMLElement>();
    const batch = spawnParticleBatch(layer, anchor, amount, preset, options, track);
    const intervalId = window.setInterval(() => {
      spawnParticleBatch(layer, anchor, amount, preset, options, track);
    }, preset.loopIntervalMs);
    activeLoops.set(loopId, { intervalId, particles: track, stopFns: [] });
    return { particles: batch, loopId };
  }

  return {
    particles: spawnParticleBatch(layer, anchor, amount, preset, options),
  };
}

export function spawnBurstComposition(
  layer: HTMLElement,
  anchor: DOMRect,
  amount: number,
  composition: BurstComposition,
  options: SpawnParticlesOptions = {}
): SpawnParticlesResult {
  const enabledLayers = composition.layers.filter((l) => l.enabled);
  const allParticles: HTMLElement[] = [];
  const track = new Set<HTMLElement>();
  const stopFns: Array<() => void> = [];

  const spawnAll = () => {
    for (const layerDef of enabledLayers) {
      const result = spawnParticles(layer, anchor, amount, layerDef.preset, options);
      allParticles.push(...result.particles);
      for (const p of result.particles) track.add(p);
    }
  };

  spawnAll();

  const anyLoop = enabledLayers.some((l) => l.preset.playbackMode === "loop");
  if (anyLoop) {
    const loopId = `vfx-loop-${++loopCounter}`;
    const intervalMs = Math.min(...enabledLayers.map((l) => l.preset.loopIntervalMs || 400));
    const intervalId = window.setInterval(spawnAll, intervalMs);
    activeLoops.set(loopId, { intervalId, particles: track, stopFns });
    return { particles: allParticles, loopId };
  }

  return { particles: allParticles };
}

export function stopParticleLoop(loopId: string): void {
  const loop = activeLoops.get(loopId);
  if (!loop) return;
  clearInterval(loop.intervalId);
  for (const fn of loop.stopFns) fn();
  for (const p of loop.particles) p.remove();
  activeLoops.delete(loopId);
}

export function burstDurationMs(preset: BurstPreset): number {
  return preset.durationMs + preset.staggerMs;
}
