// Webcam hand tracking with MediaPipe. Pinch thumb and index finger together
// to pick up a creature; open them to let go.

const VERSION = '1.0.1';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const THUMB_TIP = 4, INDEX_TIP = 8, WRIST = 0, MIDDLE_KNUCKLE = 9;
const PINCH_ON = 0.33, PINCH_OFF = 0.5; // thumb–index gap, relative to hand size
const EDGE = 0.1;                      // the outer 10% of the camera view maps to the screen edge
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export class HandTracker {
  constructor({ video, overlay, onStatus = () => {} }) {
    this.video = video;
    this.overlay = overlay;
    this.onStatus = onStatus;
    this.running = false;
    this.hands = []; // [{ id, x, y, pinching }] in 0–1 screen coordinates
    this.lastVideoTime = -1;
  }

  async start() {
    this.onStatus('Loading hand tracking…');
    const { FilesetResolver, HandLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
    this.landmarker = await HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    this.onStatus('Waiting for camera permission…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.onStatus('Pinch to pick up a creature.');
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
    this.landmarker = null;
    this.hands = [];
    const ctx = this.overlay.getContext('2d');
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  update(now) {
    const v = this.video;
    if (!this.running || v.readyState < 2 || v.currentTime === this.lastVideoTime) return this.hands;
    this.lastVideoTime = v.currentTime;
    const result = this.landmarker.detectForVideo(v, now);
    const vw = v.videoWidth, vh = v.videoHeight;

    const seen = [];
    const labels = {};
    result.landmarks.forEach((lm, i) => {
      const label = result.handedness[i]?.[0]?.categoryName ?? 'Hand';
      labels[label] = (labels[label] ?? -1) + 1;
      const id = `${label}${labels[label]}`;
      const prev = this.hands.find((h) => h.id === id);

      const px = (a) => [lm[a].x * vw, lm[a].y * vh];
      const [tx, ty] = px(THUMB_TIP), [ix, iy] = px(INDEX_TIP);
      const [wx, wy] = px(WRIST), [mx, my] = px(MIDDLE_KNUCKLE);
      const ratio = Math.hypot(tx - ix, ty - iy) / Math.max(1, Math.hypot(wx - mx, wy - my));
      const pinching = prev?.pinching ? ratio < PINCH_OFF : ratio < PINCH_ON;

      // Pinch point, mirrored like a mirror, stretched so the screen edges are reachable.
      const nx = 1 - (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2;
      const ny = (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2;
      let x = Math.min(1, Math.max(0, (nx - EDGE) / (1 - 2 * EDGE)));
      let y = Math.min(1, Math.max(0, (ny - EDGE) / (1 - 2 * EDGE)));
      if (prev) {
        x = prev.x + (x - prev.x) * 0.55;
        y = prev.y + (y - prev.y) * 0.55;
      }
      seen.push({ id, x, y, pinching });
    });
    this.hands = seen;
    this.drawOverlay(result);
    return this.hands;
  }

  // Skeleton over the little camera preview (the preview itself is mirrored by CSS).
  drawOverlay(result) {
    const c = this.overlay, ctx = c.getContext('2d');
    c.width = c.clientWidth * devicePixelRatio;
    c.height = c.clientHeight * devicePixelRatio;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2 * devicePixelRatio;
    result.landmarks.forEach((lm, i) => {
      ctx.strokeStyle = this.hands[i]?.pinching ? '#ffd28a' : 'rgba(240, 235, 220, 0.85)';
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo((1 - lm[a].x) * c.width, lm[a].y * c.height);
        ctx.lineTo((1 - lm[b].x) * c.width, lm[b].y * c.height);
      }
      ctx.stroke();
    });
  }
}
