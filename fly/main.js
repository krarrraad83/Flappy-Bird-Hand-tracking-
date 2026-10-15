// Game state constants
const STATE_INIT = 0;
const STATE_ERROR = 1;
const STATE_LOADING = 2;
const STATE_CALIBRATING = 3;
const STATE_WAITING = 4;
const STATE_PLAYING = 5;
const STATE_GAMEOVER = 6;
const STATE_PAUSED = 7;

let gameState = STATE_INIT;
let statusMessage = "INIT CAM";

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas.getContext('2d');
const videoElement = document.getElementById('webcam-video');
const fullscreenBtn = document.getElementById('fullscreen-btn');

let internalW = 480;
let internalH = 270;
canvas.width = internalW;
canvas.height = internalH;

let time = 0;
let lastTime = 0;

// Bird
let bird = { x: 96, y: 135, targetY: 135, radius: 6, angle: 0, frame: 0 };

// Pipes
let pipes = [];
let pipeWidth = 27;
let pipeSpeed = 1.8;
let minGap = 54;
let currentGap = 112;
let pipeSpawnTimer = 0;
let pipeSpawnInterval = 100;

// Score
let score = 0;
let bestScore = 0;
let speedMultiplier = 1;

// Hand tracking
let handDetected = false;
let landmarks = null;
let calibMinY = 1.0;
let calibMaxY = 0.0;
let calibTimer = 0;
let scrollX = 0;

try {
  let saved = localStorage.getItem('handFlappyBest');
  if (saved) bestScore = parseInt(saved, 10);
} catch(e) {}

// Fullscreen
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.body.requestFullscreen().catch(()=>{});
  } else {
    document.exitFullscreen();
  }
}
fullscreenBtn.addEventListener('click', toggleFullscreen);
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.innerText = document.fullscreenElement ? '🗗' : '⛶';
});

// Reset
function resetGame() {
  pipes = [];
  score = 0;
  speedMultiplier = 1;
  currentGap = 112;
  pipeSpawnTimer = 0;
  bird.y = 135;
  bird.targetY = 135;
  bird.angle = 0;
  scrollX = 0;
  gameState = STATE_PLAYING;
}

