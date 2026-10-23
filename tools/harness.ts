import { createRenderer, W, H } from './synthetic';

// Exposed to the Playwright driver in render-clips.py
(window as unknown as Record<string, unknown>).renderFrames = (specJson: string, seconds: number, frame: number) => {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const draw = createRenderer(canvas, JSON.parse(specJson));
  draw(seconds, frame);
  return canvas.toDataURL('image/png');
};
(window as unknown as Record<string, unknown>).CLIP_SIZE = [W, H];
