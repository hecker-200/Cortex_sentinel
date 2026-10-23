"""
Renders every synthetic case in seed/cases.json to seed/clips/<id>.mp4.

Needs: Python Playwright with Chromium, ffmpeg, and node (for esbuild).
Run from the project root:  python3 tools/render-clips.py
Only needed if you change the synthetic clip parameters; the MP4s are committed.
"""
import base64, json, math, os, shutil, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30
work = tempfile.mkdtemp(prefix='cortex-clips-')
bundle = os.path.join(work, 'harness.js')
subprocess.run(['npx', 'esbuild', os.path.join(ROOT, 'tools/harness.ts'), '--bundle', '--format=iife', f'--outfile={bundle}'], check=True, cwd=ROOT)
html = os.path.join(work, 'index.html')
with open(html, 'w') as f:
    f.write(f'<!doctype html><canvas id="c" width="640" height="480"></canvas><script>{open(bundle).read()}</script>')

cases = json.load(open(os.path.join(ROOT, 'seed/cases.json')))
only = set(sys.argv[1:])
os.makedirs(os.path.join(ROOT, 'seed/clips'), exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('file://' + html)
    for c in cases:
        if only and c['id'] not in only: continue
        spec = c['clip']
        if spec.get('kind') != 'synthetic': continue
        beat = 60 / spec['hr']
        beats = max(2, round(3.0 / beat))  # whole beats so the loop is seamless
        n = round(beats * beat * FPS)
        n -= n % 3  # speckle pattern cycles every 3 frames
        fdir = os.path.join(work, c['id']); os.makedirs(fdir)
        for i in range(n):
            t = beats * beat * i / n
            data = page.evaluate('([s, t, i]) => window.renderFrames(s, t, i)', [json.dumps(spec), t, i])
            with open(os.path.join(fdir, f'{i:04d}.png'), 'wb') as f:
                f.write(base64.b64decode(data.split(',', 1)[1]))
        out = os.path.join(ROOT, 'seed/clips', f"{c['id']}.mp4")
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(fdir, '%04d.png'),
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '31', '-preset', 'slow', '-movflags', '+faststart', '-an', out], check=True)
        print(c['id'], n, 'frames', os.path.getsize(out) // 1024, 'KB')
    browser.close()
shutil.rmtree(work)
