// Billing calculation and formatting utilities
// Version 1.8 - Supports paired rooms (645/64-65, 645/144-145, 645/164-165, 645/186-187), combined common fees (600 / 1000 / 800 THB), and automatic overdue detection after the 5th

import { Room, CondoConfig, BillCalculationResult } from '../types/condo';

// Map 3-digit prefix to paired room_no in database
export const PAIRED_ROOM_LOOKUP: Record<string, string> = {
  '064': '064-065',
  '065': '064-065',
  '64': '064-065',
  '65': '064-065',
  '064-065': '064-065',
  '64-65': '064-065',
  '144': '144-145',
  '145': '144-145',
  '144-145': '144-145',
  '164': '164-165',
  '165': '164-165',
  '164-165': '164-165',
  '186': '186-187',
  '187': '186-187',
  '186-187': '186-187',
};

export function resolveRoomNo(inputRoomNo: string): string {
  const clean = inputRoomNo.replace('645/', '').trim();
  if (PAIRED_ROOM_LOOKUP[clean]) return PAIRED_ROOM_LOOKUP[clean];
  return clean.padStart(3, '0');
}

export function formatRoomNo(roomNo: string): string {
  const clean = roomNo.replace('645/', '').trim();
  if (clean === '064-065' || clean === '64-65') {
    return '645/64-65';
  }
  if (clean.includes('-')) {
    return `645/${clean}`;
  }
  const padded = clean.padStart(3, '0');
  return `645/${padded}`;
}

export function getShortRoomNo(roomNo: string): string {
  const clean = roomNo.replace('645/', '').trim();
  if (clean.includes('-')) return clean;
  return clean.padStart(3, '0');
}

// Get primary 3-digit prefix for LINE 6-digit registration code (e.g. "064-065" -> "064")
export function getLineRoomPrefix(roomNo: string): string {
  const clean = roomNo.replace('645/', '').trim();
  if (clean.includes('-')) {
    const firstPart = clean.split('-')[0].trim();
    return firstPart.padStart(3, '0');
  }
  return clean.padStart(3, '0');
}

export function generateInvoiceNo(roomNo: string, period: string): string {
  return `${formatRoomNo(roomNo)}-${period}`;
}

export function generateReceiptNo(invoiceNo: string, index = 1): string {
  return `${invoiceNo}-R${index}`;
}

// Check if current date in Asia/Bangkok is past the due day (default 5th) of the billing period
export function isPeriodPastDue(period: string, dueDay = 5): boolean {
  try {
    const [pYearStr, pMonthStr] = (period || '').split('-');
    const pYear = parseInt(pYearStr, 10);
    const pMonth = parseInt(pMonthStr, 10);
    if (!pYear || !pMonth) return false;

    const nowBkkStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
    const [cYearStr, cMonthStr, cDayStr] = nowBkkStr.split('-');
    const cYear = parseInt(cYearStr, 10);
    const cMonth = parseInt(cMonthStr, 10);
    const cDay = parseInt(cDayStr, 10);

    if (cYear > pYear) return true;
    if (cYear < pYear) return false;
    if (cMonth > pMonth) return true;
    if (cMonth < pMonth) return false;
    return cDay > dueDay;
  } catch {
    return false;
  }
}

export function getCommonFeeForRoom(room: Room, config: Partial<CondoConfig>): number {
  const feeBig = Number(config.COMMON_FEE_BIG) || 500;
  const feeSmall = Number(config.COMMON_FEE_SMALL) || 300;
  const rt = (room.room_type || '').trim();

  if (rt === 'ห้องคู่ (1000)' || rt === 'ห้องคู่ใหญ่') return feeBig * 2; // 1,000 THB
  if (rt === 'ห้องคู่ (600)' || rt === 'ห้องคู่เล็ก') return feeSmall * 2; // 600 THB
  if (rt === 'ห้องคู่ (800)' || rt === 'ห้องคู่ผสม') return feeBig + feeSmall; // 800 THB
  if (rt === 'ห้องใหญ่' || rt === 'large') return feeBig; // 500 THB
  return feeSmall; // 300 THB
}

