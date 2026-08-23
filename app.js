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
let gridColor = "#ff4b4b";
let gridOpacity = 0.68;

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

const mobilePrevBtn = $("mobilePrevBtn");
const mobilePlayBtn = $("mobilePlayBtn");
const mobileNextBtn = $("mobileNextBtn");
const mobileGridToggle = $("mobileGridToggle");
const mobileValueToggle = $("mobileValueToggle");

mobilePrevBtn?.addEventListener("click", () => goToFrame(currentFrame - stepFrames));
mobileNextBtn?.addEventListener("click", () => goToFrame(currentFrame + stepFrames));
mobilePlayBtn?.addEventListener("click", togglePlay);

mobileGridToggle?.addEventListener("click", () => {
  const cb = $("gridCheck");
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event("change"));
  updateMobileQuickState();
});

mobileValueToggle?.addEventListener("click", () => {
  const cb = $("valueCheck");
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event("change"));
  updateMobileQuickState();
});

document.querySelectorAll(".mobile-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.mobilePanel;

    document.querySelectorAll(".mobile-tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".mobile-panel").forEach(p => p.classList.remove("active-mobile-panel"));

    btn.classList.add("active");
    document.querySelector(`.${target}`)?.classList.add("active-mobile-panel");
  });
});

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
  updateMobileQuickState();
});

$("gridColor").addEventListener("input", e => {
  gridColor = normalizeHexColor(e.target.value);
  renderOverlays();
});

$("gridOpacity").addEventListener("input", e => {
  gridOpacity = Math.max(0.2, Math.min(1, Number(e.target.value) / 100));
  $("gridOpacityValue").textContent = `${Math.round(gridOpacity * 100)}%`;
  renderOverlays();
});

document.querySelectorAll(".color-preset").forEach(btn => {
  btn.addEventListener("click", () => {
    const color = normalizeHexColor(btn.dataset.color || "#ff4b4b");
    gridColor = color;
    $("gridColor").value = color;
    renderOverlays();
  });
});

$("valueCheck").addEventListener("change", e => {
  valueEnabled = e.target.checked;
  renderOverlays();
  updateMobileQuickState();
});

$("exportOverlayCheck").addEventListener("change", e => {
  exportOverlays = e.target.checked;
});

document.querySelectorAll(".grid-type").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".grid-type").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    gridType = btn.dataset.grid === "phi" ? "phi" : "thirds";
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

  updateViewerAspectRatio(canvas.width, canvas.height);
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


function updateViewerAspectRatio(w, h) {
  if (!w || !h) return;

  // PCは従来UIを維持。スマホだけ動画の実アスペクト比で高さを決める。
  if (window.matchMedia("(max-width: 900px)").matches) {
    dropZone.style.aspectRatio = `${w} / ${h}`;
  } else {
    dropZone.style.aspectRatio = "";
  }
}

window.addEventListener("resize", () => {
  if (canvas.width && canvas.height) {
    updateViewerAspectRatio(canvas.width, canvas.height);
  }
});

function renderOverlays() {
  if (!canvas.width || !canvas.height) return;

  const analysisOn = !!mode && (valueEnabled || gridEnabled);
  dropZone.classList.toggle("has-analysis", analysisOn);

  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);

  if (!analysisOn) return;

  // プレビューと書き出しで同じ合成関数を使う。
  // これで「プレビューは効くが保存に出ない」「保存だけ色が戻る」を防ぐ。
  composeAnalyzedFrame(fxCtx, {
    value: valueEnabled,
    grid: gridEnabled,
    gridKind: gridType
  });
}

function composeAnalyzedFrame(targetCtx, options = {}) {
  const w = targetCtx.canvas.width;
  const h = targetCtx.canvas.height;
  const useValue = !!options.value;
  const useGrid = !!options.grid;
  const kind = options.gridKind || "thirds";

  targetCtx.save();
  targetCtx.clearRect(0, 0, w, h);
  targetCtx.globalCompositeOperation = "source-over";
  targetCtx.globalAlpha = 1;

  // まず元フレームをコピー
  targetCtx.drawImage(canvas, 0, 0, w, h);

  // バリュー：必ずRGB画素を直接モノクロ化する。
  // filterやCSSに依存しないのでプレビュー/書き出しとも同一結果になる。
  if (useValue) {
    const imageData = targetCtx.getImageData(0, 0, w, h);
    const p = imageData.data;

    for (let i = 0; i < p.length; i += 4) {
      // ITU-R BT.709 luminance
      const y = Math.max(0, Math.min(255, Math.round(
        p[i] * 0.2126 +
        p[i + 1] * 0.7152 +
        p[i + 2] * 0.0722
      )));
      p[i] = y;
      p[i + 1] = y;
      p[i + 2] = y;
      p[i + 3] = 255;
    }

    targetCtx.putImageData(imageData, 0, 0);
  }

  if (useGrid) {
    drawGridToContext(targetCtx, kind, w, h);
  }

  targetCtx.restore();
}

function normalizeHexColor(value) {
  const v = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "#ff4b4b";
}

