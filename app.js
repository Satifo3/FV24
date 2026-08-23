const FPS = 24;

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const openBtn = $("openBtn");
const dropZone = $("dropZone");
const video = $("video");
const canvas = $("canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const fxCanvas = $("fxCanvas");
const fxCtx = fxCanvas.getContext("2d");
const gridCanvas = $("gridCanvas");
const gridCtx = gridCanvas.getContext("2d");
const emptyState = $("emptyState");
const hud = $("hud");
const frameHud = $("frameHud");
const timeHud = $("timeHud");
const timeline = $("timeline");
const currentFrameEl = $("currentFrame");
const totalFramesEl = $("totalFrames");
const sourceInfo = $("sourceInfo");
const playBtn = $("playBtn");
const saveStatus = $("saveStatus");

let mode = null; // video | gif
let currentFrame = 0;
let totalFrames = 0;
let stepFrames = 1;
let isPlaying = false;
let playTimer = null;
let objectUrl = null;
let tempObjectUrls = [];

let gifFrames = [];
let gifCanvas = null;
let gifCtx = null;
let gifTotalDurationMs = 0;
let gifWidth = 0;
let gifHeight = 0;
let exportFormat = "png";
const JPEG_QUALITY = 0.95;
let p3ExportSupported = false;
let gridEnabled = false;
let valueEnabled = false;
let gridType = "thirds";
let exportOverlays = true;

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

document.querySelectorAll(".format-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".format-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const requested = btn.dataset.format;
    exportFormat = ["png", "jpeg", "p3png"].includes(requested) ? requested : "png";
    updateSaveFormatUI();
  });
});

$("overlayCheck").addEventListener("change", e => {
  hud.hidden = !e.target.checked || !mode;
});

$("gridCheck").addEventListener("change", e => {
  gridEnabled = e.target.checked;
  $("gridOptions").classList.toggle("disabled", !gridEnabled);
  renderOverlays();
});

$("valueCheck").addEventListener("change", e => {
  valueEnabled = e.target.checked;
  renderOverlays();
});

$("exportOverlayCheck").addEventListener("change", e => {
  exportOverlays = e.target.checked;
});

document.querySelectorAll(".grid-type").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".grid-type").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    gridType = btn.dataset.grid || "thirds";
    renderOverlays();
  });
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
  dropZone.classList.remove("loaded");
  emptyState.hidden = false;
  hud.hidden = true;
  mode = null;
  gifFrames = [];
  gifTotalDurationMs = 0;
  gifWidth = 0;
  gifHeight = 0;
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;

  tempObjectUrls.forEach(url => {
    try { URL.revokeObjectURL(url); } catch (_) {}
  });
  tempObjectUrls = [];

  video.removeEventListener("seeked", drawVideoFrame);
  video.removeAttribute("src");
  video.load();
}