// MediaPipe
const hands = new Hands({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`;
}});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults((results) => {
  previewCanvas.width = videoElement.videoWidth;
  previewCanvas.height = videoElement.videoHeight;
  previewCtx.save();
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.drawImage(results.image, 0, 0, previewCanvas.width, previewCanvas.height);
  
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    handDetected = true;
    landmarks = results.multiHandLandmarks[0];
    drawConnectors(previewCtx, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
    drawLandmarks(previewCtx, landmarks, {color: '#FF0000', lineWidth: 1, radius: 2});
    handleHand(landmarks);
  } else {
    handDetected = false;
    landmarks = null;
  }
  previewCtx.restore();
});

function handleHand(lm) {
  const indexTip = lm[8];
  const thumbTip = lm[4];
  const dx = indexTip.x - thumbTip.x;
  const dy = indexTip.y - thumbTip.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const isPinching = dist < 0.05;

  if (gameState === STATE_CALIBRATING) {
    calibMinY = Math.min(calibMinY, indexTip.y);
    calibMaxY = Math.max(calibMaxY, indexTip.y);
  } else if (gameState === STATE_WAITING || gameState === STATE_GAMEOVER) {
    if (isPinching) resetGame();
  }

  if (calibMaxY > calibMinY) {
    let t = (indexTip.y - calibMinY) / (calibMaxY - calibMinY);
    t = Math.max(0, Math.min(1, t));
    // Safe bounds based on radius and ground height
    bird.targetY = 6 + t * (237 - 6);
  }
}

const camera = new Camera(videoElement, {
  onFrame: async () => {
    if (gameState === STATE_INIT || gameState === STATE_LOADING) {
      gameState = STATE_LOADING;
      statusMessage = "LOADING";
    }
    await hands.send({image: videoElement});
    
    if (gameState === STATE_LOADING) {
      gameState = STATE_CALIBRATING;
      calibMinY = 1.0;
      calibMaxY = 0.0;
      calibTimer = 3.0;
      lastTime = performance.now();
      requestAnimationFrame(gameLoop);
    }
  },
  width: 640,
  height: 480
});
camera.start().catch(err => {
  gameState = STATE_ERROR;
  statusMessage = "CAM ERROR";
});

// PRE-RENDER LOGIC
function createOffscreen(w, h, renderFn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  renderFn(cx, w, h);
  return c;
}

const bgLayers = {
  sky: createOffscreen(480, 270, (cx, w, h) => {
    for (let i = 0; i < 27; i++) {
      let t = i / 27;
      let r = 43 + (61 - 43) * t;
      let g = 45 + (106 - 45) * t;
      let b = 94 + (163 - 94) * t;
      cx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
      cx.fillRect(0, i * 10, w, 10);
    }
  }),
  clouds: createOffscreen(480, 50, (cx, w, h) => {
    cx.fillStyle = '#7bb0dc';
    for(let i=0; i<w; i+=10) cx.fillRect(i, h - (10+Math.random()*20), 15, 30);
  }),
  city: createOffscreen(480, 80, (cx, w, h) => {
    const colors = ['#4b5f8a', '#5d749c', '#8aa4cf'];
    for(let i=0; i<w; i+=20) {
      const bh = 20 + Math.random()*50;
      const bw = 15 + Math.random()*15;
      cx.fillStyle = colors[Math.floor(Math.random()*colors.length)];
      cx.fillRect(i, h - bh, bw, bh);
      cx.fillStyle = 'rgba(255,255,255,0.1)';
      cx.fillRect(i, h - bh, 2, bh);
    }
  }),
  bushes: createOffscreen(480, 30, (cx, w, h) => {
    for(let i=0; i<w; i+=8) {
      const bh = 15 + Math.random()*10;
      cx.fillStyle = '#55a770'; cx.fillRect(i, h - bh, 12, bh);
      cx.fillStyle = '#2e8b57'; cx.fillRect(i, h - bh + 2, 12, bh-2);
    }
  }),
  ground: createOffscreen(480, 27, (cx, w, h) => {
    cx.fillStyle = '#f8c590'; cx.fillRect(0, 0, w, h);
    cx.fillStyle = '#78c030'; cx.fillRect(0, 0, w, 8);
    cx.fillStyle = '#2d5a14'; cx.fillRect(0, 8, w, 2);
    for(let i=0; i<w; i+=16) {
       cx.fillRect(i, 0, 2, 8);
       cx.fillRect(i+8, 4, 2, 4);
    }
    cx.fillRect(0, 4, w, 2);
  }),
  pipe: createOffscreen(27, 300, (cx, w, h) => {
    cx.fillStyle = '#2d5a14'; cx.fillRect(0,0,w,h);
    cx.fillStyle = '#78c030'; cx.fillRect(1,0,w-2,h);
    cx.fillStyle = '#9ee254'; cx.fillRect(2,0,4,h);
    cx.fillStyle = '#55901c'; cx.fillRect(w-6,0,4,h);
  }),
  pipeCap: createOffscreen(33, 13, (cx, w, h) => {
    cx.fillStyle = '#2d5a14'; cx.fillRect(0,0,w,h);
    cx.fillStyle = '#78c030'; cx.fillRect(1,1,w-2,h-2);
    cx.fillStyle = '#9ee254'; cx.fillRect(2,1,4,h-2);
    cx.fillStyle = '#55901c'; cx.fillRect(w-6,1,4,h-2);
  })
};

// Bird art rendering (15x10 footprint)
const BIRD_COLORS = {'X': '#000000', 'O': '#f7b420', 'W': '#ffffff', 'B': '#000000', 'R': '#eb5628', 'P': '#fcebb6'};
const BIRD_ART = [
  ["   XXXXXXXX    ", "  XXOOOOOOXX   ", " XXOOOOOOOWWWX ", " XOOOOXXXXWWBX ", "XOWWWWWWWWWXXXX", "XOWWWWWWWXRRRRX", "XOWWWWWWWXRRRRX", " XOOOOOOOOOXXXX", " XXPPPPPPPPPX  ", "  XXXXXXXXXX   "],
  ["   XXXXXXXX    ", "  XXOOOOOOXX   ", " XXOOOOOOOWWWX ", " XOOOOOXXXWWBX ", "XOOOWWWWWWWXXXX", "XOWWWWWWWXRRRRX", "XOWWWWWWWXRRRRX", " XOOOOOOOOOXXXX", " XXPPPPPPPPPX  ", "  XXXXXXXXXX   "],
  ["   XXXXXXXX    ", "  XXOOOOOOXX   ", " XXOOOOOOOWWWX ", " XOOOOOXXXWWBX ", "XOOOOOOOOOOXXXX", "XOOOWWWWWXRRRRX", "XOWWWWWWWXRRRRX", " XOWWWWWWWWXXXX", " XXPPPPPPPPPX  ", "  XXXXXXXXXX   "]
];
const birdCanvases = [0,1,2].map(f => createOffscreen(15, 10, (cx) => {
  const art = BIRD_ART[f];
  for(let r=0; r<art.length; r++) {
    for(let c=0; c<art[r].length; c++) {
      if (BIRD_COLORS[art[r][c]]) {
        cx.fillStyle = BIRD_COLORS[art[r][c]];
        cx.fillRect(c, r, 1, 1);
      }
    }
  }
}));

// Stars & Ghosts arrays
let stars = [];
for(let i=0; i<40; i++) {
  stars.push({
    x: Math.random()*480, y: Math.random()*150,
    type: Math.random() < 0.2 ? 1 : 0,
    color: Math.random() < 0.1 ? '#8cb5ff' : (Math.random() < 0.5 ? '#ffe23a' : '#fff'),
    twinkle: Math.random() * Math.PI * 2, speed: 1 + Math.random()*2
  });
}
let ghosts = [
  {x: 100, y: 50, vx: 0.1, vy: 0.05, t: 0},
  {x: 300, y: 80, vx: 0.15, vy: 0.08, t: 2}
];

// Custom 5x7 Font map (drawn via fillRect)
const FONT = {
  '0': " 111 1   11   11   11   11   1 111 ", '1': "  1   11    1    1    1    1   111 ",
  '2': " 111 1   1    1   1   1   1   11111", '3': " 111 1   1    1  11     11   1 111 ",
  '4': "1   11   11   111111    1    1    1", '5': "111111    1111     1    11   1 111 ",
  '6': " 111 1   11    1111 1   11   1 111 ", '7': "11111    1   1   1    1    1    1  ",
  '8': " 111 1   11   1 111 1   11   1 111 ", '9': " 111 1   11   1 1111    11   1 111 ",
  'A': " 111 1   11   1111111   11   11   1", 'B': "1111 1   11111 1   11   11   11111 ",
  'C': " 111 1   11    1    1    1   1 111 ", 'D': "1111 1   11   11   11   11   11111 ",
  'E': "111111    1    111  1    1    11111", 'F': "111111    1    111  1    1    1    ",
  'G': " 111 1   11    1  111   11   1 111 ", 'H': "1   11   11   1111111   11   11   1",
  'I': " 111   1    1    1    1    1   111 ", 'L': "1    1    1    1    1    1    11111",
  'M': "1   111 111 1 11   11   11   11   1", 'N': "1   111  11 1 11  111   11   11   1",
  'O': " 111 1   11   11   11   11   1 111 ", 'P': "1111 1   11   11111 1    1    1    ",
  'R': "1111 1   11   11111 1  1 1   11   1", 'S': " 111 1   11    111    1  1   1 111 ",
  'T': "11111  1    1    1    1    1    1  ", 'U': "1   11   11   11   11   11   1 111 ",
  'V': "1   11   11   11   1 1 1   1   1   ", 'W': "1   11   11   11 1 1111111   1 1   ",
  'Y': "1   11   1 1 1   1    1    1    1  ", ' ': "                                   "
};

function drawText(cx, text, x, y, scale, align="center") {
  text = String(text).toUpperCase();
  const w = text.length * 6 * scale - scale;
  let startX = x;
  if (align === "center") startX = x - w/2;
  for (let i = 0; i < text.length; i++) {
    const map = FONT[text[i]];
    if (map) {
      for (let j = 0; j < 35; j++) {
        if (map[j] === '1') {
          cx.fillRect(Math.floor(startX + (j % 5) * scale), Math.floor(y + Math.floor(j / 5) * scale), scale, scale);
        }
      }
    }
    startX += 6 * scale;
  }
}

function drawTextWithOutline(cx, text, x, y, scale, align="center") {
  cx.fillStyle = '#000';
  for(let dx=-1; dx<=1; dx++) {
    for(let dy=-1; dy<=1; dy++) {
      if(dx!=0||dy!=0) drawText(cx, text, x+dx*scale, y+dy*scale, scale, align);
    }
  }
  // Subtle darker shadow offset
  drawText(cx, text, x+scale, y+scale, scale, align);
  
  cx.fillStyle = '#fff';
  drawText(cx, text, x, y, scale, align);
}

// UPDATE LOGIC
function update(dt) {
  const safeDt = Math.min(dt, 0.1);
  time += safeDt;
  
  if (gameState === STATE_CALIBRATING) {
    calibTimer -= safeDt;
    if (calibTimer <= 0) {
      if (calibMaxY - calibMinY < 0.1) { calibMinY = 0.2; calibMaxY = 0.8; }
      gameState = STATE_WAITING;
    }
  }
  
  if (gameState === STATE_PLAYING) {
    if (!handDetected) { gameState = STATE_PAUSED; return; }
    
    // Scroll world
    const dx = pipeSpeed * speedMultiplier * safeDt * 60;
    scrollX += dx;
    
    // Update Bird
    const nextY = bird.y + (bird.targetY - bird.y) * 15 * safeDt;
    const birdVy = (nextY - bird.y) / safeDt;
    bird.y = Math.max(bird.radius, Math.min(243 - bird.radius, nextY));
    
    const targetAngle = Math.max(-25, Math.min(70, birdVy * 0.2));
    bird.angle += (targetAngle - bird.angle) * 10 * safeDt;
    bird.frame = Math.floor(time * 10) % 3;
    
    // Update Pipes
    pipeSpawnTimer += safeDt * 60;
    if (pipeSpawnTimer >= pipeSpawnInterval) {
      pipeSpawnTimer = 0;
      currentGap = Math.max(minGap, currentGap - 1);
      speedMultiplier = 1 + Math.floor(score / 5) * 0.1;
      const gapY = Math.random() * (243 - currentGap - 40) + 20;
      pipes.push({ x: 480, gapTop: gapY, gapBottom: gapY + currentGap, passed: false });
    }
    
    for (let i = pipes.length - 1; i >= 0; i--) {
      let p = pipes[i];
      p.x -= dx;
      
      if (!p.passed && p.x + pipeWidth < bird.x - bird.radius) {
        p.passed = true;
        score++;
        if (score > bestScore) {
          bestScore = score;
          try { localStorage.setItem('handFlappyBest', bestScore); } catch(e){}
        }
      }
      
      const hb = bird.radius * 0.8;
      if (bird.x + hb > p.x && bird.x - hb < p.x + pipeWidth) {
        if (bird.y - hb < p.gapTop || bird.y + hb > p.gapBottom) gameState = STATE_GAMEOVER;
      }
      if (p.x + pipeWidth < 0) pipes.splice(i, 1);
    }
  }
  
  if (gameState === STATE_PAUSED && handDetected) gameState = STATE_PLAYING;
}

// RENDER LOGIC
function render() {
  ctx.drawImage(bgLayers.sky, 0, 0);
  
  // Draw Stars
  for(let s of stars) {
    const a = (Math.sin(s.twinkle + time * s.speed) + 1) / 2;
    ctx.fillStyle = s.color;
    ctx.globalAlpha = 0.5 + 0.5 * a;
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    if (s.type === 0) ctx.fillRect(x, y, 1, 1);
    else { ctx.fillRect(x+1, y, 1, 3); ctx.fillRect(x, y+1, 3, 1); }
  }
  ctx.globalAlpha = 1;
  
  // Draw Ghosts
  for(let g of ghosts) {
    g.x += g.vx; g.t += g.vy;
    if (g.x > 500) g.x = -20;
    const gx = Math.round(g.x);
    const gy = Math.round(g.y + Math.sin(g.t)*5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(gx+2, gy, 7, 1); ctx.fillRect(gx+1, gy+1, 9, 1);
    ctx.fillRect(gx, gy+2, 11, 7); ctx.fillRect(gx, gy+9, 2, 2);
    ctx.fillRect(gx+3, gy+9, 2, 2); ctx.fillRect(gx+6, gy+9, 2, 2); ctx.fillRect(gx+9, gy+9, 2, 2);
    ctx.fillStyle = '#000'; ctx.fillRect(gx+6, gy+3, 3, 3);
    ctx.fillStyle = '#fff'; ctx.fillRect(gx+7, gy+3, 1, 1);
  }
  
  // Parallax layers (scroll at different speeds)
  const clX = -(scrollX * 0.2) % 480;
  ctx.drawImage(bgLayers.clouds, Math.floor(clX), 130);
  ctx.drawImage(bgLayers.clouds, Math.floor(clX + 480), 130);
  
  const ciX = -(scrollX * 0.4) % 480;
  ctx.drawImage(bgLayers.city, Math.floor(ciX), 163);
  ctx.drawImage(bgLayers.city, Math.floor(ciX + 480), 163);
  
  const buX = -(scrollX * 0.7) % 480;
  ctx.drawImage(bgLayers.bushes, Math.floor(buX), 213);
  ctx.drawImage(bgLayers.bushes, Math.floor(buX + 480), 213);
  
  // Draw Pipes
  for (let p of pipes) {
    const bx = Math.round(p.x);
    // Bottom pipe
    const by = Math.round(p.gapBottom);
    ctx.drawImage(bgLayers.pipe, bx, by, 27, 270 - by);
    ctx.drawImage(bgLayers.pipeCap, bx - 3, by, 33, 13);
    // Top pipe
    const ty = Math.round(p.gapTop);
    ctx.drawImage(bgLayers.pipe, bx, ty - 300, 27, 300);
    ctx.save();
    ctx.translate(bx - 3, ty);
    ctx.scale(1, -1);
    ctx.drawImage(bgLayers.pipeCap, 0, 0, 33, 13);
    ctx.restore();
  }
  
  // Draw Ground (scrolls exactly with pipes)
  const grX = -scrollX % 480;
  ctx.drawImage(bgLayers.ground, Math.floor(grX), 243);
  ctx.drawImage(bgLayers.ground, Math.floor(grX + 480), 243);
  
  // Hide game during initialization
  if (gameState === STATE_INIT || gameState === STATE_ERROR || gameState === STATE_LOADING) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0,0,internalW,internalH);
    drawTextWithOutline(ctx, statusMessage, internalW/2, internalH/2 - 5, 2);
    return;
  }
  
  // Draw Bird (integer translation)
  if (gameState !== STATE_CALIBRATING) {
    ctx.save();
    ctx.translate(Math.round(bird.x), Math.round(bird.y));
    ctx.rotate(Math.round(bird.angle) * Math.PI / 180);
    ctx.drawImage(birdCanvases[bird.frame], -7, -5);
    ctx.restore();
  }
  
  // Overlays HUD
  if (gameState === STATE_CALIBRATING) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0,0,internalW,internalH);
    drawTextWithOutline(ctx, "CALIBRATION", internalW/2, internalH/2 - 20, 2);
    drawTextWithOutline(ctx, "RAISE AND LOWER HAND", internalW/2, internalH/2 + 5, 1);
    drawTextWithOutline(ctx, Math.ceil(calibTimer), internalW/2, internalH/2 + 20, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(internalW/2 - 20, calibMinY * internalH, 40, (calibMaxY - calibMinY) * internalH);
  } else if (gameState === STATE_WAITING) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0,0,internalW,internalH);
    drawTextWithOutline(ctx, "FLAPPY HAND", internalW/2, 50, 3);
    if (Math.floor(time * 2) % 2 === 0) drawTextWithOutline(ctx, "PINCH TO START", internalW/2, 180, 1);
  } else if (gameState === STATE_PLAYING || gameState === STATE_PAUSED) {
    drawTextWithOutline(ctx, score, internalW/2, 20, 3);
    if (gameState === STATE_PAUSED) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,internalW,internalH);
      drawTextWithOutline(ctx, "SHOW YOUR HAND", internalW/2, internalH/2, 2);
    }
  } else if (gameState === STATE_GAMEOVER) {
    const pw = 160, ph = 100;
    const px = Math.round(internalW/2 - pw/2), py = Math.round(internalH/2 - ph/2) - 10;
    
    // Game Over Panel Background
    ctx.fillStyle = '#f8c590'; ctx.fillRect(px, py, pw, ph);
    // Outer Borders
    ctx.fillStyle = '#4a2f1d';
    ctx.fillRect(px, py, pw, 2); ctx.fillRect(px, py+ph-2, pw, 2);
    ctx.fillRect(px, py, 2, ph); ctx.fillRect(px+pw-2, py, 2, ph);
    // Inner Borders
    ctx.fillRect(px+4, py+4, pw-8, 1); ctx.fillRect(px+4, py+ph-5, pw-8, 1);
    ctx.fillRect(px+4, py+4, 1, ph-8); ctx.fillRect(px+pw-5, py+4, 1, ph-8);
    
    // Panel Text
    drawTextWithOutline(ctx, "GAME OVER", internalW/2, py + 15, 2);
    drawTextWithOutline(ctx, "SCORE " + score, internalW/2, py + 45, 1);
    drawTextWithOutline(ctx, "BEST " + bestScore, internalW/2, py + 65, 1);
    
    if (Math.floor(time * 2) % 2 === 0) drawTextWithOutline(ctx, "PINCH TO PLAY AGAIN", internalW/2, py + ph + 20, 1);
  }
}

// GAME LOOP
function gameLoop(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}
