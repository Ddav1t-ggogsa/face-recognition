const GAME_DURATION = 45;
const STARTING_LIVES = 3;
const STAR_POINTS = 10;

const elements = {
  canvas: document.querySelector("#game-canvas"),
  wrap: document.querySelector("#playfield-wrap"),
  video: document.querySelector("#camera"),
  faceCanvas: document.querySelector("#face-overlay"),
  preview: document.querySelector("#camera-preview"),
  cameraLabel: document.querySelector("#camera-label"),
  liveDot: document.querySelector("#live-dot"),
  faceStatus: document.querySelector("#face-status"),
  status: document.querySelector("#status-text"),
  overlay: document.querySelector("#game-overlay"),
  overlayIcon: document.querySelector("#overlay-icon"),
  overlayTitle: document.querySelector("#overlay-title"),
  overlayCopy: document.querySelector("#overlay-copy"),
  countdown: document.querySelector("#countdown"),
  score: document.querySelector("#score-value"),
  best: document.querySelector("#best-value"),
  timer: document.querySelector("#timer-value"),
  lives: document.querySelector("#lives-value"),
  button: document.querySelector("#play-button"),
  buttonText: document.querySelector("#button-text"),
  gameTip: document.querySelector("#game-tip")
};

const context = elements.canvas.getContext("2d");
let detector;
let stream;
let running = false;
let score = 0;
let lives = STARTING_LIVES;
let best = Number(localStorage.getItem("starcatcher-best") || 0);
let playerX = 0.5;
let targetX = 0.5;
let entities = [];
let particles = [];
let lastFrame = 0;
let lastDetection = 0;
let lastSpawn = 0;
let startedAt = 0;
let remaining = GAME_DURATION;
let animationFrame;
let countdownTimer;
let keys = new Set();
let detectionInFlight = false;

elements.best.textContent = String(best).padStart(3, "0");
elements.score.textContent = "000";
resizeCanvas();
window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);
window.addEventListener("blur", () => keys.clear());

elements.button.addEventListener("click", async () => {
  if (running) {
    endGame();
    return;
  }

  elements.button.disabled = true;
  elements.buttonText.textContent = "GETTING READY…";
  elements.status.textContent = "Starting your camera and loading the face model…";

  try {
    await startCamera();
    await loadDetector();
    await startCountdown();
  } catch (error) {
    console.error("Could not start Star Catcher:", error);
    stopCamera();
    showSetupError(error);
  } finally {
    elements.button.disabled = false;
  }
});

function resizeCanvas() {
  const bounds = elements.canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  elements.canvas.width = Math.round(bounds.width * ratio);
  elements.canvas.height = Math.round(bounds.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access requires HTTPS or localhost in a supported browser.");
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
  });
  elements.video.srcObject = stream;
  await new Promise((resolve) => {
    if (elements.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
    } else {
      elements.video.addEventListener("loadedmetadata", resolve, { once: true });
    }
  });
  await elements.video.play();
  elements.preview.classList.add("is-active");
  elements.liveDot.classList.add("is-live");
  elements.cameraLabel.textContent = "CAMERA LIVE";
}

async function loadDetector() {
  if (detector) return;
  if (!window.tf || !window.faceLandmarksDetection) {
    throw new Error("TensorFlow.js or the face-landmarks-detection library did not load.");
  }
  if (typeof window.FaceMesh !== "function") {
    throw new Error("The MediaPipe face-mesh model did not load.");
  }
  detector = await faceLandmarksDetection.createDetector(
    faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
    {
      runtime: "mediapipe",
      solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619",
      refineLandmarks: true,
      maxFaces: 1
    }
  );
}

function showSetupError(error) {
  const cameraError = ["NotAllowedError", "NotFoundError", "NotReadableError", "SecurityError"].includes(error.name);
  elements.overlay.classList.remove("is-hidden");
  elements.overlayIcon.textContent = "!";
  elements.overlayTitle.textContent = cameraError ? "Camera access needed" : "Could not load the face model";
  elements.overlayCopy.textContent = cameraError
    ? "Allow camera access in your browser settings, then try again."
    : "Check your internet connection and try again.";
  elements.status.textContent = cameraError
    ? "Camera access is unavailable. Check your browser permissions."
    : "The AI model failed to load.";
  elements.buttonText.textContent = "TRY AGAIN";
}

async function startCountdown() {
  elements.button.disabled = true;
  elements.overlay.classList.add("is-hidden");
  elements.countdown.textContent = "3";
  await wait(700);
  elements.countdown.textContent = "2";
  await wait(700);
  elements.countdown.textContent = "1";
  await wait(700);
  elements.countdown.textContent = "GO!";
  await wait(350);
  elements.countdown.textContent = "";
  elements.button.disabled = false;
  startGame();
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    countdownTimer = window.setTimeout(resolve, milliseconds);
  });
}

