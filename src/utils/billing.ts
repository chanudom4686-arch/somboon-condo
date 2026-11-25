// Billing calculation and formatting utilities
// Version 1.3 - Supports explicit previous meter from meter_logs to prevent 0-unit overwrite bug

import { Room, CondoConfig, BillCalculationResult } from '../types/condo';

export function formatRoomNo(roomNo: string): string {
  const clean = roomNo.replace('645/', '').trim();
  const padded = clean.padStart(3, '0');
  return `645/${padded}`;
}

export function getShortRoomNo(roomNo: string): string {
  const clean = roomNo.replace('645/', '').trim();
  return clean.padStart(3, '0');
}

export function generateInvoiceNo(roomNo: string, period: string): string {
  return `${formatRoomNo(roomNo)}-${period}`;
}

export function generateReceiptNo(invoiceNo: string, index = 1): string {
  return `${invoiceNo}-R${index}`;
}

export function calculateBill(
  room: Room,
  currMeter: number,
  period: string,
  config: Partial<CondoConfig>,
  specialItems = 0,
  specialItemsNote = '',
  outstandingBalance = 0,
  explicitPrevMeter?: number
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

  // Common fee based on room type
  const isLarge = room.room_type === 'ห้องใหญ่' || room.room_type === 'large';
  const commonFee = isLarge
    ? Number(config.COMMON_FEE_BIG) || 500
    : Number(config.COMMON_FEE_SMALL) || 300;

  // 1. Contribution credit deduction (Only deducts from common fee!)
  const contributionBefore = Number(room.contribution_credit) || 0;
  const contributionDeducted = Math.min(commonFee, Math.max(0, contributionBefore));
  const contributionAfter = contributionBefore - contributionDeducted;
  const netCommonFee = commonFee - contributionDeducted;

  // 2. Subtotal before prepaid deposit
  const subtotal = waterAmount + wastewaterAmount + netCommonFee + specialItems;

  // 3. Prepaid deposit deduction (Deducts from any remaining balance)
  const prepaidBefore = Number(room.prepaid_credit) || 0;
  const prepaidDeducted = Math.min(Math.max(0, subtotal), Math.max(0, prepaidBefore));
  const prepaidAfter = prepaidBefore - prepaidDeducted;

  // 4. Total Amount Due
  const totalAmount = Math.max(0, subtotal - prepaidDeducted) + outstandingBalance;

  // Due date (e.g. 5th of next month or same month)
  const dueDay = Number(config.BILL_DUE_DAY) || 5;
  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  // Due date format: DD/MM/YYYY
  const dueDate = `${String(dueDay).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;

  // LINE verification code: 3 digits room + last 3 digits of phone (e.g. 005273)
  const rawPhone = (room.owner_phone || room.tenant_phone || '').replace(/[^0-9]/g, '');
  const phoneSuffix = rawPhone.length >= 3 ? rawPhone.slice(-3) : '';
  const lineRegCode = phoneSuffix ? `${getShortRoomNo(room.room_no)}${phoneSuffix}` : `${getShortRoomNo(room.room_no)}XXX`;

  return {
    room_no: getShortRoomNo(room.room_no),
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
