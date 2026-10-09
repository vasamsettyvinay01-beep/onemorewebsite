"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#F2B134", "#E8C57A", "#E8632B", "#C2272D", "#F4E4C1", "#BB9B63"];

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
};

type Shell = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  exploded: boolean;
};

/** A short Diwali burst over the pass. It does not take clicks, and it ends on its own. */
export function DiwaliFireworks() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let alive = true;
    const sparks: Spark[] = [];
    const shells: Shell[] = [];
    const start = performance.now();
    const duration = 4600;
    const blooms = [0, 280, 620, 980, 1400, 1900, 2400];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const burst = (x: number, y: number, color: string) => {
      const count = 64 + Math.floor(Math.random() * 20);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = 1.4 + Math.random() * 2.8;
        sparks.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          max: 42 + Math.random() * 26,
          color: Math.random() > 0.2 ? color : COLORS[Math.floor(Math.random() * COLORS.length)]!,
          size: Math.random() > 0.82 ? 2.8 : 1.7,
        });
      }
    };

    const bloom = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const x = width * (0.18 + Math.random() * 0.64);
      const y = height * (0.07 + Math.random() * 0.2);
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
      shells.push({
        x: x + (Math.random() - 0.5) * 24,
        y: height * 0.72,
        vx: (x - width * 0.5) * 0.01,
        vy: -7.5,
        color,
        exploded: false,
      });
      burst(x, y, color);
    };

    let bloomed = 0;

    const frame = (now: number) => {
      if (!alive) return;
      const elapsed = now - start;
      const width = window.innerWidth;
      const height = window.innerHeight;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      if (bloomed < blooms.length && elapsed >= blooms[bloomed]!) {
        bloom();
        bloomed += 1;
      }

      for (const shell of shells) {
        if (shell.exploded) continue;
        shell.x += shell.vx;
        shell.y += shell.vy;
        shell.vy += 0.18;
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#F4E4C1";
        ctx.beginPath();
        ctx.arc(shell.x, shell.y, 2, 0, Math.PI * 2);
        ctx.fill();
        if (shell.vy >= 0) shell.exploded = true;
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const spark = sparks[i]!;
        spark.life += 1;
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.vy += 0.026;
        spark.vx *= 0.986;
        const t = spark.life / spark.max;
        if (t >= 1) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = spark.color;
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, spark.size * (1 - t * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const fade = elapsed > duration - 800 ? Math.max(0, (duration - elapsed) / 800) : 1;
      canvas.style.opacity = String(elapsed < duration ? fade : 0);
      if (elapsed < duration || sparks.length > 0) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-30" />;
}