function startGame() {
  running = true;
  score = 0;
  lives = STARTING_LIVES;
  remaining = GAME_DURATION;
  playerX = 0.5;
  targetX = 0.5;
  entities = [];
  particles = [];
  lastFrame = performance.now();
  lastDetection = 0;
  lastSpawn = lastFrame;
  startedAt = lastFrame;
  elements.score.textContent = "000";
  elements.timer.textContent = String(GAME_DURATION);
  elements.lives.textContent = "♥ ♥ ♥";
  elements.buttonText.textContent = "END GAME";
  elements.status.textContent = "Move your head left and right to steer.";
  elements.faceStatus.textContent = "LOOKING";
  elements.gameTip.textContent = "← MOVE YOUR HEAD →";
  animationFrame = requestAnimationFrame(gameLoop);
}

async function gameLoop(timestamp) {
  if (!running) return;
  const delta = Math.min((timestamp - lastFrame) / 1000, 0.05);
  lastFrame = timestamp;

  if (timestamp - lastDetection > 90) {
    lastDetection = timestamp;
    detectFace();
  }

  if (keys.has("ArrowLeft") || keys.has("a")) targetX -= delta * 1.3;
  if (keys.has("ArrowRight") || keys.has("d")) targetX += delta * 1.3;
  targetX = clamp(targetX, 0.06, 0.94);
  playerX += (targetX - playerX) * Math.min(delta * 9, 1);

  remaining = Math.max(0, GAME_DURATION - Math.floor((timestamp - startedAt) / 1000));
  elements.timer.textContent = String(remaining);
  if (remaining === 0 || lives <= 0) {
    endGame();
    return;
  }

  updateEntities(delta, timestamp);
  drawGame(timestamp);
  updateParticles(delta);
  animationFrame = requestAnimationFrame(gameLoop);
}