export function calculateBill(
  room: Room,
  currMeter: number,
  period: string,
  config: Partial<CondoConfig>,
  specialItems = 0,
  specialItemsNote = '',
  outstandingBalance = 0,
  explicitPrevMeter?: number,
  lateFee = 0
): BillCalculationResult {
  const prevMeter =
    explicitPrevMeter !== undefined && !Number.isNaN(Number(explicitPrevMeter))
      ? Number(explicitPrevMeter)
      : Number(room.latest_meter) || 0;
  const unitsUsed = Math.max(0, currMeter - prevMeter);

  const waterRate = Number(config.WATER_RATE_PER_UNIT) || 35;
  const wastewaterRate = Number(config.WASTEWATER_RATE_PER_UNIT) || 5;

  const waterAmount = unitsUsed * waterRate;
  const wastewaterAmount = unitsUsed * wastewaterRate;

  // Common fee (Supports single 300 / 500 and paired rooms 600 / 1000 / 800)
  const commonFee = getCommonFeeForRoom(room, config);

  // 1. Contribution credit deduction (Only deducts from common fee!)
  const contributionBefore = Number(room.contribution_credit) || 0;
  const contributionDeducted = Math.min(commonFee, Math.max(0, contributionBefore));
  const contributionAfter = contributionBefore - contributionDeducted;
  const netCommonFee = commonFee - contributionDeducted;

  // 2. Subtotal before prepaid deposit
  const subtotal = Math.max(0, waterAmount + wastewaterAmount + netCommonFee + specialItems + lateFee);

  // 3. Prepaid deposit deduction
  const prepaidBefore = Number(room.prepaid_credit) || 0;
  const prepaidDeducted = Math.min(subtotal, Math.max(0, prepaidBefore));
  const prepaidAfter = prepaidBefore - prepaidDeducted;

  // 4. Total Amount Due
  const totalAmount = Math.max(0, subtotal - prepaidDeducted + outstandingBalance);

  // Due date (e.g. 5th of month)
  const dueDay = Number(config.BILL_DUE_DAY) || 5;
  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr, 10) || 2026;
  const month = parseInt(monthStr, 10) || 11;
  const dueDate = `${String(dueDay).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;

  // LINE verification code: 3 digits room prefix + last 3 digits of phone (e.g. 064273)
  const rawPhone = (room.owner_phone || room.tenant_phone || '').replace(/[^0-9]/g, '');
  const phoneSuffix = rawPhone.length >= 3 ? rawPhone.slice(-3) : '';
  const linePrefix = getLineRoomPrefix(room.room_no);
  const lineRegCode = phoneSuffix ? `${linePrefix}${phoneSuffix}` : `${linePrefix}XXX`;

  return {
    room_no: room.room_no,
    formatted_room: formatRoomNo(room.room_no),
    period,
    prev_meter: prevMeter,
    curr_meter: currMeter,
    units_used: unitsUsed,
    water_rate: waterRate,
    water_amount: waterAmount,
    wastewater_rate: wastewaterRate,
    wastewater_amount: wastewaterAmount,
    common_fee: commonFee,
    late_fee: lateFee,
    special_items: specialItems,
    special_items_note: specialItemsNote,
    contribution_before: contributionBefore,
    contribution_deducted: contributionDeducted,
    contribution_after: contributionAfter,
    prepaid_before: prepaidBefore,
    prepaid_deducted: prepaidDeducted,
    prepaid_after: prepaidAfter,
    outstanding_balance: outstandingBalance,
    total_amount: totalAmount,
    invoice_no: generateInvoiceNo(room.room_no, period),
    due_date: dueDate,
    line_reg_code: lineRegCode,
  };
}
