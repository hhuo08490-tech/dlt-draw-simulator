const canvas = document.querySelector('#machine');
const ctx = canvas.getContext('2d');
const ui = {
  start: document.querySelector('#startBtn'), reset: document.querySelector('#resetBtn'), sound: document.querySelector('#soundBtn'),
  speed: document.querySelector('#speedToggle'), front: document.querySelector('#frontResults'), back: document.querySelector('#backResults'),
  title: document.querySelector('#stageTitle'), round: document.querySelector('#roundLabel'), countdown: document.querySelector('#countdown'), counterCaption: document.querySelector('#counterCaption'),
  poolName: document.querySelector('#poolName'), poolRange: document.querySelector('#poolRange'), poolDot: document.querySelector('#poolDot'),
  history: document.querySelector('#historyList'), clear: document.querySelector('#clearHistory'), stage: document.querySelector('.stage-card'),
  clock: document.querySelector('#systemClock'), drawNo: document.querySelector('#drawNo'), machineStatus: document.querySelector('#machineStatus'),
  currentPoolStat: document.querySelector('#currentPoolStat'), remainingCount: document.querySelector('#remainingCount'), elapsedTime: document.querySelector('#elapsedTime'),
  drawnCount: document.querySelector('#drawnCount'), airflowValue: document.querySelector('#airflowValue'), lastBall: document.querySelector('#lastBallPreview'),
  ballMessage: document.querySelector('#ballMessage'), liveSequence: document.querySelector('#liveSequence'), processSteps: [...document.querySelectorAll('.process-step')]
};

const HISTORY_KEY = 'dlt-draw-simulator-history-v1';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let balls = [], motionActive = false, drawInProgress = false, drawToken = 0, muted = false, phase = 'front', raf;
let history = loadHistory();
let drawCounter = history.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
let timerStarted = 0, timerHandle, currentProcessIndex = 0;
let chamber = { x: 0, y: 0, r: 0 };
let audioContext;