async function loadVideo(file) {
  mode = "video";

  const lower = file.name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() : "";

  // iPhoneで撮影したHEVC(H.265)は、一般にMOVまたはMP4コンテナ内の
  // hvc1 / hev1として保存される。このアプリではブラウザ/OSの
  // ネイティブデコーダーを利用して元解像度のまま読み込む。
  const hevcCapability = getHevcCapability();

  const candidates = [];
  const seenTypes = new Set();

  function addCandidate(blob, label) {
    const type = blob.type || "";
    const key = `${type}|${blob.size}|${label}`;
    if (seenTypes.has(key)) return;
    seenTypes.add(key);
    candidates.push({ blob, label });
  }

  // まずファイル本来のMIMEタイプを最優先。
  addCandidate(file, file.type || "original");

  // iOS/ファイルアプリ経由ではMIMEが空、または環境によって判定が揺れる
  // 場合があるため、コンテナ拡張子に応じたMIMEで再試行する。
  if (ext === "mov") {
    addCandidate(file.slice(0, file.size, "video/quicktime"), "video/quicktime");
    addCandidate(file.slice(0, file.size, "video/mp4"), "video/mp4 fallback");
  } else if (ext === "mp4" || ext === "m4v") {
    addCandidate(file.slice(0, file.size, "video/mp4"), "video/mp4");
    addCandidate(file.slice(0, file.size, "video/x-m4v"), "video/x-m4v");
    addCandidate(file.slice(0, file.size, "video/quicktime"), "video/quicktime fallback");
  } else {
    // 不明拡張子でも動画として渡された場合の安全な候補。
    if (!file.type) {
      addCandidate(file.slice(0, file.size, "video/mp4"), "video/mp4 fallback");
      addCandidate(file.slice(0, file.size, "video/quicktime"), "video/quicktime fallback");
    }
  }

  let loaded = false;
  let lastError = null;
  let usedLabel = "";

  for (const candidate of candidates) {
    try {
      const url = URL.createObjectURL(candidate.blob);
      tempObjectUrls.push(url);

      await loadVideoMetadataFromUrl(url);
      objectUrl = url;
      usedLabel = candidate.label;
      loaded = true;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!loaded) {
    mode = null;

    const hevcNote = hevcCapability
      ? "この端末はHEVC再生能力をブラウザが報告していますが、このファイルは読み込めませんでした。"
      : "この端末/ブラウザではHEVC(H.265)のネイティブ再生に対応していない可能性があります。";

    alert(
      "動画を読み込めませんでした。\n\n" +
      hevcNote +
      "\n\niPhone撮影動画は、MOVまたはMP4のHEVC(H.265)をそのまま選んでください。" +
      "\nPCではOSやブラウザにHEVCデコーダーが必要な場合があります。"
    );

    console.error("Video load failed:", lastError);
    return;
  }

  totalFrames = Math.max(1, Math.ceil(video.duration * FPS));
  setupCanvas(video.videoWidth, video.videoHeight);

  const hevcTag =
    (ext === "mov" || ext === "mp4" || ext === "m4v")
      ? ` / HEVC対応${hevcCapability ? "可" : "は端末依存"}`
      : "";

  sourceInfo.textContent =
    `${file.name} / ${video.videoWidth}×${video.videoHeight} / ` +
    `${formatDuration(video.duration)} / 24fps換算${hevcTag}`;

  showLoadedUI();

  video.removeEventListener("seeked", drawVideoFrame);
  video.addEventListener("seeked", drawVideoFrame);

  await seekVideoFrame(0);
}

function loadVideoMetadataFromUrl(url) {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(video.error || new Error("動画デコーダーがこのファイルを開けませんでした。"));
    };

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });

    video.src = url;
    video.load();
  });
}

function getHevcCapability() {
  const tests = [
    'video/mp4; codecs="hvc1"',
    'video/mp4; codecs="hev1"',
    'video/quicktime; codecs="hvc1"',
    'video/quicktime; codecs="hev1"'
  ];

  return tests.some(type => {
    try {
      return video.canPlayType(type) !== "";
    } catch (_) {
      return false;
    }
  });
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

  // GIFは各フレームが「差分パッチ」だけの場合があるため、
  // 1枚目のパッチサイズではなくGIF全体の論理解像度を使う。
  gifWidth = gif?.lsd?.width || Math.max(...frames.map(f => f.dims.left + f.dims.width));
  gifHeight = gif?.lsd?.height || Math.max(...frames.map(f => f.dims.top + f.dims.height));

  gifCanvas = document.createElement("canvas");
  gifCanvas.width = gifWidth;
  gifCanvas.height = gifHeight;
  gifCtx = gifCanvas.getContext("2d", { alpha: true });
  gifCtx.imageSmoothingEnabled = true;
  gifCtx.imageSmoothingQuality = "high";

  // GIFのdelayは通常 1/100秒単位相当。gifuct-jsはms相当で返す。
  gifTotalDurationMs = frames.reduce((sum, f) => sum + Math.max(10, f.delay || 100), 0);
  totalFrames = Math.max(1, Math.ceil((gifTotalDurationMs / 1000) * FPS));

  setupCanvas(gifWidth, gifHeight);
  sourceInfo.textContent = `${file.name} / ${gifWidth}×${gifHeight} / ${formatDuration(gifTotalDurationMs/1000)} / 24fps換算`;
  showLoadedUI();
  renderGifAtTime(0);
  updateUI();
}

function setupCanvas(w,h) {
  // canvasの内部解像度をソースそのものに合わせる。
  // CSSだけで画面サイズに縮小するので、4K等の元データは4Kのまま保持される。
  canvas.width = Math.max(1, Math.round(w || 1280));
  canvas.height = Math.max(1, Math.round(h || 720));
  canvas.style.display = "block";

  fxCanvas.width = canvas.width;
  fxCanvas.height = canvas.height;
  gridCanvas.width = canvas.width;
  gridCanvas.height = canvas.height;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  renderOverlays();
}

function showLoadedUI() {
  dropZone.classList.add("loaded");
  emptyState.hidden = true;
  hud.hidden = !$("overlayCheck").checked;
  timeline.max = Math.max(0,totalFrames - 1);
  goToFrame(0);
  renderOverlays();
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

  // デコードされた元動画のネイティブ解像度をそのままcanvasへコピーする。
  // プレビューはCSSで縮小表示されても、内部画素数は元動画のまま。
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0);
  renderOverlays();
}

