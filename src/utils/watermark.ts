// Watermark and Image Compression for Meter Photos
// Version 1.0 - Optimized for 30-60 KB WebP output with legible meter numbers

export interface WatermarkOptions {
  roomNo: string; // e.g. "645/087"
  period: string; // e.g. "2026-11"
  prevMeter: number;
  currMeter: number;
  unitsUsed: number;
  readerName?: string;
  maxDimension?: number; // default 960px
  quality?: number; // default 0.65
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
    readerName = 'ผู้ตรวจมิเตอร์',
    maxDimension = 960,
    quality = 0.65,
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

  // Calculate scaled dimension while maintaining aspect ratio
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

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not supported');
  }

  // Draw scaled original image
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Watermark Banner at the bottom
  const bannerHeight = Math.max(90, Math.round(targetHeight * 0.16));
  const bannerY = targetHeight - bannerHeight;

  // Dark translucent background with top border accent
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'; // Dark slate with high opacity for readability
  ctx.fillRect(0, bannerY, targetWidth, bannerHeight);

  // Accent line on top of banner
  ctx.fillStyle = '#0284c7'; // Sky-600
  ctx.fillRect(0, bannerY, targetWidth, Math.max(2, Math.round(targetHeight * 0.005)));

  // Text Styling
  const baseFontSize = Math.max(14, Math.round(targetHeight * 0.032));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // Format date: DD/MM/YYYY HH:mm
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} น.`;

  const leftPadding = Math.round(targetWidth * 0.04);
  const lineSpacing = bannerHeight / 3.4;

  // Line 1: Room & Period
  ctx.font = `bold ${baseFontSize * 1.1}px sans-serif`;
  ctx.fillStyle = '#f8fafc'; // White
  ctx.fillText(`ห้อง ${roomNo}  |  รอบบิล: ${period}`, leftPadding, bannerY + lineSpacing * 0.8);

  // Line 2: Meter details & Units used
  ctx.font = `bold ${baseFontSize * 1.05}px sans-serif`;
  ctx.fillStyle = '#38bdf8'; // Sky-400 (Highlight)
  ctx.fillText(
    `เลขมิเตอร์: ${currMeter} (ครั้งก่อน: ${prevMeter})  ใช้น้ำ: ${unitsUsed} หน่วย`,
    leftPadding,
    bannerY + lineSpacing * 1.8
  );

  // Line 3: Timestamp & Reader
  ctx.font = `${baseFontSize * 0.85}px sans-serif`;
  ctx.fillStyle = '#94a3b8'; // Slate-400
  ctx.fillText(`${dateStr}  |  ${readerName}`, leftPadding, bannerY + lineSpacing * 2.7);

  // Export as WebP with fallback to JPEG
  return new Promise((resolve, reject) => {
    // Try image/webp first
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          // Fallback to jpeg if webp unsupported
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
