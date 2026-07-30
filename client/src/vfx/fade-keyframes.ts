const fadeKeyframeCache = new Set<number>();

export function ensureFadeKeyframes(fadeOutStart: number): string {
  const pct = Math.min(95, Math.max(5, Math.round(fadeOutStart)));
  if (fadeKeyframeCache.has(pct)) return `vfxFadeTail${pct}`;
  fadeKeyframeCache.add(pct);
  const style = document.createElement("style");
  style.textContent = `
    @keyframes vfxFadeTail${pct} {
      0% { opacity: 0; }
      12% { opacity: 1; }
      ${pct}% { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  return `vfxFadeTail${pct}`;
}

// Bootstrap default fade keyframe used by floaters
ensureFadeKeyframes(70);