function renderGifAtTime(seconds) {
  if (!gifFrames.length) return;

  const targetMs = Math.max(0, seconds * 1000);
  gifCtx.clearRect(0, 0, gifWidth, gifHeight);

  let elapsed = 0;
  let previousSnapshot = null;

  for (const f of gifFrames) {
    // disposalType=3（前の状態へ戻す）用に、描画前の状態を保持。
    let restoreSnapshot = null;
    if (f.disposalType === 3) {
      restoreSnapshot = gifCtx.getImageData(0, 0, gifWidth, gifHeight);
    }

    const imageData = new ImageData(
      new Uint8ClampedArray(f.patch),
      f.dims.width,
      f.dims.height
    );
    const patchCanvas = document.createElement("canvas");
    patchCanvas.width = f.dims.width;
    patchCanvas.height = f.dims.height;
    const patchCtx = patchCanvas.getContext("2d");
    patchCtx.putImageData(imageData, 0, 0);

    gifCtx.drawImage(patchCanvas, f.dims.left, f.dims.top);

    const delay = Math.max(10, f.delay || 100);
    elapsed += delay;

    // 今のフレームが指定時刻なら、この合成結果を表示。
    if (elapsed > targetMs) break;

    // 次フレームへ進む前にGIFのdisposal処理を適用。
    if (f.disposalType === 2) {
      gifCtx.clearRect(f.dims.left, f.dims.top, f.dims.width, f.dims.height);
    } else if (f.disposalType === 3 && restoreSnapshot) {
      gifCtx.putImageData(restoreSnapshot, 0, 0);
    }

    previousSnapshot = restoreSnapshot;
  }

  if (canvas.width !== gifWidth || canvas.height !== gifHeight) {
    setupCanvas(gifWidth, gifHeight);
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(gifCanvas, 0, 0);
  renderOverlays();
}


function renderOverlays() {
  if (!canvas.width || !canvas.height) return;

  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);

  // バリュー確認:
  // CSS filterではなく、画素データを直接グレースケール化する。
  // これによりブラウザ差で「モノクロにならない」問題を避ける。
  if (valueEnabled && mode) {
    try {
      fxCtx.drawImage(canvas, 0, 0);

      const imageData = fxCtx.getImageData(0, 0, fxCanvas.width, fxCanvas.height);
      const d = imageData.data;

      for (let i = 0; i < d.length; i += 4) {
        // Rec.709に近い輝度係数
        const y = Math.round(
          d[i] * 0.2126 +
          d[i + 1] * 0.7152 +
          d[i + 2] * 0.0722
        );
        d[i] = y;
        d[i + 1] = y;
        d[i + 2] = y;
      }

      fxCtx.putImageData(imageData, 0, 0);
    } catch (err) {
      console.warn("Value/grayscale render failed:", err);

      // 万一getImageDataが使えない環境ではfilterへフォールバック
      fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
      fxCtx.save();
      fxCtx.filter = "grayscale(100%)";
      fxCtx.drawImage(canvas, 0, 0);
      fxCtx.restore();
    }
  }

  if (gridEnabled && mode) {
    drawSelectedGrid();
  }
}
function drawSelectedGrid() {
  const w = gridCanvas.width;
  const h = gridCanvas.height;
  if (!w || !h) return;

  gridCtx.save();
  gridCtx.clearRect(0, 0, w, h);
  gridCtx.strokeStyle = "rgba(255, 84, 84, 0.92)";
  gridCtx.lineWidth = Math.max(2, Math.min(w, h) / 700);
  gridCtx.lineCap = "round";
  gridCtx.lineJoin = "round";

  if (gridType === "phi") {
    drawPhiGrid(w, h);
  } else if (gridType === "spiral") {
    drawFibonacciSpiral(w, h);
  } else {
    drawThirdsGrid(w, h);
  }

  gridCtx.restore();
}

function drawThirdsGrid(w, h) {
  [1/3, 2/3].forEach(r => {
    line(r*w, 0, r*w, h);
    line(0, r*h, w, r*h);
  });
}

function drawPhiGrid(w, h) {
  const a = 0.38196601125;
  const b = 0.61803398875;

  [a, b].forEach(r => {
    line(r*w, 0, r*w, h);
    line(0, r*h, w, r*h);
  });
}

