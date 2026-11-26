// Types for Condo 645 Management System
// Version 1.8 - Supports Paired Rooms (64-65, 144-145, 164-165, 186-187), Overdue & Late Payment Tracking

export type RoomType = 'ห้องเล็ก' | 'ห้องใหญ่' | 'ห้องคู่ (600)' | 'ห้องคู่ (1000)' | 'ห้องคู่ (800)' | 'small' | 'large';
export type RoomStatus = 'ปกติ' | 'ติดต่อไม่ได้' | 'ธนาคารยึด' | 'รอขาย' | 'normal' | 'uncontactable' | 'bank_seized' | 'pending_sale';
export type PrimaryPayer = 'เจ้าของ' | 'ผู้เช่า' | 'ทั้งคู่' | 'owner' | 'tenant' | 'both';
export type Language = 'ไทย' | 'อังกฤษ' | 'TH' | 'EN';
export type FollowupStatus = 'none' | 'line_notified' | 'phone_called' | 'overdue' | 'unclear_slip';

export interface Room {
  room_no: string; // e.g. "001" to "195", or paired "064-065", "144-145", "164-165", "186-187"
  floor: number;
  room_type: string; // 'ห้องเล็ก' | 'ห้องใหญ่' | 'ห้องคู่ (600)' | 'ห้องคู่ (1000)' | 'ห้องคู่ (800)'
  status: string; // 'ปกติ' | 'ติดต่อไม่ได้' | 'ธนาคารยึด' | 'รอขาย'
  primary_payer: string;
  owner_name: string;
  owner_phone: string;
  language: string;
  tenant_name: string;
  tenant_phone: string;
  line_user_id: string;
  common_fee_paid_until: string;
  prepaid_credit: number;
  contribution_credit: number;
  latest_meter: number;
  outstanding_balance?: number;
  note: string;
  created_at?: string;
  updated_at?: string;
}

export interface MeterLog {
  id: string;
  period: string; // "2026-11"
  room_no: string;
  prev_meter: number;
  curr_meter: number;
  units_used: number;
  water_amount: number;
  wastewater_amount: number;
  common_fee_amount: number;
  late_fee: number;
  special_items: number;
  special_items_note?: string | null;
  contribution_deducted: number;
  prepaid_deducted: number;
  total_amount: number;
  is_paid: boolean;
  is_late_payment?: boolean;
  paid_type: string | null;
  paid_timestamp: string | null;
  slip_url: string | null;
  meter_photo_url: string | null;
  line_push_status: string | null;
  is_verified?: boolean;
  followup_status?: FollowupStatus | string | null;
  followup_note?: string | null;
  note: string | null;
  invoice_no?: string | null;
  recorded_at: string;
}

export interface LineAutoReplyRule {
  id: string;
  keyword: string;
  match_type: 'exact' | 'contains' | string;
  reply_mode: 'custom_text' | 'system_bill' | 'system_receipt' | 'system_statement' | 'system_fund' | 'system_finance' | string;
  reply_text: string;
  description?: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface WalletLedgerItem {
  id: string;
  room_no: string;
  wallet_type: 'contribution' | 'prepaid';
  entry_type: 'credit_in' | 'deduction' | 'refund' | 'transfer' | 'forfeit_on_sale';
  amount: number;
  balance_after: number;
  ref_period?: string;
  description_th?: string;
  description_en?: string;
  created_by?: string;
  created_at: string;
}

export interface CondoConfig {
  CONDO_NAME: string;
  ADMIN_PIN: string;
  CURRENT_BILLING_PERIOD: string;
  BILL_DUE_DAY: string;
  WATER_RATE_PER_UNIT: string;
  WASTEWATER_RATE_PER_UNIT: string;
  COMMON_FEE_BIG: string;
  COMMON_FEE_SMALL: string;
  LATE_FEE_DEFAULT: string;
  BANK_NAME: string;
  BANK_ACCOUNT_NO: string;
  BANK_ACCOUNT_NAME: string;
  PROMPTPAY_NO: string;
  BANK_QR_IMAGE_URL: string;
  DRIVE_FOLDER_ID: string;
  SLIP_FOLDER_ID: string;
  LINE_CHANNEL_ID: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_GREETING_MESSAGE: string;
  [key: string]: string;
}

export interface BillCalculationResult {
  room_no: string;
  formatted_room: string; // e.g. "645/001" or "645/64-65"
  period: string;
  prev_meter: number;
  curr_meter: number;
  units_used: number;
  water_rate: number;
  water_amount: number;
  wastewater_rate: number;
  wastewater_amount: number;
  common_fee: number;
  late_fee: number;
  special_items: number;
  special_items_note: string;
  contribution_before: number;
  contribution_deducted: number;
  contribution_after: number;
  prepaid_before: number;
  prepaid_deducted: number;
  prepaid_after: number;
  outstanding_balance: number;
  total_amount: number;
  invoice_no: string;
  due_date: string;
  line_reg_code?: string;
}

export interface Transaction {
  id: string;
  tx_date: string;
  billing_period?: string;
  category: string;
  type: 'income' | 'expense' | 'รายรับ' | 'รายจ่าย' | string;
  amount: number;
  payment_method?: string | null;
  slip_url?: string | null;
  note?: string | null;
  fund_type: 'operating' | 'maintenance_fund' | string;
  room_no?: string | null;
  is_paid?: boolean;
  created_at?: string;
}
