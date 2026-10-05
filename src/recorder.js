// Records the canvas to a video file, for making teasers.
export class Recorder {
  constructor(canvas, onChange = () => {}) {
    this.canvas = canvas;
    this.onChange = onChange;
    this.recording = false;
  }

  start(seconds = 12, name = 'common-ground') {
    if (this.recording) return;
    const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(this.canvas.captureStream(60), { mimeType: type, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      this.recording = false;
      this.onChange(false);
    };
    rec.start();
    this.recording = true;
    this.onChange(true);
    setTimeout(() => rec.stop(), seconds * 1000);
  }
}
