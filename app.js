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
const saveStatus = $("saveStatus");

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
let gifWidth = 0;
let gifHeight = 0;

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
  dropZone.classList.remove("loaded");
  emptyState.hidden = false;
  hud.hidden = true;
  mode = null;
  gifFrames = [];
  gifTotalDurationMs = 0;
  gifWidth = 0;
  gifHeight = 0;
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
  sourceInfo.textContent = `${file.name} / ${video.videoWidth}×${video.videoHeight} / ${formatDuration(video.duration)} / 24fps換算`;
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

function showLoadedUI() {
  dropZone.classList.add("loaded");
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

  // デコードされた元動画のネイティブ解像度をそのままcanvasへコピーする。
  // プレビューはCSSで縮小表示されても、内部画素数は元動画のまま。
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0);
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

  const fileName = `frame_${String(currentFrame + 1).padStart(6,"0")}_24fps.png`;
  setSaveStatus(`元解像度 ${canvas.width}×${canvas.height} でPNGを準備しています…`);

  try {
    const blob = await canvasToBlob(canvas, "image/png");
    if (!blob) throw new Error("PNG画像を作成できませんでした。");

    // PC版Chrome / Edgeなど:
    // ユーザーが保存フォルダとファイル名を直接選べる。
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: "PNG画像",
            accept: { "image/png": [".png"] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setSaveStatus(`指定した保存先に ${canvas.width}×${canvas.height} のPNGを保存しました。`, "ok");
        return;
      } catch (err) {
        if (err?.name === "AbortError") {
          setSaveStatus("保存をキャンセルしました。");
          return;
        }
        // File System Access APIが実装されていても利用不能な環境では
        // 下の共有シート方式へフォールバックする。
        console.warn("File picker failed:", err);
      }
    }

    const file = new File([blob], fileName, { type: "image/png" });

    // iPhone / iPad / Safari等:
    // Webサイト側から任意フォルダへ直接書き込むことはできないため、
    // OSの共有シートを開く。「ファイルに保存」を選ぶと保存先を指定できる。
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      try {
        await navigator.share({
          files: [file],
          title: fileName
        });
        setSaveStatus(`共有シートへ ${canvas.width}×${canvas.height} のPNGを渡しました。`, "ok");
        return;
      } catch (err) {
        if (err?.name === "AbortError") {
          setSaveStatus("保存をキャンセルしました。");
          return;
        }
        console.warn("Share failed:", err);
      }
    }

    // 最終フォールバック: 通常のブラウザダウンロード。
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setSaveStatus(`ブラウザのダウンロード機能で ${canvas.width}×${canvas.height} のPNGを保存しました。`, "ok");
  } catch (err) {
    console.error(err);
    setSaveStatus(`保存できませんでした: ${err.message || err}`, "error");
    alert("画像を保存できませんでした。別のブラウザでも試してください。");
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
