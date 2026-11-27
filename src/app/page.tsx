'use client';

// Main Application Page for Condo 674 Management System
// Version 2.15 - Receipt Footer Config, Print LINE QR, and Multi-bubble Fixes

import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Room, MeterLog, CondoConfig, LineAutoReplyRule } from '@/types/condo';
import {
  formatRoomNo,
  calculateBill,
  isPeriodPastDue,
  getCommonFeeForRoom,
  resolveRoomNo,
  getLineRoomPrefix,
} from '@/utils/billing';
import { generatePromptPayQRDataUrl } from '@/utils/promptpay';
import { RoomDetailModal } from '@/components/RoomDetailModal';
import { PrintBills4PerA4 } from '@/components/PrintBills4PerA4';
import { PaymentModal } from '@/components/PaymentModal';
import { ExpenseModal } from '@/components/ExpenseModal';
import { MeterReadingModal } from '@/components/MeterReadingModal';
import { BillEditModal } from '@/components/BillEditModal';
import { MonthlyReportPrintModal } from '@/components/MonthlyReportPrintModal';
import { MultiRoomPayModal } from '@/components/MultiRoomPayModal';
import { BatchReceiptSendModal } from '@/components/BatchReceiptSendModal';
import { LineSystemMessageEditor } from '@/components/LineSystemMessageEditor';
import { BatchDeductionModal } from '@/components/BatchDeductionModal';

const THAI_MONTHS = [
  { num: '01', label: '01 - มกราคม' },
  { num: '02', label: '02 - กุมภาพันธ์' },
  { num: '03', label: '03 - มีนาคม' },
  { num: '04', label: '04 - เมษายน' },
  { num: '05', label: '05 - พฤษภาคม' },
  { num: '06', label: '06 - มิถุนายน' },
  { num: '07', label: '07 - กรกฎาคม' },
  { num: '08', label: '08 - สิงหาคม' },
  { num: '09', label: '09 - กันยายน' },
  { num: '10', label: '10 - ตุลาคม' },
  { num: '11', label: '11 - พฤศจิกายน' },
  { num: '12', label: '12 - ธันวาคม' },
];

const YEARS_LIST = ['2025', '2026', '2027', '2028'];

