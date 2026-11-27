// GOBBLE BREAK — boot and the one loop. Input is read every frame, the world
// advances in fixed 1/60 s steps (several in a slow frame, none in a fast
// one), and the renderer paints what is there. The game moves between four
// screens: title, play, paused and game over.
//
// ?seed=N fixes the pattern. ?shot=cover|title|kitchen|end (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const ctx = canvas.getContext('2d');
const world = createWorld(createRandom(seed));
const sound = createSound();

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(window.innerWidth / FIELD.width, window.innerHeight / FIELD.height);
  canvas.width = Math.floor(FIELD.width * dpr);
  canvas.height = Math.floor(FIELD.height * dpr);
  canvas.style.width = `${Math.floor(FIELD.width * scale)}px`;
  canvas.style.height = `${Math.floor(FIELD.height * scale)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

function draw(state, screen, best, time) {
  const biome = biomeAt(state.distance);
  const scroll = state.distance * 10;
  ctx.save();
  if (state.shake > 0) {
    ctx.translate((Math.random() - 0.5) * state.shake * 24, (Math.random() - 0.5) * state.shake * 24);
  }
  drawBackground(ctx, biome, scroll, time);
  for (const o of state.obstacles) if (o.active) drawObstacle(ctx, o, time);
  for (const p of state.pickups) if (p.active) drawPickup(ctx, p, time);
  drawFarmer(ctx, state.turkey, state.farmer, time);
  drawTurkey(ctx, state.turkey, time);
  if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) drawHud(ctx, state, best, sound.muted);
  if (screen === SCREEN_TITLE) drawTitle(ctx, best, time);
  if (screen === SCREEN_PAUSED) drawPaused(ctx);
  if (screen === SCREEN_OVER) drawOver(ctx, state, best, time);
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(229,83,75,${state.flash * 1.6})`;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  }
  ctx.restore();
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    draw(world.state, scene.screen, scene.best, 5);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let musicZone = '';

  function announce(message) { status.textContent = message; }

  function startGame() {
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    musicZone = world.state.zone.id;
    sound.unlock();
    sound.startMusic(biomeAt(0));
    sound.gobble();
    announce(`Playing. ${LIVES} lives. Run 1000 metres to freedom.`);
  }

  function endGame() {
    screen = SCREEN_OVER;
    sound.stopMusic();
    if (world.state.score > best) { best = world.state.score; saveBest(best); }
    announce(world.state.cause === 'escaped'
      ? `Escaped! Score ${world.state.score}. Best ${best}.`
      : `Game over. Score ${world.state.score}. Best ${best}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) sound.toggleMute();
    if (actions & ACTION_RESTART && (screen === SCREEN_OVER || screen === SCREEN_PAUSED)) { startGame(); return 0; }
    if (actions & ACTION_CONFIRM && (screen === SCREEN_TITLE || screen === SCREEN_OVER)) { startGame(); return 0; }
    if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) { screen = SCREEN_PAUSED; sound.stopMusic(); announce('Paused.'); }
    else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY; sound.startMusic(biomeAt(world.state.distance)); announce('Playing.');
    }
    return actions;
  }

  function stepFrame(actions) {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { jumpPressed: false, jumpHeld: false, duck: false, direction: 0, dash: false }, true);
      return;
    }
    const jumpHeld = input.held.jump;
    const inputState = {
      jumpPressed: !!(actions & ACTION_CONFIRM), jumpHeld, duck: input.held.duck,
      direction: input.direction(), dash: !!(actions & ACTION_DASH),
    };
    const events = world.step(STEP, inputState, false);
    if (events & EVENT_HIT) { sound.hit(); announce(world.state.lives === 1 ? 'Hit. 1 life left.' : `Hit. ${world.state.lives} lives left.`); }
    if (events & EVENT_CORN) sound.corn();
    if (events & EVENT_FEATHER) sound.feather();
    if (events & EVENT_CLOSE) sound.closeCall();
    if (events & EVENT_ZONE) {
      sound.zone();
      const zone = world.state.zone.id;
      if (zone !== musicZone) { musicZone = zone; sound.startMusic(biomeAt(world.state.distance)); }
      announce(`Now entering: ${world.state.zone.label}.`);
    }
    if (events & EVENT_OVER) endGame();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      accumulator += dt;
      let guard = 0;
      while (accumulator >= STEP && guard < 8 && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        stepFrame(actions);
        accumulator -= STEP;
        guard += 1;
      }
      if (guard === 8) accumulator = 0;
    } else {
      accumulator = 0;
    }
    draw(world.state, screen, best, now / 1000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      sound.stopMusic();
      announce('Paused.');
    }
  });

  announce('Gobble Break. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
