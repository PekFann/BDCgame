const PARTICLE_COUNT = 70;
const MAX_DPR = 2;

type Particle = {
  x: number;
  y: number;
  r: number;
  opacity: number;
  vx: number;
  vy: number;
  hue: number;
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let animId = 0;
let reducedMotion = false;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createParticles(w: number, h: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: rand(0.8, 3),
    opacity: rand(0.2, 0.55),
    vx: rand(-0.15, 0.15),
    vy: rand(-0.35, -0.08),
    hue: rand(30, 50),
  }));
}

function resize(): void {
  if (!canvas || !ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (particles.length === 0) {
    particles = createParticles(w, h);
  }
}

function drawFrame(): void {
  if (!canvas || !ctx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  for (const p of particles) {
    if (!reducedMotion) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -4) {
        p.y = h + 4;
        p.x = Math.random() * w;
      }
      if (p.x < -4) p.x = w + 4;
      if (p.x > w + 4) p.x = -4;
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${p.hue}, 18%, 72%, ${p.opacity})`;
    ctx.fill();
  }
}

function tick(): void {
  drawFrame();
  animId = requestAnimationFrame(tick);
}

function start(): void {
  if (animId) return;
  animId = requestAnimationFrame(tick);
}

function stop(): void {
  if (!animId) return;
  cancelAnimationFrame(animId);
  animId = 0;
  drawFrame();
}

function onVisibility(): void {
  if (document.hidden || reducedMotion) {
    stop();
    if (!document.hidden) drawFrame();
  } else {
    start();
  }
}

function init(): void {
  if (document.getElementById("ambient-canvas")) return;

  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  canvas = document.createElement("canvas");
  canvas.id = "ambient-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  ctx = canvas.getContext("2d");

  resize();
  drawFrame();

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);

  if (!reducedMotion) start();

  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
    reducedMotion = e.matches;
    if (reducedMotion) stop();
    else if (!document.hidden) start();
    else drawFrame();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
