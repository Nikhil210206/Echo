import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * An ordered-dither (Bayer 8×8) sound field rendered on a low-res canvas.
 * Ambient rings pulse out of "voice" sources, the cursor lights the dots under
 * it, and every movement throws a ripple followed by a fainter second ring —
 * the echo. Anything can trigger a pulse with:
 *   window.dispatchEvent(new CustomEvent("echo:pulse", { detail: { x, y, strength } }))
 * where x/y are viewport (client) coordinates.
 */

export interface DitherSource {
  /** 0–1 across the field */
  x: number;
  /** 0–1 down the field */
  y: number;
  strength?: number;
}

export interface DitherOrb {
  x: number;
  y: number;
  /** radius as a fraction of the field's shorter side */
  r: number;
}

interface Props {
  className?: string;
  /** Colours from faintest to brightest lit dot */
  palette?: string[];
  /** CSS px per dither cell */
  cell?: number;
  /** "dot" leaves a gap around each cell (halftone), "square" fills it */
  shape?: "dot" | "square";
  sources?: DitherSource[];
  orbs?: DitherOrb[];
  /** Glow rising from the bottom edge, 0–1 */
  floor?: number;
  /** Overall gain */
  gain?: number;
  interactive?: boolean;
  /** Pointer glow radius in px */
  glow?: number;
}

const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface Ripple {
  x: number;
  y: number;
  t: number;
  s: number;
}