function shiftYearMonth(ym: string, deltaMonths: number): string {
  const [yStr, mStr] = (ym || '2026-11').split('-');
  let year = parseInt(yStr, 10) || 2026;
  let month = parseInt(mStr, 10) || 11;
  month += deltaMonths;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

export default function AdminCondoApp() {
  const supabase = createClient();

  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'audit' | 'billing' | 'payments' | 'rooms' | 'accounting' | 'line' | 'settings'>('audit');

  // Core Data
  const [rooms, setRooms] = useState<Room[]>([]);
  const [config, setConfig] = useState<Partial<CondoConfig>>({});
  const [meterLogs, setMeterLogs] = useState<MeterLog[]>([]);
  const [allYearLogs, setAllYearLogs] = useState<MeterLog[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [lineRules, setLineRules] = useState<LineAutoReplyRule[]>([]);
  const [loading, setLoading] = useState(true);

  // Viewing Billing Period & Staff Active Billing Period
  const [period, setPeriod] = useState<string>('2026-11');
  const [staffActivePeriod, setStaffActivePeriod] = useState<string>('2026-11');

  // Shared Search Input (Room Range Buttons Removed as Requested)
  const [searchQuery, setSearchQuery] = useState('');
  const [txStatusFilter, setTxStatusFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [auditFilter, setAuditFilter] = useState<'all' | 'has_photo' | 'unverified' | 'verified' | 'anomaly' | 'unread'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'unpaid' | 'overdue' | 'paid' | 'receipt_unsent' | 'receipt_sent' | 'late_paid' | 'line_notified' | 'phone_called' | 'multi_room'>('all');
  const [roomsViewMode, setRoomsViewMode] = useState<'individual' | 'by_owner'>('individual');
  const [showMultiRoomPayModal, setShowMultiRoomPayModal] = useState(false);
  const [showBatchReceiptModal, setShowBatchReceiptModal] = useState(false);
  const [batchReceiptPreselectedRoomNos, setBatchReceiptPreselectedRoomNos] = useState<string[] | undefined>(undefined);
  const [batchReceiptFilterMode, setBatchReceiptFilterMode] = useState<'unsent' | 'all'>('unsent');

  // Inline Meter Editing Drafts in Audit Tab
  const [inlineEdits, setInlineEdits] = useState<Record<string, { prev: string; curr: string }>>({});
  const [savingRoomNo, setSavingRoomNo] = useState<string | null>(null);
  const [savedToastRoomNo, setSavedToastRoomNo] = useState<string | null>(null);

  // Multi-Select Checkboxes on Tab 2
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [isPushingLine, setIsPushingLine] = useState(false);
  const [pushCustomModalOpen, setPushCustomModalOpen] = useState(false);
  const [customPushText, setCustomPushText] = useState(
    '🔔 แจ้งเตือนจากนิติบุคคล {condo_name}\nห้อง {room_no} มียอดบิลรอบ {period} จำนวน {total_due} บาท (ครบกำหนดวันที่ {due_date})\nหากชำระแล้วรบกวนส่งสลิปในแชตนี้ได้เลยครับ ขอบคุณครับ 🙏'
  );

  // Modals
  const [lightboxRoom, setLightboxRoom] = useState<Room | null>(null);
  const [readingModalRoom, setReadingModalRoom] = useState<Room | null>(null);
  const [billEditRoom, setBillEditRoom] = useState<Room | null>(null);
  const [batchDeductionModalOpen, setBatchDeductionModalOpen] = useState(false);
  const [detailRoom, setDetailRoom] = useState<Room | null>(null);
  const [paymentRoom, setPaymentRoom] = useState<Room | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printDocType, setPrintDocType] = useState<'invoice' | 'receipt'>('invoice');
  const [printTargetRooms, setPrintTargetRooms] = useState<string[]>([]);
  const [showMonthlyReportModal, setShowMonthlyReportModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);

  // Water Reconciliation Inputs (Tab 5)
  const [pwaUnitsStr, setPwaUnitsStr] = useState<string>('');
  const [pwaCostStr, setPwaCostStr] = useState<string>('');

  // LINE OA Auto-Reply Rule Editor & 3-Tier Suite (Tab 6)
  const [lineSubTab, setLineSubTab] = useState<'rooms' | 'keywords' | 'system_messages'>('rooms');
  const [lineRoomSearch, setLineRoomSearch] = useState('');
  const [editingRule, setEditingRule] = useState<Partial<LineAutoReplyRule> | null>(null);
  const [activeBubbleIndex, setActiveBubbleIndex] = useState<number>(0);
  const [testLineCode, setTestLineCode] = useState('');
  const [testLineResult, setTestLineResult] = useState<{ match: boolean; message: string } | null>(null);

  // Settings form (Tab 7)
  const [waterRate, setWaterRate] = useState('35');
  const [wastewaterRate, setWastewaterRate] = useState('5');
  const [feeBig, setFeeBig] = useState('500');
  const [feeSmall, setFeeSmall] = useState('300');
  const [promptpayNo, setPromptpayNo] = useState('');
  const [bankName, setBankName] = useState('ธนาคารกสิกรไทย');
  const [bankAccNo, setBankAccNo] = useState('');
  const [bankAccName, setBankAccName] = useState('');
  const [dueDay, setDueDay] = useState('5');
  const [lineSecret, setLineSecret] = useState('');
  const [lineAccessToken, setLineAccessToken] = useState('');
  const [receiptFooterText, setReceiptFooterText] = useState('ออกแบบใบเสร็จรับเงิน ออกโดย วชิรดา');
  const [showPrintLineQr, setShowPrintLineQr] = useState(true);
  const [lineQrImageUrl, setLineQrImageUrl] = useState('');
  const [isUploadingLineQr, setIsUploadingLineQr] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const fetchData = async (overridePeriod?: string) => {
    setLoading(true);
    try {
      const { data: configData } = await supabase
        .from('condo_config')
        .select('*')
        .not('key', 'like', 'LINE_REG_STATE_%');
      let activePeriod = overridePeriod || period;
      const configMap: Record<string, string> = {};
      if (configData) {
        configData.forEach((item: any) => {
          configMap[item.key] = item.value;
        });
        setConfig(configMap);
        const cfgPeriod = configMap.CURRENT_BILLING_PERIOD || '2026-11';
        setStaffActivePeriod(cfgPeriod);
        if (!overridePeriod) {
          activePeriod = cfgPeriod;
          setPeriod(activePeriod);
        }
        setWaterRate(configMap.WATER_RATE_PER_UNIT || '35');
        setWastewaterRate(configMap.WASTEWATER_RATE_PER_UNIT || '5');
        setFeeBig(configMap.COMMON_FEE_BIG || '500');
        setFeeSmall(configMap.COMMON_FEE_SMALL || '300');
        setPromptpayNo(configMap.PROMPTPAY_NO || '');
        setBankName(configMap.BANK_NAME || 'ธนาคารกสิกรไทย');
        setBankAccNo(configMap.BANK_ACCOUNT_NO || '');
        setBankAccName(configMap.BANK_ACCOUNT_NAME || '');
        setDueDay(configMap.BILL_DUE_DAY || '5');
        setLineSecret(configMap.LINE_CHANNEL_SECRET || '');
        setLineAccessToken(configMap.LINE_CHANNEL_ACCESS_TOKEN || '');
        setReceiptFooterText(configMap.RECEIPT_FOOTER_TEXT || 'ออกแบบใบเสร็จรับเงิน ออกโดย วชิรดา');
        setShowPrintLineQr(configMap.SHOW_PRINT_LINE_QR !== 'false');
        setLineQrImageUrl(configMap.LINE_QR_IMAGE_URL || '');
      }

      const { data: roomsData } = await supabase
        .from('rooms')
        .select('*')
        .neq('status', 'รวมห้องคู่')
        .order('room_no', { ascending: true });
      if (roomsData) {
        setRooms(
          (roomsData as Room[]).filter(
            (r) => !['065', '145', '165', '187'].includes(r.room_no)
          )
        );
      }

      const { data: logsData } = await supabase
        .from('meter_logs')
        .select('*')
        .eq('period', activePeriod);
      if (logsData) setMeterLogs(logsData as MeterLog[]);

      const { data: allLogsData } = await supabase
        .from('meter_logs')
        .select('*')
        .order('period', { ascending: false });
      if (allLogsData) {
        setAllYearLogs(allLogsData as MeterLog[]);
      }

      const { data: txData } = await supabase
        .from('transactions')
        .select('*')
        .order('tx_date', { ascending: false })
        .limit(200);
      if (txData) setTransactions(txData);

      const { data: rulesData } = await supabase
        .from('line_auto_replies')
        .select('*')
        .order('sort_order', { ascending: true });
      if (rulesData) setLineRules(rulesData as LineAutoReplyRule[]);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSwitchViewingPeriod = async (newPeriod: string) => {
    setPeriod(newPeriod);
    setInlineEdits({});
    setSelectedRooms([]);
    await fetchData(newPeriod);
  };

  const handleSetAsActiveStaffPeriod = async (targetPeriod: string) => {
    try {
      await supabase
        .from('condo_config')
        .upsert(
          { key: 'CURRENT_BILLING_PERIOD', value: targetPeriod, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
      setStaffActivePeriod(targetPeriod);
      setConfig((prev) => ({ ...prev, CURRENT_BILLING_PERIOD: targetPeriod }));
      alert(`✅ ตั้งค่ารอบบิลปัจจุบันสำหรับแอปพนักงานจดมิเตอร์ (/meter) เป็นรอบ ${targetPeriod} เรียบร้อยแล้ว`);
    } catch (err: any) {
      alert('ตั้งค่ารอบบิลไม่สำเร็จ: ' + err.message);
    }
  };

  const logMap = useMemo(() => {
    const map: Record<string, MeterLog> = {};
    meterLogs.forEach((l) => {
      map[l.room_no] = l;
    });
    return map;
  }, [meterLogs]);

  // Check if current period is past the 5th (due day) inside useEffect for Next.js 16 prerender compatibility
  const [isCurrentPeriodPastDue, setIsCurrentPeriodPastDue] = useState(false);
  useEffect(() => {
    setIsCurrentPeriodPastDue(isPeriodPastDue(period, Number(dueDay) || 5));
  }, [period, dueDay]);

  // Determine if a room is Overdue (ค้างชำระ):
  // True if unpaid AND (past the 5th of the month OR manually marked as overdue)
  const isRoomOverdue = (log?: MeterLog): boolean => {
    if (log?.is_paid) return false;
    if (log?.followup_status === 'overdue' || log?.followup_status === 'unclear_slip') return true;
    return isCurrentPeriodPastDue;
  };

  const getRoomAnomaly = (room: Room, log?: MeterLog): string | null => {
    if (!log) return null;
    const prev = Number(log.prev_meter) || 0;
    const curr = Number(log.curr_meter) || 0;
    const units = Number(log.units_used) || 0;

    if (curr < prev) return '🚨 เลขมิเตอร์น้อยกว่าครั้งก่อน';
    if (!log.meter_photo_url) return '⚠️ จดเลขแล้วแต่ไม่มีรูปถ่าย';
    if (units > 30) return `⚠️ ใช้น้ำสูงผิดปกติ (${units} หน่วย)`;
    if (units === 0 && room.status === 'ปกติ') return 'ℹ️ ใช้น้ำ 0 หน่วย (โปรดเช็ครูป)';
    return null;
  };

  const readCount = useMemo(
    () => rooms.filter((r) => !!logMap[r.room_no]).length,
    [rooms, logMap]
  );
  const withPhotoCount = useMemo(
    () => rooms.filter((r) => !!logMap[r.room_no]?.meter_photo_url).length,
    [rooms, logMap]
  );
  const verifiedCount = useMemo(
    () => rooms.filter((r) => !!logMap[r.room_no]?.is_verified).length,
    [rooms, logMap]
  );
  const anomalyCount = useMemo(
    () => rooms.filter((r) => !!getRoomAnomaly(r, logMap[r.room_no])).length,
    [rooms, logMap]
  );
  const readPercentage = useMemo(() => {
    if (rooms.length === 0) return 0;
    return Math.round((readCount / rooms.length) * 100);
  }, [readCount, rooms.length]);

  const ownerCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    rooms.forEach((r) => {
      const oName = (r.owner_name || '').trim();
      if (oName) {
        map[oName] = (map[oName] || 0) + 1;
      }
    });
    return map;
  }, [rooms]);

  const ownerGroups = useMemo(() => {
    const groups: Record<
      string,
      {
        owner_name: string;
        rooms: Room[];
        totalOutstanding: number;
        totalFundCredit: number;
        totalPrepaid: number;
      }
    > = {};

    rooms.forEach((r) => {
      const oName = (r.owner_name || '').trim() || 'ไม่ระบุชื่อเจ้าของ';
      if (!groups[oName]) {
        groups[oName] = {
          owner_name: oName,
          rooms: [],
          totalOutstanding: 0,
          totalFundCredit: 0,
          totalPrepaid: 0,
        };
      }
      groups[oName].rooms.push(r);
      groups[oName].totalOutstanding += Number(r.outstanding_balance) || 0;
      groups[oName].totalFundCredit += Number(r.contribution_credit) || 0;
      groups[oName].totalPrepaid += Number(r.prepaid_credit) || 0;
    });

    return Object.values(groups).sort(
      (a, b) => b.rooms.length - a.rooms.length || a.owner_name.localeCompare(b.owner_name, 'th')
    );
  }, [rooms]);

  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      const formatted = formatRoomNo(r.room_no);
      const matchesSearch =
        searchQuery === '' ||
        r.room_no.includes(searchQuery) ||
        formatted.includes(searchQuery) ||
        (r.owner_name && r.owner_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (r.tenant_name && r.tenant_name.toLowerCase().includes(searchQuery.toLowerCase()));

      const log = logMap[r.room_no];
      const isRead = !!log;
      let matchesTabFilter = true;

      if (activeTab === 'audit') {
        if (auditFilter === 'has_photo') matchesTabFilter = isRead && !!log?.meter_photo_url;
        else if (auditFilter === 'unverified') matchesTabFilter = isRead && !log?.is_verified;
        else if (auditFilter === 'verified') matchesTabFilter = isRead && !!log?.is_verified;
        else if (auditFilter === 'anomaly') matchesTabFilter = !!getRoomAnomaly(r, log);
        else if (auditFilter === 'unread') matchesTabFilter = !isRead;
      } else if (activeTab === 'payments') {
        const isReceiptSent =
          log?.followup_status === 'receipt_sent' || (!!log?.slip_url && log.slip_url.includes('receipt'));
        if (paymentFilter === 'unpaid') matchesTabFilter = !log?.is_paid;
        else if (paymentFilter === 'overdue') matchesTabFilter = isRoomOverdue(log);
        else if (paymentFilter === 'paid') matchesTabFilter = !!log?.is_paid;
        else if (paymentFilter === 'receipt_unsent') matchesTabFilter = !!log?.is_paid && !isReceiptSent;
        else if (paymentFilter === 'receipt_sent') matchesTabFilter = !!log?.is_paid && isReceiptSent;
        else if (paymentFilter === 'late_paid') matchesTabFilter = !!log?.is_paid && !!log?.is_late_payment;
        else if (paymentFilter === 'line_notified') matchesTabFilter = log?.followup_status === 'line_notified';
        else if (paymentFilter === 'phone_called') matchesTabFilter = log?.followup_status === 'phone_called';
        else if (paymentFilter === 'multi_room') matchesTabFilter = (ownerCountMap[(r.owner_name || '').trim()] || 0) > 1;
      }

      return matchesSearch && matchesTabFilter;
    });
  }, [rooms, searchQuery, auditFilter, paymentFilter, activeTab, logMap, isCurrentPeriodPastDue, ownerCountMap]);

  const calculatedBills = useMemo(() => {
    return rooms.map((room) => {
      const log = logMap[room.room_no];
      const prev = log ? Number(log.prev_meter) : Number(room.latest_meter) || 0;
      const curr = log ? Number(log.curr_meter) : prev;
      return calculateBill(
        room,
        curr,
        period,
        config,
        log ? Number(log.special_items) || 0 : 0,
        log?.special_items_note || log?.note || '',
        Number(room.outstanding_balance) || 0,
        prev,
        log ? Number(log.late_fee) || 0 : 0,
        log && log.contribution_deducted !== undefined && log.contribution_deducted !== null
          ? Number(log.contribution_deducted)
          : 0
      );
    });
  }, [rooms, logMap, period, config]);

  const billMap = useMemo(() => {
    const map: Record<string, ReturnType<typeof calculateBill>> = {};
    calculatedBills.forEach((b) => {
      map[b.room_no] = b;
    });
    return map;
  }, [calculatedBills]);

  const billingSummary = useMemo(() => {
    let totalWaterUnits = 0;
    let totalWaterAmt = 0;
    let totalWastewaterAmt = 0;
    let totalCommonFee = 0;
    let totalContribDeducted = 0;
    let totalPrepaidDeducted = 0;
    let totalBilled = 0;

    calculatedBills.forEach((b) => {
      totalWaterUnits += b.units_used;
      totalWaterAmt += b.water_amount;
      totalWastewaterAmt += b.wastewater_amount;
      totalCommonFee += b.common_fee;
      totalContribDeducted += b.contribution_deducted;
      totalPrepaidDeducted += b.prepaid_deducted;
      totalBilled += b.total_amount;
    });

    return {
      totalWaterUnits,
      totalWaterAmt,
      totalWastewaterAmt,
      totalCommonFee,
      totalContribDeducted,
      totalPrepaidDeducted,
      totalBilled,
    };
  }, [calculatedBills]);

  const paidRoomsCount = useMemo(
    () => rooms.filter((r) => !!logMap[r.room_no]?.is_paid).length,
    [rooms, logMap]
  );
  const receiptSentCount = useMemo(
    () =>
      rooms.filter(
        (r) =>
          !!logMap[r.room_no]?.is_paid &&
          (logMap[r.room_no]?.followup_status === 'receipt_sent' ||
            (!!logMap[r.room_no]?.slip_url && logMap[r.room_no].slip_url!.includes('receipt')))
      ).length,
    [rooms, logMap]
  );
  const receiptUnsentCount = useMemo(
    () => Math.max(0, paidRoomsCount - receiptSentCount),
    [paidRoomsCount, receiptSentCount]
  );
  const latePaidRoomsCount = useMemo(
    () => rooms.filter((r) => !!logMap[r.room_no]?.is_paid && !!logMap[r.room_no]?.is_late_payment).length,
    [rooms, logMap]
  );
  const overdueRoomsCount = useMemo(
    () => rooms.filter((r) => isRoomOverdue(logMap[r.room_no])).length,
    [rooms, logMap, isCurrentPeriodPastDue]
  );

  const totalCollected = useMemo(() => {
    return rooms
      .filter((r) => !!logMap[r.room_no]?.is_paid)
      .reduce((sum, r) => sum + (Number(logMap[r.room_no]?.total_amount) || 0), 0);
  }, [rooms, logMap]);

  const totalContributionFund = useMemo(() => {
    return rooms.reduce((sum, r) => sum + (Number(r.contribution_credit) || 0), 0);
  }, [rooms]);

  const lineRegisteredCount = useMemo(() => {
    return rooms.filter((r) => !!r.line_user_id).length;
  }, [rooms]);

  const handleInlineMeterSave = async (room: Room, autoNext = false) => {
    const log = logMap[room.room_no];
    const draft = inlineEdits[room.room_no];

    const defaultPrev = log ? Number(log.prev_meter) : Number(room.latest_meter) || 0;
    const defaultCurr = log ? Number(log.curr_meter) : defaultPrev;

    const prevMeter =
      draft?.prev !== undefined && draft.prev !== '' ? Number(draft.prev) : defaultPrev;
    const currMeter =
      draft?.curr !== undefined && draft.curr !== '' ? Number(draft.curr) : defaultCurr;
    const unitsUsed = Math.max(0, currMeter - prevMeter);

    setSavingRoomNo(room.room_no);
    try {
      const billCalc = calculateBill(
        room,
        currMeter,
        period,
        config,
        log ? Number(log.special_items) || 0 : 0,
        log?.special_items_note || log?.note || '',
        Number(room.outstanding_balance) || 0,
        prevMeter,
        log ? Number(log.late_fee) || 0 : 0,
        log && log.contribution_deducted !== undefined && log.contribution_deducted !== null
          ? Number(log.contribution_deducted)
          : 0
      );

      const { data: savedLog, error: logErr } = await supabase
        .from('meter_logs')
        .upsert(
          {
            period,
            room_no: room.room_no,
            prev_meter: prevMeter,
            curr_meter: currMeter,
            units_used: unitsUsed,
            water_amount: billCalc.water_amount,
            wastewater_amount: billCalc.wastewater_amount,
            common_fee_amount: billCalc.common_fee,
            late_fee: billCalc.late_fee,
            special_items: billCalc.special_items,
            special_items_note: billCalc.special_items_note || null,
            contribution_deducted: billCalc.contribution_deducted,
            prepaid_deducted: billCalc.prepaid_deducted,
            total_amount: billCalc.total_amount,
            meter_photo_url: log?.meter_photo_url || null,
            note: log?.note || null,
            is_verified: true,
            recorded_at: new Date().toISOString(),
          },
          { onConflict: 'period,room_no' }
        )
        .select()
        .single();

      if (logErr) throw logErr;

      await supabase
        .from('rooms')
        .update({
          latest_meter: currMeter,
          updated_at: new Date().toISOString(),
        })
        .eq('room_no', room.room_no);

      if (savedLog) {
        setMeterLogs((prevLogs) => {
          const exists = prevLogs.some((l) => l.room_no === room.room_no);
          if (exists) {
            return prevLogs.map((l) => (l.room_no === room.room_no ? (savedLog as MeterLog) : l));
          }
          return [...prevLogs, savedLog as MeterLog];
        });
      }

      setRooms((prevRooms) =>
        prevRooms.map((r) => (r.room_no === room.room_no ? { ...r, latest_meter: currMeter } : r))
      );

      setSavedToastRoomNo(room.room_no);
      setTimeout(() => {
        setSavedToastRoomNo((prev) => (prev === room.room_no ? null : prev));
      }, 2000);

      if (autoNext) {
        const list = filteredRooms.length > 0 ? filteredRooms : rooms;
        const currIdx = list.findIndex((r) => r.room_no === room.room_no);
        if (currIdx >= 0 && currIdx + 1 < list.length) {
          setLightboxRoom(list[currIdx + 1]);
        } else {
          setLightboxRoom(null);
          alert('🎉 คุณตรวจสอบครบทุกห้องในรายการนี้แล้ว!');
        }
      }
    } catch (err: any) {
      alert('บันทึกเลขมิเตอร์ไม่สำเร็จ: ' + err.message);
    } finally {
      setSavingRoomNo(null);
    }
  };

  const handleNavigateLightboxRoom = (direction: -1 | 1) => {
    if (!lightboxRoom) return;
    const list = filteredRooms.length > 0 ? filteredRooms : rooms;
    const currIdx = list.findIndex((r) => r.room_no === lightboxRoom.room_no);
    const nextIdx = currIdx + direction;
    if (nextIdx >= 0 && nextIdx < list.length) {
      setLightboxRoom(list[nextIdx]);
    }
  };

  const handleVerifyAllReadLogs = async () => {
    try {
      await supabase
        .from('meter_logs')
        .update({ is_verified: true })
        .eq('period', period);
      setMeterLogs((prev) => prev.map((l) => ({ ...l, is_verified: true })));
      alert(`✅ ยืนยันความถูกต้องของค่ามิเตอร์ที่จดแล้วทั้งหมดในรอบ ${period} เรียบร้อยแล้ว`);
    } catch (err: any) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
    }
  };

  const handleOpenPrint = async (
    docType: 'invoice' | 'receipt' = 'invoice',
    targetRoomNos: string[] = []
  ) => {
    setIsGeneratingQr(true);
    setPrintDocType(docType);
    setPrintTargetRooms(targetRoomNos);

    const targetPromptPay = config.PROMPTPAY_NO || '0105555555555';
    const newQrMap: Record<string, string> = { ...qrMap };

    if (docType === 'invoice') {
      const billsToPrepare =
        targetRoomNos.length > 0
          ? calculatedBills.filter((b) => targetRoomNos.includes(b.room_no))
          : calculatedBills;

      for (const bill of billsToPrepare) {
        if (bill.total_amount > 0 && !newQrMap[bill.room_no]) {
          newQrMap[bill.room_no] = await generatePromptPayQRDataUrl(
            targetPromptPay,
            bill.total_amount,
            180
          );
        }
      }
      setQrMap(newQrMap);
    }

    setIsGeneratingQr(false);
    setShowPrintModal(true);
  };

  const handlePushLine = async (
    targetRoomNos: string[],
    mode: 'bill' | 'custom' = 'bill',
    customMsg = ''
  ) => {
    if (targetRoomNos.length === 0) {
      alert('กรุณาเลือกห้องที่ต้องการส่ง LINE อย่างน้อย 1 ห้อง');
      return;
    }

    setIsPushingLine(true);
    try {
      const res = await fetch('/api/line/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomNos: targetRoomNos,
          period,
          mode,
          customMessage: customMsg,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ส่งข้อความ LINE ไม่สำเร็จ');

      await fetchData(period);
      setPushCustomModalOpen(false);
      alert(
        `📲 ส่งข้อมูลผ่าน LINE OA สำเร็จ!\n• ส่งสำเร็จ: ${data.sentCount} ห้อง\n• ข้ามห้องที่ยังไม่ผูก LINE: ${data.skippedCount} ห้อง`
      );
    } catch (err: any) {
      alert('เกิดข้อผิดพลาดในการส่ง LINE: ' + err.message);
    } finally {
      setIsPushingLine(false);
    }
  };

  const handleUpdateFollowup = async (
    room: Room,
    status: 'none' | 'line_notified' | 'phone_called' | 'overdue'
  ) => {
    const log = logMap[room.room_no];
    const bill = billMap[room.room_no];
    try {
      const { data: savedLog, error } = await supabase
        .from('meter_logs')
        .upsert(
          {
            period,
            room_no: room.room_no,
            prev_meter: bill.prev_meter,
            curr_meter: bill.curr_meter,
            units_used: bill.units_used,
            water_amount: bill.water_amount,
            wastewater_amount: bill.wastewater_amount,
            common_fee_amount: bill.common_fee,
            late_fee: bill.late_fee,
            special_items: bill.special_items,
            special_items_note: bill.special_items_note || null,
            contribution_deducted: bill.contribution_deducted,
            prepaid_deducted: bill.prepaid_deducted,
            total_amount: bill.total_amount,
            followup_status: status,
            recorded_at: log?.recorded_at || new Date().toISOString(),
          },
          { onConflict: 'period,room_no' }
        )
        .select()
        .single();

      if (error) throw error;
      if (savedLog) {
        setMeterLogs((prev) => {
          const exists = prev.some((l) => l.room_no === room.room_no);
          return exists
            ? prev.map((l) => (l.room_no === room.room_no ? (savedLog as MeterLog) : l))
            : [...prev, savedLog as MeterLog];
        });
      }
    } catch (err: any) {
      alert('อัปเดตสถานะการติดตามไม่สำเร็จ: ' + err.message);
    }
  };

  const handleToggleLatePayment = async (room: Room) => {
    const log = logMap[room.room_no];
    if (!log) return;
    const nextLate = !log.is_late_payment;
    try {
      const { data: savedLog, error } = await supabase
        .from('meter_logs')
        .update({ is_late_payment: nextLate })
        .eq('id', log.id)
        .select()
        .single();
      if (error) throw error;
      if (savedLog) {
        setMeterLogs((prev) =>
          prev.map((l) => (l.room_no === room.room_no ? (savedLog as MeterLog) : l))
        );
      }
    } catch (err: any) {
      alert('อัปเดตสถานะชำระล่าช้าไม่สำเร็จ: ' + err.message);
    }
  };

  const handleCancelPayment = async (room: Room) => {
    const log = logMap[room.room_no];
    if (!log) return;
    const ok = window.confirm(
      `ยืนยันการยกเลิกสถานะ "ชำระแล้ว" ของห้อง ${formatRoomNo(room.room_no)} (รอบบิล ${period}) เพื่อกลับไปเป็นสถานะ "รอชำระ" ใช่หรือไม่?`
    );
    if (!ok) return;

    try {
      await supabase
        .from('meter_logs')
        .update({ is_paid: false, is_late_payment: false, paid_type: null, paid_timestamp: null })
        .eq('id', log.id);
      await fetchData(period);
    } catch (err: any) {
      alert('ยกเลิกการชำระไม่สำเร็จ: ' + err.message);
    }
  };

  const handleUnlinkLineRoom = async (room: Room) => {
    const ok = window.confirm(
      `🔓 ยืนยันการยกเลิกผูกบัญชี LINE ของห้อง ${formatRoomNo(room.room_no)} (${room.owner_name || room.tenant_name || '-'})?\n\nหลังจากยกเลิกแล้ว ผู้รับคนเดิมจะไม่สามารถดูบิลห้องนี้ได้อีก และผู้รับคนใหม่สามารถพิมพ์รหัส 6 หลักเข้ามาลงทะเบียนผูกห้องแทนได้ทันที`
    );
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('rooms')
        .update({ line_user_id: '', updated_at: new Date().toISOString() })
        .eq('room_no', room.room_no);

      if (error) throw error;
      setRooms((prev) =>
        prev.map((r) => (r.room_no === room.room_no ? { ...r, line_user_id: '' } : r))
      );
    } catch (err: any) {
      alert('ยกเลิกการผูก LINE ไม่สำเร็จ: ' + err.message);
    }
  };

  const handleSaveLineRule = async () => {
    const rawBubbles = Array.isArray(editingRule?.reply_bubbles) && editingRule.reply_bubbles.length > 0
      ? editingRule.reply_bubbles.map((b) => b.trim()).filter(Boolean)
      : (editingRule?.reply_text ? [editingRule.reply_text.trim()] : []);

    const primaryText = rawBubbles[0] || editingRule?.reply_text?.trim() || '';

    if (!editingRule || !editingRule.keyword?.trim() || !primaryText) {
      alert('กรุณากรอกคีย์เวิร์ดและข้อความตอบกลับอย่างน้อย 1 กล่องข้อความ');
      return;
    }

    try {
      if (editingRule.id) {
        const { error } = await supabase
          .from('line_auto_replies')
          .update({
            keyword: editingRule.keyword.trim(),
            match_type: editingRule.match_type || 'contains',
            reply_mode: editingRule.reply_mode || 'custom_text',
            reply_text: primaryText,
            reply_bubbles: rawBubbles.length > 0 ? rawBubbles : [primaryText],
            description: editingRule.description || '',
            is_active: editingRule.is_active ?? true,
            sort_order: Number(editingRule.sort_order) || 10,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingRule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('line_auto_replies').insert({
          keyword: editingRule.keyword.trim(),
          match_type: editingRule.match_type || 'contains',
          reply_mode: editingRule.reply_mode || 'custom_text',
          reply_text: primaryText,
          reply_bubbles: rawBubbles.length > 0 ? rawBubbles : [primaryText],
          description: editingRule.description || '',
          is_active: true,
          sort_order: lineRules.length + 1,
        });
        if (error) throw error;
      }

      setEditingRule(null);
      await fetchData(period);
    } catch (err: any) {
      alert('บันทึกคีย์เวิร์ดไม่สำเร็จ: ' + err.message);
    }
  };

  const handleDeleteLineRule = async (id: string) => {
    if (!window.confirm('ยืนยันการลบคีย์เวิร์ดตอบกลับนี้?')) return;
    await supabase.from('line_auto_replies').delete().eq('id', id);
    await fetchData(period);
  };

  const handleToggleLineRule = async (rule: LineAutoReplyRule) => {
    await supabase
      .from('line_auto_replies')
      .update({ is_active: !rule.is_active })
      .eq('id', rule.id);
    setLineRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r))
    );
  };

  const handleToggleTxPaid = async (txId: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    const { error } = await supabase
      .from('transactions')
      .update({ is_paid: newStatus })
      .eq('id', txId);
    if (error) {
      alert('ไม่สามารถอัปเดตสถานะได้: ' + error.message);
      return;
    }
    setTransactions((prev) =>
      prev.map((t) => (t.id === txId ? { ...t, is_paid: newStatus } : t))
    );
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!window.confirm('ยืนยันการลบรายการบัญชีนี้?')) return;
    await supabase.from('transactions').delete().eq('id', id);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const handleTestLineCode = () => {
    const clean = testLineCode.replace(/[^0-9]/g, '');
    if (clean.length !== 7) {
      setTestLineResult({ match: false, message: 'โปรดระบุตัวเลข 7 หลัก (เลขห้อง 3 หลัก + เบอร์โทร 4 ตัวท้าย)' });
      return;
    }

    const rawPrefix = clean.substring(0, 3);
    const roomPrefix = resolveRoomNo(rawPrefix);
    const phoneSuffix = clean.substring(3, 7);

    const room = rooms.find((r) => r.room_no === roomPrefix);
    if (!room) {
      setTestLineResult({ match: false, message: `ไม่พบห้อง ${formatRoomNo(roomPrefix)} ในระบบ` });
      return;
    }

    const oPhones = (room.owner_phone || '').split(/[,/]/).map((p) => p.replace(/[^0-9]/g, '')).filter((p) => p.length >= 4);
    const tPhones = (room.tenant_phone || '').split(/[,/]/).map((p) => p.replace(/[^0-9]/g, '')).filter((p) => p.length >= 4);

    const matchOwner = oPhones.some((p) => p.endsWith(phoneSuffix));
    const matchTenant = tPhones.some((p) => p.endsWith(phoneSuffix));

    if (matchOwner || matchTenant) {
      setTestLineResult({
        match: true,
        message: `✅ ตรวจสอบถูกต้อง! ตรงกับห้อง ${formatRoomNo(roomPrefix)} (${matchOwner ? `เจ้าของ: ${room.owner_name || '-'}` : `ผู้เช่า: ${room.tenant_name || '-'}`}) เบอร์ลงท้าย ${phoneSuffix}`,
      });
    } else {
      setTestLineResult({
        match: false,
        message: `❌ เลขห้อง ${formatRoomNo(roomPrefix)} พบในระบบ แต่เบอร์โทร 4 ตัวท้าย (${phoneSuffix}) ไม่ตรงกับที่แจ้งไว้ (เบอร์เจ้าของ: ${room.owner_phone || '-'})`,
      });
    }
  };

  const handleUploadLineQrImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploadingLineQr(true);
      const ext = file.name.split('.').pop() || 'png';
      const path = `line-qr/line_qr_${Date.now()}.${ext}`;
      const { data, error } = await supabase.storage.from('slips').upload(path, file, {
        cacheControl: '3600',
        upsert: true,
      });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('slips').getPublicUrl(data.path);
      setLineQrImageUrl(urlData.publicUrl);
    } catch (err: any) {
      alert('เกิดข้อผิดพลาดในการอัปโหลดรูป: ' + err.message);
    } finally {
      setIsUploadingLineQr(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const updates = [
        { key: 'WATER_RATE_PER_UNIT', value: waterRate },
        { key: 'WASTEWATER_RATE_PER_UNIT', value: wastewaterRate },
        { key: 'COMMON_FEE_BIG', value: feeBig },
        { key: 'COMMON_FEE_SMALL', value: feeSmall },
        { key: 'PROMPTPAY_NO', value: promptpayNo },
        { key: 'BANK_NAME', value: bankName },
        { key: 'BANK_ACCOUNT_NO', value: bankAccNo },
        { key: 'BANK_ACCOUNT_NAME', value: bankAccName },
        { key: 'BILL_DUE_DAY', value: dueDay },
        { key: 'CURRENT_BILLING_PERIOD', value: staffActivePeriod },
        { key: 'LINE_CHANNEL_SECRET', value: lineSecret },
        { key: 'LINE_CHANNEL_ACCESS_TOKEN', value: lineAccessToken },
        { key: 'RECEIPT_FOOTER_TEXT', value: receiptFooterText },
        { key: 'SHOW_PRINT_LINE_QR', value: showPrintLineQr ? 'true' : 'false' },
        { key: 'LINE_QR_IMAGE_URL', value: lineQrImageUrl },
      ];

      for (const item of updates) {
        await supabase
          .from('condo_config')
          .upsert({ key: item.key, value: item.value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      }

      setConfig((prev) => ({
        ...prev,
        WATER_RATE_PER_UNIT: waterRate,
        WASTEWATER_RATE_PER_UNIT: wastewaterRate,
        COMMON_FEE_BIG: feeBig,
        COMMON_FEE_SMALL: feeSmall,
        PROMPTPAY_NO: promptpayNo,
        BANK_NAME: bankName,
        BANK_ACCOUNT_NO: bankAccNo,
        BANK_ACCOUNT_NAME: bankAccName,
        BILL_DUE_DAY: dueDay,
        CURRENT_BILLING_PERIOD: staffActivePeriod,
        LINE_CHANNEL_SECRET: lineSecret,
        LINE_CHANNEL_ACCESS_TOKEN: lineAccessToken,
        RECEIPT_FOOTER_TEXT: receiptFooterText,
        SHOW_PRINT_LINE_QR: showPrintLineQr ? 'true' : 'false',
        LINE_QR_IMAGE_URL: lineQrImageUrl,
      }));

      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (err: any) {
      alert('บันทึกการตั้งค่าไม่สำเร็จ: ' + err.message);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Room',
      'Type',
      'Status',
      'Owner',
      'Phone',
      'PrevMeter',
      'CurrMeter',
      'Units',
      'Water35',
      'Wastewater5',
      'CommonFee',
      'SpecialItems',
      'CreditDeducted',
      'TotalDue',
      'PaymentStatus',
      'PaymentMethod',
    ];
    const rows = calculatedBills.map((b) => {
      const r = rooms.find((rm) => rm.room_no === b.room_no);
      const l = logMap[b.room_no];
      const statusText = l?.is_paid
        ? l.is_late_payment
          ? 'PAID_LATE'
          : 'PAID'
        : isRoomOverdue(l)
        ? 'OVERDUE'
        : 'UNPAID';
      return [
        b.formatted_room,
        r?.room_type || '',
        r?.status || '',
        `"${(r?.owner_name || '').replace(/"/g, '""')}"`,
        r?.owner_phone || '',
        b.prev_meter,
        b.curr_meter,
        b.units_used,
        b.water_amount,
        b.wastewater_amount,
        b.common_fee,
        b.special_items,
        b.contribution_deducted + b.prepaid_deducted,
        b.total_amount,
        statusText,
        l?.paid_type || '',
      ].join(',');
    });
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `somboon-condo-bills-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [viewYear, viewMonth] = (period || '2026-11').split('-');
  const [staffYear, staffMonth] = (staffActivePeriod || '2026-11').split('-');

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-800">
      {/* Top Header with Easy Period Stepper */}
      <header className="bg-slate-900 text-white sticky top-0 z-40 shadow-md print:hidden">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-sky-400 flex items-center justify-center font-bold text-white shadow">
              674
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>{config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์'}</span>
                <span className="text-[10px] bg-slate-800 text-sky-300 px-2 py-0.5 rounded-full font-mono border border-slate-700">
                  ระบบบริหารนิติบุคคล v2.14
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">
                195 ห้องชุด (รวมห้องคู่ 4 คู่ = {rooms.length} มิเตอร์) • รอบบิลพนักงานปัจจุบัน:{' '}
                <b className="text-sky-300">{staffActivePeriod}</b>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="bg-slate-800 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 border border-slate-700">
              <span className="text-slate-300 text-[11px] mr-1">📅 รอบบิลที่ดู:</span>
              <button
                type="button"
                onClick={() => handleSwitchViewingPeriod(shiftYearMonth(period, -1))}
                className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold"
                title="เลื่อนไปเดือนก่อนหน้า"
              >
                ◀
              </button>

              <select
                value={viewMonth || '11'}
                onChange={(e) => handleSwitchViewingPeriod(`${viewYear || '2026'}-${e.target.value}`)}
                className="bg-slate-900 text-sky-400 font-bold px-2 py-1 rounded-lg border border-slate-600 outline-none"
              >
                {THAI_MONTHS.map((m) => (
                  <option key={m.num} value={m.num}>
                    {m.label}
                  </option>
                ))}
              </select>

              <select
                value={viewYear || '2026'}
                onChange={(e) => handleSwitchViewingPeriod(`${e.target.value}-${viewMonth || '11'}`)}
                className="bg-slate-900 text-sky-400 font-mono font-bold px-2 py-1 rounded-lg border border-slate-600 outline-none"
              >
                {YEARS_LIST.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => handleSwitchViewingPeriod(shiftYearMonth(period, 1))}
                className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold"
                title="เลื่อนไปเดือนถัดไป"
              >
                ▶
              </button>

              {period !== staffActivePeriod && (
                <button
                  type="button"
                  onClick={() => handleSetAsActiveStaffPeriod(period)}
                  className="ml-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-[10px]"
                >
                  ⏭️ ตั้งเป็นรอบพนักงาน
                </button>
              )}
            </div>

            <a
              href="/meter"
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600 text-white font-bold rounded-xl text-xs shadow-md flex items-center gap-1.5 transition active:scale-95 border border-sky-400/30"
            >
              <span>📱 หน้าจดมิเตอร์ (พนักงาน)</span>
              <span className="text-sky-200">↗</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Navigation Tabs (Removed KPI label from Tab 3) */}
      <nav className="bg-white border-b shadow-sm sticky top-[64px] z-30 overflow-x-auto text-xs print:hidden">
        <div className="max-w-7xl mx-auto flex">
          {[
            { id: 'audit', label: '🔍 ตรวจมิเตอร์ & รูปถ่าย', count: `${readCount}/${rooms.length}` },
            { id: 'billing', label: '🧾 ออกบิล / ส่วนลด / ส่ง LINE' },
            { id: 'payments', label: '💰 รับชำระ & ออกใบเสร็จ', count: `${paidRoomsCount}/${rooms.length}` },
            { id: 'rooms', label: '🏢 ทะเบียนห้องชุด & สมทบทุน' },
            { id: 'accounting', label: '📊 บัญชี & รายงานส่งมอบนิติ' },
            { id: 'line', label: '📲 LINE OA & ตั้งค่าคีย์เวิร์ด', count: `${lineRegisteredCount}/${rooms.length}` },
            { id: 'settings', label: '⚙️ ตั้งค่าระบบ' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3.5 px-3.5 font-bold border-b-2 whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                    activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto w-full p-3 sm:p-5 flex-1 space-y-4 print:hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">กำลังโหลดข้อมูลรอบบิล {period}...</p>
          </div>
        ) : (
          <>
            {/* Shared Search-Only Bar (Room Range Buttons Removed as Requested!) */}
            {['audit', 'billing', 'payments', 'rooms'].includes(activeTab) && (
              <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200 text-xs">
                <div className="relative w-full">
                  <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ค้นหาเลขห้อง (เช่น 005, 64-65, 144-145) หรือชื่อเจ้าของ/ผู้เช่า..."
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 text-sm"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 1: METER VERIFICATION & PHOTO AUDIT                               */}
            {/* ===================================================================== */}
            {activeTab === 'audit' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
                    <span className="text-slate-500 block">ความคืบหน้าการจด ({period})</span>
                    <div className="text-lg font-bold text-blue-700 font-mono mt-0.5">
                      {readCount} / {rooms.length} มิเตอร์ ({readPercentage}%)
                    </div>
                    <span className="text-[11px] text-emerald-700 font-medium">
                      📷 มีรูปถ่าย {withPhotoCount} ห้อง
                    </span>
                  </div>

                  <div className="bg-white p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/30 shadow-xs">
                    <span className="text-emerald-800 font-bold block">✅ นิติตรวจยืนยันแล้ว</span>
                    <div className="text-lg font-bold text-emerald-700 font-mono mt-0.5">
                      {verifiedCount} / {readCount} ห้องที่จด
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyAllReadLogs}
                      className="mt-1 text-[11px] text-blue-600 hover:underline font-bold"
                    >
                      ✓ กดยืนยันทั้งหมดที่จดแล้ว
                    </button>
                  </div>

                  <div className="bg-white p-3.5 rounded-2xl border border-amber-200 bg-amber-50/40 shadow-xs">
                    <span className="text-amber-800 font-bold block">⚠️ จุดสังเกต / ควรตรวจเช็ค</span>
                    <div className="text-lg font-bold text-amber-700 font-mono mt-0.5">
                      {anomalyCount} ห้อง
                    </div>
                    <span className="text-[11px] text-amber-700">
                      น้ำ 0 หน่วย / สูงเกิน 30 หน่วย / ไม่มีรูป
                    </span>
                  </div>

                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                    <div>
                      <span className="text-slate-500 block">หน่วยน้ำรวมรอบนี้</span>
                      <div className="text-lg font-bold text-slate-800 font-mono mt-0.5">
                        {billingSummary.totalWaterUnits.toLocaleString()} หน่วย
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('billing')}
                      className="mt-1 w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-[11px]"
                    >
                      ตรวจเสร็จแล้ว ➔ ไปหน้าออกบิล ▶
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 rounded-2xl border border-slate-200 text-xs">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'all', label: `ทั้งหมด (${rooms.length})` },
                      { id: 'has_photo', label: `📷 มีรูปถ่าย (${withPhotoCount})` },
                      { id: 'unverified', label: `⏳ รอนิติตรวจ (${Math.max(0, readCount - verifiedCount)})` },
                      { id: 'verified', label: `✅ ตรวจยืนยันแล้ว (${verifiedCount})` },
                      { id: 'anomaly', label: `⚠️ ควรตรวจซ้ำ (${anomalyCount})` },
                      { id: 'unread', label: `ยังไม่จด (${rooms.length - readCount})` },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setAuditFilter(f.id as any)}
                        className={`px-3 py-1.5 rounded-xl font-bold transition ${
                          auditFilter === f.id
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (filteredRooms.length > 0) {
                          setLightboxRoom(filteredRooms[0]);
                        }
                      }}
                      className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold rounded-xl shadow flex items-center gap-1.5"
                    >
                      🔍 เปิดโหมดขยายตรวจต่อเนื่องทีละห้อง ▶
                    </button>
                    <button
                      type="button"
                      onClick={() => fetchData(period)}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                    >
                      🔄 รีเฟรช
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredRooms.length === 0 ? (
                    <div className="col-span-full bg-white p-10 text-center text-slate-400 rounded-2xl border">
                      ไม่พบห้องที่ตรงกับเงื่อนไขการค้นหา
                    </div>
                  ) : (
                    filteredRooms.map((room) => {
                      const log = logMap[room.room_no];
                      const isRead = !!log;
                      const isVerified = !!log?.is_verified;
                      const draft = inlineEdits[room.room_no];

                      const prevVal =
                        draft?.prev !== undefined
                          ? draft.prev
                          : String(log ? Number(log.prev_meter) : Number(room.latest_meter) || 0);

                      const currVal =
                        draft?.curr !== undefined
                          ? draft.curr
                          : log
                          ? String(log.curr_meter)
                          : '';

                      const prevNum = Number(prevVal) || 0;
                      const currNum = currVal === '' ? prevNum : Number(currVal);
                      const unitsUsed = Math.max(0, currNum - prevNum);
                      const waterAmt = unitsUsed * (Number(waterRate) || 35);
                      const wasteAmt = unitsUsed * (Number(wastewaterRate) || 5);
                      const anomaly = getRoomAnomaly(room, log);

                      return (
                        <div
                          key={room.room_no}
                          className={`bg-white rounded-2xl border p-3.5 shadow-xs flex flex-col sm:flex-row gap-3.5 transition ${
                            anomaly
                              ? 'border-amber-300 bg-amber-50/10'
                              : isVerified
                              ? 'border-emerald-400 bg-emerald-50/10'
                              : isRead
                              ? 'border-sky-300'
                              : 'border-slate-200'
                          }`}
                        >
                          {/* LEFT: METER PHOTO BOX */}
                          <div className="w-full sm:w-44 shrink-0 flex flex-col">
                            {log?.meter_photo_url ? (
                              <div
                                onClick={() => setLightboxRoom(room)}
                                className="relative group aspect-4/3 sm:h-36 bg-slate-950 rounded-xl overflow-hidden border border-slate-300 cursor-pointer"
                              >
                                <img
                                  src={log.meter_photo_url}
                                  alt={`มิเตอร์ ${room.room_no}`}
                                  className="w-full h-full object-contain bg-black group-hover:scale-105 transition duration-200"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                                  <span className="bg-black/75 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow">
                                    🔍 ขยายตรวจ & ถัดไป
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div
                                onClick={() => setReadingModalRoom(room)}
                                className="aspect-4/3 sm:h-36 bg-slate-100 hover:bg-slate-200/70 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400 cursor-pointer p-2 text-center transition"
                              >
                                <span className="text-2xl mb-1">📷</span>
                                <span className="text-[11px] font-bold text-slate-600">
                                  {isRead ? 'ไม่มีรูปถ่ายแนบมา' : 'ยังไม่ได้ถ่ายรูป'}
                                </span>
                                <span className="text-[10px] text-blue-600 underline mt-0.5">
                                  กดเพื่อถ่าย/อัปโหลดรูป
                                </span>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-1 mt-2">
                              <button
                                type="button"
                                onClick={() => setLightboxRoom(room)}
                                className="py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] rounded-lg transition"
                              >
                                🔍 ขยายตรวจ
                              </button>
                              <button
                                type="button"
                                onClick={() => setReadingModalRoom(room)}
                                className="py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg transition"
                              >
                                📸 เปลี่ยนรูป
                              </button>
                            </div>
                          </div>

                          {/* RIGHT: METER NUMBERS COMPARISON & INLINE EDIT */}
                          <div className="flex-1 flex flex-col justify-between space-y-2.5 text-xs">
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-base font-bold text-blue-700 font-mono">
                                    ห้อง {formatRoomNo(room.room_no)}
                                  </span>
                                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                                    {room.room_type}
                                  </span>
                                </div>

                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    isVerified
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : isRead
                                      ? 'bg-sky-100 text-sky-800'
                                      : 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  {isVerified
                                    ? '✅ ตรวจยืนยันแล้ว'
                                    : isRead
                                    ? '📷 จดแล้ว-รอตรวจ'
                                    : '⏳ รอจด'}
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {room.owner_name || 'เจ้าของห้อง'}
                              </div>

                              {anomaly && (
                                <div className="mt-1.5 px-2.5 py-1 bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-[11px] font-bold">
                                  {anomaly}
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                              <div>
                                <label className="text-[10px] text-slate-500 block mb-0.5">
                                  เลขครั้งก่อน
                                </label>
                                <input
                                  type="number"
                                  value={prevVal}
                                  onChange={(e) =>
                                    setInlineEdits((prev) => ({
                                      ...prev,
                                      [room.room_no]: {
                                        prev: e.target.value,
                                        curr: currVal,
                                      },
                                    }))
                                  }
                                  className="w-full font-mono font-bold text-sm text-slate-700 bg-white border border-slate-300 rounded-lg px-2 py-1.5"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] font-bold text-blue-700 block mb-0.5">
                                  เลขครั้งนี้ (แก้ได้)
                                </label>
                                <input
                                  type="number"
                                  value={currVal}
                                  placeholder={String(prevNum)}
                                  onChange={(e) =>
                                    setInlineEdits((prev) => ({
                                      ...prev,
                                      [room.room_no]: {
                                        prev: prevVal,
                                        curr: e.target.value,
                                      },
                                    }))
                                  }
                                  className="w-full font-mono font-bold text-sm text-blue-700 bg-white border-2 border-blue-400 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                              </div>

                              <div className="flex flex-col justify-center items-end pr-1">
                                <span className="text-sm font-bold font-mono text-emerald-700">
                                  ใช้ {unitsUsed} หน่วย
                                </span>
                                <span className="text-[10px] text-slate-600">
                                  ค่าน้ำ(35): {waterAmt.toLocaleString()} บ.
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  บำบัด(5): {wasteAmt.toLocaleString()} บ.
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setLightboxRoom(room)}
                                className="text-[11px] text-indigo-600 hover:underline font-bold"
                              >
                                🔍 ขยายเต็มจอ
                              </button>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {savedToastRoomNo === room.room_no && (
                                  <span className="text-[11px] font-bold text-emerald-600">
                                    ✅ ยืนยันแล้ว!
                                  </span>
                                )}
                                <button
                                  type="button"
                                  disabled={savingRoomNo === room.room_no}
                                  onClick={() => handleInlineMeterSave(room, false)}
                                  className={`px-3 py-1.5 font-bold rounded-xl shadow-xs text-xs transition disabled:opacity-50 ${
                                    isVerified
                                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                                  }`}
                                >
                                  {savingRoomNo === room.room_no
                                    ? 'กำลังบันทึก...'
                                    : isVerified
                                    ? '✅ ยืนยันแล้ว'
                                    : '💾 บันทึกยืนยัน'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 2: BILLING (DEDICATED TO INVOICES & LINE PUSH)                    */}
            {/* ===================================================================== */}
            {activeTab === 'billing' && (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center justify-between">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base">
                      ระบบออกใบแจ้งหนี้ (บิล) / ปรับปรุงรายการ / ส่งบิล LINE (รอบบิล {period})
                    </h2>
                    <p className="text-xs text-slate-500">
                      แยกแสดงค่าน้ำประปา (35 บ./หน่วย) และค่าบำบัดน้ำเสีย (5 บ./หน่วย) • รองรับห้องคู่ 674/64-65, 144-145, 164-165, 186-187
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isGeneratingQr}
                      onClick={() => handleOpenPrint('invoice', [])}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow text-xs flex items-center gap-1.5"
                    >
                      {isGeneratingQr ? 'กำลังสร้าง QR...' : '🖨️ พิมพ์ใบแจ้งหนี้ 4 บิลต่อ 1 A4 (ทั้งหมด)'}
                    </button>
                  </div>
                </div>

                {/* Smart Selection & Batch Action Toolbar */}
                <div className="bg-slate-900 text-white p-3.5 rounded-2xl shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-sky-400 mr-1">
                      ☑️ เลือกแล้ว {selectedRooms.length} ห้อง:
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedRooms(filteredRooms.map((r) => r.room_no))}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium"
                    >
                      เลือกทั้งหมดในหน้านี้
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const unpushedLineRooms = rooms
                          .filter((r) => !!r.line_user_id && !logMap[r.room_no]?.line_push_status)
                          .map((r) => r.room_no);
                        setSelectedRooms(unpushedLineRooms);
                      }}
                      className="px-2.5 py-1 bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-700 rounded-lg font-medium"
                    >
                      📲 เลือกห้องผูก LINE ที่ยังไม่ส่งบิล
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const paperOnlyRooms = rooms
                          .filter((r) => !r.line_user_id && r.status === 'ปกติ')
                          .map((r) => r.room_no);
                        setSelectedRooms(paperOnlyRooms);
                      }}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium"
                    >
                      🖨️ เลือกห้องไม่มี LINE (พิมพ์กระดาษ)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const unpaidLineRooms = rooms
                          .filter((r) => !!r.line_user_id && !logMap[r.room_no]?.is_paid)
                          .map((r) => r.room_no);
                        setSelectedRooms(unpaidLineRooms);
                      }}
                      className="px-2.5 py-1 bg-amber-900/80 hover:bg-amber-800 text-amber-200 border border-amber-700 rounded-lg font-medium"
                    >
                      ⏳ เลือกห้องค้างชำระที่มี LINE
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const multiRooms = rooms
                          .filter((r) => (ownerCountMap[(r.owner_name || '').trim()] || 0) > 1)
                          .map((r) => r.room_no);
                        setSelectedRooms(multiRooms);
                      }}
                      className="px-2.5 py-1 bg-purple-900/80 hover:bg-purple-800 text-purple-200 border border-purple-700 rounded-lg font-medium"
                    >
                      👥 เลือกเฉพาะเจ้าของหลายห้อง
                    </button>
                    {selectedRooms.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedRooms([])}
                        className="px-2.5 py-1 bg-red-900/80 hover:bg-red-800 text-red-200 rounded-lg font-medium"
                      >
                        ✕ ล้างที่เลือก
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={selectedRooms.length === 0 || isGeneratingQr}
                      onClick={() => handleOpenPrint('invoice', selectedRooms)}
                      className="px-3.5 py-1.5 bg-white text-slate-900 hover:bg-slate-100 font-bold rounded-xl disabled:opacity-40"
                    >
                      🖨️ พิมพ์บิลที่เลือก ({selectedRooms.length})
                    </button>
                    <button
                      type="button"
                      disabled={selectedRooms.length === 0 || isPushingLine}
                      onClick={() => handlePushLine(selectedRooms, 'bill')}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl disabled:opacity-40"
                    >
                      {isPushingLine ? 'กำลังส่ง...' : `📲 ส่งบิล LINE ที่เลือก (${selectedRooms.length})`}
                    </button>
                    <button
                      type="button"
                      disabled={selectedRooms.length === 0 || isPushingLine}
                      onClick={() => setPushCustomModalOpen(true)}
                      className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl disabled:opacity-40"
                    >
                      🔔 ส่งข้อความแจ้งเตือนที่เลือก ({selectedRooms.length})
                    </button>
                    <button
                      type="button"
                      disabled={selectedRooms.length === 0}
                      onClick={() => setBatchDeductionModalOpen(true)}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl disabled:opacity-40 shadow-xs"
                    >
                      💰 จัดการลดหย่อนที่เลือก ({selectedRooms.length})
                    </button>
                  </div>
                </div>

                {/* Separated Calculation Cards Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">1. รวมค่าน้ำประปา (35 บ./น.)</span>
                    <span className="text-base font-bold text-slate-800 font-mono">
                      {billingSummary.totalWaterAmt.toLocaleString()} บ.
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">2. รวมค่าบำบัดน้ำเสีย (5 บ./น.)</span>
                    <span className="text-base font-bold text-slate-800 font-mono">
                      {billingSummary.totalWastewaterAmt.toLocaleString()} บ.
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">3. รวมค่าส่วนกลาง</span>
                    <span className="text-base font-bold text-slate-800 font-mono">
                      {billingSummary.totalCommonFee.toLocaleString()} บ.
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">หักเครดิตสมทบทุนซ่อมตึก</span>
                    <span className="text-base font-bold text-emerald-700 font-mono">
                      -{billingSummary.totalContribDeducted.toLocaleString()} บ.
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200 bg-blue-50/30">
                    <span className="text-slate-500 block">ยอดรวมเรียกเก็บสุทธิทั้งตึก</span>
                    <span className="text-base font-bold text-blue-700 font-mono">
                      {billingSummary.totalBilled.toLocaleString()} บ.
                    </span>
                  </div>
                </div>

                {/* Bills Management Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b">
                        <tr>
                          <th className="py-2.5 px-2 text-center w-8">
                            <input
                              type="checkbox"
                              checked={
                                filteredRooms.length > 0 &&
                                filteredRooms.every((r) => selectedRooms.includes(r.room_no))
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedRooms(filteredRooms.map((r) => r.room_no));
                                } else {
                                  setSelectedRooms([]);
                                }
                              }}
                              className="rounded"
                            />
                          </th>
                          <th className="py-2.5 px-2 text-left">ห้อง</th>
                          <th className="py-2.5 px-2 text-right">มิเตอร์ (หน่วย)</th>
                          <th className="py-2.5 px-2 text-right">ค่าน้ำ (35 บ.)</th>
                          <th className="py-2.5 px-2 text-right">ค่าบำบัด (5 บ.)</th>
                          <th className="py-2.5 px-2 text-right">ส่วนกลาง</th>
                          <th className="py-2.5 px-2 text-right">รายการเพิ่ม/ส่วนลด</th>
                          <th className="py-2.5 px-2 text-right">ลดหย่อน (เงินสมทบ)</th>
                          <th className="py-2.5 px-2 text-right font-bold">ยอดสุทธิ</th>
                          <th className="py-2.5 px-2 text-center">สถานะ LINE</th>
                          <th className="py-2.5 px-2 text-center">จัดการบิล / พิมพ์บิล / ส่ง LINE</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-800">
                        {filteredRooms.map((room) => {
                          const bill = billMap[room.room_no];
                          if (!bill) return null;
                          const log = logMap[room.room_no];
                          const isSelected = selectedRooms.includes(room.room_no);
                          const hasLine = !!room.line_user_id;

                          return (
                            <tr
                              key={room.room_no}
                              className={`hover:bg-slate-50 ${isSelected ? 'bg-blue-50/40' : ''}`}
                            >
                              <td className="py-2 px-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedRooms((prev) => [...prev, room.room_no]);
                                    } else {
                                      setSelectedRooms((prev) => prev.filter((id) => id !== room.room_no));
                                    }
                                  }}
                                  className="rounded"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <div className="font-bold text-blue-700 font-mono">{bill.formatted_room}</div>
                                <div className="text-[10px] text-slate-500 truncate max-w-[100px]">
                                  {room.owner_name || room.room_type}
                                </div>
                              </td>
                              <td className="py-2 px-2 text-right font-mono">
                                <span className="text-slate-500 text-[11px]">
                                  {bill.prev_meter}➔{bill.curr_meter}
                                </span>{' '}
                                <b className="text-slate-900">({bill.units_used})</b>
                              </td>
                              <td className="py-2 px-2 text-right font-mono">
                                {bill.water_amount.toFixed(2)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono">
                                {bill.wastewater_amount.toFixed(2)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono">
                                {bill.common_fee.toFixed(2)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono">
                                {bill.special_items !== 0 || bill.late_fee > 0 ? (
                                  <div>
                                    <span
                                      className={`font-bold ${
                                        bill.special_items < 0 ? 'text-emerald-600' : 'text-amber-700'
                                      }`}
                                    >
                                      {bill.special_items + bill.late_fee > 0
                                        ? `+${(bill.special_items + bill.late_fee).toFixed(2)}`
                                        : (bill.special_items + bill.late_fee).toFixed(2)}
                                    </span>
                                    {bill.special_items_note && (
                                      <div className="text-[10px] text-slate-500 truncate max-w-[120px]">
                                        {bill.special_items_note}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-right font-mono">
                                {bill.contribution_deducted > 0 ? (
                                  <div className="text-emerald-700 font-bold">
                                    -{bill.contribution_deducted.toFixed(2)}
                                  </div>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                                {Number(room.contribution_credit) > 0 && (
                                  <div className="text-[10px] text-emerald-600 font-semibold" title="ยอดเงินสมทบสะสมทั้งหมด">
                                    สะสม: {Number(room.contribution_credit).toLocaleString()} บ.
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-2 text-right font-mono font-bold text-blue-700">
                                {bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 px-2 text-center">
                                {log?.line_push_status ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                    ✅ {log.line_push_status}
                                  </span>
                                ) : hasLine ? (
                                  <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[10px] font-bold">
                                    📲 พร้อมส่ง LINE
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-400">
                                    รหัส: <b className="font-mono">{bill.line_reg_code}</b>
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setBillEditRoom(room)}
                                    className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg font-bold text-[11px]"
                                  >
                                    ✏️ แก้บิล
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenPrint('invoice', [room.room_no])}
                                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-[11px]"
                                  >
                                    🖨️ พิมพ์บิล
                                  </button>
                                  {hasLine && (
                                    <button
                                      type="button"
                                      disabled={isPushingLine}
                                      onClick={() => handlePushLine([room.room_no], 'bill')}
                                      className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px]"
                                    >
                                      📲 ส่ง LINE
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 3: PAYMENTS, AUTO-OVERDUE AFTER 5TH, LATE PAYMENT & RECEIPTS      */}
            {/* ===================================================================== */}
            {activeTab === 'payments' && (
              <div className="space-y-4">
                {/* Summary Cards without KPI Labels + Dedicated Receipt Batch Printing */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                    <span className="text-slate-500 font-bold block mb-1">
                      สรุปห้องที่ชำระแล้ว (รอบบิล {period})
                    </span>
                    <div className="text-xl font-bold text-emerald-700 font-mono">
                      {paidRoomsCount} / {rooms.length} ห้อง
                    </div>
                    <div className="flex gap-3 text-[11px] mt-1">
                      <span className="text-emerald-700">
                        ✅ ตามกำหนด: <b>{paidRoomsCount - latePaidRoomsCount}</b> ห้อง
                      </span>
                      <span className="text-amber-700">
                        ⏰ ชำระล่าช้า: <b>{latePaidRoomsCount}</b> ห้อง
                      </span>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                    <span className="text-slate-500 font-bold block mb-1">ยอดเงินที่รับชำระแล้ว</span>
                    <div className="text-xl font-bold text-blue-700 font-mono">
                      {totalCollected.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
                    </div>
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      จากยอดเรียกเก็บทั้งหมด {billingSummary.totalBilled.toLocaleString()} บาท
                    </span>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-slate-500 font-bold block">สถานะค้างชำระ (กำหนดวันที่ {dueDay})</span>
                        <div className={`text-xl font-bold font-mono mt-0.5 ${overdueRoomsCount > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                          🚨 ค้างชำระ {overdueRoomsCount} ห้อง
                        </div>
                      </div>
                      {isCurrentPeriodPastDue && (
                        <span className="text-[10px] bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-bold">
                          เลยวันที่ {dueDay} แล้ว
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="button"
                        disabled={paidRoomsCount === 0}
                        onClick={() =>
                          handleOpenPrint(
                            'receipt',
                            rooms.filter((r) => !!logMap[r.room_no]?.is_paid).map((r) => r.room_no)
                          )
                        }
                        className="flex-1 min-w-[120px] py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold rounded-xl text-xs shadow-xs"
                      >
                        🧾 พิมพ์ A4 ({paidRoomsCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBatchReceiptFilterMode('unsent');
                          setBatchReceiptPreselectedRoomNos(undefined);
                          setShowBatchReceiptModal(true);
                        }}
                        disabled={paidRoomsCount === 0}
                        className="flex-1 min-w-[150px] py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold rounded-xl text-xs shadow-xs flex items-center justify-center gap-1.5"
                        title="ส่งรูปใบเสร็จเข้า LINE (เลือกระหว่างห้องที่ยังไม่ส่ง หรือทั้งหมด)"
                      >
                        <span>📲</span>
                        <span>ส่งรูป LINE {receiptUnsentCount > 0 ? `(ค้าง ${receiptUnsentCount})` : '(ครบแล้ว)'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMultiRoomPayModal(true)}
                        className="py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs shadow-xs flex items-center justify-center gap-1"
                      >
                        <span>👥</span>
                        <span>รวมชำระหลายห้อง</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Payment & Follow-up Filter Buttons */}
                <div className="bg-white p-3 rounded-2xl border border-slate-200 flex flex-wrap gap-1.5 text-xs">
                  {[
                    { id: 'all', label: `ทั้งหมด (${rooms.length})` },
                    { id: 'unpaid', label: `⏳ ยังไม่ชำระ (${rooms.length - paidRoomsCount})` },
                    { id: 'overdue', label: `🚨 ค้างชำระ (${overdueRoomsCount})` },
                    { id: 'paid', label: `✅ ชำระแล้วทั้งหมด (${paidRoomsCount})` },
                    { id: 'receipt_unsent', label: `⚠️ ชำระแล้ว - ยังไม่ส่งใบเสร็จ (${receiptUnsentCount})` },
                    { id: 'receipt_sent', label: `📲 ส่งใบเสร็จแล้ว (${receiptSentCount})` },
                    { id: 'late_paid', label: `⏰ ชำระล่าช้า (${latePaidRoomsCount})` },
                    { id: 'multi_room', label: `👥 เจ้าของหลายห้อง` },
                    { id: 'line_notified', label: `💬 ทวงในแชต LINE แล้ว` },
                    { id: 'phone_called', label: `📞 โทรติดตามแล้ว` },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setPaymentFilter(f.id as any)}
                      className={`px-3 py-1.5 rounded-xl font-bold transition ${
                        paymentFilter === f.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Rooms Payment & Receipt Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {filteredRooms.map((room) => {
                    const log = logMap[room.room_no];
                    const bill = billMap[room.room_no];
                    const isPaid = !!log?.is_paid;
                    const isLate = !!log?.is_late_payment;
                    const overdue = isRoomOverdue(log);
                    const hasReceiptSent =
                      log?.followup_status === 'receipt_sent' || (!!log?.slip_url && log.slip_url.includes('receipt'));
                    const dueAmt = bill ? bill.total_amount : Number(room.outstanding_balance) || 0;
                    const fStatus = log?.followup_status || 'none';

                    return (
                      <div
                        key={room.room_no}
                        className={`p-3.5 rounded-2xl border bg-white flex flex-col justify-between shadow-xs ${
                          isPaid
                            ? isLate
                              ? 'border-amber-300 bg-amber-50/10'
                              : 'border-emerald-300 bg-emerald-50/10'
                            : overdue
                            ? 'border-red-300 bg-red-50/10'
                            : 'border-slate-200'
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-start mb-1">
                            <div>
                              <span className="font-bold text-sm text-blue-700 font-mono">
                                ห้อง {formatRoomNo(room.room_no)}
                              </span>
                              <span className="text-[11px] text-slate-500 block">
                                {room.owner_name || room.room_type} ({room.owner_phone || '-'})
                              </span>
                            </div>
                            {isPaid ? (
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isLate
                                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                    : 'bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {isLate ? '⏰ ชำระแล้ว (ล่าช้า)' : '✅ ชำระแล้ว'}
                              </span>
                            ) : overdue ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-300">
                                🚨 ค้างชำระ
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                ⏳ รอชำระ
                              </span>
                            )}
                          </div>

                          <div className="bg-slate-50 p-2 rounded-xl text-xs my-2 border border-slate-100 space-y-0.5">
                            <div className="flex justify-between text-[11px] text-slate-500">
                              <span>ค่าน้ำ(35): {bill?.water_amount.toLocaleString()} บ.</span>
                              <span>บำบัด(5): {bill?.wastewater_amount.toLocaleString()} บ.</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                              <span className="text-slate-600 font-medium">ยอดสุทธิรอบนี้:</span>
                              <span className="font-bold font-mono text-slate-900 text-sm">
                                {dueAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                              </span>
                            </div>
                          </div>

                          {!isPaid && (
                            <div className="space-y-1.5 mb-2">
                              <span className="text-[10px] text-slate-400 block">
                                สถานะการติดตามทวงถาม:
                              </span>
                              <div className="grid grid-cols-3 gap-1 text-[10px]">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateFollowup(
                                      room,
                                      fStatus === 'line_notified' ? 'none' : 'line_notified'
                                    )
                                  }
                                  className={`py-1 px-1 rounded-lg border font-bold ${
                                    fStatus === 'line_notified'
                                      ? 'bg-sky-600 text-white border-sky-600'
                                      : 'bg-white text-slate-600 border-slate-200'
                                  }`}
                                >
                                  💬 ทวง LINE
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateFollowup(
                                      room,
                                      fStatus === 'phone_called' ? 'none' : 'phone_called'
                                    )
                                  }
                                  className={`py-1 px-1 rounded-lg border font-bold ${
                                    fStatus === 'phone_called'
                                      ? 'bg-purple-600 text-white border-purple-600'
                                      : 'bg-white text-slate-600 border-slate-200'
                                  }`}
                                >
                                  📞 โทรแล้ว
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateFollowup(
                                      room,
                                      fStatus === 'overdue' ? 'none' : 'overdue'
                                    )
                                  }
                                  className={`py-1 px-1 rounded-lg border font-bold ${
                                    overdue
                                      ? 'bg-red-600 text-white border-red-600'
                                      : 'bg-white text-slate-600 border-slate-200'
                                  }`}
                                >
                                  🚨 ค้างชำระ
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="pt-2 border-t flex flex-wrap gap-1.5">
                          {!isPaid ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setPaymentRoom(room)}
                                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs"
                              >
                                💵 บันทึกรับชำระ & ออกใบเสร็จ
                              </button>
                              <button
                                type="button"
                                onClick={() => setBillEditRoom(room)}
                                className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs"
                                title="แก้ไขบิล / ส่วนลด"
                              >
                                ✏️
                              </button>
                            </>
                          ) : (
                            <div className="w-full space-y-1.5">
                              <div className="flex items-center justify-between text-[11px] bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                                <span className="text-slate-600 font-medium">
                                  {log?.paid_type === 'cash' || log?.paid_type === 'เงินสด' ? '💵 เงินสด' : '🏦 โอนเงิน'}{' '}
                                  {log?.paid_timestamp &&
                                    `(${new Date(log.paid_timestamp).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })})`}
                                </span>
                                {hasReceiptSent ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold flex items-center gap-1">
                                    <span>🟢</span>
                                    <span>ส่งรูป LINE แล้ว</span>
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold flex items-center gap-1">
                                    <span>🟡</span>
                                    <span>ยังไม่ส่งรูป</span>
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-1 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() => handleOpenPrint('receipt', [room.room_no])}
                                  className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg shadow-xs"
                                  title="พิมพ์ใบเสร็จรับเงิน A4 (RECEIPT)"
                                >
                                  🧾 พิมพ์ A4
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBatchReceiptFilterMode('all');
                                    setBatchReceiptPreselectedRoomNos([room.room_no]);
                                    setShowBatchReceiptModal(true);
                                  }}
                                  className={`px-2.5 py-1.5 font-bold rounded-lg border shadow-xs flex items-center gap-1 transition ${
                                    hasReceiptSent
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                                      : 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-700'
                                  }`}
                                  title={hasReceiptSent ? 'ส่งรูปใบเสร็จซ้ำเข้า LINE ลูกบ้าน' : 'ส่งรูปใบเสร็จเข้า LINE ลูกบ้าน'}
                                >
                                  <span>📲</span>
                                  <span>{hasReceiptSent ? 'ส่งซ้ำ' : 'ส่งรูป'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleLatePayment(room)}
                                  className={`px-2 py-1.5 font-bold rounded-lg border ${
                                    isLate
                                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}
                                  title="สลับสถานะ ชำระตามกำหนด / ชำระล่าช้า"
                                >
                                  ⏰
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCancelPayment(room)}
                                  className="px-2 py-1.5 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-700 font-bold rounded-lg"
                                  title="ยกเลิกสถานะชำระแล้ว (กรณีคีย์ผิด)"
                                >
                                  ↩️
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 4: ROOMS & WALLETS (Includes Paired Rooms 64-65, 144-145, etc.)   */}
            {/* ===================================================================== */}
            {activeTab === 'rooms' && (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-4 justify-between items-center">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base">
                      ทะเบียนห้องชุด (รวมห้องคู่ 674/64-65, 144-145, 164-165, 186-187) & กระเป๋าเงินสมทบทุน
                    </h2>
                    <p className="text-xs text-slate-500">
                      กดปุ่ม &quot;แก้ไข / เครดิต&quot; เพื่อตั้งค่าส่วนกลางห้องคู่ (600 บาท หรือ 1,000 บาท), ชื่อ-เบอร์โทร, และเครดิตสมทบทุน
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                      <div className="text-[11px] text-emerald-700">ยอดเครดิตสมทบทุนคงเหลือรวม</div>
                      <div className="text-base font-bold text-emerald-900 font-mono">
                        {totalContributionFund.toLocaleString()} บาท
                      </div>
                    </div>
                  </div>
                </div>

                {/* View Mode Toggle: Individual Rooms vs. Grouped by Owner */}
                <div className="flex items-center gap-2 print:hidden">
                  <span className="text-xs font-bold text-slate-700">มุมมอง:</span>
                  <button
                    type="button"
                    onClick={() => setRoomsViewMode('individual')}
                    className={`px-3.5 py-1.5 rounded-xl font-bold text-xs transition ${
                      roomsViewMode === 'individual'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    📋 แสดงรายห้อง ({rooms.length} ห้อง)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoomsViewMode('by_owner')}
                    className={`px-3.5 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 ${
                      roomsViewMode === 'by_owner'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>👥</span>
                    <span>จัดกลุ่มตามเจ้าของห้อง ({ownerGroups.length} ท่าน)</span>
                  </button>
                </div>

                {roomsViewMode === 'by_owner' ? (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600 border-b">
                          <tr>
                            <th className="py-2.5 px-3 text-left">เจ้าของร่วม</th>
                            <th className="py-2.5 px-3 text-center">จำนวนห้อง</th>
                            <th className="py-2.5 px-3 text-left">ห้องที่ถือครอง</th>
                            <th className="py-2.5 px-3 text-right">ยอดหนี้ค้างสะสมรวม</th>
                            <th className="py-2.5 px-3 text-right">💰 เครดิตสมทบรวม</th>
                            <th className="py-2.5 px-3 text-right">💵 เงินฝากล่วงหน้ารวม</th>
                            <th className="py-2.5 px-3 text-center">จัดการด่วน</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y text-slate-800">
                          {ownerGroups.map((g) => {
                            const isMulti = g.rooms.length > 1;
                            return (
                              <tr
                                key={g.owner_name}
                                className={`hover:bg-slate-50 ${isMulti ? 'bg-purple-50/20' : ''}`}
                              >
                                <td className="py-2.5 px-3">
                                  <div className="font-bold text-slate-900 flex items-center gap-2">
                                    <span>{g.owner_name}</span>
                                    {isMulti && (
                                      <span className="text-[10px] bg-purple-100 text-purple-800 border border-purple-300 px-2 py-0.2 rounded-full font-bold">
                                        👑 เจ้าของ {g.rooms.length} ห้อง
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                    เบอร์: {g.rooms[0]?.owner_phone || '-'}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-center font-bold font-mono">
                                  {g.rooms.length}
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="flex flex-wrap gap-1">
                                    {g.rooms.map((r) => (
                                      <button
                                        key={r.room_no}
                                        type="button"
                                        onClick={() => setDetailRoom(r)}
                                        className="font-mono text-[11px] font-bold px-1.5 py-0.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded"
                                        title="คลิกเพื่อแก้ไขข้อมูลห้องนี้"
                                      >
                                        {formatRoomNo(r.room_no)}
                                      </button>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold">
                                  {g.totalOutstanding > 0 ? (
                                    <span className="text-red-600">
                                      {g.totalOutstanding.toLocaleString()} บ.
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-emerald-800 font-bold">
                                  {g.totalFundCredit.toLocaleString()} บ.
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-blue-800 font-bold">
                                  {g.totalPrepaid.toLocaleString()} บ.
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  {isMulti ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedRooms(g.rooms.map((r) => r.room_no));
                                        setActiveTab('billing');
                                      }}
                                      className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg text-[10.5px] shadow-xs"
                                    >
                                      🧾 ออกบิลกลุ่มนี้
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setDetailRoom(g.rooms[0])}
                                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[10.5px]"
                                    >
                                      แก้ไข
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b">
                        <tr>
                          <th className="py-2.5 px-3 text-left">เลขห้อง</th>
                          <th className="py-2.5 px-3 text-left">ประเภทห้อง (ค่าส่วนกลาง)</th>
                          <th className="py-2.5 px-3 text-left">สถานะ</th>
                          <th className="py-2.5 px-3 text-left">เจ้าของ / ผู้เช่า</th>
                          <th className="py-2.5 px-3 text-right">มิเตอร์ล่าสุด</th>
                          <th className="py-2.5 px-3 text-right">หนี้ค้างยกมา</th>
                          <th className="py-2.5 px-3 text-right">💰 เครดิตสมทบทุน</th>
                          <th className="py-2.5 px-3 text-right">💵 เงินฝากล่วงหน้า</th>
                          <th className="py-2.5 px-3 text-center">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-800">
                        {filteredRooms.map((room) => {
                          const feeAmt = getCommonFeeForRoom(room, config);
                          const isPaired = room.room_no.includes('-');
                          return (
                            <tr key={room.room_no} className={`hover:bg-slate-50 ${isPaired ? 'bg-purple-50/30' : ''}`}>
                              <td className="py-2 px-3 font-bold text-blue-700 font-mono">
                                {formatRoomNo(room.room_no)}
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    isPaired
                                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                      : room.room_type === 'ห้องใหญ่'
                                      ? 'bg-purple-100 text-purple-800'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {room.room_type} ({feeAmt.toLocaleString()} บ.)
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] ${
                                    room.status === 'ปกติ'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800 font-bold'
                                  }`}
                                >
                                  {room.status}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <div className="font-medium">{room.owner_name || '-'}</div>
                                {room.tenant_name && (
                                  <div className="text-[10px] text-slate-500">ผู้เช่า: {room.tenant_name}</div>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-slate-700">
                                {room.latest_meter || 0}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-red-600">
                                {(Number(room.outstanding_balance) || 0) > 0
                                  ? `${Number(room.outstanding_balance).toLocaleString()} บ.`
                                  : '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700">
                                {(Number(room.contribution_credit) || 0) > 0
                                  ? `${(Number(room.contribution_credit) || 0).toLocaleString()} บ.`
                                  : '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-sky-700">
                                {(Number(room.prepaid_credit) || 0) > 0
                                  ? `${(Number(room.prepaid_credit) || 0).toLocaleString()} บ.`
                                  : '-'}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  onClick={() => setDetailRoom(room)}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold"
                                >
                                  แก้ไข / เครดิต
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                )}
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 5: ACCOUNTING, WATER RECONCILIATION & MONTHLY/ANNUAL REPORTS      */}
            {/* ===================================================================== */}
            {activeTab === 'accounting' && (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-3 items-center justify-between">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base">
                      บัญชีรายรับ-รายจ่าย & รายงานส่งมอบนิติบุคคล (รายเดือน / รายปี)
                    </h2>
                    <p className="text-xs text-slate-500">
                      แยกบัญชีกองทุนดำเนินงาน และกองทุนสมทบซ่อมบำรุงตึก พร้อมพิมพ์รายงานติดประกาศ
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowMonthlyReportModal(true)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow text-xs flex items-center gap-1.5"
                    >
                      🖨️ พิมพ์รายงานติดประกาศรายเดือน & รายงานรายปี
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowExpenseModal(true)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow text-xs flex items-center gap-1.5"
                    >
                      ＋ บันทึกรายจ่าย
                    </button>
                  </div>
                </div>

                <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-2xl space-y-3 text-xs">
                  <div>
                    <h3 className="font-bold text-blue-900 text-sm">
                      💧 ข้อมูลค่าน้ำประปา (เทียบ 195 ห้องชุด กับ บิลการประปานครหลวง)
                    </h3>
                    <p className="text-blue-700">
                      ค่าน้ำประปา 35 บาท/หน่วย ({billingSummary.totalWaterAmt.toLocaleString()} บ.) + ค่าบำบัดน้ำเสีย 5 บาท/หน่วย ({billingSummary.totalWastewaterAmt.toLocaleString()} บ.)
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-3.5 rounded-xl border border-blue-100">
                    <div>
                      <span className="text-slate-500 block">หน่วยน้ำรวมที่เก็บจาก 195 ห้อง</span>
                      <span className="text-lg font-bold text-blue-800 font-mono">
                        {billingSummary.totalWaterUnits.toLocaleString()} หน่วย
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        ค่าน้ำ {billingSummary.totalWaterAmt.toLocaleString()} + บำบัด {billingSummary.totalWastewaterAmt.toLocaleString()} บ.
                      </span>
                    </div>

                    <div>
                      <label className="text-slate-700 font-bold block mb-1">
                        ยอดเงินตามบิลการประปา (บาท)
                      </label>
                      <input
                        type="number"
                        value={pwaCostStr}
                        onChange={(e) => setPwaCostStr(e.target.value)}
                        placeholder="กรอกยอดเงินบิลประปา..."
                        className="w-full border rounded-lg p-1.5 font-mono font-bold"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-3 border-b flex flex-wrap justify-between items-center gap-2">
                    <div className="flex items-center gap-3">
                      <h4 className="font-bold text-slate-800 text-xs">รายการรับ-จ่ายล่าสุด</h4>
                      <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11px]">
                        <button
                          type="button"
                          onClick={() => setTxStatusFilter('all')}
                          className={`px-2.5 py-0.5 rounded font-bold transition ${
                            txStatusFilter === 'all'
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          ทั้งหมด ({transactions.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setTxStatusFilter('paid')}
                          className={`px-2.5 py-0.5 rounded font-bold transition ${
                            txStatusFilter === 'paid'
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          ✅ ชำระแล้ว ({transactions.filter((t) => t.is_paid !== false).length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setTxStatusFilter('unpaid')}
                          className={`px-2.5 py-0.5 rounded font-bold transition ${
                            txStatusFilter === 'unpaid'
                              ? 'bg-amber-600 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          ⏳ ยังไม่ชำระ ({transactions.filter((t) => (t.type === 'expense' || t.type === 'รายจ่าย') && t.is_paid === false).length})
                        </button>
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-500">แสดง 200 รายการล่าสุด</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b">
                        <tr>
                          <th className="py-2 px-3 text-left">วันที่</th>
                          <th className="py-2 px-3 text-left">กองทุน</th>
                          <th className="py-2 px-3 text-left">ประเภท</th>
                          <th className="py-2 px-3 text-left">หมวดหมู่ / รายละเอียด</th>
                          <th className="py-2 px-3 text-right">จำนวนเงิน</th>
                          <th className="py-2 px-3 text-left">ช่องทาง</th>
                          <th className="py-2 px-3 text-center">สถานะการชำระ</th>
                          <th className="py-2 px-3 text-center">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-800">
                        {transactions
                          .filter((tx) => {
                            if (txStatusFilter === 'paid') return tx.is_paid !== false;
                            if (txStatusFilter === 'unpaid')
                              return (tx.type === 'expense' || tx.type === 'รายจ่าย') && tx.is_paid === false;
                            return true;
                          })
                          .map((tx) => (
                            <tr key={tx.id} className="hover:bg-slate-50">
                              <td className="py-2 px-3 text-slate-500">
                                <div>{tx.tx_date}</div>
                                {tx.billing_period && (
                                  <div className="text-[10px] text-sky-600 font-mono font-bold">
                                    งวด {tx.billing_period}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] ${
                                    tx.fund_type === 'maintenance_fund'
                                      ? 'bg-emerald-100 text-emerald-800 font-bold'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {tx.fund_type === 'maintenance_fund' ? 'ซ่อมบำรุงตึก' : 'ดำเนินงาน'}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`font-bold ${
                                    tx.type === 'รายรับ' || tx.type === 'income'
                                      ? 'text-emerald-600'
                                      : 'text-red-600'
                                  }`}
                                >
                                  {tx.type === 'รายรับ' || tx.type === 'income' ? 'รายรับ' : 'รายจ่าย'}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <div className="font-medium">{tx.category}</div>
                                <div className="text-[10px] text-slate-500">{tx.note}</div>
                              </td>
                              <td
                                className={`py-2 px-3 text-right font-mono font-bold ${
                                  tx.type === 'รายรับ' || tx.type === 'income'
                                    ? 'text-emerald-600'
                                    : 'text-red-600'
                                }`}
                              >
                                {tx.type === 'รายรับ' || tx.type === 'income'
                                  ? `+${Number(tx.amount).toLocaleString()}`
                                  : `-${Number(tx.amount).toLocaleString()}`}
                              </td>
                              <td className="py-2 px-3 text-slate-500">{tx.payment_method || '-'}</td>
                              <td className="py-2 px-3 text-center">
                                {tx.type === 'expense' || tx.type === 'รายจ่าย' ? (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleTxPaid(tx.id, tx.is_paid !== false)}
                                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition inline-flex items-center gap-1 cursor-pointer ${
                                      tx.is_paid !== false
                                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200'
                                        : 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200 animate-pulse'
                                    }`}
                                    title="คลิกเพื่อสลับสถานะ: ชำระแล้ว / ยังไม่ชำระ"
                                  >
                                    {tx.is_paid !== false ? '✅ ชำระแล้ว' : '⏳ ยังไม่ชำระ'}
                                  </button>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 inline-block">
                                    ✅ รับแล้ว
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTransaction(tx.id)}
                                  className="text-red-500 hover:text-red-700 font-bold text-[11px]"
                                >
                                  ลบ
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 6: LINE OA, UNLINK REGISTRATION & CUSTOM AUTO-REPLY MANAGER       */}
            {/* ===================================================================== */}
            {activeTab === 'line' && (
              <div className="space-y-4">
                {/* 3-Tier Sub-Navigation Pill Bar */}
                <div className="bg-white p-2.5 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setLineSubTab('rooms')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                        lineSubTab === 'rooms'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <span>📋 ส่วนที่ 1: จัดการผู้รับข้อมูล LINE รายห้อง</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                          lineSubTab === 'rooms' ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {lineRegisteredCount} / {rooms.length} ห้อง
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setLineSubTab('keywords')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                        lineSubTab === 'keywords'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <span>⚙️ ส่วนที่ 2: เมนูคีย์เวิร์ด &amp; บอทตอบอัตโนมัติ</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                          lineSubTab === 'keywords' ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {lineRules.length} กฎ
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setLineSubTab('system_messages')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                        lineSubTab === 'system_messages'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <span>💬 ส่วนที่ 3: จัดการข้อความในระบบ (Studio)</span>
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold">
                        10 ข้อความระบบ • รูปภาพ • ไฟล์ PDF
                      </span>
                    </button>
                  </div>

                  <span className="text-[11px] text-slate-500 hidden md:inline">
                    🕒 แอดมินตอบแชท: <b>12.00 - 24.00 น.</b>
                  </span>
                </div>

                {/* SECTION 1: Rooms Registration & Unlink */}
                {lineSubTab === 'rooms' && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden text-xs">
                    <div className="p-4 border-b flex flex-wrap justify-between items-center gap-3">
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm">
                          📋 จัดการผู้รับข้อมูล LINE รายห้อง &amp; ยกเลิกการลงทะเบียน ({lineRegisteredCount} / {rooms.length} ห้อง)
                        </h3>
                        <p className="text-slate-500">
                          กรณีเปลี่ยนผู้เช่า เปลี่ยนเจ้าของ หรือเปลี่ยนผู้รับข้อมูล กดปุ่ม &quot;🔓 ยกเลิกการผูก LINE&quot; เพื่อให้คนใหม่ลงทะเบียนแทนได้ทันที
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={lineRoomSearch}
                          onChange={(e) => setLineRoomSearch(e.target.value)}
                          placeholder="🔍 ค้นหาห้อง / ชื่อ..."
                          className="border rounded-xl px-3 py-1.5 text-xs w-40"
                        />
                        <input
                          type="text"
                          maxLength={7}
                          value={testLineCode}
                          onChange={(e) => setTestLineCode(e.target.value)}
                          placeholder="ทดสอบรหัส 7 หลัก เช่น 0646273"
                          className="border rounded-xl px-3 py-1.5 font-mono font-bold w-48 text-xs"
                        />
                        <button
                          type="button"
                          onClick={handleTestLineCode}
                          className="px-3 py-1.5 bg-slate-800 text-white font-bold rounded-xl text-xs"
                        >
                          เช็ครหัส
                        </button>
                      </div>
                    </div>

                    {testLineResult && (
                      <div
                        className={`m-3 p-2.5 rounded-xl ${
                          testLineResult.match
                            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                            : 'bg-red-50 border border-red-200 text-red-800'
                        }`}
                      >
                        {testLineResult.message}
                      </div>
                    )}

                    <div className="max-h-96 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600 border-b sticky top-0">
                          <tr>
                            <th className="py-2.5 px-3 text-left">เลขห้อง</th>
                            <th className="py-2.5 px-3 text-left">ชื่อผู้ติดต่อ (เจ้าของ/ผู้เช่า)</th>
                            <th className="py-2.5 px-3 text-left">เบอร์โทรศัพท์</th>
                            <th className="py-2.5 px-3 text-center">รหัสลงทะเบียน 7 หลัก</th>
                            <th className="py-2.5 px-3 text-center">สถานะ LINE</th>
                            <th className="py-2.5 px-3 text-center">จัดการผู้รับข้อมูล</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y text-slate-800">
                          {rooms
                            .filter((room) => {
                              if (!lineRoomSearch.trim()) return true;
                              const q = lineRoomSearch.trim().toLowerCase();
                              const rNo = (room.room_no || '').toLowerCase();
                              const owner = (room.owner_name || '').toLowerCase();
                              const tenant = (room.tenant_name || '').toLowerCase();
                              const phone = (room.owner_phone || room.tenant_phone || '');
                              return (
                                rNo.includes(q) ||
                                owner.includes(q) ||
                                tenant.includes(q) ||
                                phone.includes(q)
                              );
                            })
                            .map((room) => {
                              const phones = (room.owner_phone || room.tenant_phone || '')
                                .split(/[,/]/)
                                .map((p) => p.replace(/[^0-9]/g, ''))
                                .filter((p) => p.length >= 4);
                              const linePrefix = getLineRoomPrefix(room.room_no);
                              const regCode = phones.length > 0
                                ? phones.map((p) => `${linePrefix}${p.slice(-4)}`).join(', ')
                                : '-';
                              const isLinked = !!room.line_user_id;

                              return (
                                <tr key={room.room_no} className="hover:bg-slate-50">
                                  <td className="py-2 px-3 font-bold text-blue-700 font-mono">
                                    {formatRoomNo(room.room_no)}
                                  </td>
                                  <td className="py-2 px-3">{room.owner_name || room.tenant_name || '-'}</td>
                                  <td className="py-2 px-3 font-mono">{room.owner_phone || room.tenant_phone || '-'}</td>
                                  <td className="py-2 px-3 text-center font-mono font-bold text-emerald-800 bg-emerald-50/40">
                                    {regCode}
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] ${
                                        isLinked
                                          ? 'bg-emerald-100 text-emerald-800 font-bold'
                                          : 'bg-slate-100 text-slate-500'
                                      }`}
                                    >
                                      {isLinked ? '✅ ผูก LINE แล้ว' : '⏳ ยังไม่ผูก'}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      {isLinked && (
                                        <button
                                          type="button"
                                          onClick={() => handleUnlinkLineRoom(room)}
                                          className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-bold text-[11px]"
                                        >
                                          🔓 ยกเลิกการผูก LINE
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setDetailRoom(room)}
                                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-[11px]"
                                      >
                                        แก้เบอร์โทร
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* SECTION 2: Keyword Rules & Auto-Reply Bot */}
                {lineSubTab === 'keywords' && (
                  <div className="space-y-4">
                    {/* Interactive Registration & Bilingual Keyword Workflow Overview Card */}
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-5 rounded-2xl shadow-sm space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 pb-3">
                    <div>
                      <h2 className="font-bold text-sky-400 text-sm sm:text-base">
                        🤖 ขั้นตอนการทำงานระบบลงทะเบียน LINE OA อัตโนมัติ (ไทย / English)
                      </h2>
                      <p className="text-slate-300 text-[11px]">
                        รองรับทั้งการกดจาก Rich Menu ทีละขั้นตอน และการพิมพ์รหัสลัด 7 หลัก
                      </p>
                    </div>
                    <span className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-bold rounded-xl text-xs">
                      🕒 เวลาทำการแอดมินตอบแชท / Admin Hours: 12.00 - 24.00 น.
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="bg-slate-800/90 border border-slate-700 p-3 rounded-xl space-y-1">
                      <div className="font-bold text-sky-300">1. แอดไลน์ใหม่ (Follow Event)</div>
                      <p className="text-slate-300 text-[11px]">
                        เมื่อลูกบ้านแอดไลน์เข้ามาใหม่ ระบบส่งข้อความต้อนรับ 2 ภาษา (TH/EN) แนะนำให้กดปุ่ม <b>&quot;ลงทะเบียน&quot;</b> ที่ริชเมนู พร้อมแจ้งเวลาทำการแอดมิน <b>12.00 - 24.00 น.</b>
                      </p>
                    </div>
                    <div className="bg-slate-800/90 border border-slate-700 p-3 rounded-xl space-y-1">
                      <div className="font-bold text-sky-300">2. พิมพ์ &quot;ลงทะเบียน&quot; / &quot;Register&quot;</div>
                      <p className="text-slate-300 text-[11px]">
                        เมื่อกดริชเมนูหรือพิมพ์คำว่า <b>ลงทะเบียน</b> ระบบจะให้ลูกบ้านกรอกเลขห้อง เช่น <code className="text-amber-300">001</code> หรือกรณีมีหลายห้องพิมพ์คั่นด้วยลูกน้ำ <code className="text-amber-300">001,002,005</code>
                      </p>
                    </div>
                    <div className="bg-slate-800/90 border border-slate-700 p-3 rounded-xl space-y-1">
                      <div className="font-bold text-sky-300">3. แสดงชื่อ &amp; เบอร์โทรปิด XXXX</div>
                      <p className="text-slate-300 text-[11px]">
                        เมื่อลูกบ้านพิมพ์เลขห้อง (เช่น <code className="text-amber-300">001</code> หรือ <code className="text-amber-300">001,002</code>) ระบบจะแจ้ง <b>ชื่อ-นามสกุล</b> และ <b>เบอร์โทรที่ปิด 4 ตัวท้ายเป็น XXXX</b> ของทุกห้องที่เลือก
                      </p>
                    </div>
                    <div className="bg-slate-800/90 border border-slate-700 p-3 rounded-xl space-y-1">
                      <div className="font-bold text-sky-300">4. กรอกเลข 4 ตัวท้ายยืนยัน</div>
                      <p className="text-slate-300 text-[11px]">
                        เมื่อลูกบ้านพิมพ์เลข <b>4 ตัวท้ายของเบอร์โทร</b> (เช่น <code className="text-amber-300">6273</code>) หากตรงกับฐานข้อมูล ระบบจะผูกห้องชุดทันที!
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                    <div>
                      <h2 className="font-bold text-slate-900 text-base">
                        ⚙️ ตั้งค่าเมนูคีย์เวิร์ด & ข้อความตอบกลับอัตโนมัติ (LINE OA Bot)
                      </h2>
                      <p className="text-slate-500">
                        กำหนดว่าเมื่อลูกบ้านพิมพ์ข้อความอะไรเข้ามาใน LINE ➔ ให้เว็บตอบกลับข้อความอะไรออกไป
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRule({
                          keyword: '',
                          match_type: 'contains',
                          reply_mode: 'custom_text',
                          reply_text: '',
                          reply_bubbles: [''],
                          description: '',
                          is_active: true,
                          sort_order: lineRules.length + 1,
                        });
                        setActiveBubbleIndex(0);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow"
                    >
                      ＋ เพิ่มคีย์เวิร์ดตอบกลับใหม่
                    </button>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-800">
                        💡 คู่มือตัวแปรอัตโนมัติ (คลิกที่ปุ่มตัวแปรเพื่อแทรกลงในช่องข้อความตอบกลับได้ทันที):
                      </span>
                      <span className="text-[11px] text-emerald-700 font-medium">
                        ✨ ระบบจะดึงข้อมูลจริงของลูกบ้านห้องนั้นๆ แทนที่ให้อัตโนมัติเมื่อส่งเข้า LINE
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 pt-1">
                      {[
                        { tag: '{room_no}', desc: 'เลขห้องของลูกบ้าน (เช่น 674/64-65)' },
                        { tag: '{owner_name}', desc: 'ชื่อเจ้าของห้อง / ผู้เช่า' },
                        { tag: '{period}', desc: 'รอบบิลปัจจุบัน (เช่น 2026-11)' },
                        { tag: '{prev_meter}', desc: 'เลขมิเตอร์น้ำครั้งก่อน' },
                        { tag: '{curr_meter}', desc: 'เลขมิเตอร์น้ำครั้งนี้' },
                        { tag: '{water_units}', desc: 'จำนวนหน่วยน้ำที่ใช้รอบนี้' },
                        { tag: '{water_amount}', desc: 'ค่าน้ำประปา (35 บ./หน่วย)' },
                        { tag: '{wastewater_amount}', desc: 'ค่าบำบัดน้ำเสีย (5 บ./หน่วย)' },
                        { tag: '{common_fee}', desc: 'ค่าส่วนกลางตามขนาดห้อง' },
                        { tag: '{extra_items}', desc: 'รายการเพิ่ม / ส่วนลด / หักเครดิต' },
                        { tag: '{total_due}', desc: 'ยอดเงินสุทธิที่ต้องชำระ (บาท)' },
                        { tag: '{payment_status}', desc: 'สถานะ (ชำระแล้ว / รอชำระ)' },
                        { tag: '{due_date}', desc: 'วันที่ครบกำหนดชำระ (เช่น 5)' },
                        { tag: '{bank_info}', desc: 'ชื่อธนาคาร เลขที่บัญชี และชื่อบัญชี' },
                        { tag: '{statement_12m}', desc: 'ประวัติการชำระย้อนหลัง 12 เดือน' },
                        { tag: '{fund_summary}', desc: 'สรุปยอดเงินระดมทุนซ่อมบำรุงตึก' },
                        { tag: '{building_finance}', desc: 'สรุปรายรับ-รายจ่ายรวมของอาคาร' },
                        { tag: '{condo_name}', desc: 'ชื่อคอนโดมิเนียม' },
                      ].map((item) => (
                        <button
                          key={item.tag}
                          type="button"
                          onClick={() => {
                            if (editingRule) {
                              const currentBubbles = [
                                ...(editingRule.reply_bubbles || [editingRule.reply_text || '']),
                              ];
                              const targetIdx =
                                activeBubbleIndex < currentBubbles.length ? activeBubbleIndex : 0;
                              currentBubbles[targetIdx] = `${currentBubbles[targetIdx] || ''}${item.tag}`;
                              setEditingRule((prev) => ({
                                ...prev,
                                reply_bubbles: currentBubbles,
                                reply_text: currentBubbles[0] || '',
                              }));
                            } else {
                              navigator.clipboard?.writeText(item.tag);
                            }
                          }}
                          className="flex items-center justify-between gap-2 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg text-left transition"
                          title="คลิกเพื่อแทรกตัวแปรนี้ลงในกล่องข้อความที่เลือก"
                        >
                          <span className="font-mono font-bold text-blue-700 text-[11px] shrink-0">
                            {item.tag}
                          </span>
                          <span className="text-[11px] text-slate-600 truncate">
                            = {item.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {editingRule && (
                    <div className="bg-blue-50/60 border-2 border-blue-400 p-4 rounded-2xl space-y-3">
                      <h3 className="font-bold text-blue-900 text-sm">
                        {editingRule.id ? '✏️ แก้ไขคีย์เวิร์ดตอบกลับ' : '➕ สร้างคีย์เวิร์ดตอบกลับใหม่'}
                      </h3>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="font-bold text-slate-700 block mb-1">
                            เมื่อได้รับข้อความ (คั่นหลายคำด้วยลูกน้ำ ,)
                          </label>
                          <input
                            type="text"
                            value={editingRule.keyword || ''}
                            onChange={(e) =>
                              setEditingRule((prev) => ({ ...prev, keyword: e.target.value }))
                            }
                            placeholder="เช่น เลขบัญชี,โอนเงิน,พร้อมเพย์"
                            className="w-full border rounded-lg p-2 bg-white font-bold text-blue-800"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-slate-700 block mb-1">
                            รูปแบบการตรวจจับคำ
                          </label>
                          <select
                            value={editingRule.match_type || 'contains'}
                            onChange={(e) =>
                              setEditingRule((prev) => ({ ...prev, match_type: e.target.value }))
                            }
                            className="w-full border rounded-lg p-2 bg-white"
                          >
                            <option value="contains">มีคำนี้อยู่ในประโยค (แนะนำ)</option>
                            <option value="exact">ต้องพิมพ์ตรงทุกตัวอักษร</option>
                          </select>
                        </div>

                        <div>
                          <label className="font-bold text-slate-700 block mb-1">
                            โหมดข้อมูลสิทธิ์ PDPA
                          </label>
                          <select
                            value={editingRule.reply_mode || 'custom_text'}
                            onChange={(e) =>
                              setEditingRule((prev) => ({ ...prev, reply_mode: e.target.value }))
                            }
                            className="w-full border rounded-lg p-2 bg-white"
                          >
                            <option value="custom_text">ข้อความทั่วไป (ทุกคนดูได้)</option>
                            <option value="system_bill">หมวด 1: ใบแจ้งหนี้ (เฉพาะห้องตนเอง)</option>
                            <option value="system_receipt">หมวด 1: ใบเสร็จรับเงิน (เฉพาะห้องตนเอง)</option>
                            <option value="system_statement">หมวด 2: สเตทเมนท์ 12 เดือน (เฉพาะห้องตนเอง)</option>
                            <option value="system_fund">หมวด 3: เงินระดมทุนซ่อมตึก (ทุกห้องเห็นตรงกัน)</option>
                            <option value="system_finance">หมวด 4: ภาพรวมการเงินอาคาร (ทุกห้องเห็นตรงกัน)</option>
                          </select>
                        </div>
                      </div>

                      {(() => {
                        const raw = editingRule.reply_bubbles;
                        const bubbles: string[] = Array.isArray(raw) && raw.length > 0
                          ? raw
                          : [editingRule.reply_text || ''];
                        return (
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="font-bold text-slate-700">
                                ข้อความที่จะให้เว็บตอบกลับไปที่ LINE ({bubbles.length}/5 กล่องข้อความ)
                              </label>
                              {bubbles.length < 5 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = [...bubbles, ''];
                                    setEditingRule((prev) => ({
                                      ...prev,
                                      reply_bubbles: updated,
                                      reply_text: updated[0] || '',
                                    }));
                                    setActiveBubbleIndex(updated.length - 1);
                                  }}
                                  className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold border border-blue-200 flex items-center gap-1 transition-colors"
                                >
                                  <span>＋</span> เพิ่มกล่องข้อความ
                                </button>
                              )}
                            </div>

                            <div className="space-y-3">
                              {bubbles.map((bubbleText, idx) => (
                                <div
                                  key={idx}
                                  className={`border rounded-xl p-2.5 transition-all ${
                                    activeBubbleIndex === idx
                                      ? 'border-blue-500 bg-white ring-2 ring-blue-100 shadow-sm'
                                      : 'border-slate-200 bg-slate-50/70'
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                                      <span>💬 กล่องข้อความที่ {idx + 1}</span>
                                      {activeBubbleIndex === idx && (
                                        <span className="text-[10px] text-blue-700 font-semibold bg-blue-100 px-1.5 py-0.5 rounded">
                                          เลือกอยู่ (คลิกตัวแปรจะแทรกลงกล่องนี้)
                                        </span>
                                      )}
                                    </span>
                                    {bubbles.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const updated = bubbles.filter((_, i) => i !== idx);
                                          const nextBubbles = updated.length > 0 ? updated : [''];
                                          setEditingRule((prev) => ({
                                            ...prev,
                                            reply_bubbles: nextBubbles,
                                            reply_text: nextBubbles[0] || '',
                                          }));
                                          setActiveBubbleIndex((curr) =>
                                            Math.max(0, curr >= nextBubbles.length ? nextBubbles.length - 1 : curr)
                                          );
                                        }}
                                        className="text-[11px] text-red-500 hover:text-red-700 font-medium px-2 py-0.5 rounded hover:bg-red-50"
                                        title="ลบกล่องข้อความนี้"
                                      >
                                        🗑️ ลบกล่องนี้
                                      </button>
                                    )}
                                  </div>
                                  <textarea
                                    rows={Math.max(3, Math.min(6, (bubbleText || '').split('\n').length + 1))}
                                    value={bubbleText || ''}
                                    onFocus={() => setActiveBubbleIndex(idx)}
                                    onChange={(e) => {
                                      const updated = [...bubbles];
                                      updated[idx] = e.target.value;
                                      setEditingRule((prev) => ({
                                        ...prev,
                                        reply_bubbles: updated,
                                        reply_text: updated[0] || '',
                                      }));
                                    }}
                                    placeholder={`พิมพ์ข้อความกล่องที่ ${idx + 1} (เช่น ข้อความภาษาไทย / ภาษาอังกฤษ หรือแยกกล่องเลขบัญชี)...`}
                                    className="w-full border rounded-lg p-2.5 bg-white font-mono text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingRule(null)}
                          className="px-4 py-2 border border-slate-300 bg-white text-slate-700 font-bold rounded-xl"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveLineRule}
                          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow"
                        >
                          💾 บันทึกคีย์เวิร์ดตอบกลับ
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto border rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b">
                        <tr>
                          <th className="py-2.5 px-3 text-left">เมื่อลูกบ้านพิมพ์คีย์เวิร์ด</th>
                          <th className="py-2.5 px-3 text-left">หมวดสิทธิ์ข้อมูล</th>
                          <th className="py-2.5 px-3 text-left">ข้อความที่เว็บตอบกลับไปให้ LINE</th>
                          <th className="py-2.5 px-3 text-center">สถานะ</th>
                          <th className="py-2.5 px-3 text-center">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {lineRules.map((rule) => (
                          <tr key={rule.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-bold text-blue-700">
                              <div className="flex flex-wrap gap-1">
                                {rule.keyword.split(',').map((kw, i) => (
                                  <span
                                    key={i}
                                    className="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-md font-mono text-[11px]"
                                  >
                                    {kw.trim()}
                                  </span>
                                ))}
                              </div>
                              {rule.description && (
                                <div className="text-[10px] text-slate-400 font-normal mt-1">
                                  {rule.description}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[10px] font-medium">
                                {rule.reply_mode === 'custom_text'
                                  ? 'ข้อความทั่วไป'
                                  : rule.reply_mode === 'system_bill'
                                  ? '🔒 บิลห้องตนเอง'
                                  : rule.reply_mode === 'system_receipt'
                                  ? '🔒 ใบเสร็จห้องตนเอง'
                                  : rule.reply_mode === 'system_statement'
                                  ? '🔒 สเตทเมนท์ 12 เดือน'
                                  : rule.reply_mode === 'system_fund'
                                  ? '🌐 เงินระดมทุนตึก'
                                  : '🌐 การเงินอาคาร'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              {Array.isArray(rule.reply_bubbles) && rule.reply_bubbles.length > 1 ? (
                                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                                  <div className="flex items-center gap-1.5 text-[10px] text-blue-700 font-bold">
                                    <span className="px-1.5 py-0.5 bg-blue-100 rounded">
                                      💬 {rule.reply_bubbles.length} กล่องข้อความ (Bubbles)
                                    </span>
                                  </div>
                                  {rule.reply_bubbles.map((bText, bIdx) => (
                                    <pre
                                      key={bIdx}
                                      className="whitespace-pre-wrap font-sans text-[11px] text-slate-700 bg-slate-50 p-1.5 rounded border border-slate-200"
                                    >
                                      <span className="text-[9px] font-bold text-slate-400 block mb-0.5">
                                        กล่องที่ {bIdx + 1}:
                                      </span>
                                      {bText}
                                    </pre>
                                  ))}
                                </div>
                              ) : (
                                <pre className="whitespace-pre-wrap font-sans text-[11px] text-slate-700 max-h-24 overflow-y-auto bg-slate-50 p-2 rounded border">
                                  {rule.reply_text}
                                </pre>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleToggleLineRule(rule)}
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  rule.is_active
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-slate-200 text-slate-500'
                                }`}
                              >
                                {rule.is_active ? 'เปิดใช้งาน' : 'ปิดไว้'}
                              </button>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const rawBubbles = Array.isArray(rule.reply_bubbles) && rule.reply_bubbles.length > 0
                                      ? rule.reply_bubbles
                                      : [rule.reply_text || ''];
                                    setEditingRule({
                                      ...rule,
                                      reply_bubbles: rawBubbles,
                                      reply_text: rawBubbles[0] || '',
                                    });
                                    setActiveBubbleIndex(0);
                                  }}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold"
                                >
                                  ✏️ แก้ไข
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLineRule(rule.id)}
                                  className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-bold"
                                >
                                  ลบ
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 3: System Message Studio */}
            {lineSubTab === 'system_messages' && (
              <LineSystemMessageEditor
                config={config}
                onSaved={() => fetchData(period)}
              />
            )}
          </div>
        )}

            {/* ===================================================================== */}
            {/* TAB 7: SETTINGS                                                       */}
            {/* ===================================================================== */}
            {activeTab === 'settings' && (
              <div className="max-w-2xl mx-auto bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4 text-xs">
                <div className="border-b pb-3 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base">ตั้งค่าระบบคอนโด 674 (v2.15)</h2>
                    <p className="text-slate-500">ปรับเปลี่ยนอัตราค่าน้ำ ค่าส่วนกลาง บัญชีธนาคาร LINE OA และรอบบิล</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs"
                  >
                    📥 ส่งออกไฟล์ Excel (CSV)
                  </button>
                </div>

                {settingsSaved && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-bold">
                    ✅ บันทึกการตั้งค่าเรียบร้อยแล้ว
                  </div>
                )}

                <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-2xl space-y-2">
                  <label className="text-blue-900 font-bold text-sm block">
                    📅 รอบบิลปัจจุบัน (สำหรับแอปพนักงานจดมิเตอร์ /meter)
                  </label>
                  <p className="text-blue-700 text-[11px]">
                    กดปุ่มเลื่อนเดือน หรือเลือกเดือน/ปีจากรายการเพื่อป้องกันการพิมพ์ผิดพลาด
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setStaffActivePeriod(shiftYearMonth(staffActivePeriod, -1))}
                      className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-blue-300 rounded-xl font-bold text-blue-800 shadow-xs"
                    >
                      ◀ เดือนก่อนหน้า
                    </button>

                    <select
                      value={staffMonth || '11'}
                      onChange={(e) => setStaffActivePeriod(`${staffYear || '2026'}-${e.target.value}`)}
                      className="border-2 border-blue-500 rounded-xl px-3 py-2 bg-white font-bold text-blue-900 text-sm"
                    >
                      {THAI_MONTHS.map((m) => (
                        <option key={m.num} value={m.num}>
                          เดือน {m.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={staffYear || '2026'}
                      onChange={(e) => setStaffActivePeriod(`${e.target.value}-${staffMonth || '11'}`)}
                      className="border-2 border-blue-500 rounded-xl px-3 py-2 bg-white font-mono font-bold text-blue-900 text-sm"
                    >
                      {YEARS_LIST.map((y) => (
                        <option key={y} value={y}>
                          ปี ค.ศ. {y}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => setStaffActivePeriod(shiftYearMonth(staffActivePeriod, 1))}
                      className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-blue-300 rounded-xl font-bold text-blue-800 shadow-xs"
                    >
                      เดือนถัดไป ▶
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-700 font-bold block mb-1">ค่าน้ำประปา (บาท/หน่วย)</label>
                    <input
                      type="number"
                      value={waterRate}
                      onChange={(e) => setWaterRate(e.target.value)}
                      className="w-full border rounded-lg p-2 font-mono font-bold text-blue-700"
                    />
                  </div>
                  <div>
                    <label className="text-slate-700 font-bold block mb-1">ค่าบำบัดน้ำเสีย (บาท/หน่วย)</label>
                    <input
                      type="number"
                      value={wastewaterRate}
                      onChange={(e) => setWastewaterRate(e.target.value)}
                      className="w-full border rounded-lg p-2 font-mono font-bold text-blue-700"
                    />
                  </div>
                  <div>
                    <label className="text-slate-700 font-bold block mb-1">ค่าส่วนกลางห้องใหญ่ (บาท/เดือน)</label>
                    <input
                      type="number"
                      value={feeBig}
                      onChange={(e) => setFeeBig(e.target.value)}
                      className="w-full border rounded-lg p-2 font-mono font-bold text-purple-700"
                    />
                  </div>
                  <div>
                    <label className="text-slate-700 font-bold block mb-1">ค่าส่วนกลางห้องเล็ก (บาท/เดือน)</label>
                    <input
                      type="number"
                      value={feeSmall}
                      onChange={(e) => setFeeSmall(e.target.value)}
                      className="w-full border rounded-lg p-2 font-mono font-bold text-slate-700"
                    />
                  </div>
                </div>

                <div className="border-t pt-3 space-y-3">
                  <h3 className="font-bold text-slate-800">ข้อมูลบัญชีรับเงินของนิติบุคคล</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-500 block mb-1">ชื่อธนาคาร</label>
                      <input
                        type="text"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        className="w-full border rounded-lg p-2"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 block mb-1">เลขที่บัญชี</label>
                      <input
                        type="text"
                        value={bankAccNo}
                        onChange={(e) => setBankAccNo(e.target.value)}
                        className="w-full border rounded-lg p-2 font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-slate-500 block mb-1">ชื่อบัญชี</label>
                    <input
                      type="text"
                      value={bankAccName}
                      onChange={(e) => setBankAccName(e.target.value)}
                      className="w-full border rounded-lg p-2"
                    />
                  </div>
                </div>

                <div className="border-t pt-3 space-y-3">
                  <h3 className="font-bold text-slate-800">การเชื่อมต่อ LINE Official Account (Messaging API)</h3>
                  <div>
                    <label className="text-slate-600 block mb-1">Webhook URL (นำไปใส่ใน LINE Developers Console)</label>
                    <div className="bg-slate-100 p-2 rounded-lg border font-mono text-slate-800 select-all">
                      https://somboon-condo.vercel.app/api/line/webhook
                    </div>
                  </div>
                  <div>
                    <label className="text-slate-600 block mb-1">Channel Secret</label>
                    <input
                      type="password"
                      value={lineSecret}
                      onChange={(e) => setLineSecret(e.target.value)}
                      className="w-full border rounded-lg p-2 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 block mb-1">Channel Access Token (Long-lived)</label>
                    <input
                      type="password"
                      value={lineAccessToken}
                      onChange={(e) => setLineAccessToken(e.target.value)}
                      className="w-full border rounded-lg p-2 font-mono"
                    />
                  </div>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs">
                    <div className="font-bold flex items-center gap-1.5">
                      <span>💬</span>
                      <span>การจัดการข้อความในระบบ &amp; ข้อความต้อนรับเริ่มต้น</span>
                    </div>
                    <p className="text-blue-700 mt-1">
                      ย้ายไปรวมอยู่ที่ <b>แท็บ LINE OA &gt; ส่วนที่ 3: จัดการข้อความในระบบ (Studio)</b> เรียบร้อยแล้ว พร้อมระบบ Drag &amp; Drop และจำลองหน้าจอมือถือเสมือนจริง
                    </p>
                  </div>
                </div>

                {/* SETTING: RECEIPT & PRINT BILLS */}
                <div className="border-t pt-3 space-y-3">
                  <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                    <span>🧾</span>
                    <span>การตั้งค่าใบเสร็จรับเงิน &amp; ใบแจ้งหนี้ตอนพิมพ์ (A4)</span>
                  </h3>

                  {/* 1. Receipt Footer Note */}
                  <div>
                    <label className="text-slate-700 font-bold block mb-1">
                      ข้อความท้ายใบเสร็จรับเงิน (Receipt Footer Note)
                    </label>
                    <input
                      type="text"
                      value={receiptFooterText}
                      onChange={(e) => setReceiptFooterText(e.target.value)}
                      placeholder="ออกแบบใบเสร็จรับเงิน ออกโดย วชิรดา"
                      className="w-full border rounded-lg p-2.5 font-sans text-xs bg-white text-slate-800 focus:ring-1 focus:ring-blue-500"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      ข้อความนี้จะแสดงอยู่ด้านล่างสุดของใบเสร็จรับเงินทุกใบ ทั้งในหน้ารับชำระเงิน, ส่งใบเสร็จทาง LINE และตอนพิมพ์ใบเสร็จ
                    </p>
                  </div>

                  {/* 2. Print LINE QR Code */}
                  <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-slate-800 font-bold text-xs flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showPrintLineQr}
                            onChange={(e) => setShowPrintLineQr(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded"
                          />
                          <span>แสดง QR Code LINE OA ในใบแจ้งหนี้ / บิลตอนพิมพ์ (4 บิลต่อหน้า A4)</span>
                        </label>
                        <p className="text-[11px] text-slate-500 ml-6">
                          พิมพ์ QR Code ไลน์ควบคู่กับ PromptPay QR เพื่อให้ลูกบ้านสแกนแอดไลน์ส่งสลิปได้สะดวก
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          showPrintLineQr ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {showPrintLineQr ? 'เปิดใช้งาน' : 'ปิดอยู่'}
                      </span>
                    </div>

                    {showPrintLineQr && (
                      <div className="pt-2 border-t border-slate-200 space-y-2">
                        <label className="text-slate-700 font-bold block text-xs">
                          รูปภาพ QR Code LINE OA สำหรับพิมพ์ลงบิล
                        </label>
                        <div className="flex flex-wrap items-center gap-3">
                          {lineQrImageUrl ? (
                            <div className="relative border-2 border-slate-300 rounded-lg p-1 bg-white shrink-0">
                              <img
                                src={lineQrImageUrl}
                                alt="LINE OA QR Code"
                                className="w-20 h-20 object-contain"
                              />
                              <button
                                type="button"
                                onClick={() => setLineQrImageUrl('')}
                                className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shadow"
                                title="ลบรูป QR Code"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className="w-20 h-20 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center text-slate-400 text-[10px] bg-white shrink-0">
                              <span>📱 ไม่มีรูป</span>
                              <span>QR Code</span>
                            </div>
                          )}

                          <div className="flex-1 space-y-2 min-w-[200px]">
                            <div className="flex items-center gap-2">
                              <label className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer shadow-xs flex items-center gap-1.5 transition">
                                <span>📁</span>
                                <span>{isUploadingLineQr ? 'กำลังอัปโหลด...' : 'เลือกรูป QR Code จากเครื่อง'}</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  disabled={isUploadingLineQr}
                                  onChange={handleUploadLineQrImage}
                                  className="hidden"
                                />
                              </label>
                            </div>
                            <input
                              type="text"
                              value={lineQrImageUrl}
                              onChange={(e) => setLineQrImageUrl(e.target.value)}
                              placeholder="หรือวาง URL รูปภาพ QR Code..."
                              className="w-full border rounded-lg p-2 font-mono text-[11px] bg-white"
                            />
                            <p className="text-[10px] text-slate-500">
                              แนะนำ: ใช้ไฟล์ <b>M_gainfriends_2dbarcodes_BW.png</b> หรือ <b>S_gainfriends_2dbarcodes_BW.png</b> ที่เป็นภาพขาว-ดำความคมชัดสูง
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t pt-3">
                  <label className="text-slate-700 font-bold block mb-1">วันที่ครบกำหนดชำระของทุกเดือน (เลยวันนี้จะตีเป็นค้างชำระอัตโนมัติ)</label>
                  <select
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    className="w-full border rounded-lg p-2 font-bold bg-white"
                  >
                    {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((d) => (
                      <option key={d} value={d}>
                        วันที่ {d} ของทุกเดือน
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md text-sm mt-3"
                >
                  💾 บันทึกการตั้งค่าทั้งหมด
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ===================================================================== */}
      {/* MODAL: CUSTOM LINE NOTIFICATION PUSH                                  */}
      {/* ===================================================================== */}
      {pushCustomModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
              <h3 className="font-bold text-sm text-sky-400">
                🔔 ส่งข้อความแจ้งเตือน LINE ให้ห้องที่เลือก ({selectedRooms.length} ห้อง)
              </h3>
              <button onClick={() => setPushCustomModalOpen(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <p className="text-slate-600">
                สามารถปรับแต่งข้อความแจ้งเตือนได้ตามต้องการ (รองรับตัวแปร <code className="bg-slate-100 px-1 rounded">{'{room_no}'}</code>,{' '}
                <code className="bg-slate-100 px-1 rounded">{'{total_due}'}</code>,{' '}
                <code className="bg-slate-100 px-1 rounded">{'{period}'}</code>,{' '}
                <code className="bg-slate-100 px-1 rounded">{'{due_date}'}</code>)
              </p>
              <textarea
                rows={5}
                value={customPushText}
                onChange={(e) => setCustomPushText(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-sans"
              />
            </div>
            <div className="p-3 bg-slate-100 border-t flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPushCustomModalOpen(false)}
                className="flex-1 py-2.5 border border-slate-300 rounded-xl font-bold text-slate-700"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isPushingLine}
                onClick={() => handlePushLine(selectedRooms, 'custom', customPushText)}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold shadow"
              >
                {isPushingLine ? 'กำลังส่ง...' : '📲 ยืนยันส่งแจ้งเตือน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: EXPANDABLE METER & BILL INSPECTOR WITH AUTO-NEXT ROOM!         */}
      {/* ===================================================================== */}
      {lightboxRoom &&
        (() => {
          const list = filteredRooms.length > 0 ? filteredRooms : rooms;
          const currIdx = list.findIndex((r) => r.room_no === lightboxRoom.room_no);
          const log = logMap[lightboxRoom.room_no];
          const draft = inlineEdits[lightboxRoom.room_no];
          const prevVal =
            draft?.prev !== undefined
              ? draft.prev
              : String(log ? Number(log.prev_meter) : Number(lightboxRoom.latest_meter) || 0);
          const currVal =
            draft?.curr !== undefined
              ? draft.curr
              : log
              ? String(log.curr_meter)
              : '';
          const prevNum = Number(prevVal) || 0;
          const currNum = currVal === '' ? prevNum : Number(currVal);

          const previewBill = calculateBill(
            lightboxRoom,
            currNum,
            period,
            config,
            log ? Number(log.special_items) || 0 : 0,
            log?.special_items_note || log?.note || '',
            Number(lightboxRoom.outstanding_balance) || 0,
            prevNum,
            log ? Number(log.late_fee) || 0 : 0,
            log && log.contribution_deducted !== undefined && log.contribution_deducted !== null
              ? Number(log.contribution_deducted)
              : 0
          );

          return (
            <div
              className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2 sm:p-5 overflow-y-auto"
              onClick={() => setLightboxRoom(null)}
            >
              <div
                className="bg-slate-900 border border-slate-700 text-white w-full max-w-5xl rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[95vh]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 bg-slate-950 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={currIdx <= 0}
                      onClick={() => handleNavigateLightboxRoom(-1)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-xl text-xs font-bold"
                    >
                      ◀ ห้องก่อนหน้า
                    </button>
                    <div>
                      <h3 className="font-bold text-base sm:text-lg text-sky-400">
                        🔍 ตรวจมิเตอร์ & บิล — ห้อง {formatRoomNo(lightboxRoom.room_no)}{' '}
                        <span className="text-xs text-slate-400 font-normal">
                          (ลำดับที่ {currIdx + 1} จาก {list.length})
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400">
                        {lightboxRoom.owner_name || 'เจ้าของห้อง'} • {lightboxRoom.room_type} • รอบบิล {period}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={currIdx >= list.length - 1}
                      onClick={() => handleNavigateLightboxRoom(1)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-xl text-xs font-bold"
                    >
                      ข้ามไปห้องถัดไป ▶
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setLightboxRoom(null)}
                    className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center text-base"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 flex-1 overflow-y-auto">
                  <div className="md:col-span-7 bg-black flex flex-col items-center justify-center p-3 border-b md:border-b-0 md:border-r border-slate-800 min-h-[280px]">
                    {log?.meter_photo_url ? (
                      <img
                        src={log.meter_photo_url}
                        alt="Meter Full"
                        className="max-h-[64vh] w-auto object-contain rounded"
                      />
                    ) : (
                      <div className="py-16 text-center space-y-3">
                        <div className="text-4xl">📷</div>
                        <div className="text-slate-400 text-sm">ยังไม่มีรูปถ่ายมิเตอร์สำหรับห้องนี้</div>
                        <button
                          type="button"
                          onClick={() => {
                            const target = lightboxRoom;
                            setLightboxRoom(null);
                            setReadingModalRoom(target);
                          }}
                          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs"
                        >
                          📸 กดเพื่อถ่าย/อัปโหลดรูปมิเตอร์
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-5 p-4 flex flex-col justify-between space-y-4 text-xs bg-slate-900">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-sky-400">
                          1. ตรวจสอบตัวเลขมิเตอร์น้ำ
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            log?.is_verified
                              ? 'bg-emerald-900 text-emerald-300 border border-emerald-700'
                              : 'bg-amber-900 text-amber-300'
                          }`}
                        >
                          {log?.is_verified ? '✅ ตรวจยืนยันแล้ว' : '⏳ รอตรวจสอบ'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 bg-slate-800/80 p-3 rounded-xl border border-slate-700">
                        <div>
                          <label className="text-slate-400 block mb-1">เลขครั้งก่อน</label>
                          <input
                            type="number"
                            value={prevVal}
                            onChange={(e) =>
                              setInlineEdits((prev) => ({
                                ...prev,
                                [lightboxRoom.room_no]: { prev: e.target.value, curr: currVal },
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 font-mono font-bold text-lg text-slate-200"
                          />
                        </div>
                        <div>
                          <label className="text-sky-400 font-bold block mb-1">เลขครั้งนี้ (แก้ได้)</label>
                          <input
                            type="number"
                            value={currVal}
                            placeholder={String(prevNum)}
                            onChange={(e) =>
                              setInlineEdits((prev) => ({
                                ...prev,
                                [lightboxRoom.room_no]: { prev: prevVal, curr: e.target.value },
                              }))
                            }
                            className="w-full bg-white text-blue-700 border-2 border-sky-400 rounded-xl px-3 py-2 font-mono font-bold text-lg outline-none"
                          />
                        </div>
                      </div>

                      <div className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 space-y-2">
                        <div className="flex justify-between items-center border-b border-slate-700 pb-1.5">
                          <span className="font-bold text-slate-200">2. รายการคำนวณบิลห้องนี้</span>
                          <button
                            type="button"
                            onClick={() => {
                              setBillEditRoom(lightboxRoom);
                            }}
                            className="text-amber-400 hover:underline font-bold text-[11px]"
                          >
                            ✏️ เพิ่มรายการ/ส่วนลด
                          </button>
                        </div>

                        <div className="flex justify-between text-slate-300">
                          <span>จำนวนหน่วยน้ำที่ใช้:</span>
                          <span className="font-mono font-bold text-emerald-400 text-sm">
                            {previewBill.units_used} หน่วย
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>1. ค่าน้ำประปา ({previewBill.units_used} × {previewBill.water_rate} บ.):</span>
                          <span className="font-mono font-bold">{previewBill.water_amount.toFixed(2)} บ.</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>2. ค่าบำบัดน้ำเสีย ({previewBill.units_used} × {previewBill.wastewater_rate} บ.):</span>
                          <span className="font-mono font-bold">{previewBill.wastewater_amount.toFixed(2)} บ.</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>3. ค่าส่วนกลาง ({lightboxRoom.room_type}):</span>
                          <span className="font-mono font-bold">{previewBill.common_fee.toFixed(2)} บ.</span>
                        </div>
                        {previewBill.special_items !== 0 && (
                          <div className="flex justify-between text-amber-300">
                            <span>4. รายการเพิ่ม/ส่วนลด:</span>
                            <span className="font-mono font-bold">
                              {previewBill.special_items > 0
                                ? `+${previewBill.special_items.toFixed(2)}`
                                : previewBill.special_items.toFixed(2)}{' '}
                              บ.
                            </span>
                          </div>
                        )}
                        {previewBill.contribution_deducted > 0 && (
                          <div className="flex justify-between text-emerald-400">
                            <span>★ หักเครดิตสมทบทุนซ่อมตึก:</span>
                            <span className="font-mono font-bold">-{previewBill.contribution_deducted.toFixed(2)} บ.</span>
                          </div>
                        )}
                        {previewBill.prepaid_deducted > 0 && (
                          <div className="flex justify-between text-emerald-400">
                            <span>★ หักเงินฝากล่วงหน้า:</span>
                            <span className="font-mono font-bold">-{previewBill.prepaid_deducted.toFixed(2)} บ.</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center pt-2 border-t border-slate-700 text-sm font-bold">
                          <span>ยอดเรียกเก็บสุทธิ:</span>
                          <span className="text-lg font-mono text-sky-400">
                            {previewBill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        disabled={savingRoomNo === lightboxRoom.room_no}
                        onClick={() => handleInlineMeterSave(lightboxRoom, true)}
                        className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-bold rounded-xl shadow-lg text-sm flex items-center justify-center gap-2 transition"
                      >
                        {savingRoomNo === lightboxRoom.room_no
                          ? '⏳ กำลังบันทึก...'
                          : '✅ บันทึกยืนยัน & ไปห้องถัดไปทันที ▶'}
                      </button>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={savingRoomNo === lightboxRoom.room_no}
                          onClick={() => handleInlineMeterSave(lightboxRoom, false)}
                          className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs"
                        >
                          💾 บันทึก (อยู่ห้องเดิม)
                        </button>
                        <button
                          type="button"
                          onClick={() => setLightboxRoom(null)}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-xl text-xs"
                        >
                          ปิดหน้าต่าง
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* MODAL: ADMIN METER READING & PHOTO UPLOAD */}
      {readingModalRoom && (
        <MeterReadingModal
          key={readingModalRoom.room_no}
          room={readingModalRoom}
          period={period}
          existingLog={logMap[readingModalRoom.room_no] || null}
          config={config}
          isAdminMode={true}
          onClose={() => setReadingModalRoom(null)}
          onSaved={(updatedRoom) => {
            setRooms((prev) =>
              prev.map((r) => (r.room_no === updatedRoom.room_no ? updatedRoom : r))
            );
            fetchData(period);
          }}
        />
      )}

      {/* MODAL: PER-ROOM BILL EDITOR */}
      {billEditRoom && (
        <BillEditModal
          room={billEditRoom}
          meterLog={logMap[billEditRoom.room_no]}
          period={period}
          config={config}
          allRooms={rooms}
          onClose={() => setBillEditRoom(null)}
          onSaved={() => {
            fetchData(period);
          }}
        />
      )}

      {/* MODAL: BATCH DEDUCTION */}
      {batchDeductionModalOpen && (
        <BatchDeductionModal
          selectedRoomNos={selectedRooms}
          allRooms={rooms}
          logMap={logMap}
          period={period}
          config={config}
          onClose={() => setBatchDeductionModalOpen(false)}
          onSuccess={() => {
            fetchData(period);
          }}
        />
      )}

      {/* MODAL: ROOM DETAIL & WALLETS */}
      {detailRoom && (
        <RoomDetailModal
          room={detailRoom}
          allRooms={rooms}
          onClose={() => setDetailRoom(null)}
          onRoomUpdated={(updatedRoom) => {
            setRooms((prev) =>
              prev.map((r) => (r.room_no === updatedRoom.room_no ? updatedRoom : r))
            );
            setDetailRoom(null);
            fetchData(period);
          }}
        />
      )}

      {/* MODAL: PAYMENT RECORD */}
      {paymentRoom && (
        <PaymentModal
          room={paymentRoom}
          meterLog={logMap[paymentRoom.room_no]}
          period={period}
          config={config}
          onClose={() => setPaymentRoom(null)}
          onPaymentSuccess={async () => {
            await fetchData(period);
          }}
          onOpenPrintReceipt={(paidRoomNo) => {
            setPaymentRoom(null);
            handleOpenPrint('receipt', [paidRoomNo]);
          }}
        />
      )}

      {/* MODAL: EXPENSE ENTRY */}
      {showExpenseModal && (
        <ExpenseModal
          currentPeriod={period}
          onClose={() => setShowExpenseModal(false)}
          onSuccess={() => {
            fetchData(period);
          }}
        />
      )}

      {/* MODAL: 4-PER-A4 BILL / RECEIPT PRINT PREVIEW */}
      {showPrintModal && (
        <PrintBills4PerA4
          bills={calculatedBills}
          rooms={rooms}
          logMap={logMap}
          config={config}
          qrMap={qrMap}
          docType={printDocType}
          preselectedRoomNos={printTargetRooms}
          onClose={() => setShowPrintModal(false)}
        />
      )}

      {/* MODAL: MONTHLY NOTICEBOARD REPORT & ANNUAL 12-MONTH REPORT */}
      {showMonthlyReportModal && (
        <MonthlyReportPrintModal
          period={period}
          rooms={rooms}
          bills={calculatedBills}
          logMap={logMap}
          transactions={transactions}
          config={config}
          allYearLogs={allYearLogs}
          onClose={() => setShowMonthlyReportModal(false)}
        />
      )}

      {/* MODAL: MULTI-ROOM BATCH PAYMENT */}
      {showMultiRoomPayModal && (
        <MultiRoomPayModal
          rooms={rooms}
          logMap={logMap}
          period={period}
          config={config}
          onClose={() => setShowMultiRoomPayModal(false)}
          onSuccess={() => {
            fetchData(period);
          }}
        />
      )}

      {/* MODAL: BATCH RECEIPT LINE PUSH */}
      {showBatchReceiptModal && (
        <BatchReceiptSendModal
          rooms={rooms}
          logMap={logMap}
          config={config}
          period={period}
          initialFilterMode={batchReceiptFilterMode}
          preselectedRoomNos={batchReceiptPreselectedRoomNos}
          onClose={() => {
            setShowBatchReceiptModal(false);
            setBatchReceiptPreselectedRoomNos(undefined);
          }}
          onSuccess={() => {
            fetchData(period);
          }}
        />
      )}
    </div>
  );
}