const pad = n => String(n).padStart(2, '0');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function secureRandom(max) {
  if (window.crypto?.getRandomValues) {
    const limit = Math.floor(0x100000000 / max) * max;
    const value = new Uint32Array(1);
    do window.crypto.getRandomValues(value); while (value[0] >= limit);
    return value[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function sample(max, count) {
  const values = Array.from({ length: max }, (_, i) => i + 1);
  for (let i = values.length - 1; i > values.length - 1 - count; i--) {
    const j = secureRandom(i + 1); [values[i], values[j]] = [values[j], values[i]];
  }
  // 保留摇奖机实际抽出的随机顺序；开奖结果不在动画前预先排序。
  return values.slice(-count);
}

function resize() {
  const old = { ...chamber };
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  chamber = { x: rect.width / 2, y: rect.height * .46, r: Math.min(rect.width * .28, rect.height * .36) };
  if (!balls.length) createBalls(35, 'red');
  else if (old.r) balls.forEach(ball => {
    ball.x = chamber.x + ((ball.x - old.x) / old.r) * chamber.r;
    ball.y = chamber.y + ((ball.y - old.y) / old.r) * chamber.r;
  });
}

function createBalls(total, color) {
  phase = color === 'red' ? 'front' : 'back';
  balls = Array.from({ length: total }, (_, i) => {
    const angle = Math.random() * Math.PI * 2, dist = Math.sqrt(Math.random()) * chamber.r * .72;
    return { number: i + 1, color, x: chamber.x + Math.cos(angle) * dist, y: chamber.y + Math.sin(angle) * dist,
      vx: (Math.random() - .5) * 2.2, vy: (Math.random() - .5) * 2.2, radius: total > 20 ? 12 : 15, spin: Math.random() * 6 };
  });
}

function drawMachine() {
  const { width, height } = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, width, height);
  const c = chamber;
  drawMechanics(c, width, height);
  ctx.save();
  ctx.shadowColor = 'rgba(71,210,255,.28)'; ctx.shadowBlur = 25;
  const glass = ctx.createRadialGradient(c.x - c.r * .35, c.y - c.r * .4, c.r * .05, c.x, c.y, c.r);
  glass.addColorStop(0, 'rgba(153,235,255,.11)'); glass.addColorStop(.72, 'rgba(29,88,116,.07)'); glass.addColorStop(1, 'rgba(62,180,224,.12)');
  ctx.fillStyle = glass; ctx.strokeStyle = 'rgba(130,221,250,.46)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(c.x, c.y, c.r - 8, 3.7, 4.55); ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(112,198,228,.35)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(c.x - c.r * .55, c.y + c.r * .83); ctx.lineTo(c.x - c.r * .72, height - 47); ctx.moveTo(c.x + c.r * .55, c.y + c.r * .83); ctx.lineTo(c.x + c.r * .72, height - 47); ctx.stroke();
  ctx.strokeStyle = 'rgba(116,215,245,.26)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(c.x - c.r * .92, height - 45); ctx.lineTo(c.x + c.r * .92, height - 45); ctx.stroke();

  ctx.save(); ctx.beginPath(); ctx.arc(c.x, c.y, c.r - 5, 0, Math.PI * 2); ctx.clip();
  balls.filter(ball => !ball.extracting).forEach(drawBall); ctx.restore();
  balls.filter(ball => ball.extracting).forEach(drawBall);
  ctx.fillStyle = 'rgba(95,213,246,.12)'; ctx.beginPath(); ctx.ellipse(c.x, c.y + c.r * .72, c.r * .48, c.r * .10, 0, 0, Math.PI * 2); ctx.fill();
}

function drawMechanics(c, width, height) {
  const active = motionActive && !reducedMotion.matches, rotation = performance.now() / (active ? 160 : 1100);
  ctx.save();
  const frame = ctx.createLinearGradient(c.x - c.r, 0, c.x + c.r, 0);
  frame.addColorStop(0, '#27495b'); frame.addColorStop(.48, '#8db3c3'); frame.addColorStop(.55, '#33586a'); frame.addColorStop(1, '#173343');
  ctx.strokeStyle = frame; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 12, 2.88, 6.55); ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(139,218,240,.34)';
  ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 19, 3.36, 5.95); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4 + .12, x = c.x + Math.cos(angle) * (c.r + 13), y = c.y + Math.sin(angle) * (c.r + 13);
    ctx.fillStyle = '#8fb8c7'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#17303d'; ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
  }
  const fanX = c.x - c.r * .9, fanY = c.y + c.r * .78, fanR = 24;
  ctx.fillStyle = 'rgba(4,14,22,.95)'; ctx.strokeStyle = 'rgba(102,191,219,.38)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(fanX, fanY, fanR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.save(); ctx.translate(fanX, fanY); ctx.rotate(rotation);
  for (let i = 0; i < 5; i++) { ctx.rotate(Math.PI * 2 / 5); ctx.fillStyle = active ? 'rgba(78,218,249,.58)' : 'rgba(77,126,145,.35)'; ctx.beginPath(); ctx.ellipse(0, -9, 5, 12, .45, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore(); ctx.fillStyle = '#6fdcf3'; ctx.beginPath(); ctx.arc(fanX, fanY, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(84,177,207,.35)'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(fanX + fanR, fanY); ctx.quadraticCurveTo(c.x - c.r * .55, fanY, c.x - c.r * .46, c.y + c.r * .66); ctx.stroke();
  const outletX = c.x + c.r * .9, outletY = c.y + c.r * .7;
  ctx.strokeStyle = 'rgba(115,199,225,.32)'; ctx.lineWidth = 13;
  ctx.beginPath(); ctx.moveTo(c.x + c.r * .67, c.y + c.r * .55); ctx.quadraticCurveTo(outletX, c.y + c.r * .55, outletX, outletY); ctx.lineTo(outletX - 18, outletY + 27); ctx.stroke();
  ctx.strokeStyle = 'rgba(188,238,250,.38)'; ctx.lineWidth = 2; ctx.stroke();
  if (active) {
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 4; i++) {
      const offset = ((performance.now() / 14 + i * 39) % (c.r * 1.25));
      ctx.strokeStyle = `rgba(92,222,250,${.08 + i * .025})`;
      ctx.beginPath(); ctx.arc(c.x, c.y + c.r * .12, c.r * .25 + offset * .42, 3.45, 5.9); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBall(ball) {
  const gradient = ctx.createRadialGradient(ball.x - ball.radius * .35, ball.y - ball.radius * .4, 1, ball.x, ball.y, ball.radius);
  if (ball.color === 'red') { gradient.addColorStop(0, '#ff9cac'); gradient.addColorStop(.42, '#ff3c59'); gradient.addColorStop(1, '#9f1028'); }
  else { gradient.addColorStop(0, '#a4ccff'); gradient.addColorStop(.42, '#3988ff'); gradient.addColorStop(1, '#0e449e'); }
  ctx.save(); ctx.shadowColor = ball.color === 'red' ? 'rgba(255,45,75,.4)' : 'rgba(43,126,255,.4)'; ctx.shadowBlur = 8;
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = `700 ${ball.radius * .72}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(pad(ball.number), ball.x, ball.y + .5); ctx.restore();
}

function physics() {
  if (motionActive && !reducedMotion.matches) {
    const energy = ui.speed.checked ? .62 : .44;
    balls.forEach((b, i) => {
      if (b.extracting) return;
      b.vx += (Math.random() - .5) * energy; b.vy += (Math.random() - .5) * energy - .015;
      const speed = Math.hypot(b.vx, b.vy), max = ui.speed.checked ? 6.2 : 4.6;
      if (speed > max) { b.vx *= max / speed; b.vy *= max / speed; }
      b.x += b.vx; b.y += b.vy;
      const dx = b.x - chamber.x, dy = b.y - chamber.y, dist = Math.hypot(dx, dy), limit = chamber.r - b.radius - 6;
      if (dist > limit) { const nx = dx / dist, ny = dy / dist; b.x = chamber.x + nx * limit; b.y = chamber.y + ny * limit; const dot = b.vx * nx + b.vy * ny; b.vx -= 1.85 * dot * nx; b.vy -= 1.85 * dot * ny; }
      for (let j = i + 1; j < balls.length; j++) {
        const o = balls[j];
        if (o.extracting) continue;
        const x = o.x - b.x, y = o.y - b.y, d = Math.hypot(x, y), min = b.radius + o.radius;
        if (d > 0 && d < min) { const nx = x/d, ny = y/d, overlap = (min-d)/2; b.x -= nx*overlap; b.y -= ny*overlap; o.x += nx*overlap; o.y += ny*overlap; const impulse = (o.vx-b.vx)*nx + (o.vy-b.vy)*ny; if (impulse < 0) { b.vx += impulse*nx; b.vy += impulse*ny; o.vx -= impulse*nx; o.vy -= impulse*ny; } }
      }
    });
  } else {
    balls.forEach(b => { if (b.extracting) return; b.vy += .025; b.vx *= .995; b.vy *= .995; b.x += b.vx; b.y += b.vy; const dx=b.x-chamber.x, dy=b.y-chamber.y, d=Math.hypot(dx,dy), limit=chamber.r-b.radius-6; if(d>limit){const nx=dx/d,ny=dy/d;b.x=chamber.x+nx*limit;b.y=chamber.y+ny*limit;const dot=b.vx*nx+b.vy*ny;b.vx-=1.6*dot*nx;b.vy-=1.6*dot*ny;} });
  }
  drawMachine(); raf = requestAnimationFrame(physics);
}

function placeholders() {
  ui.front.innerHTML = Array.from({length: 5}, () => '<span class="ball-placeholder">?</span>').join('');
  ui.back.innerHTML = Array.from({length: 2}, () => '<span class="ball-placeholder">?</span>').join('');
}

function revealResult(container, number, color, index) {
  const target = container.children[index];
  const el = document.createElement('span'); el.className = `result-ball ${color}`; el.textContent = pad(number); el.style.animationDelay = `${index * .035}s`;
  target.replaceWith(el); ping(color === 'red' ? 520 + index * 55 : 720 + index * 70);
}

function extractBall(number, fast) {
  const ball = balls.find(item => item.number === number && !item.extracting);
  if (!ball) return Promise.resolve();
  ball.extracting = true; ball.vx = 0; ball.vy = 0;
  if (reducedMotion.matches) { balls = balls.filter(item => item !== ball); return Promise.resolve(); }
  const startX = ball.x, startY = ball.y, startRadius = ball.radius;
  const controlX = chamber.x + chamber.r * .72, controlY = chamber.y + chamber.r * .72;
  const targetX = chamber.x + chamber.r * .72, targetY = canvas.getBoundingClientRect().height - 54;
  const duration = fast ? 260 : 560, started = performance.now();
  return new Promise(resolve => {
    const step = now => {
      const raw = Math.min(1, (now - started) / duration), t = 1 - Math.pow(1 - raw, 3), inv = 1 - t;
      ball.x = inv * inv * startX + 2 * inv * t * controlX + t * t * targetX;
      ball.y = inv * inv * startY + 2 * inv * t * controlY + t * t * targetY;
      ball.radius = startRadius + 5 * t;
      if (raw < 1) requestAnimationFrame(step);
      else { balls = balls.filter(item => item !== ball); resolve(); }
    };
    requestAnimationFrame(step);
  });
}

async function extractAndReveal(container, number, color, index, fast) {
  await extractBall(number, fast);
  revealResult(container, number, color, index);
}

function ping(frequency) {
  if (muted) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator(), gain = audioContext.createGain();
    osc.frequency.value = frequency; osc.type = 'sine'; gain.gain.setValueAtTime(.08, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .28);
    osc.connect(gain).connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + .28);
  } catch (_) {}
}

function setProcess(index, complete = false) {
  currentProcessIndex = index;
  ui.processSteps.forEach((step, i) => {
    step.classList.toggle('done', complete || i < index);
    step.classList.toggle('active', !complete && i === index);
  });
}

function formatElapsed(ms) {
  const seconds = Math.max(0, ms) / 1000;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${Math.floor((seconds % 1) * 10)}`;
}

function startTimer(offset = 0) {
  clearInterval(timerHandle); timerStarted = performance.now() - offset; ui.elapsedTime.textContent = formatElapsed(offset);
  timerHandle = setInterval(() => {
    const elapsed = performance.now() - timerStarted;
    ui.elapsedTime.textContent = formatElapsed(elapsed);
    ui.airflowValue.textContent = `${Math.round(88 + Math.sin(elapsed / 420) * 7)}%`;
  }, 100);
}

function stopTimer() {
  clearInterval(timerHandle); timerHandle = null; ui.airflowValue.textContent = '0%';
}

function resetConsole() {
  ui.drawNo.textContent = `SIM-${String(drawCounter + 1).padStart(3, '0')}`;
  ui.machineStatus.textContent = '待机'; ui.machineStatus.classList.remove('running');
  ui.currentPoolStat.textContent = '前区'; ui.remainingCount.textContent = '35'; ui.elapsedTime.textContent = '00:00.0'; ui.drawnCount.textContent = '0 / 7'; ui.airflowValue.textContent = '0%';
  ui.lastBall.className = 'preview-ball empty'; ui.lastBall.textContent = '—'; ui.ballMessage.textContent = '等待首个号码球';
  ui.liveSequence.innerHTML = '<em>尚未出球</em>'; setProcess(0);
}

function recordLiveBall(number, color, poolIndex, totalDrawn) {
  const isFront = color === 'red', poolTotal = isFront ? 35 : 12;
  ui.currentPoolStat.textContent = isFront ? '前区' : '后区'; ui.remainingCount.textContent = String(poolTotal - poolIndex);
  ui.drawnCount.textContent = `${totalDrawn} / 7`; ui.lastBall.className = `preview-ball ${color}`; ui.lastBall.textContent = pad(number);
  ui.ballMessage.textContent = `确认：第 ${poolIndex} 个${isFront ? '前区' : '后区'}号码`;
  ui.liveSequence.querySelector('em')?.remove();
  const chip = document.createElement('span'); chip.className = `sequence-ball ${color}`; chip.textContent = pad(number); ui.liveSequence.appendChild(chip);
}

function readResult(container) {
  return [...container.children].map(element => element.classList.contains('result-ball') ? Number(element.textContent) : null);
}

function getRoomSnapshot() {
  const lastNumber = ui.lastBall.classList.contains('empty') ? null : Number(ui.lastBall.textContent);
  return {
    drawInProgress, motionActive, phase, processIndex: currentProcessIndex, drawCounter,
    front: readResult(ui.front), back: readResult(ui.back), history,
    round: ui.round.textContent, title: ui.title.textContent, countdown: ui.countdown.textContent, counterCaption: ui.counterCaption.textContent,
    poolName: ui.poolName.textContent, poolRange: ui.poolRange.textContent, poolColor: phase === 'back' ? 'blue' : 'red',
    machineStatus: ui.machineStatus.textContent, currentPool: ui.currentPoolStat.textContent, remaining: ui.remainingCount.textContent,
    drawnCount: ui.drawnCount.textContent, elapsedMs: timerStarted ? performance.now() - timerStarted : 0,
    lastNumber, lastColor: ui.lastBall.classList.contains('blue') ? 'blue' : 'red', ballMessage: ui.ballMessage.textContent
  };
}

function broadcastSnapshot() {
  if (window.RoomSync?.role === 'host' && window.RoomSync.connected) window.RoomSync.send('snapshot', getRoomSnapshot());
}

function renderSyncedResults(container, values, color) {
  container.innerHTML = values.map(number => number == null ? '<span class="ball-placeholder">?</span>' : `<span class="result-ball ${color}" style="animation:none">${pad(number)}</span>`).join('');
}

function applyRoomSnapshot(state) {
  if (!state || window.RoomSync?.role !== 'remote') return;
  drawInProgress = Boolean(state.drawInProgress); motionActive = Boolean(state.motionActive); phase = state.phase || 'front'; drawCounter = Number(state.drawCounter) || 0;
  renderSyncedResults(ui.front, state.front || Array(5).fill(null), 'red'); renderSyncedResults(ui.back, state.back || Array(2).fill(null), 'blue');
  const poolColor = state.poolColor === 'blue' ? 'blue' : 'red', poolMax = poolColor === 'blue' ? 12 : 35;
  createBalls(poolMax, poolColor);
  const alreadyDrawn = poolColor === 'blue' ? (state.back || []) : (state.front || []); balls = balls.filter(ball => !alreadyDrawn.includes(ball.number));
  setProcess(Number(state.processIndex) || 0, !state.drawInProgress && state.machineStatus === '已完成'); setDrawingState(drawInProgress);
  ui.round.textContent = state.round || '联机同步'; ui.title.textContent = state.title || '等待主机'; ui.countdown.textContent = state.countdown || '—'; ui.counterCaption.textContent = state.counterCaption || '远程状态';
  ui.poolName.textContent = state.poolName || '前区号码池'; ui.poolRange.textContent = state.poolRange || '01—35'; ui.poolDot.style.background = `var(--${poolColor})`; ui.poolDot.style.boxShadow = `0 0 8px var(--${poolColor})`;
  ui.machineStatus.textContent = state.machineStatus || (drawInProgress ? '远程同步' : '待机'); ui.currentPoolStat.textContent = state.currentPool || '前区'; ui.remainingCount.textContent = state.remaining ?? '—'; ui.drawnCount.textContent = state.drawnCount || '0 / 7';
  ui.lastBall.className = state.lastNumber ? `preview-ball ${state.lastColor}` : 'preview-ball empty'; ui.lastBall.textContent = state.lastNumber ? pad(state.lastNumber) : '—'; ui.ballMessage.textContent = state.ballMessage || '等待主机出球';
  ui.liveSequence.innerHTML = '';
  [...(state.front || []), ...(state.back || [])].filter(number => number != null).forEach((number, index) => { const chip = document.createElement('span'); chip.className = `sequence-ball ${index < (state.front || []).filter(Boolean).length ? 'red' : 'blue'}`; chip.textContent = pad(number); ui.liveSequence.appendChild(chip); });
  if (!ui.liveSequence.children.length) ui.liveSequence.innerHTML = '<em>尚未出球</em>';
  if (Array.isArray(state.history)) { history = state.history; renderHistory(); }
  if (drawInProgress) startTimer(Number(state.elapsedMs) || 0); else { stopTimer(); ui.elapsedTime.textContent = formatElapsed(Number(state.elapsedMs) || 0); }
  ui.drawNo.textContent = `SIM-${String(drawInProgress ? drawCounter + 1 : Math.max(1, drawCounter)).padStart(3, '0')}`;
  ui.start.querySelector('span:last-child').textContent = drawInProgress ? '摇奖进行中' : '远程启动';
}

async function runDraw() {
  if (drawInProgress) return;
  const token = ++drawToken;
  drawInProgress = true; motionActive = true; placeholders(); resetConsole(); setDrawingState(true); startTimer();
  const front = sample(35, 5), back = sample(12, 2), short = ui.speed.checked || reducedMotion.matches;
  setProcess(0); ui.round.textContent = '系统准备 · 自检'; ui.title.textContent = '正在执行设备自检'; ui.countdown.textContent = 'CHECK'; ui.counterCaption.textContent = '设备状态';
  ui.poolName.textContent = '前区号码池'; ui.poolRange.textContent = '01—35'; ui.poolDot.style.background = 'var(--red)'; ui.poolDot.style.boxShadow = '0 0 8px var(--red)'; createBalls(35, 'red');
  broadcastSnapshot();
  await wait(short ? 220 : 650); if (token !== drawToken) return;
  setProcess(1); ui.round.textContent = '第一阶段 · 前区'; ui.title.textContent = '前区号码充分搅拌'; ui.countdown.textContent = '0 / 5'; ui.counterCaption.textContent = '准备出球';
  broadcastSnapshot();
  await wait(short ? 380 : 1050); if (token !== drawToken) return;
  setProcess(2); ui.title.textContent = '前区摇奖进行中'; ui.counterCaption.textContent = '已摇出';
  broadcastSnapshot();
  for (let i = 0; i < front.length; i++) { if (token !== drawToken) return; await extractAndReveal(ui.front, front[i], 'red', i, short); ui.countdown.textContent = `${i+1} / 5`; recordLiveBall(front[i], 'red', i + 1, i + 1); broadcastSnapshot(); await wait(short ? 300 : 650); }
  setProcess(3); ui.round.textContent = '号码池切换'; ui.title.textContent = '正在装载后区号码球'; ui.countdown.textContent = '—'; ui.counterCaption.textContent = '准备后区'; motionActive = false; ui.currentPoolStat.textContent = '切换中'; ui.remainingCount.textContent = '—';
  broadcastSnapshot();
  await wait(short ? 350 : 950); if (token !== drawToken) return; createBalls(12, 'blue'); motionActive = true;
  setProcess(4); ui.round.textContent = '第二阶段 · 后区'; ui.title.textContent = '后区摇奖进行中'; ui.countdown.textContent = '0 / 2'; ui.counterCaption.textContent = '已摇出'; ui.currentPoolStat.textContent = '后区'; ui.remainingCount.textContent = '12';
  ui.poolName.textContent = '后区号码池'; ui.poolRange.textContent = '01—12'; ui.poolDot.style.background = 'var(--blue)'; ui.poolDot.style.boxShadow = '0 0 8px var(--blue)';
  broadcastSnapshot();
  await wait(short ? 500 : 1350);
  for (let i = 0; i < back.length; i++) { if (token !== drawToken) return; await extractAndReveal(ui.back, back[i], 'blue', i, short); ui.countdown.textContent = `${i+1} / 2`; recordLiveBall(back[i], 'blue', i + 1, 6 + i); broadcastSnapshot(); await wait(short ? 320 : 700); }
  motionActive = false; drawInProgress = false; setDrawingState(false); ui.start.querySelector('span:last-child').textContent = '再摇一次';
  setProcess(5); stopTimer(); ui.machineStatus.textContent = '结果确认'; ui.round.textContent = '本次摇奖完成'; ui.title.textContent = '号码已全部产生'; ui.countdown.textContent = '完成'; ui.counterCaption.textContent = '本次摇奖';
  addHistory(front, back); ping(930); broadcastSnapshot();
  await wait(short ? 180 : 650); setProcess(5, true); ui.machineStatus.textContent = '已完成'; broadcastSnapshot();
}

function addHistory(front, back) {
  history.unshift({ id: ++drawCounter, front, back, time: new Date().toISOString() }); history = history.slice(0, 10); saveHistory(); renderHistory();
}

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(item => Array.isArray(item.front) && Array.isArray(item.back)).slice(0, 10) : [];
  } catch (_) { return []; }
}

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (_) {}
}

function renderHistory() {
  if (!history.length) { ui.history.innerHTML = '<div class="empty-state">完成一次摇奖后，号码会保存在这里</div>'; return; }
  ui.history.innerHTML = history.map(item => `<div class="history-item"><span class="history-index">#${pad(item.id)}</span><div class="history-balls">${item.front.map(n=>`<span class="mini-ball red">${pad(n)}</span>`).join('')}${item.back.map(n=>`<span class="mini-ball blue">${pad(n)}</span>`).join('')}</div><span class="history-time">${new Date(item.time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span></div>`).join('');
}

function setDrawingState(active) {
  ui.start.disabled = active; ui.reset.disabled = active; ui.speed.disabled = active;
  ui.reset.title = active ? '摇奖完成后可重置' : '重置';
  ui.stage.classList.toggle('is-running', active); ui.machineStatus.classList.toggle('running', active);
  if (active) ui.machineStatus.textContent = '运行中';
}

function reset() {
  if (drawInProgress) return;
  drawToken++; motionActive = false; placeholders(); createBalls(35, 'red'); ui.round.textContent = '准备就绪'; ui.title.textContent = '等待启动摇奖机'; ui.countdown.textContent = '—'; ui.counterCaption.textContent = '等待开始';
  ui.poolName.textContent = '前区号码池'; ui.poolRange.textContent = '01—35'; ui.poolDot.style.background = 'var(--red)'; ui.poolDot.style.boxShadow = '0 0 8px var(--red)';
  ui.start.querySelector('span:last-child').textContent = window.RoomSync?.role === 'remote' ? '远程启动' : '启动摇奖'; stopTimer(); resetConsole(); broadcastSnapshot();
}

ui.start.addEventListener('click', () => {
  if (window.RoomSync?.role === 'remote') { window.RoomSync.send('command', { action: 'start', fast: ui.speed.checked }); ui.start.disabled = true; ui.start.querySelector('span:last-child').textContent = '已发送，等待主机'; }
  else runDraw();
});
ui.reset.addEventListener('click', () => { if (window.RoomSync?.role === 'remote') window.RoomSync.send('command', { action: 'reset' }); else reset(); });
ui.sound.addEventListener('click', () => { muted = !muted; ui.sound.textContent = muted ? '×' : '♪'; ui.sound.classList.toggle('active', !muted); ui.sound.title = muted ? '声音已关闭' : '声音已开启'; ui.sound.setAttribute('aria-label', muted ? '开启声音' : '关闭声音'); ui.sound.setAttribute('aria-pressed', String(!muted)); });
ui.clear.addEventListener('click', () => { history = []; drawCounter = 0; saveHistory(); renderHistory(); ui.drawNo.textContent = 'SIM-001'; });
ui.speed.addEventListener('change', () => { if (window.RoomSync?.role === 'remote') window.RoomSync.send('command', { action: 'speed', value: ui.speed.checked }); else broadcastSnapshot(); });
window.addEventListener('resize', resize); document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else { cancelAnimationFrame(raf); physics(); } });
function updateClock() { ui.clock.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }); }
updateClock(); setInterval(updateClock, 1000);
window.RoomSync?.onMessage((type, data) => {
  if (type === 'sync-request' && window.RoomSync.role === 'host') broadcastSnapshot();
  if (type === 'snapshot' && window.RoomSync.role === 'remote') applyRoomSnapshot(data);
  if (type === 'command' && window.RoomSync.role === 'host') {
    if (data.action === 'start' && !drawInProgress) { ui.speed.checked = Boolean(data.fast); runDraw(); }
    if (data.action === 'reset' && !drawInProgress) reset();
    if (data.action === 'speed' && !drawInProgress) { ui.speed.checked = Boolean(data.value); broadcastSnapshot(); }
  }
  if (type === 'connection') {
    if (data.role === 'remote') ui.start.querySelector('span:last-child').textContent = '远程启动';
    if (data.status === 'offline') { ui.start.disabled = false; ui.start.querySelector('span:last-child').textContent = '启动摇奖'; }
  }
});
placeholders(); resize(); renderHistory(); resetConsole(); physics();