async function detectFace() {
  if (!running || detectionInFlight || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  detectionInFlight = true;
  try {
    const faces = await detector.estimateFaces(elements.video, { flipHorizontal: false });
    if (!running) return;
    const face = faces[0];
    if (!face) {
      elements.faceStatus.textContent = "NO FACE";
      elements.status.textContent = "No face found. Move closer and face the camera.";
      clearFaceOverlay();
      return;
    }

    const box = face.box;
    const centerX = box && Number.isFinite(box.xMin) && Number.isFinite(box.xMax)
      ? (box.xMin + box.xMax) / 2
      : face.keypoints[1]?.x;
    if (!Number.isFinite(centerX)) {
      elements.faceStatus.textContent = "FACE POSITION UNAVAILABLE";
      elements.status.textContent = "Face found, but its position could not be read. Try again.";
      return;
    }
    if (!keys.has("ArrowLeft") && !keys.has("ArrowRight") && !keys.has("a") && !keys.has("d")) {
      targetX = clamp(1 - centerX / elements.video.videoWidth, 0.06, 0.94);
    }
    elements.faceStatus.textContent = "TRACKING";
    elements.status.textContent = "Nice! Catch stars and dodge the rocks.";
    drawFace(face);
  } catch (error) {
    console.error("Face tracking failed:", error);
    elements.faceStatus.textContent = "TRACKING PAUSED";
    elements.status.textContent = "Face tracking paused. Use the arrow keys to steer.";
  } finally {
    detectionInFlight = false;
  }
}

function updateEntities(delta, timestamp) {
  const difficulty = 1 + (GAME_DURATION - remaining) / 30;
  const spawnDelay = Math.max(330, 760 - difficulty * 95);
  if (timestamp - lastSpawn > spawnDelay) {
    const isRock = Math.random() < 0.29;
    entities.push({
      type: isRock ? "rock" : "star",
      x: 0.05 + Math.random() * 0.9,
      y: -0.07,
      size: isRock ? 13 + Math.random() * 7 : 10 + Math.random() * 5,
      speed: (isRock ? 0.34 : 0.29) + Math.random() * 0.15 + difficulty * 0.04,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 3
    });
    lastSpawn = timestamp;
  }

  const width = elements.canvas.clientWidth;
  const height = elements.canvas.clientHeight;
  const basketX = playerX * width;
  const basketY = height - 46;

  for (let index = entities.length - 1; index >= 0; index -= 1) {
    const entity = entities[index];
    entity.y += entity.speed * delta;
    entity.rotation += entity.spin * delta;
    const x = entity.x * width;
    const y = entity.y * height;
    if (Math.abs(x - basketX) < entity.size + 28 && Math.abs(y - basketY) < entity.size + 21) {
      entities.splice(index, 1);
      if (entity.type === "star") {
        score += STAR_POINTS;
        elements.score.textContent = String(score).padStart(3, "0");
        burst(x, y, "#ffe27a");
      } else {
        lives -= 1;
        elements.lives.textContent = "♥ ".repeat(Math.max(0, lives)).trim() || "—";
        burst(x, y, "#b7a3ff");
        elements.wrap.classList.remove("hit");
        void elements.wrap.offsetWidth;
        elements.wrap.classList.add("hit");
      }
    } else if (entity.y > 1.1) {
      entities.splice(index, 1);
    }
  }
}

function drawGame(timestamp) {
  const width = elements.canvas.clientWidth;
  const height = elements.canvas.clientHeight;
  context.clearRect(0, 0, width, height);
  drawStarsBackground(width, height, timestamp);
  for (const entity of entities) drawEntity(entity, width, height);
  drawPlayer(playerX * width, height - 46, timestamp);
}

function drawStarsBackground(width, height, timestamp) {
  context.fillStyle = "#11121f";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(201, 202, 255, .48)";
  for (let i = 0; i < 38; i += 1) {
    const x = (i * 157.3) % width;
    const y = (i * 89.7 + timestamp * (i % 3 + 1) * 0.008) % height;
    const size = i % 7 === 0 ? 1.5 : 0.8;
    context.globalAlpha = 0.3 + (Math.sin(timestamp * 0.002 + i) + 1) * 0.24;
    context.fillRect(x, y, size, size);
  }
  context.globalAlpha = 1;
}

function drawEntity(entity, width, height) {
  const x = entity.x * width;
  const y = entity.y * height;
  context.save();
  context.translate(x, y);
  context.rotate(entity.rotation);
  if (entity.type === "star") {
    context.shadowColor = "#ffe27a";
    context.shadowBlur = 17;
    context.fillStyle = "#ffe27a";
    context.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const radius = point % 2 === 0 ? entity.size : entity.size * 0.43;
      const angle = point * Math.PI / 5 - Math.PI / 2;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (point === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.fill();
  } else {
    context.shadowColor = "rgba(176, 150, 255, .45)";
    context.shadowBlur = 12;
    context.fillStyle = "#7466a9";
    context.strokeStyle = "#b5a3f3";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(-entity.size * 0.8, -entity.size * 0.2);
    context.lineTo(-entity.size * 0.25, -entity.size);
    context.lineTo(entity.size * 0.65, -entity.size * 0.7);
    context.lineTo(entity.size, entity.size * 0.25);
    context.lineTo(entity.size * 0.2, entity.size * 0.85);
    context.lineTo(-entity.size * 0.7, entity.size * 0.65);
    context.closePath();
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawPlayer(x, y, timestamp) {
  context.save();
  context.translate(x, y);
  context.shadowColor = "#90e5f4";
  context.shadowBlur = 22;
  context.fillStyle = "#83dbea";
  context.strokeStyle = "#d5fbff";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(0, -23);
  context.lineTo(27, 16);
  context.lineTo(11, 12);
  context.lineTo(0, 19 + Math.sin(timestamp * 0.018) * 2);
  context.lineTo(-11, 12);
  context.lineTo(-27, 16);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function burst(x, y, color) {
  for (let i = 0; i < 11; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 30 + Math.random() * 85;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.45, color });
  }
}

function updateParticles(delta) {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.life -= delta;
    if (particle.life <= 0) {
      particles.splice(index, 1);
      continue;
    }
    context.globalAlpha = particle.life / 0.45;
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, 2.2, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

function drawFace(face) {
  const canvas = elements.faceCanvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  const scale = Math.max(width / elements.video.videoWidth, height / elements.video.videoHeight);
  const offsetX = (width - elements.video.videoWidth * scale) / 2;
  const offsetY = (height - elements.video.videoHeight * scale) / 2;
  ctx.fillStyle = "rgba(196, 242, 119, .76)";
  for (const point of face.keypoints) {
    ctx.beginPath();
    ctx.arc(point.x * scale + offsetX, point.y * scale + offsetY, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function clearFaceOverlay() {
  elements.faceCanvas.getContext("2d").clearRect(0, 0, elements.faceCanvas.width, elements.faceCanvas.height);
}

function endGame() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(animationFrame);
  stopCamera();
  clearFaceOverlay();
  elements.preview.classList.remove("is-active");
  elements.liveDot.classList.remove("is-live");
  elements.cameraLabel.textContent = "CAMERA OFF";
  elements.faceStatus.textContent = "GAME OVER";
  elements.countdown.textContent = "";
  elements.overlay.classList.remove("is-hidden");
  elements.overlayIcon.textContent = score > best ? "★" : "✦";
  elements.overlayTitle.textContent = lives <= 0 ? "Ship wrecked!" : "Run complete!";
  elements.overlayCopy.textContent = "You caught " + score + " points worth of stars. " +
    (score > best ? "New personal best! Go again?" : "Think you can beat that?");
  elements.status.textContent = "Game over. Your camera is off; your score is " + score + ".";
  elements.gameTip.textContent = "NICE RUN!";
  elements.buttonText.textContent = "PLAY AGAIN";
  if (score > best) {
    best = score;
    localStorage.setItem("starcatcher-best", String(best));
    elements.best.textContent = String(best).padStart(3, "0");
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  elements.video.srcObject = null;
}

function handleKeyDown(event) {
  if (["ArrowLeft", "ArrowRight", "a", "d"].includes(event.key)) {
    event.preventDefault();
    keys.add(event.key);
  }
}

function handleKeyUp(event) {
  keys.delete(event.key);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