function drawFibonacciSpiral(w, h) {
  const phi = (1 + Math.sqrt(5)) / 2;

  // 映像内に収まる黄金長方形を中央に配置
  let rectW = w;
  let rectH = rectW / phi;

  if (rectH > h) {
    rectH = h;
    rectW = rectH * phi;
  }

  const x0 = (w - rectW) / 2;
  const y0 = (h - rectH) / 2;

  // ガイド用の黄金長方形 + 黄金分割線
  gridCtx.save();
  gridCtx.globalAlpha = 0.48;
  gridCtx.strokeRect(x0, y0, rectW, rectH);

  // 黄金比で分割した補助線
  let x = x0;
  let y = y0;
  let rw = rectW;
  let rh = rectH;
  let dir = 0;

  for (let i = 0; i < 7; i++) {
    if (dir === 0) {
      const s = rh;
      line(x + s, y, x + s, y + rh);
      x += s;
      rw -= s;
    } else if (dir === 1) {
      const s = rw;
      line(x, y + s, x + rw, y + s);
      y += s;
      rh -= s;
    } else if (dir === 2) {
      const s = rh;
      line(x + rw - s, y, x + rw - s, y + rh);
      rw -= s;
    } else {
      const s = rw;
      line(x, y + rh - s, x + rw, y + rh - s);
      rh -= s;
    }

    dir = (dir + 1) % 4;
    if (rw <= 1 || rh <= 1) break;
  }

  gridCtx.restore();

  // きれいな黄金スパイラル:
  // r = a * e^(bθ), 四分円ごとに半径が1/phiになるよう設定
  const thetaMax = Math.PI * 4.5;
  const b = -Math.log(phi) / (Math.PI / 2);

  // 右上寄りの黄金点を中心にして、見た目が自然に収まるよう調整
  const cx = x0 + rectW * 0.61803398875;
  const cy = y0 + rectH * 0.38196601125;
  const maxR = Math.min(rectW, rectH) * 0.95;

  gridCtx.beginPath();

  const steps = 420;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * thetaMax;
    const r = maxR * Math.exp(b * t);
    const a = t + Math.PI * 0.08;

    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;

    if (i === 0) gridCtx.moveTo(px, py);
    else gridCtx.lineTo(px, py);
  }

  gridCtx.stroke();
}
function line(x1, y1, x2, y2) {
  gridCtx.beginPath();
  gridCtx.moveTo(x1, y1);
  gridCtx.lineTo(x2, y2);
  gridCtx.stroke();
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

async function saveCurrentFrame() {
  if (!mode) return;

  const isJpeg = exportFormat === "jpeg";
  const isP3 = exportFormat === "p3png";

  const extension = isJpeg ? "jpg" : "png";
  const mimeType = isJpeg ? "image/jpeg" : "image/png";
  const formatLabel = isJpeg ? "JPEG" : (isP3 ? "HDR/P3 PNG" : "PNG");
  const fileName = `frame_${String(currentFrame + 1).padStart(6,"0")}_24fps${isP3 ? "_P3" : ""}.${extension}`;

  setSaveStatus(`元解像度 ${canvas.width}×${canvas.height} で${formatLabel}を準備しています…`);

  try {
    // 書き出し専用キャンバスを作る。
    // 元動画は一切変更せず、必要な場合だけバリュー/グリッドを合成。
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = canvas.width;
    compositeCanvas.height = canvas.height;

    let compositeCtx;

    if (isP3) {
      if (!p3ExportSupported) {
        throw new Error("このブラウザはDisplay-P3 Canvas書き出しに対応していません。");
      }

      compositeCtx = compositeCanvas.getContext("2d", {
        alpha: false,
        colorSpace: "display-p3"
      });

      if (!compositeCtx) {
        throw new Error("Display-P3 Canvasを作成できませんでした。");
      }
    } else {
      compositeCtx = compositeCanvas.getContext("2d", { alpha: false });
    }

    compositeCtx.fillStyle = "#000";
    compositeCtx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    compositeCtx.drawImage(canvas, 0, 0);

    if (exportOverlays) {
      // バリューは元映像の上に完全なモノクロ画像として合成
      if (valueEnabled) {
        compositeCtx.drawImage(fxCanvas, 0, 0);
      }

      // グリッドは最後に最前面へ合成
      if (gridEnabled) {
        compositeCtx.drawImage(gridCanvas, 0, 0);
      }
    }

    let exportCanvas = compositeCanvas;

    if (isJpeg) {
      const jpegCanvas = document.createElement("canvas");
      jpegCanvas.width = compositeCanvas.width;
      jpegCanvas.height = compositeCanvas.height;
      const jpegCtx = jpegCanvas.getContext("2d", { alpha: false });
      jpegCtx.fillStyle = "#000";
      jpegCtx.fillRect(0, 0, jpegCanvas.width, jpegCanvas.height);
      jpegCtx.drawImage(compositeCanvas, 0, 0);
      exportCanvas = jpegCanvas;
    }

    const blob = await canvasToBlob(
      exportCanvas,
      mimeType,
      isJpeg ? JPEG_QUALITY : undefined
    );

    if (!blob) throw new Error(`${formatLabel}画像を作成できませんでした。`);

    if ("showSaveFilePicker" in window) {
      try {
        const pickerTypes = isJpeg
          ? [{
              description: "JPEG画像",
              accept: { "image/jpeg": [".jpg", ".jpeg"] }
            }]
          : [{
              description: isP3 ? "Display-P3 PNG画像" : "PNG画像",
              accept: { "image/png": [".png"] }
            }];

        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: pickerTypes
        });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();

        setSaveStatus(
          `指定した保存先に ${canvas.width}×${canvas.height} の${formatLabel}を保存しました。`,
          "ok"
        );
        return;
      } catch (err) {
        if (err?.name === "AbortError") {
          setSaveStatus("保存をキャンセルしました。");
          return;
        }
        console.warn("File picker failed:", err);
      }
    }

    const file = new File([blob], fileName, { type: mimeType });

    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      try {
        await navigator.share({
          files: [file],
          title: fileName
        });

        setSaveStatus(
          `共有シートへ ${canvas.width}×${canvas.height} の${formatLabel}を渡しました。`,
          "ok"
        );
        return;
      } catch (err) {
        if (err?.name === "AbortError") {
          setSaveStatus("保存をキャンセルしました。");
          return;
        }
        console.warn("Share failed:", err);
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    setSaveStatus(
      `ブラウザのダウンロード機能で ${canvas.width}×${canvas.height} の${formatLabel}を保存しました。`,
      "ok"
    );
  } catch (err) {
    console.error(err);
    setSaveStatus(`保存できませんでした: ${err.message || err}`, "error");
    alert(err.message || "画像を保存できませんでした。");
  }
}
function canvasToBlob(targetCanvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    try {
      targetCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("画像データの生成に失敗しました。"));
      }, type, quality);
    } catch (err) {
      reject(err);
    }
  });
}

