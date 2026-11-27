// Watermark and Image Resolution Downscaler for Meter Photos
// Version 1.6 - Downscales resolution to 720px with Top Header Bar and exports standard JPEG (.jpg) for 100% LINE Image Bubble compatibility

export interface WatermarkOptions {
  roomNo: string; // e.g. "674/087"
  period: string; // e.g. "2026-11"
  prevMeter: number;
  currMeter: number;
  unitsUsed: number;
  readerName?: string;
  maxDimension?: number; // default 720px
  quality?: number; // default 0.75
}

export interface WatermarkResult {
  blob: Blob;
  dataUrl: string;
  sizeKb: number;
}

export async function processAndWatermarkImage(
  imageSource: File | Blob | HTMLImageElement | HTMLCanvasElement,
  options: WatermarkOptions
): Promise<WatermarkResult> {
  const {
    roomNo,
    period,
    prevMeter,
    currMeter,
    unitsUsed,
    maxDimension = 720,
    quality = 0.75,
  } = options;

  let img: HTMLImageElement | HTMLCanvasElement;

  if (typeof HTMLCanvasElement !== 'undefined' && imageSource instanceof HTMLCanvasElement) {
    img = imageSource;
  } else if (imageSource instanceof HTMLImageElement) {
    img = imageSource;
  } else {
    img = await new Promise((resolve, reject) => {
      const el = new Image();
      const url = URL.createObjectURL(imageSource as Blob | File);
      el.onload = () => {
        URL.revokeObjectURL(url);
        resolve(el);
      };
      el.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      el.src = url;
    });
  }

  // 1. Resolution Downscaling to 720px max dimension
  const origWidth = 'naturalWidth' in img ? (img.naturalWidth || img.width) : img.width;
  const origHeight = 'naturalHeight' in img ? (img.naturalHeight || img.height) : img.height;

  let targetWidth = origWidth;
  let targetHeight = origHeight;

  if (targetWidth > maxDimension || targetHeight > maxDimension) {
    if (targetWidth > targetHeight) {
      targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
      targetWidth = maxDimension;
    } else {
      targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
      targetHeight = maxDimension;
    }
  }

  // 2. Extend canvas height at the TOP so the info bar sits ABOVE the photo and NEVER covers the meter face!
  const headerHeight = Math.max(54, Math.round(targetWidth * 0.11));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight + headerHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not supported');
  }

  // Fill background white first (for JPEG transparency safety)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw Top Header Background (Dark Slate)
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, targetWidth, headerHeight);

  // Draw Sky-Blue Accent Line separating header and photo
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, headerHeight - 3, targetWidth, 3);

  // Format timestamp in Asia/Bangkok timezone
  const now = new Date();
  const dateStr = now.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const padX = Math.max(12, Math.round(targetWidth * 0.03));
  const fontSize1 = Math.max(12, Math.round(headerHeight * 0.28));
  const fontSize2 = Math.max(13, Math.round(headerHeight * 0.31));

  ctx.textBaseline = 'middle';

  // Top Line (Left: Room & Period | Right: Date/Time)
  ctx.textAlign = 'left';
  ctx.font = `bold ${fontSize1}px sans-serif`;
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(`ห้อง ${roomNo}  •  รอบบิล ${period}`, padX, Math.round(headerHeight * 0.3));

  ctx.textAlign = 'right';
  ctx.font = `${Math.max(11, fontSize1 - 1)}px sans-serif`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`${dateStr} น.`, targetWidth - padX, Math.round(headerHeight * 0.3));

  // Bottom Line of Top Header (Meter numbers & Units used)
  ctx.textAlign = 'left';
  ctx.font = `bold ${fontSize2}px sans-serif`;
  ctx.fillStyle = '#38bdf8';
  ctx.fillText(
    `เลขมิเตอร์: ${currMeter} (ก่อน: ${prevMeter})  ➔  ใช้น้ำ: ${unitsUsed} หน่วย`,
    padX,
    Math.round(headerHeight * 0.72)
  );

  // 3. Draw 100% Uncropped & Uncovered Photo below the Top Header
  ctx.drawImage(img, 0, headerHeight, targetWidth, targetHeight);

  // Export as JPEG (.jpg) for 100% compatibility with LINE Messaging API Image Bubbles on iOS/Android
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (jpegBlob) => {
        if (!jpegBlob) return reject(new Error('Failed to create image blob'));
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({
          blob: jpegBlob,
          dataUrl,
          sizeKb: Math.round(jpegBlob.size / 1024),
        });
      },
      'image/jpeg',
      quality
    );
  });
}
