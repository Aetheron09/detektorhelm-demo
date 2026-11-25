const fileInput = document.querySelector("#file-input");
const chooseFileButton = document.querySelector("#choose-file");
const changeFileButton = document.querySelector("#change-file");
const uploadModeButton = document.querySelector("#upload-mode");
const cameraModeButton = document.querySelector("#camera-mode");
const imagePreview = document.querySelector("#image-preview");
const videoPreview = document.querySelector("#video-preview");
const overlay = document.querySelector("#overlay");
const stage = document.querySelector("#media-stage");
const emptyState = document.querySelector("#empty-state");
const emptyTitle = document.querySelector("#empty-title");
const emptyDescription = document.querySelector("#empty-description");
const cameraPlaceholder = document.querySelector("#camera-placeholder");
const cameraControls = document.querySelector("#camera-controls");
const startCameraButton = document.querySelector("#start-camera");
const stopCameraButton = document.querySelector("#stop-camera");
const processing = document.querySelector("#processing");
const processingText = document.querySelector("#processing-text");
const stageError = document.querySelector("#stage-error");
const healthPill = document.querySelector("#health-pill");
const healthText = document.querySelector("#health-text");
const resultCaption = document.querySelector("#result-caption");
const liveIndicator = document.querySelector("#live-indicator");
const helmetCount = document.querySelector("#helmet-count");
const noHelmetCount = document.querySelector("#no-helmet-count");
const totalCount = document.querySelector("#total-count");

let activeMode = "upload";
let cameraStream = null;
let animationFrame = null;
let lastFrameAt = 0;
let requestInFlight = false;
let pendingSource = null;
let mediaUrl = null;
let activeSource = null;

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    if (!response.ok || !health.ready) throw new Error("Model belum siap");
    healthPill.classList.add("ready");
    healthPill.classList.remove("error");
    healthText.textContent = `Model siap · ${health.model}`;
  } catch {
    healthPill.classList.add("error");
    healthPill.classList.remove("ready");
    healthText.textContent = "Server tidak terhubung";
  }
}

function setMode(mode) {
  stopCamera();
  stopVideoAnalysis();
  activeMode = mode;
  const isUpload = mode === "upload";
  uploadModeButton.classList.toggle("active", isUpload);
  cameraModeButton.classList.toggle("active", !isUpload);
  uploadModeButton.setAttribute("aria-selected", String(isUpload));
  cameraModeButton.setAttribute("aria-selected", String(!isUpload));
  cameraControls.hidden = isUpload;
  changeFileButton.hidden = !isUpload || !activeSource;
  emptyState.hidden = Boolean(activeSource) || !isUpload;
  cameraPlaceholder.hidden = isUpload || Boolean(cameraStream);
  imagePreview.hidden = true;
  videoPreview.hidden = true;
  activeSource = null;
  clearOverlay();
  resetCounts();
  clearError();
  liveIndicator.hidden = true;
  resultCaption.textContent = isUpload
    ? "Hasil deteksi akan muncul di sini"
    : "Mulai kamera untuk melihat deteksi langsung";
}

function resetCounts() {
  helmetCount.textContent = "—";
  noHelmetCount.textContent = "—";
  totalCount.textContent = "—";
}

function showError(message) {
  stageError.textContent = message;
  stageError.hidden = false;
}

function clearError() {
  stageError.hidden = true;
  stageError.textContent = "";
}

function clearOverlay() {
  const context = overlay.getContext("2d");
  context.clearRect(0, 0, overlay.width, overlay.height);
}

function setProcessing(visible, text = "Menganalisis...") {
  processing.hidden = !visible;
  processingText.textContent = text;
}

function setMediaDimensions(width, height) {
  const maxWidth = Math.min(stage.clientWidth - 32, 900);
  const maxHeight = Math.min(window.innerHeight * 0.65, 590);
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const displayWidth = Math.round(width * scale);
  const displayHeight = Math.round(height * scale);
  const media = activeSource;
  media.style.width = `${displayWidth}px`;
  media.style.height = `${displayHeight}px`;
}