function hexToRgba(hex, alpha) {
  const safe = normalizeHexColor(hex);
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  const a = Math.max(0, Math.min(1, Number(alpha)));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function drawGridToContext(g, kind, w, h) {
  g.save();
  g.strokeStyle = hexToRgba(gridColor, gridOpacity);
  g.lineWidth = Math.max(2, Math.min(w, h) / 650);
  g.lineCap = "round";
  g.lineJoin = "round";

  if (kind === "phi") {
    drawPhiGrid(g, w, h);
  } else {
    drawThirdsGrid(g, w, h);
  }

  g.restore();
}

function drawThirdsGrid(g, w, h) {
  [1/3, 2/3].forEach(r => {
    drawLine(g, r*w, 0, r*w, h);
    drawLine(g, 0, r*h, w, r*h);
  });
}

function drawPhiGrid(g, w, h) {
  const a = 1 / ((1 + Math.sqrt(5)) / 2 + 1); // 0.381966...
  const b = 1 - a;                             // 0.618034...

  [a, b].forEach(r => {
    drawLine(g, r*w, 0, r*w, h);
    drawLine(g, 0, r*h, w, r*h);
  });
}

function drawFibonacciSpiral(g, w, h) {
  // 参考画像と同じ「黄金長方形を正方形へ順番に分割し、
  // 各正方形へ1/4円弧を描く」構成。
  const PHI = (1 + Math.sqrt(5)) / 2;

  // 動画の中央に、最大サイズの黄金長方形を収める。
  let rw = w;
  let rh = rw / PHI;
  if (rh > h) {
    rh = h;
    rw = rh * PHI;
  }

  let x = (w - rw) / 2;
  let y = (h - rh) / 2;

  g.save();

  // 外枠と内部の分割線
  g.globalAlpha = 0.72;
  g.strokeRect(x, y, rw, rh);

  // dir:
  // 0 = 左の正方形を切る
  // 1 = 上の正方形を切る
  // 2 = 右の正方形を切る
  // 3 = 下の正方形を切る
  let dir = 0;
  const squares = [];

  for (let i = 0; i < 10; i++) {
    if (rw <= 2 || rh <= 2) break;

    if (rw >= rh) {
      const s = rh;

      if (dir === 0) {
        // 左側の正方形
        squares.push({ x, y, s, corner: "br", start: Math.PI, end: Math.PI * 1.5 });
        drawLine(g, x + s, y, x + s, y + rh);
        x += s;
        rw -= s;
      } else {
        // 右側の正方形
        squares.push({ x: x + rw - s, y, s, corner: "tl", start: 0, end: Math.PI * 0.5 });
        drawLine(g, x + rw - s, y, x + rw - s, y + rh);
        rw -= s;
      }
    } else {
      const s = rw;

      if (dir === 1) {
        // 上側の正方形
        squares.push({ x, y, s, corner: "bl", start: Math.PI * 1.5, end: Math.PI * 2 });
        drawLine(g, x, y + s, x + rw, y + s);
        y += s;
        rh -= s;
      } else {
        // 下側の正方形
        squares.push({ x, y: y + rh - s, s, corner: "tr", start: Math.PI * 0.5, end: Math.PI });
        drawLine(g, x, y + rh - s, x + rw, y + rh - s);
        rh -= s;
      }
    }

    dir = (dir + 1) % 4;
  }

  // 参考画像のように、それぞれの正方形に連続する1/4円弧を描く。
  g.globalAlpha = 1;
  g.beginPath();

  squares.forEach((sq, index) => {
    let cx, cy;

    switch (sq.corner) {
      case "br":
        cx = sq.x + sq.s;
        cy = sq.y + sq.s;
        break;
      case "bl":
        cx = sq.x;
        cy = sq.y + sq.s;
        break;
      case "tl":
        cx = sq.x;
        cy = sq.y;
        break;
      default: // tr
        cx = sq.x + sq.s;
        cy = sq.y;
        break;
    }

    const sx = cx + Math.cos(sq.start) * sq.s;
    const sy = cy + Math.sin(sq.start) * sq.s;

    if (index === 0) g.moveTo(sx, sy);
    else g.lineTo(sx, sy);

    g.arc(cx, cy, sq.s, sq.start, sq.end, false);
  });

  g.stroke();
  g.restore();
}

function drawLine(g, x1, y1, x2, y2) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function updateMobileQuickState() {
  if (mobileGridToggle) {
    mobileGridToggle.classList.toggle("active", gridEnabled);
  }
  if (mobileValueToggle) {
    mobileValueToggle.classList.toggle("active", valueEnabled);
  }
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
  if (mobilePlayBtn) mobilePlayBtn.textContent = "Ⅱ";

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
  if (mobilePlayBtn) mobilePlayBtn.textContent = "▶";
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
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;

    let exportCtx;

    if (isP3) {
      if (!p3ExportSupported) {
        throw new Error("このブラウザはDisplay-P3 Canvas書き出しに対応していません。");
      }

      exportCtx = exportCanvas.getContext("2d", {
        alpha: false,
        colorSpace: "display-p3"
      });
    } else {
      exportCtx = exportCanvas.getContext("2d", { alpha: false });
    }

    if (!exportCtx) {
      throw new Error("書き出し用Canvasを作成できませんでした。");
    }

    exportCtx.fillStyle = "#000";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    if (exportOverlays && (valueEnabled || gridEnabled)) {
      // プレビューと完全に同じ合成関数を使用。
      composeAnalyzedFrame(exportCtx, {
        value: valueEnabled,
        grid: gridEnabled,
        gridKind: gridType
      });
    } else {
      exportCtx.drawImage(canvas, 0, 0);
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
          ? [{ description: "JPEG画像", accept: { "image/jpeg": [".jpg", ".jpeg"] } }]
          : [{ description: isP3 ? "Display-P3 PNG画像" : "PNG画像", accept: { "image/png": [".png"] } }];

        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: pickerTypes
        });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();

        setSaveStatus(
          `保存完了：${canvas.width}×${canvas.height} ${formatLabel}` +
          `${exportOverlays && valueEnabled ? " / モノクロ" : ""}` +
          `${exportOverlays && gridEnabled ? " / グリッド込み" : ""}`,
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
        await navigator.share({ files: [file], title: fileName });
        setSaveStatus("共有シートへ画像を渡しました。", "ok");
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

    setSaveStatus("ブラウザのダウンロード機能で保存しました。", "ok");
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

updateMobileQuickState();