export function DitherField({
  className,
  palette = ["#241a8f", "#3b2bff", "#8b80ff", "#c9c2ff"],
  cell = 6,
  shape = "dot",
  sources = [{ x: 0.5, y: 1.05, strength: 1 }],
  orbs = [],
  floor = 0,
  gain = 1,
  interactive = true,
  glow = 120,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep the latest props available to the render loop without restarting it
  const cfg = useRef({ palette, sources, orbs, floor, gain, glow });
  cfg.current = { palette, sources, orbs, floor, gain, glow };

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sub = shape === "dot" ? 3 : 1; // intrinsic pixels per cell edge
    const lit = shape === "dot" ? 2 : 1; // lit pixels per cell edge

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let image: ImageData | null = null;
    let raf = 0;
    let visible = true;
    const start = performance.now();
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, inside: false, lastX: 0, lastY: 0, lastT: 0 };
    const ripples: Ripple[] = [];

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      w = r.width;
      h = r.height;
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      canvas.width = cols * sub;
      canvas.height = rows * sub;
      canvas.style.width = `${cols * cell}px`;
      canvas.style.height = `${rows * cell}px`;
      image = ctx.createImageData(canvas.width, canvas.height);
      if (reduced) draw(0);
    };

    const toLocal = (clientX: number, clientY: number) => {
      const r = wrap.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top, inside: clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom };
    };

    const addRipple = (x: number, y: number, s: number) => {
      ripples.push({ x, y, t: (performance.now() - start) / 1000, s });
      if (ripples.length > 14) ripples.shift();
    };

    const onMove = (e: PointerEvent) => {
      const p = toLocal(e.clientX, e.clientY);
      pointer.tx = p.x;
      pointer.ty = p.y;
      if (!pointer.inside && p.inside) {
        pointer.x = p.x;
        pointer.y = p.y;
      }
      pointer.inside = p.inside;
      if (!p.inside) return;
      const now = performance.now();
      const moved = Math.hypot(p.x - pointer.lastX, p.y - pointer.lastY);
      if (moved > 70 && now - pointer.lastT > 140) {
        addRipple(p.x, p.y, Math.min(1, 0.45 + moved / 400));
        pointer.lastX = p.x;
        pointer.lastY = p.y;
        pointer.lastT = now;
      }
    };
    const onDown = (e: PointerEvent) => {
      const p = toLocal(e.clientX, e.clientY);
      if (p.inside) addRipple(p.x, p.y, 1.6);
    };
    const onLeave = () => {
      pointer.inside = false;
    };
    const onPulse = (e: Event) => {
      const d = (e as CustomEvent<{ x: number; y: number; strength?: number }>).detail;
      const p = toLocal(d.x, d.y);
      addRipple(p.x, p.y, d.strength ?? 1.8);
    };

    function draw(T: number) {
      if (!image) return;
      const { palette, sources, orbs, floor, gain, glow } = cfg.current;
      const colors = palette.map(hexToRgb);
      const L = colors.length;
      const data = image.data;
      data.fill(0);
      const diag = Math.hypot(w, h);
      const minSide = Math.min(w, h);
      const fall = diag * 0.27;
      const glow2 = 2 * glow * glow;
      const px0 = pointer.x;
      const py0 = pointer.y;
      const pointerOn = pointer.inside && interactive;
      const src = sources.map((s) => ({ x: s.x * w, y: s.y * h, k: s.strength ?? 1 }));
      const orb = orbs.map((o) => ({ x: o.x * w, y: o.y * h, r: o.r * minSide }));
      const live = ripples.map((r) => {
        const age = T - r.t;
        return { x: r.x, y: r.y, rad: age * 330, amp: r.s * Math.exp(-age * 1.15), age };
      });
      const stride = canvas.width * 4;

      for (let j = 0; j < rows; j++) {
        const py = (j + 0.5) * cell;
        const fy = py / h;
        for (let i = 0; i < cols; i++) {
          const px = (i + 0.5) * cell;
          let v = 0;

          // Ambient: rings travelling out of each voice source
          for (let s = 0; s < src.length; s++) {
            const d = Math.hypot(px - src[s].x, py - src[s].y);
            const ring = 0.5 + 0.5 * Math.sin(d * 0.03 - T * 1.6);
            v += src[s].k * 0.66 * ring * ring * ring * ring * Math.exp(-d / fall);
          }

          // Organic drift so flat areas never look mechanical
          const n = Math.sin(px * 0.011 + T * 0.35) * Math.sin(py * 0.016 - T * 0.22) + Math.sin((px + py) * 0.006 + T * 0.18);

          if (floor > 0) v += floor * fy * fy * fy * (0.7 + 0.22 * n);
          v += 0.02 * n;

          // Dithered spheres, lit from the upper left
          for (let o = 0; o < orb.length; o++) {
            const dx = (px - orb[o].x) / orb[o].r;
            const dy = (py - orb[o].y) / orb[o].r;
            const dd = dx * dx + dy * dy;
            if (dd < 1) {
              const z = Math.sqrt(1 - dd);
              const lambert = Math.max(0, -0.5 * dx - 0.55 * dy + 0.67 * z);
              const craters = 0.08 * Math.sin(px * 0.09) * Math.sin(py * 0.07 + 1.3);
              v += 0.1 + 0.78 * lambert + craters;
            } else {
              v += 0.22 * Math.exp(-(Math.sqrt(dd) - 1) * 5.5);
            }
          }

          if (pointerOn) {
            const dx = px - px0;
            const dy = py - py0;
            const d2 = dx * dx + dy * dy;
            if (d2 < glow2 * 4) v += 0.62 * Math.exp(-d2 / glow2);
          }

          // Ripples and their echoes
          for (let r = 0; r < live.length; r++) {
            const rp = live[r];
            if (rp.amp < 0.02) continue;
            const d = Math.hypot(px - rp.x, py - rp.y);
            const a = d - rp.rad;
            if (a > -40 && a < 40) v += rp.amp * Math.exp(-(a * a) / 260);
            const e = d - rp.rad * 0.7;
            if (e > -30 && e < 30) v += rp.amp * 0.45 * Math.exp(-(e * e) / 160);
          }

          v *= gain;
          if (v <= 0.004) continue;
          const th = BAYER[(i & 7) + ((j & 7) << 3)];
          let q = Math.floor(v * L + th);
          if (q <= 0) continue;
          if (q > L) q = L;
          const c = colors[q - 1];
          const base = j * sub * stride + i * sub * 4;
          for (let yy = 0; yy < lit; yy++) {
            let k = base + yy * stride;
            for (let xx = 0; xx < lit; xx++) {
              data[k] = c[0];
              data[k + 1] = c[1];
              data[k + 2] = c[2];
              data[k + 3] = 255;
              k += 4;
            }
          }
        }
      }
      ctx.putImageData(image, 0, 0);
      for (let r = ripples.length - 1; r >= 0; r--) if (T - ripples[r].t > 3) ripples.splice(r, 1);
    }

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      // Ease the glow towards the cursor so it feels like light, not a sticker
      pointer.x += (pointer.tx - pointer.x) * 0.18;
      pointer.y += (pointer.ty - pointer.y) * 0.18;
      draw((performance.now() - start) / 1000);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: "100px" });
    io.observe(wrap);
    resize();

    if (!reduced) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      window.addEventListener("echo:pulse", onPulse);
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("echo:pulse", onPulse);
    };
  }, [cell, shape, interactive]);

  return (
    <div ref={wrapRef} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <canvas ref={canvasRef} className="absolute left-0 top-0 [image-rendering:pixelated]" />
    </div>
  );
}

/** Fire a ripple into every DitherField on the page from a client point. */
export function pulseAt(x: number, y: number, strength = 1.8) {
  window.dispatchEvent(new CustomEvent("echo:pulse", { detail: { x, y, strength } }));
}

export function pulseFrom(el: Element | null, strength = 1.8) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  pulseAt(r.left + r.width / 2, r.top + r.height / 2, strength);
}
