let vfxLayer: HTMLElement | null = null;

export function ensureVfxLayer(): HTMLElement {
  if (vfxLayer) return vfxLayer;
  vfxLayer = document.getElementById("friendship-vfx-layer") as HTMLElement | null;
  if (vfxLayer) return vfxLayer;
  vfxLayer = document.createElement("div");
  vfxLayer.id = "friendship-vfx-layer";
  document.body.appendChild(vfxLayer);
  return vfxLayer;
}

export function resetVfxLayerCache(): void {
  vfxLayer = null;
}
