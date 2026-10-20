// Dev-only helpers for measuring the renderer. Never imported by the game;
// load it from the dev server console with:
//   await import('/src/gfx/devtools.js')
// then: await __run(huntIndex, 'medium'); await __bench();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Pick a hunting ground and quality on the menu and start a solo hunt with the
// simulation running (pointer lock faked so nothing is paused).
window.__run = async (huntIdx = 0, quality = 'medium') => {
  document.querySelectorAll('#hunts .hunt')[huntIdx].click();
  const sel = document.getElementById('quality');
  if (![...sel.options].some((o) => o.value === quality)) return 'no quality ' + quality;
  sel.value = quality;
  document.getElementById('btnSolo').click();
  const t0 = performance.now();
  while (!(window.__game && window.__game.renderer && document.getElementById('loading').classList.contains('hidden'))) {
    await wait(200);
    if (performance.now() - t0 > 90000) return 'timeout';
  }
  const g = window.__game;
  g.input.locked = true;
  g.hud.pause(false);
  for (let i = 0; i < 20; i++) g.frame();
  return 'ok';
};

// Same as __run but returns at once; poll window.__status.
window.__start = (huntIdx = 0, quality = 'medium', hour = 8.5) => {
  window.__status = 'loading';
  window.__run(huntIdx, quality).then((r) => {
    if (r === 'ok') window.__game.atmo.hour = hour;
    window.__status = r;
  });
  return 'started';
};

// The real cost of a frame, measured synchronously: run the game's frame()
// and wait for the GPU with a 1-pixel readPixels. Works even when the page is
// in the background and requestAnimationFrame is paused.
window.__bench = (n = 60, scale = 1) => {
  const g = window.__game;
  // hold the render scale still while measuring (dynamic resolution would
  // otherwise react to the back-to-back frames)
  const gs = window.__gfxSettings;
  const saved = gs ? gs.renderScale : null;
  if (gs && g.gfx) {
    gs.renderScale = scale;
    g.gfx.applyRenderScale();
  }
  const gl = g.renderer.getContext();
  const px = new Uint8Array(4);
  const t = [];
  const info = g.renderer.info;
  info.autoReset = false;
  for (let i = 0; i < n; i++) {
    info.reset();
    const a = performance.now();
    g.frame();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    t.push(performance.now() - a);
  }
  info.autoReset = true;
  if (gs) gs.renderScale = saved;
  t.sort((a, b) => a - b);
  const med = t[n >> 1];
  const r = info.render;
  return {
    medMs: +med.toFixed(2),
    p90Ms: +t[Math.floor(n * 0.9)].toFixed(2),
    fps: Math.round(1000 / med),
    calls: r.calls,
    tris: r.triangles,
    scale: g.gfx ? g.gfx.scale : 1,
    pr: +g.renderer.getPixelRatio().toFixed(2),
    size: [g.renderer.domElement.width, g.renderer.domElement.height],
    quality: g.quality,
  };
};

// Advance the game n frames of dt seconds without requestAnimationFrame.
window.__step = (n = 1) => {
  const g = window.__game;
  for (let i = 0; i < n; i++) g.frame();
  return n;
};

// Put the hunter somewhere and look a given way; freeze time of day if asked.
window.__view = (opts = {}) => {
  const g = window.__game;
  const p = g.player;
  if (opts.x != null) p.spawn(opts.x, opts.z, opts.yaw ?? p.yaw);
  if (opts.yaw != null) p.yaw = opts.yaw;
  if (opts.pitch != null) p.pitch = opts.pitch;
  if (opts.hour != null) g.atmo.hour = opts.hour;
  return { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1), y: +p.pos.y.toFixed(1), yaw: +p.yaw.toFixed(2), hour: +g.atmo.hour.toFixed(2) };
};

'devtools ready';
