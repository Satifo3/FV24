const FPS = 24;

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const openBtn = $("openBtn");
const dropZone = $("dropZone");
const video = $("video");
const canvas = $("canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const emptyState = $("emptyState");
const hud = $("hud");
const frameHud = $("frameHud");
const timeHud = $("timeHud");
const timeline = $("timeline");
const currentFrameEl = $("currentFrame");
const totalFramesEl = $("totalFrames");
const sourceInfo = $("sourceInfo");
const playBtn = $("playBtn");

let mode = null; // video | gif
let currentFrame = 0;
let totalFrames = 0;
let stepFrames = 1;
let isPlaying = false;
let playTimer = null;
let objectUrl = null;

let gifFrames = [];
let gifCanvas = null;
let gifCtx = null;
let gifTotalDurationMs = 0;

openBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  if (e.target.files?.[0]) loadFile(e.target.files[0]);
});

["dragenter","dragover"].forEach(evt => dropZone.addEventListener(evt, e => {
  e.preventDefault();
  dropZone.classList.add("drag");
}));
["dragleave","drop"].forEach(evt => dropZone.addEventListener(evt, e => {
  e.preventDefault();
  dropZone.classList.remove("drag");
}));
dropZone.addEventListener("drop", e => {
  const f = e.dataTransfer.files?.[0];
  if (f) loadFile(f);
});

$("prevBtn").addEventListener("click", () => goToFrame(currentFrame - stepFrames));
$("nextBtn").addEventListener("click", () => goToFrame(currentFrame + stepFrames));
$("firstBtn").addEventListener("click", () => goToFrame(0));
$("lastBtn").addEventListener("click", () => goToFrame(Math.max(0,totalFrames - 1)));
playBtn.addEventListener("click", togglePlay);
$("saveBtn").addEventListener("click", saveCurrentFrame);

document.querySelectorAll(".step").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".step").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    stepFrames = Number(btn.dataset.step);
  });
});

$("overlayCheck").addEventListener("change", e => {
  hud.hidden = !e.target.checked || !mode;
});

timeline.addEventListener("input", () => {
  pausePlayback();
  goToFrame(Number(timeline.value));
});

document.addEventListener("keydown", e => {
  if (!mode || ["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); goToFrame(currentFrame - stepFrames); }
  if (e.key === "ArrowRight") { e.preventDefault(); goToFrame(currentFrame + stepFrames); }
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
});

async function loadFile(file) {
  pausePlayback();
  clearSource();

  const lower = file.name.toLowerCase();
  if (file.type === "image/gif" || lower.endsWith(".gif")) {
    await loadGif(file);
  } else {
    await loadVideo(file);
  }
}

function clearSource() {
  mode = null;
  gifFrames = [];
  gifTotalDurationMs = 0;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  video.removeAttribute("src");
  video.load();
}

async function loadVideo(file) {
  mode = "video";
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("この動画形式をブラウザで再生できません。"));
  }).catch(err => {
    alert(err.message + "\nMP4(H.264)またはWebMで試してください。");
    mode = null;
  });

  if (!mode) return;

  totalFrames = Math.max(1, Math.ceil(video.duration * FPS));
  setupCanvas(video.videoWidth, video.videoHeight);
  sourceInfo.textContent = `${file.name} / ${formatDuration(video.duration)} / 24fps換算`;
  showLoadedUI();

  video.addEventListener("seeked", drawVideoFrame);
  await seekVideoFrame(0);
}

async function loadGif(file) {
  mode = "gif";
  if (!window.gifuctjs) {
    alert("GIFデコーダーの読み込みに失敗しました。インターネット接続を確認してください。");
    mode = null;
    return;
  }

  const buf = await file.arrayBuffer();
  const gif = gifuctjs.parseGIF(buf);
  const frames = gifuctjs.decompressFrames(gif, true);
  if (!frames.length) {
    alert("GIFのフレームを読み取れませんでした。");
    mode = null;
    return;
  }

  gifFrames = frames;
  const w = frames[0].dims.width;
  const h = frames[0].dims.height;
  gifCanvas = document.createElement("canvas");
  gifCanvas.width = w;
  gifCanvas.height = h;
  gifCtx = gifCanvas.getContext("2d");

  // GIFのdelayは通常 1/100秒単位相当。gifuct-jsはms相当で返す。
  gifTotalDurationMs = frames.reduce((sum, f) => sum + Math.max(10, f.delay || 100), 0);
  totalFrames = Math.max(1, Math.ceil((gifTotalDurationMs / 1000) * FPS));

  setupCanvas(w, h);
  sourceInfo.textContent = `${file.name} / ${formatDuration(gifTotalDurationMs/1000)} / 24fps換算`;
  showLoadedUI();
  renderGifAtTime(0);
  updateUI();
}