function drawDetections(result) {
  const bounds = stage.getBoundingClientRect();
  const mediaBounds = activeSource.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  overlay.width = Math.round(bounds.width * ratio);
  overlay.height = Math.round(bounds.height * ratio);
  const context = overlay.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);

  const offsetX = mediaBounds.left - bounds.left;
  const offsetY = mediaBounds.top - bounds.top;
  const scaleX = mediaBounds.width / result.width;
  const scaleY = mediaBounds.height / result.height;
  const counts = { helmet: 0, no_helmet: 0 };

  for (const detection of result.detections) {
    const isHelmet = detection.label === "helmet";
    const color = isHelmet ? "#a4e65e" : "#ff7772";
    const [x1, y1, x2, y2] = detection.box;
    const x = offsetX + x1 * scaleX;
    const y = offsetY + y1 * scaleY;
    const width = (x2 - x1) * scaleX;
    const height = (y2 - y1) * scaleY;
    const label = isHelmet ? "HELMET" : "NO HELMET";
    const tag = `${label} ${(detection.confidence * 100).toFixed(0)}%`;

    counts[isHelmet ? "helmet" : "no_helmet"] += 1;
    context.lineWidth = 2;
    context.strokeStyle = color;
    context.strokeRect(x, y, width, height);
    context.font = "600 11px DM Sans, sans-serif";
    const tagWidth = context.measureText(tag).width + 12;
    const tagY = Math.max(0, y - 22);
    context.fillStyle = color;
    context.fillRect(x, tagY, tagWidth, 20);
    context.fillStyle = "#111510";
    context.fillText(tag, x + 6, tagY + 14);
  }

  helmetCount.textContent = String(counts.helmet);
  noHelmetCount.textContent = String(counts.no_helmet);
  totalCount.textContent = String(result.detections.length);
  resultCaption.textContent = result.detections.length
    ? `${result.detections.length} objek terdeteksi pada frame ini`
    : "Tidak ada objek terdeteksi pada frame ini";
}