function updateSaveFormatUI() {
  const isJpeg = exportFormat === "jpeg";
  const isP3 = exportFormat === "p3png";

  const label = isJpeg ? "JPEG" : (isP3 ? "HDR/P3" : "PNG");
  $("saveBtn").textContent = `保存先を選んで${label}保存`;

  if (isJpeg) {
    $("saveHelp").textContent =
      "元解像度のままJPEG保存します。チェックON時は表示中のグリッド / バリューも合成します。";
  } else if (isP3) {
    $("saveHelp").textContent =
      "対応端末ではDisplay-P3 PNGとして保存します。チェックON時は表示中のグリッド / バリューも合成します。";
  } else {
    $("saveHelp").textContent =
      "元解像度のままPNG保存します。チェックON時は表示中のグリッド / バリューも合成します。";
  }
}

function setSaveStatus(message, kind = "") {
  if (!saveStatus) return;
  saveStatus.textContent = message;
  saveStatus.className = `save-status ${kind}`.trim();
}

function formatDuration(s) {
  if (!Number.isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}


function detectP3ExportSupport() {
  const el = $("hdrCapability");

  try {
    const testCanvas = document.createElement("canvas");
    testCanvas.width = 2;
    testCanvas.height = 2;

    const testCtx = testCanvas.getContext("2d", {
      colorSpace: "display-p3"
    });

    const attrs = testCtx?.getContextAttributes?.();
    p3ExportSupported = !!testCtx && (!attrs?.colorSpace || attrs.colorSpace === "display-p3");

    if (p3ExportSupported) {
      el.textContent = "HDR/P3書き出し対応：Display-P3 Canvasを利用できます。";
      el.className = "hdr-capability ok";
    } else {
      el.textContent = "HDR/P3書き出し非対応：このブラウザでは通常PNG/JPEGを使用してください。";
      el.className = "hdr-capability warn";
    }
  } catch (_) {
    p3ExportSupported = false;
    el.textContent = "HDR/P3書き出し非対応：このブラウザでは通常PNG/JPEGを使用してください。";
    el.className = "hdr-capability warn";
  }
}

detectP3ExportSupport();

updateSaveFormatUI();
