// Watermark and Image Resolution Downscaler for Meter Photos
// Version 1.4 - Downscales resolution to 720px and places metadata in an extended TOP HEADER above the photo so 0% of the meter photo is covered

export interface WatermarkOptions {
  roomNo: string; // e.g. "645/087"
  period: string; // e.g. "2026-11"
  prevMeter: number;
  currMeter: number;
  unitsUsed: number;
  readerName?: string;
  maxDimension?: number; // default 720px (Resolution downscaling)
  quality?: number; // default 0.72
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
    quality = 0.72,
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

  // 1. Resolution Downscaling: scale image down to maxDimension (720px) while keeping aspect ratio
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

  // Draw Top Header Background (Dark Slate)
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, targetWidth, headerHeight);

  // Draw Sky-Blue Accent Line separating header and photo
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, headerHeight - 3, targetWidth, 3);

  // Format timestamp: DD/MM/YYYY HH:mm
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

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
  ctx.fillText(dateStr, targetWidth - padX, Math.round(headerHeight * 0.3));

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

  // Export as WebP with fallback to JPEG
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
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
          return;
        }
        const dataUrl = canvas.toDataURL('image/webp', quality);
        resolve({
          blob,
          dataUrl,
          sizeKb: Math.round(blob.size / 1024),
        });
      },
      'image/webp',
      quality
    );
  });
}
