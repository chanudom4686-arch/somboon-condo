// PromptPay EMVCo QR Code generator
// Version 1.0

import QRCode from 'qrcode';

function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

function formatTLV(tag: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${tag}${len}${value}`;
}

export function generatePromptPayPayload(target: string, amount?: number): string {
  // Clean target: digits only
  const cleanTarget = target.replace(/[^0-9]/g, '');
  let formattedTarget = cleanTarget;
  let subTag = '01'; // 01 for mobile, 02 for Tax ID / National ID

  if (cleanTarget.length === 10 && cleanTarget.startsWith('0')) {
    // Mobile number: e.g. 0812345678 -> 0066812345678
    formattedTarget = `0066${cleanTarget.substring(1)}`;
    subTag = '01';
  } else if (cleanTarget.length === 13 || cleanTarget.length === 15) {
    // Tax ID / National ID / e-Wallet
    formattedTarget = cleanTarget;
    subTag = cleanTarget.length === 15 ? '03' : '02';
  }

  // Merchant Account Info (Tag 29)
  const tag29Sub00 = formatTLV('00', 'A000000677010111');
  const tag29SubTarget = formatTLV(subTag, formattedTarget);
  const tag29 = formatTLV('29', tag29Sub00 + tag29SubTarget);

  // Payload segments
  let payload = '';
  payload += formatTLV('00', '01'); // Payload Format Indicator
  payload += formatTLV('01', amount && amount > 0 ? '12' : '11'); // 12 = Dynamic (with amount), 11 = Static
  payload += tag29;
  payload += formatTLV('53', '764'); // Currency: THB

  if (amount && amount > 0) {
    payload += formatTLV('54', amount.toFixed(2));
  }

  payload += formatTLV('58', 'TH'); // Country Code

  // Checksum tag 63
  const rawForCrc = payload + '6304';
  const checksum = crc16(rawForCrc);

  return rawForCrc + checksum;
}

export async function generatePromptPayQRDataUrl(
  target: string,
  amount?: number,
  size = 250
): Promise<string> {
  if (!target || target.trim() === '') return '';
  try {
    const payload = generatePromptPayPayload(target, amount);
    return await QRCode.toDataURL(payload, {
      width: size,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    });
  } catch (err) {
    console.error('Failed to generate PromptPay QR:', err);
    return '';
  }
}
