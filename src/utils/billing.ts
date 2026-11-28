// Billing calculation and formatting utilities
// Version 2.20 - formatConsolidatedBillText, Bilingual Consolidated Billing Engine, Multi-room Calculations

import { Room, CondoConfig, BillCalculationResult } from '../types/condo';

export interface SuggestedLateFeeResult {
  daysLate: number;
  dailyRate: number;
  dailyFeeTotal: number;
  rolloverMonths: number;
  rolloverInterestRate: number;
  rolloverInterestFee: number;
  totalSuggestedLateFee: number;
  formulaExplanation: string;
}

// Calculate recommended late fee based on rule:
// 1. Paid after 5th of month: 50 THB/day per room.
// 2. Rollover unpaid past 5th of next periods: +2% compound interest on balance + 50 THB/day.
export function calculateSuggestedLateFee(
  room: Room,
  period: string, // e.g. "2026-11"
  config: Partial<CondoConfig>,
  baseAmount = 0,
  targetDate?: Date
): SuggestedLateFeeResult {
  try {
    const dueDay = Number(config.BILL_DUE_DAY) || 5;
    const dailyRate = 50; // 50 THB/day per room
    const monthlyRate = 0.02; // 2% compound per rollover period past 5th

    const [pYearStr, pMonthStr] = (period || '').split('-');
    const pYear = parseInt(pYearStr, 10);
    const pMonth = parseInt(pMonthStr, 10);
    if (!pYear || !pMonth) {
      return {
        daysLate: 0,
        dailyRate,
        dailyFeeTotal: 0,
        rolloverMonths: 0,
        rolloverInterestRate: monthlyRate,
        rolloverInterestFee: 0,
        totalSuggestedLateFee: 0,
        formulaExplanation: 'ไม่พบข้อมูลงวดบิล',
      };
    }

    const nowBkkStr = (targetDate || new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
    const [cYearStr, cMonthStr, cDayStr] = nowBkkStr.split('-');
    const cYear = parseInt(cYearStr, 10);
    const cMonth = parseInt(cMonthStr, 10);
    const cDay = parseInt(cDayStr, 10);

    const monthDiff = (cYear - pYear) * 12 + (cMonth - pMonth);
    const dueDateMidnight = new Date(Date.UTC(pYear, pMonth - 1, dueDay));
    const currentDateMidnight = new Date(Date.UTC(cYear, cMonth - 1, cDay));

    const diffMs = currentDateMidnight.getTime() - dueDateMidnight.getTime();
    const daysLate = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    if (daysLate === 0) {
      return {
        daysLate: 0,
        dailyRate,
        dailyFeeTotal: 0,
        rolloverMonths: 0,
        rolloverInterestRate: monthlyRate,
        rolloverInterestFee: 0,
        totalSuggestedLateFee: 0,
        formulaExplanation: `ยังไม่พ้นกำหนดชำระ (ครบกำหนดวันที่ ${String(dueDay).padStart(2, '0')}/${String(pMonth).padStart(2, '0')}/${pYear})`,
      };
    }

    const dailyFeeTotal = daysLate * dailyRate;

    let rolloverMonths = 0;
    if (monthDiff > 0) {
      rolloverMonths = cDay > dueDay ? monthDiff : Math.max(0, monthDiff - 1);
    }

    let rolloverInterestFee = 0;
    const principal = Math.max(0, baseAmount + (Number(room.outstanding_balance) || 0));
    if (rolloverMonths > 0 && principal > 0) {
      const compoundFactor = Math.pow(1 + monthlyRate, rolloverMonths) - 1;
      rolloverInterestFee = Math.round(principal * compoundFactor * 100) / 100;
    }

    const totalSuggestedLateFee = Math.round(dailyFeeTotal + rolloverInterestFee);

    let formulaExplanation = `เกินกำหนด ${daysLate} วัน × 50 บ. = ${dailyFeeTotal.toLocaleString()} บ.`;
    if (rolloverMonths > 0 && rolloverInterestFee > 0) {
      formulaExplanation += ` + ดอกเบี้ยค้างยกยอด ${rolloverMonths} รอบ (2% ทบต้น) = +${rolloverInterestFee.toLocaleString()} บ.`;
    }

    return {
      daysLate,
      dailyRate,
      dailyFeeTotal,
      rolloverMonths,
      rolloverInterestRate: monthlyRate,
      rolloverInterestFee,
      totalSuggestedLateFee,
      formulaExplanation,
    };
  } catch (err: any) {
    console.error('Error calculating late fee:', err);
    return {
      daysLate: 0,
      dailyRate: 50,
      dailyFeeTotal: 0,
      rolloverMonths: 0,
      rolloverInterestRate: 0.02,
      rolloverInterestFee: 0,
      totalSuggestedLateFee: 0,
      formulaExplanation: 'เกิดข้อผิดพลาดในการคำนวณค่าปรับ',
    };
  }
}

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
  const clean = inputRoomNo.replace(/^674\//, '').replace(/^645\//, '').replace('674/', '').replace('645/', '').trim();
  if (PAIRED_ROOM_LOOKUP[clean]) return PAIRED_ROOM_LOOKUP[clean];
  return clean.padStart(3, '0');
}

export function formatRoomNo(roomNo: string): string {
  const clean = roomNo.replace(/^674\//, '').replace(/^645\//, '').replace('674/', '').replace('645/', '').trim();
  if (clean === '064-065' || clean === '64-65') {
    return '674/64-65';
  }
  if (clean.includes('-')) {
    return `674/${clean}`;
  }
  const padded = clean.padStart(3, '0');
  return `674/${padded}`;
}

export function getShortRoomNo(roomNo: string): string {
  const clean = roomNo.replace(/^674\//, '').replace(/^645\//, '').replace('674/', '').replace('645/', '').trim();
  if (clean.includes('-')) return clean;
  return clean.padStart(3, '0');
}

// Get primary 3-digit prefix for LINE 6-digit registration code (e.g. "064-065" -> "064")
export function getLineRoomPrefix(roomNo: string): string {
  const clean = roomNo.replace(/^674\//, '').replace(/^645\//, '').replace('674/', '').replace('645/', '').trim();
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
  lateFee = 0,
  explicitContributionDeducted?: number,
  explicitPrepaidDeducted?: number
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
  // If explicitly overridden by admin, use explicit amount. Otherwise default to 0 (pending condo agreement).
  const contributionBefore = Number(room.contribution_credit) || 0;
  let contributionDeducted = 0;
  if (explicitContributionDeducted !== undefined && !Number.isNaN(Number(explicitContributionDeducted))) {
    contributionDeducted = Math.min(commonFee, Math.min(contributionBefore, Math.max(0, Number(explicitContributionDeducted))));
  } else {
    contributionDeducted = 0;
  }
  const contributionAfter = contributionBefore - contributionDeducted;
  const netCommonFee = commonFee - contributionDeducted;

  // 2. Subtotal before prepaid deposit
  const subtotal = Math.max(0, waterAmount + wastewaterAmount + netCommonFee + specialItems + lateFee);

  // 3. Prepaid deposit deduction
  const prepaidBefore = Number(room.prepaid_credit) || 0;
  const prepaidDeducted =
    explicitPrepaidDeducted !== undefined && !Number.isNaN(Number(explicitPrepaidDeducted))
      ? Math.min(subtotal, Math.min(prepaidBefore, Math.max(0, Number(explicitPrepaidDeducted))))
      : Math.min(subtotal, Math.max(0, prepaidBefore));
  const prepaidAfter = prepaidBefore - prepaidDeducted;

  // 4. Total Amount Due
  const totalAmount = Math.max(0, subtotal - prepaidDeducted + outstandingBalance);

  // Due date (e.g. 5th of month)
  const dueDay = Number(config.BILL_DUE_DAY) || 5;
  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr, 10) || 2026;
  const month = parseInt(monthStr, 10) || 11;
  const dueDate = `${String(dueDay).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;

  // LINE verification code: 3 digits room prefix + last 4 digits of phone (e.g. 0646273)
  // Supports multiple phone numbers per room
  const phones = (room.owner_phone || room.tenant_phone || '')
    .split(/[,/]/)
    .map((p) => p.replace(/[^0-9]/g, ''))
    .filter((p) => p.length >= 4);
  const linePrefix = getLineRoomPrefix(room.room_no);
  const lineRegCode = phones.length > 0
    ? phones.map((p) => `${linePrefix}${p.slice(-4)}`).join(', ')
    : `${linePrefix}XXXX`;

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

export function getPrintableCustomItems(noteStr?: string, totalSpecial = 0): { label: string; amount: number }[] {
  const clean = (noteStr || '').trim();
  if (!clean && totalSpecial === 0) return [];

  if (clean.includes('|') || /\([+-]?\d+(\.\d+)?\s*บ\.\)/.test(clean)) {
    const parts = clean.split('|').map((p) => p.trim()).filter(Boolean);
    const items: { label: string; amount: number }[] = [];
    parts.forEach((part) => {
      const match = part.match(/^(.*?)\s*\(([+-]?\d+(?:\.\d+)?)\s*บ\.\)$/);
      if (match) {
        items.push({
          label: match[1].trim() || 'รายการเพิ่มเติม',
          amount: parseFloat(match[2]) || 0,
        });
      } else {
        items.push({
          label: part,
          amount: parts.length === 1 ? totalSpecial : 0,
        });
      }
    });
    if (items.length > 0) return items;
  }

  return [
    {
      label: clean || (totalSpecial < 0 ? 'ส่วนลดพิเศษ' : 'รายการเพิ่มเติม'),
      amount: totalSpecial,
    },
  ];
}

export interface ConsolidatedBillItem {
  room: Room;
  bill: BillCalculationResult;
}

export function formatConsolidatedBillText(
  ownerName: string,
  items: ConsolidatedBillItem[],
  period: string,
  config: Partial<CondoConfig>
): {
  messageText: string;
  consolidatedTotal: number;
  totalWaterAmount: number;
  totalUnitsUsed: number;
  totalWastewaterAmount: number;
  totalCommonFee: number;
  totalLateFee: number;
  totalOutstanding: number;
  totalDeductions: number;
  dueDate: string;
} {
  const condoName = config.CONDO_NAME || 'อาคารชุด สมบูรณ์ คอนโดทาวน์ 674';
  let consolidatedTotal = 0;
  let totalWaterAmount = 0;
  let totalUnitsUsed = 0;
  let totalWastewaterAmount = 0;
  let totalCommonFee = 0;
  let totalLateFee = 0;
  let totalOutstanding = 0;
  let totalDeductions = 0;
  let commonDueDate = '';

  const roomBlocks: string[] = [];

  for (const { room, bill } of items) {
    consolidatedTotal += bill.total_amount;
    totalWaterAmount += bill.water_amount;
    totalUnitsUsed += bill.units_used;
    totalWastewaterAmount += bill.wastewater_amount;
    totalCommonFee += bill.common_fee;
    totalLateFee += bill.late_fee;
    totalOutstanding += bill.outstanding_balance;
    totalDeductions += (bill.contribution_deducted + bill.prepaid_deducted);
    if (!commonDueDate && bill.due_date) {
      commonDueDate = bill.due_date;
    }

    const extraLines: string[] = [];
    if (bill.late_fee > 0) {
      extraLines.push(`• เบี้ยปรับชำระล่าช้า / Late Fee: +${bill.late_fee.toLocaleString()} บ.`);
    }
    if (bill.outstanding_balance > 0) {
      extraLines.push(`• ยอดค้างชำระยกมา / Arrears: +${bill.outstanding_balance.toLocaleString()} บ.`);
    }
    if (bill.special_items !== 0) {
      extraLines.push(
        `• รายการพิเศษ / Extra (${bill.special_items_note || '-'}): ${bill.special_items > 0 ? '+' : ''}${bill.special_items.toLocaleString()} บ.`
      );
    }
    if (bill.contribution_deducted > 0) {
      extraLines.push(`• หักเครดิตสมทบทุน / Fund Credit: -${bill.contribution_deducted.toLocaleString()} บ.`);
    }
    if (bill.prepaid_deducted > 0) {
      extraLines.push(`• หักเงินฝากล่วงหน้า / Prepaid Deposit: -${bill.prepaid_deducted.toLocaleString()} บ.`);
    }

    roomBlocks.push(
      `🏠 ห้อง / Room: ${formatRoomNo(room.room_no)}\n` +
      `• ค่าน้ำประปา / Water: ${bill.water_amount.toLocaleString()} บ. (${bill.units_used} Units [${bill.prev_meter}➔${bill.curr_meter}])\n` +
      `• ค่าบำบัดน้ำเสีย / Wastewater: ${bill.wastewater_amount.toLocaleString()} บ.\n` +
      `• ค่าส่วนกลาง / Common Fee: ${bill.common_fee.toLocaleString()} บ.` +
      (extraLines.length > 0 ? '\n' + extraLines.join('\n') : '') +
      `\n➔ รวมห้องนี้ / Subtotal: ${bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ. (THB)`
    );
  }

  const cleanOwnerName = (ownerName || '').trim() || 'ท่านเจ้าของร่วม / Resident';

  const messageText =
    `🧾 แจ้งใบแจ้งหนี้รวม ${items.length} ห้องชุด ประจำรอบ ${period}\n` +
    `Consolidated Invoice for ${items.length} Rooms - Period ${period}\n` +
    `${condoName}\n` +
    `ผู้รับ / Resident: ${cleanOwnerName}\n` +
    `━━━━━━━━━━━━━━\n` +
    roomBlocks.join('\n\n') + '\n' +
    `━━━━━━━━━━━━━━\n` +
    `💰 ยอดรวมทุกห้องที่ต้องชำระ / Total Amount Due: ${consolidatedTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท / THB\n` +
    `📅 กำหนดชำระภายในวันที่ / Due Date: ${commonDueDate}\n\n` +
    `🏦 ช่องทางโอนชำระ / Payment Transfer:\n` +
    `${config.BANK_NAME || 'กสิกรไทย'} เลขบัญชี / A/C: ${config.BANK_ACCOUNT_NO || '-'}\n` +
    `ชื่อบัญชี / A/C Name: ${config.BANK_ACCOUNT_NAME || condoName}\n\n` +
    `เมื่อโอนชำระแล้ว รบกวนส่งรูปสลิปในแชตนี้ได้เลยครับ 🙏\nPlease attach transfer slip in this chat after payment.`;

  return {
    messageText,
    consolidatedTotal,
    totalWaterAmount,
    totalUnitsUsed,
    totalWastewaterAmount,
    totalCommonFee,
    totalLateFee,
    totalOutstanding,
    totalDeductions,
    dueDate: commonDueDate,
  };
}