function setupCanvas(w,h) {
  canvas.width = w || 1280;
  canvas.height = h || 720;
  canvas.style.display = "block";
  ctx.fillStyle = "#000";
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

function showLoadedUI() {
  emptyState.hidden = true;
  hud.hidden = !$("overlayCheck").checked;
  timeline.max = Math.max(0,totalFrames - 1);
  goToFrame(0);
}

function clampFrame(n) {
  return Math.max(0, Math.min(totalFrames - 1, Math.round(n)));
}

async function goToFrame(frame) {
  if (!mode) return;
  currentFrame = clampFrame(frame);

  if (mode === "video") {
    await seekVideoFrame(currentFrame);
  } else {
    const t = currentFrame / FPS;
    renderGifAtTime(t);
  }
  updateUI();
}

function seekVideoFrame(frame) {
  return new Promise(resolve => {
    const target = Math.min(video.duration || 0, frame / FPS);
    if (Math.abs(video.currentTime - target) < 0.0005) {
      drawVideoFrame();
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener("seeked", done);
      drawVideoFrame();
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = target;
  });
}

function drawVideoFrame() {
  if (!video.videoWidth) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    setupCanvas(video.videoWidth, video.videoHeight);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

function renderGifAtTime(seconds) {
  if (!gifFrames.length) return;

  const targetMs = Math.max(0, seconds * 1000);
  gifCtx.clearRect(0,0,gifCanvas.width,gifCanvas.height);

  let elapsed = 0;
  for (const f of gifFrames) {
    if (f.disposalType === 2) {
      // Disposal is applied after the frame duration. For this lightweight viewer
      // we redraw progressively; most reference GIFs work as expected.
    }
    const imageData = new ImageData(
      new Uint8ClampedArray(f.patch),
      f.dims.width,
      f.dims.height
    );
    const patchCanvas = document.createElement("canvas");
    patchCanvas.width = f.dims.width;
    patchCanvas.height = f.dims.height;
    patchCanvas.getContext("2d").putImageData(imageData,0,0);
    gifCtx.drawImage(patchCanvas, f.dims.left, f.dims.top);

    elapsed += Math.max(10, f.delay || 100);
    if (elapsed > targetMs) break;
  }

  ctx.drawImage(gifCanvas, 0, 0, canvas.width, canvas.height);
}

function updateUI() {
  timeline.value = currentFrame;
  const shownFrame = currentFrame + 1;
  currentFrameEl.textContent = `${String(shownFrame).padStart(6,"0")} F`;
  totalFramesEl.textContent = `/ ${String(totalFrames).padStart(6,"0")} F`;
  frameHud.textContent = `F ${String(shownFrame).padStart(6,"0")}`;

  const totalSeconds = currentFrame / FPS;
  const wholeSec = Math.floor(totalSeconds);
  const frameInSec = currentFrame % FPS;
  const min = Math.floor(wholeSec / 60);
  const sec = wholeSec % 60;
  timeHud.textContent = `${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")} + ${String(frameInSec).padStart(2,"0")}`;
}

function togglePlay() {
  if (!mode) return;
  if (isPlaying) pausePlayback();
  else startPlayback();
}

function startPlayback() {
  if (currentFrame >= totalFrames - 1) currentFrame = 0;
  isPlaying = true;
  playBtn.textContent = "Ⅱ";

  let nextAt = performance.now();
  const frameMs = 1000 / FPS;

  const tick = async () => {
    if (!isPlaying) return;
    const now = performance.now();
    if (now >= nextAt) {
      nextAt += frameMs;
      if (currentFrame >= totalFrames - 1) {
        pausePlayback();
        return;
      }
      await goToFrame(currentFrame + 1);
    }
    playTimer = requestAnimationFrame(tick);
  };
  playTimer = requestAnimationFrame(tick);
}

function pausePlayback() {
  isPlaying = false;
  playBtn.textContent = "▶";
  if (playTimer) cancelAnimationFrame(playTimer);
  playTimer = null;
}

function saveCurrentFrame() {
  if (!mode) return;
  const a = document.createElement("a");
  a.download = `frame_${String(currentFrame + 1).padStart(6,"0")}_24fps.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

function formatDuration(s) {
  if (!Number.isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