async function requestDetection(blob) {
  const body = new FormData();
  body.append("file", blob, "frame.jpg");
  const response = await fetch("/api/detect", { method: "POST", body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Deteksi gagal (${response.status})`);
  }
  return response.json();
}

function captureFrame(source) {
  const width = source.videoWidth || source.naturalWidth;
  const height = source.videoHeight || source.naturalHeight;
  if (!width || !height) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
}

async function analyzeSource(source, showSpinner = true) {
  if (source !== activeSource) return;
  if (requestInFlight) {
    pendingSource = source;
    return;
  }
  requestInFlight = true;
  if (showSpinner) setProcessing(true);
  try {
    const blob = await captureFrame(source);
    if (!blob) return;
    const result = await requestDetection(blob);
    if (source !== activeSource) return;
    setMediaDimensions(result.width, result.height);
    drawDetections(result);
    clearError();
  } catch (error) {
    if (source === activeSource) showError(error.message);
  } finally {
    requestInFlight = false;
    if (showSpinner) setProcessing(false);
    const nextSource = pendingSource;
    pendingSource = null;
    if (nextSource === activeSource) {
      analyzeSource(nextSource, nextSource === imagePreview);
    }
  }
}

function openFilePicker() {
  fileInput.click();
}

chooseFileButton.addEventListener("click", openFilePicker);
changeFileButton.addEventListener("click", openFilePicker);

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  stopVideoAnalysis();
  stopCamera();
  clearError();
  clearOverlay();
  resetCounts();
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = URL.createObjectURL(file);
  emptyState.hidden = true;
  cameraPlaceholder.hidden = true;
  changeFileButton.hidden = false;
  activeMode = "upload";
  activeSource = null;

  if (file.type.startsWith("image/")) {
    imagePreview.hidden = false;
    videoPreview.hidden = true;
    activeSource = imagePreview;
    imagePreview.onload = () => {
      setMediaDimensions(imagePreview.naturalWidth, imagePreview.naturalHeight);
      setProcessing(true);
      analyzeSource(imagePreview).finally(() => setProcessing(false));
    };
    imagePreview.src = mediaUrl;
  } else if (file.type.startsWith("video/")) {
    imagePreview.hidden = true;
    videoPreview.hidden = false;
    activeSource = videoPreview;
    videoPreview.onloadedmetadata = () => {
      setMediaDimensions(videoPreview.videoWidth, videoPreview.videoHeight);
      videoPreview.play().catch(() => {});
      liveIndicator.hidden = false;
      resultCaption.textContent = "Menganalisis frame video";
      runVideoAnalysis();
    };
    videoPreview.src = mediaUrl;
    videoPreview.load();
  } else {
    activeSource = null;
    emptyState.hidden = false;
    showError("Pilih file gambar atau video yang didukung.");
  }

  fileInput.value = "";
});

function runVideoAnalysis() {
  const tick = (now) => {
    if (activeMode !== "upload" || activeSource !== videoPreview || videoPreview.paused || videoPreview.ended) {
      animationFrame = null;
      return;
    }
    if (now - lastFrameAt > 650 && !requestInFlight) {
      lastFrameAt = now;
      analyzeSource(videoPreview, false);
    }
    animationFrame = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(tick);
}

function stopVideoAnalysis() {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (videoPreview.src) videoPreview.pause();
}

videoPreview.addEventListener("play", () => {
  if (activeSource === videoPreview) runVideoAnalysis();
});
videoPreview.addEventListener("pause", () => {
  if (activeSource === videoPreview && !videoPreview.ended) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
});

async function startCamera() {
  clearError();
  if (!navigator.mediaDevices?.getUserMedia) {
    showError("Browser ini tidak mendukung akses kamera. Buka melalui localhost atau HTTPS.");
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    videoPreview.onloadedmetadata = () => {
      setMediaDimensions(videoPreview.videoWidth, videoPreview.videoHeight);
      runCameraAnalysis();
    };
    videoPreview.srcObject = cameraStream;
    videoPreview.controls = false;
    videoPreview.hidden = false;
    cameraPlaceholder.hidden = true;
    activeSource = videoPreview;
    startCameraButton.hidden = true;
    stopCameraButton.hidden = false;
    liveIndicator.hidden = false;
    resultCaption.textContent = "Menganalisis frame kamera";
    await videoPreview.play();
    if (videoPreview.videoWidth) {
      setMediaDimensions(videoPreview.videoWidth, videoPreview.videoHeight);
      runCameraAnalysis();
    }
  } catch (error) {
    stopCamera();
    showError(error.name === "NotAllowedError"
      ? "Akses kamera ditolak. Izinkan kamera di pengaturan browser."
      : `Kamera tidak dapat dimulai: ${error.message}`);
  }
}

function runCameraAnalysis() {
  const tick = (now) => {
    if (!cameraStream || activeSource !== videoPreview) {
      animationFrame = null;
      return;
    }
    if (now - lastFrameAt > 650 && !requestInFlight) {
      lastFrameAt = now;
      analyzeSource(videoPreview, false);
    }
    animationFrame = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(tick);
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  if (videoPreview.srcObject) videoPreview.srcObject = null;
  if (activeMode === "camera") {
    videoPreview.hidden = true;
    cameraPlaceholder.hidden = false;
    startCameraButton.hidden = false;
    stopCameraButton.hidden = true;
    liveIndicator.hidden = true;
  }
  cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

startCameraButton.addEventListener("click", startCamera);
stopCameraButton.addEventListener("click", () => {
  stopCamera();
  activeSource = null;
  clearOverlay();
  resetCounts();
  resultCaption.textContent = "Mulai kamera untuk melihat deteksi langsung";
});
uploadModeButton.addEventListener("click", () => setMode("upload"));
cameraModeButton.addEventListener("click", () => setMode("camera"));

window.addEventListener("resize", () => {
  if (activeSource) {
    const width = activeSource.videoWidth || activeSource.naturalWidth;
    const height = activeSource.videoHeight || activeSource.naturalHeight;
    if (width && height) setMediaDimensions(width, height);
  }
});

setMode("upload");
checkHealth();
