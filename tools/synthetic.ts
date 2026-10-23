/*
 * Draws the synthetic placeholder echo clips. Used only by tools/render-clips.py,
 * which renders each case to an MP4 once. The web app plays the MP4s, so the
 * clip parameters (EF, effusion size) never reach a trainee's browser.
 */
import type { ClipSpec } from '../src/types';

type Spec = Extract<ClipSpec, { kind: 'synthetic' }>;

const W = 640;
const H = 480;
const APEX = { x: 320, y: 30 };
const R = 430;
const HALF = 0.66;
const DEPTH_CM = 16;

const gray = (v: number) => `rgb(${v},${v},${v})`;

function sector(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(APEX.x, APEX.y);
  ctx.arc(APEX.x, APEX.y, R, Math.PI / 2 - HALF, Math.PI / 2 + HALF, false);
  ctx.closePath();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function makeSpeckle(seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W + 24;
  c.height = H + 24;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 1) / 4294967297;
  };
  for (let i = 0; i < img.data.length; i += 4) {
    // Rayleigh-distributed speckle
    const v = Math.min(255, Math.sqrt(-2 * Math.log(rnd())) * 120);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 0 at end-diastole, 1 at end-systole */
function contraction(phase: number): number {
  if (phase < 0.32) return 0.5 - 0.5 * Math.cos((Math.PI * phase) / 0.32);
  if (phase < 0.5) return 0.5 + 0.5 * Math.cos((Math.PI * (phase - 0.32)) / 0.18);
  return 0;
}

const gauss = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd));
function ecg(phase: number): number {
  return (
    0.12 * gauss(phase, 0.86, 0.02) -
    0.12 * gauss(phase, 0.952, 0.004) +
    1.0 * gauss(phase, 0.962, 0.005) -
    0.28 * gauss(phase, 0.972, 0.005) +
    0.26 * gauss(phase, 0.3, 0.04)
  );
}

function drawTissue(t: CanvasRenderingContext2D, spec: Extract<ClipSpec, { kind: 'synthetic' }>, c: number) {
  t.clearRect(0, 0, W, H);
  t.save();
  t.filter = 'blur(2.2px)';
  sector(t);
  t.fillStyle = gray(92);
  t.fill();

  // Pericardium, effusion (black) or fat pad (grey), then the heart envelope
  const env = { x: 318, y: 240, rx: 134, ry: 164 };
  const gap = spec.effusion * 34 + (spec.mimic ? 10 : 0);
  ellipse(t, env.x, env.y + 2 * c, env.rx + gap + 9, env.ry + gap + 9, gray(255));
  if (gap > 0) {
    ellipse(t, env.x, env.y + 2 * c, env.rx + gap, env.ry + gap, spec.mimic ? gray(150) : gray(6));
  }
  ellipse(t, env.x, env.y, env.rx, env.ry, gray(140));

  // Atria fill as the ventricles contract
  const a = 1 + 0.09 * c;
  ellipse(t, 374, 352, 50 * a, 40 * a, gray(205));
  ellipse(t, 374, 352, 42 * a, 32 * a, gray(16));
  ellipse(t, 262, 350, 44 * a, 37 * a, gray(205));
  ellipse(t, 262, 350, 37 * a, 30 * a, gray(16));

  // Right ventricle (fixed function)
  const rv = 1 - c * (1 - Math.cbrt(0.5));
  const rvApex = 128;
  ellipse(t, 262, rvApex + 86 * rv, 40 * rv + 8, 86 * rv + 8, gray(210));
  ellipse(t, 262, rvApex + 86 * rv, 40 * rv, 86 * rv, gray(16));

  // Left ventricle: cavity shrinks with EF; walls thicken in systole
  const lv = 1 - c * (1 - Math.cbrt(1 - spec.ef));
  const crx = 50 * lv;
  const cry = 108 * Math.pow(lv, 0.85);
  const wall = 15 * (1 + 0.55 * c * (spec.ef / 0.6));
  const lvApex = 100;
  const cy = lvApex + cry;
  ellipse(t, 372, cy, crx + wall, cry + wall * 0.9, gray(228));
  ellipse(t, 372, cy, crx, cry, gray(14));

  // Mitral and tricuspid leaflets: open in diastole, closed in systole
  t.filter = 'blur(1px)';
  t.strokeStyle = gray(240);
  t.lineWidth = 3.5;
  const open = 1 - Math.min(1, c * 3);
  const valve = (x: number, y: number, w: number) => {
    t.beginPath();
    t.moveTo(x - w, y);
    t.lineTo(x - w * (1 - 0.55 * open) + 2, y - 26 * open);
    t.moveTo(x + w, y);
    t.lineTo(x + w * (1 - 0.55 * open) - 2, y - 26 * open);
    t.stroke();
  };
  valve(372, cy + cry + 6, crx + 4);
  valve(262, rvApex + 172 * rv + 6, 40 * rv + 2);
  t.restore();
}


export function createRenderer(canvas: HTMLCanvasElement, spec: Spec) {
  const ctx = canvas.getContext('2d')!;
  const tissue = document.createElement('canvas');
  tissue.width = W;
  tissue.height = H;
  const tctx = tissue.getContext('2d')!;
  const speckles = [makeSpeckle(7), makeSpeckle(19), makeSpeckle(43)];
  const ink = '#c5d0d8';
  const trace = '#5bd38a';
  let t = 0;
  let frame = 0;
  const render = () => {
      const phase = ((t * spec.hr) / 60) % 1;
      const c = contraction(phase);
      drawTissue(tctx, spec, c);

      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      sector(ctx);
      ctx.clip();
      ctx.drawImage(tissue, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      const sp = speckles[frame % speckles.length];
      ctx.drawImage(sp, -((frame * 7) % 24), -((frame * 5) % 24));
      ctx.globalCompositeOperation = 'source-over';
      const g = ctx.createRadialGradient(APEX.x, APEX.y, 20, APEX.x, APEX.y, R);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.75, 'rgba(0,0,0,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // Machine overlays
      ctx.fillStyle = ink;
      ctx.font = '600 13px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('CORTEX SIM', 18, 26);
      ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(`${spec.view}   HR ${spec.hr} bpm`, 18, 44);
      ctx.textAlign = 'right';
      ctx.fillText(`Depth ${DEPTH_CM} cm`, W - 18, 26);
      ctx.fillText(`FR 30 Hz`, W - 18, 44);
      ctx.textAlign = 'left';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      const pxcm = R / DEPTH_CM;
      for (let d = 2; d <= 12; d += 2) {
        const y = APEX.y + d * pxcm;
        ctx.beginPath();
        ctx.moveTo(W - 30, y);
        ctx.lineTo(W - (d % 4 === 0 ? 42 : 36), y);
        ctx.stroke();
        if (d % 4 === 0) ctx.fillText(String(d), W - 60, y + 4);
      }

      // ECG sweep
      ctx.strokeStyle = trace;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const span = 2.5;
      for (let x = 30; x <= 610; x += 2) {
        const tx = t - ((610 - x) / 580) * span;
        const ph = (((tx * spec.hr) / 60) % 1 + 1) % 1;
        const y = 452 - ecg(ph) * 18;
        if (x === 30) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = trace;
      ctx.beginPath();
      ctx.arc(610, 452 - ecg(phase) * 18, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.75;
      ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('SYNTHETIC PLACEHOLDER · NOT A PATIENT', 18, H - 44);
      ctx.globalAlpha = 1;
    };


  return (seconds: number, frameIndex: number) => {
    t = seconds;
    frame = frameIndex;
    render();
  };
}

export { W, H };
