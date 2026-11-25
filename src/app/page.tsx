'use client';

// Main Application Page for Condo 645 Management System
// Version 1.3 - Admin Portal with Dedicated Meter Photo Verification & Inline Editing Workflow

import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { formatRoomNo, calculateBill } from '@/utils/billing';
import { generatePromptPayQRDataUrl } from '@/utils/promptpay';
import { RoomDetailModal } from '@/components/RoomDetailModal';
import { PrintBills4PerA4 } from '@/components/PrintBills4PerA4';
import { PaymentModal } from '@/components/PaymentModal';
import { ExpenseModal } from '@/components/ExpenseModal';
import { MeterReadingModal } from '@/components/MeterReadingModal';

export default function AdminCondoApp() {
  const supabase = createClient();

  // Navigation Tabs (Ordered by Real Condo Monthly Workflow: Audit Meter -> Billing -> Payments -> Rooms -> Accounting -> LINE -> Settings)
  const [activeTab, setActiveTab] = useState<'audit' | 'billing' | 'payments' | 'rooms' | 'accounting' | 'line' | 'settings'>('audit');

  // Core Data
  const [rooms, setRooms] = useState<Room[]>([]);
  const [config, setConfig] = useState<Partial<CondoConfig>>({});
  const [meterLogs, setMeterLogs] = useState<MeterLog[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Current active period (e.g. "2026-11")
  const [period, setPeriod] = useState<string>('2026-11');

  // Shared Search & Filter across Tabs
  const [searchQuery, setSearchQuery] = useState('');
  const [filterFloor, setFilterFloor] = useState<number | 'all'>('all');
  const [auditFilter, setAuditFilter] = useState<'all' | 'has_photo' | 'anomaly' | 'read' | 'unread'>('all');

  // Inline Meter Editing Drafts in Audit Tab: room_no -> { prev: string, curr: string }
  const [inlineEdits, setInlineEdits] = useState<Record<string, { prev: string; curr: string }>>({});
  const [savingRoomNo, setSavingRoomNo] = useState<string | null>(null);
  const [savedToastRoomNo, setSavedToastRoomNo] = useState<string | null>(null);

  // Lightbox Zoom Modal for comparing Photo vs Meter Reading
  const [lightboxRoom, setLightboxRoom] = useState<Room | null>(null);

  // Modal States
  const [readingModalRoom, setReadingModalRoom] = useState<Room | null>(null);
  const [detailRoom, setDetailRoom] = useState<Room | null>(null);
  const [paymentRoom, setPaymentRoom] = useState<Room | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);

  // LINE Test Verification Input
  const [testLineCode, setTestLineCode] = useState('');
  const [testLineResult, setTestLineResult] = useState<{ match: boolean; message: string } | null>(null);

  // Settings form
  const [waterRate, setWaterRate] = useState('35');
  const [wastewaterRate, setWastewaterRate] = useState('5');
  const [feeBig, setFeeBig] = useState('500');
  const [feeSmall, setFeeSmall] = useState('300');
  const [promptpayNo, setPromptpayNo] = useState('');
  const [bankName, setBankName] = useState('ธนาคารกสิกรไทย');
  const [bankAccNo, setBankAccNo] = useState('');
  const [bankAccName, setBankAccName] = useState('');
  const [dueDay, setDueDay] = useState('5');
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Load all initial data
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Condo Config
      const { data: configData } = await supabase.from('condo_config').select('*');
      let activePeriod = period;
      const configMap: Record<string, string> = {};
      if (configData) {
        configData.forEach((item: any) => {
          configMap[item.key] = item.value;
        });
        setConfig(configMap);
        if (configMap.CURRENT_BILLING_PERIOD) {
          activePeriod = configMap.CURRENT_BILLING_PERIOD;
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
      }

      // 2. Fetch Rooms
      const { data: roomsData } = await supabase
        .from('rooms')
        .select('*')
        .order('room_no', { ascending: true });
      if (roomsData) setRooms(roomsData as Room[]);

      // 3. Fetch Meter Logs for current period
      const { data: logsData } = await supabase
        .from('meter_logs')
        .select('*')
        .eq('period', activePeriod);
      if (logsData) setMeterLogs(logsData as MeterLog[]);

      // 4. Fetch Transactions
      const { data: txData } = await supabase
        .from('transactions')
        .select('*')
        .order('tx_date', { ascending: false })
        .limit(100);
      if (txData) setTransactions(txData);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Map of meter logs by room_no
  const logMap = useMemo(() => {
    const map: Record<string, MeterLog> = {};
    meterLogs.forEach((l) => {
      map[l.room_no] = l;
    });
    return map;
  }, [meterLogs]);

  // Helper to check if a room reading has an anomaly that admin should double-check
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

  // Meter Reading Progress & Audit Stats
  const readCount = useMemo(() => meterLogs.length, [meterLogs]);
  const withPhotoCount = useMemo(
    () => meterLogs.filter((l) => !!l.meter_photo_url).length,
    [meterLogs]
  );
  const anomalyCount = useMemo(() => {
    return rooms.filter((r) => !!getRoomAnomaly(r, logMap[r.room_no])).length;
  }, [rooms, logMap]);

  const readPercentage = useMemo(() => {
    if (rooms.length === 0) return 0;
    return Math.round((readCount / rooms.length) * 100);
  }, [readCount, rooms.length]);

  // Filtered Rooms (Shared across tabs)
  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      const formatted = formatRoomNo(r.room_no);
      const matchesSearch =
        searchQuery === '' ||
        r.room_no.includes(searchQuery) ||
        formatted.includes(searchQuery) ||
        (r.owner_name && r.owner_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (r.tenant_name && r.tenant_name.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesFloor = filterFloor === 'all' || r.floor === filterFloor;

      const log = logMap[r.room_no];
      const isRead = !!log;
      let matchesAudit = true;

      if (activeTab === 'audit') {
        if (auditFilter === 'has_photo') matchesAudit = isRead && !!log?.meter_photo_url;
        else if (auditFilter === 'anomaly') matchesAudit = !!getRoomAnomaly(r, log);
        else if (auditFilter === 'read') matchesAudit = isRead;
        else if (auditFilter === 'unread') matchesAudit = !isRead;
      }

      return matchesSearch && matchesFloor && matchesAudit;
    });
  }, [rooms, searchQuery, filterFloor, auditFilter, activeTab, logMap]);

  // Calculated Bills (Fixes 0-unit bug by passing log.prev_meter explicitly!)
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
        log?.note || '',
        Number(room.outstanding_balance) || 0,
        prev
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

  // Financial Summaries
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

  // Total Contribution Pool in Condo
  const totalContributionFund = useMemo(() => {
    return rooms.reduce((sum, r) => sum + (Number(r.contribution_credit) || 0), 0);
  }, [rooms]);

  // Total Paid Amount for this period
  const totalCollected = useMemo(() => {
    return meterLogs
      .filter((l) => l.is_paid)
      .reduce((sum, l) => sum + (Number(l.total_amount) || 0), 0);
  }, [meterLogs]);

  // Total LINE registered rooms
  const lineRegisteredCount = useMemo(() => {
    return rooms.filter((r) => !!r.line_user_id).length;
  }, [rooms]);

  // Inline Save Meter Reading directly from Admin Audit Tab
  const handleInlineMeterSave = async (room: Room, customPrev?: number, customCurr?: number) => {
    const log = logMap[room.room_no];
    const draft = inlineEdits[room.room_no];

    const defaultPrev = log ? Number(log.prev_meter) : Number(room.latest_meter) || 0;
    const defaultCurr = log ? Number(log.curr_meter) : defaultPrev;

    const prevMeter =
      customPrev !== undefined
        ? customPrev
        : draft?.prev !== undefined && draft.prev !== ''
        ? Number(draft.prev)
        : defaultPrev;

    const currMeter =
      customCurr !== undefined
        ? customCurr
        : draft?.curr !== undefined && draft.curr !== ''
        ? Number(draft.curr)
        : defaultCurr;

    const unitsUsed = Math.max(0, currMeter - prevMeter);

    setSavingRoomNo(room.room_no);
    try {
      const billCalc = calculateBill(
        room,
        currMeter,
        period,
        config,
        log ? Number(log.special_items) || 0 : 0,
        log?.note || '',
        Number(room.outstanding_balance) || 0,
        prevMeter
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
            contribution_deducted: billCalc.contribution_deducted,
            prepaid_deducted: billCalc.prepaid_deducted,
            total_amount: billCalc.total_amount,
            meter_photo_url: log?.meter_photo_url || null,
            note: log?.note || null,
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

      // Update local state immediately without full reload jump
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
      }, 2500);
    } catch (err: any) {
      alert('บันทึกเลขมิเตอร์ไม่สำเร็จ: ' + err.message);
    } finally {
      setSavingRoomNo(null);
    }
  };

  // Prepare and open 4-per-A4 Print Modal with dynamic PromptPay QR codes
  const handleOpenPrint = async () => {
    setIsGeneratingQr(true);
    const targetPromptPay = config.PROMPTPAY_NO || '0105555555555';
    const newQrMap: Record<string, string> = {};

    for (const bill of calculatedBills) {
      if (bill.total_amount > 0) {
        newQrMap[bill.room_no] = await generatePromptPayQRDataUrl(
          targetPromptPay,
          bill.total_amount,
          180
        );
      }
    }

    setQrMap(newQrMap);
    setIsGeneratingQr(false);
    setShowPrintModal(true);
  };

  // Test LINE Verification Code
  const handleTestLineCode = () => {
    const clean = testLineCode.replace(/[^0-9]/g, '');
    if (clean.length !== 6) {
      setTestLineResult({ match: false, message: 'โปรดระบุตัวเลข 6 หลัก (เลขห้อง 3 หลัก + เบอร์โทร 3 ตัวท้าย)' });
      return;
    }

    const roomPrefix = clean.substring(0, 3);
    const phoneSuffix = clean.substring(3, 6);

    const room = rooms.find((r) => r.room_no === roomPrefix);
    if (!room) {
      setTestLineResult({ match: false, message: `ไม่พบห้อง 645/${roomPrefix} ในระบบ` });
      return;
    }

    const ownerClean = (room.owner_phone || '').replace(/[^0-9]/g, '');
    const tenantClean = (room.tenant_phone || '').replace(/[^0-9]/g, '');

    const matchOwner = ownerClean.endsWith(phoneSuffix);
    const matchTenant = tenantClean.endsWith(phoneSuffix);

    if (matchOwner || matchTenant) {
      setTestLineResult({
        match: true,
        message: `✅ ตรวจสอบถูกต้อง! ตรงกับห้อง 645/${roomPrefix} (${matchOwner ? `เจ้าของ: ${room.owner_name || '-'}` : `ผู้เช่า: ${room.tenant_name || '-'}`}) เบอร์ลงท้าย ${phoneSuffix}`,
      });
    } else {
      setTestLineResult({
        match: false,
        message: `❌ เลขห้อง 645/${roomPrefix} พบในระบบ แต่เบอร์โทรลงท้าย (${phoneSuffix}) ไม่ตรงกับที่แจ้งไว้ (เบอร์เจ้าของ: ${room.owner_phone || '-'})`,
      });
    }
  };

  // Save Settings
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
        { key: 'CURRENT_BILLING_PERIOD', value: period },
      ];

      for (const item of updates) {
        await supabase
          .from('condo_config')
          .update({ value: item.value, updated_at: new Date().toISOString() })
          .eq('key', item.key);
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
        CURRENT_BILLING_PERIOD: period,
      }));

      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (err: any) {
      alert('บันทึกการตั้งค่าไม่สำเร็จ: ' + err.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-800">
      {/* Top Header */}
      <header className="bg-slate-900 text-white sticky top-0 z-40 shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-sky-400 flex items-center justify-center font-bold text-white shadow">
              645
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>{config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์'}</span>
                <span className="text-[10px] bg-slate-800 text-sky-300 px-2 py-0.5 rounded-full font-mono border border-slate-700">
                  ระบบบริหารนิติบุคคล v1.3
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">195 ห้อง • รอบบิล {period}</p>
            </div>
          </div>

          {/* Quick Action: Open Staff Meter App */}
          <div className="flex items-center gap-2.5">
            <a
              href="/meter"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600 text-white font-bold rounded-xl text-xs shadow-md flex items-center gap-2 transition active:scale-95 border border-sky-400/30"
              title="เปิดหน้าจดมิเตอร์สำหรับพนักงานในหน้าต่างใหม่"
            >
              <span>📱 เปิดหน้าจดมิเตอร์ (สำหรับพนักงาน)</span>
              <span className="text-sky-200">↗</span>
            </a>

            <div className="bg-slate-800 px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 border border-slate-700">
              <span className="text-slate-400 text-[11px]">รอบบิล:</span>
              <span className="font-bold text-sky-400 font-mono">{period}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main App Navigation Tabs (Ordered by Monthly Workflow) */}
      <nav className="bg-white border-b shadow-sm sticky top-[64px] z-30 overflow-x-auto text-xs">
        <div className="max-w-7xl mx-auto flex">
          {[
            { id: 'audit', label: '1. 🔍 ตรวจมิเตอร์ & รูปถ่าย', count: `${readCount}/195` },
            { id: 'billing', label: '2. 🧾 ออกบิล & พิมพ์ 4/A4' },
            { id: 'payments', label: '3. 💰 รับชำระ & ลูกหนี้' },
            { id: 'rooms', label: '🏢 ทะเบียน 195 ห้อง & สมทบทุน', count: `${rooms.length}` },
            { id: 'accounting', label: '📊 บัญชีกองทุน & ส่วนต่างน้ำ' },
            { id: 'line', label: '📲 LINE OA', count: `${lineRegisteredCount}/195` },
            { id: 'settings', label: '⚙️ ตั้งค่าระบบ' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3.5 px-4 font-bold border-b-2 whitespace-nowrap transition flex items-center gap-1.5 ${
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
      <main className="max-w-7xl mx-auto w-full p-3 sm:p-5 flex-1 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">กำลังเชื่อมต่อฐานข้อมูล Supabase...</p>
          </div>
        ) : (
          <>
            {/* Shared Search & Floor Filter Bar for Audit, Billing, Payments, and Rooms */}
            {['audit', 'billing', 'payments', 'rooms'].includes(activeTab) && (
              <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative flex-1 min-w-[220px]">
                    <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ค้นหาเลขห้อง (เช่น 005, 087) หรือชื่อเจ้าของ/ผู้เช่า..."
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

                  {/* Floor Filter Pills */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                    <button
                      type="button"
                      onClick={() => setFilterFloor('all')}
                      className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
                        filterFloor === 'all'
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      ทุกชั้น
                    </button>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((fl) => (
                      <button
                        key={fl}
                        type="button"
                        onClick={() => setFilterFloor(fl)}
                        className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
                          filterFloor === fl
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        ชั้น {fl}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 1: METER VERIFICATION & PHOTO AUDIT (ตรวจมิเตอร์ & รูปถ่าย)          */}
            {/* ===================================================================== */}
            {activeTab === 'audit' && (
              <div className="space-y-4">
                {/* Workflow Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
                    <span className="text-slate-500 block">ความคืบหน้าการจดมิเตอร์</span>
                    <div className="text-lg font-bold text-blue-700 font-mono mt-0.5">
                      {readCount} / {rooms.length} ห้อง ({readPercentage}%)
                    </div>
                    <span className="text-[11px] text-emerald-700 font-medium">
                      📷 มีรูปถ่าย {withPhotoCount} ห้อง
                    </span>
                  </div>

                  <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
                    <span className="text-slate-500 block">ห้องที่ยังไม่ได้จด</span>
                    <div className="text-lg font-bold text-amber-600 font-mono mt-0.5">
                      {rooms.length - readCount} ห้อง
                    </div>
                    <span className="text-[11px] text-slate-500">
                      กดปุ่ม &quot;จด/ถ่ายรูป&quot; ในหน้านี้ได้เลย
                    </span>
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
                      <span className="text-slate-500 block">หน่วยน้ำรวมทั้งตึกรอบนี้</span>
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

                {/* Filter Buttons for Verification */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 rounded-2xl border border-slate-200 text-xs">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'all', label: `ทั้งหมด (${rooms.length})` },
                      { id: 'has_photo', label: `📷 มีรูปถ่ายให้ตรวจ (${withPhotoCount})` },
                      { id: 'anomaly', label: `⚠️ ควรตรวจซ้ำ (${anomalyCount})` },
                      { id: 'read', label: `✅ จดแล้ว (${readCount})` },
                      { id: 'unread', label: `⏳ ยังไม่จด (${rooms.length - readCount})` },
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

                  <button
                    type="button"
                    onClick={fetchData}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl flex items-center gap-1"
                  >
                    🔄 รีเฟรชข้อมูลล่าสุดจากคนจด
                  </button>
                </div>

                {/* Side-by-Side Photo vs Meter Number Verification Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredRooms.length === 0 ? (
                    <div className="col-span-full bg-white p-10 text-center text-slate-400 rounded-2xl border">
                      ไม่พบห้องที่ตรงกับเงื่อนไขการค้นหา
                    </div>
                  ) : (
                    filteredRooms.map((room) => {
                      const log = logMap[room.room_no];
                      const isRead = !!log;
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
                      const anomaly = getRoomAnomaly(room, log);

                      return (
                        <div
                          key={room.room_no}
                          className={`bg-white rounded-2xl border p-3.5 shadow-xs flex flex-col sm:flex-row gap-3.5 transition ${
                            anomaly
                              ? 'border-amber-300 bg-amber-50/10'
                              : isRead
                              ? 'border-emerald-300'
                              : 'border-slate-200'
                          }`}
                        >
                          {/* LEFT: METER PHOTO BOX (Click to Zoom Full Screen!) */}
                          <div className="w-full sm:w-44 shrink-0 flex flex-col">
                            {log?.meter_photo_url ? (
                              <div
                                onClick={() => setLightboxRoom(room)}
                                className="relative group aspect-4/3 sm:h-36 bg-slate-950 rounded-xl overflow-hidden border border-slate-300 cursor-pointer"
                                title="คลิกเพื่อขยายดูรูปหน้าปัดมิเตอร์ขนาดใหญ่"
                              >
                                <img
                                  src={log.meter_photo_url}
                                  alt={`มิเตอร์ ${room.room_no}`}
                                  className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                                  <span className="bg-black/75 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow">
                                    🔍 คลิกขยายรูปใหญ่
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

                            <button
                              type="button"
                              onClick={() => setReadingModalRoom(room)}
                              className="mt-2 w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg transition"
                            >
                              📸 ถ่าย/เปลี่ยนรูปมิเตอร์
                            </button>
                          </div>

                          {/* RIGHT: METER NUMBERS COMPARISON & INLINE EDIT */}
                          <div className="flex-1 flex flex-col justify-between space-y-2.5 text-xs">
                            <div>
                              {/* Room Header & Status */}
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-base font-bold text-blue-700 font-mono">
                                    ห้อง {formatRoomNo(room.room_no)}
                                  </span>
                                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                                    ชั้น {room.floor} • {room.room_type}
                                  </span>
                                </div>

                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    isRead
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  {isRead ? '✅ จดแล้ว' : '⏳ รอจด'}
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {room.owner_name || 'เจ้าของห้อง'}
                                {log?.recorded_at && (
                                  <span className="ml-2 text-slate-400">
                                    • เวลาจด: {new Date(log.recorded_at).toLocaleString('th-TH')}
                                  </span>
                                )}
                              </div>

                              {/* Anomaly Warning Badge if any */}
                              {anomaly && (
                                <div className="mt-1.5 px-2.5 py-1 bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-[11px] font-bold">
                                  {anomaly}
                                </div>
                              )}
                            </div>

                            {/* Side-by-Side Number Inputs for Fast Verification & Correction */}
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
                                <span className="text-[10px] text-slate-500">หน่วยน้ำที่ใช้</span>
                                <span className="text-base font-bold font-mono text-emerald-700">
                                  {unitsUsed} <span className="text-[10px] font-normal">หน่วย</span>
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  {(unitsUsed * (Number(waterRate) + Number(wastewaterRate))).toLocaleString()} บ.
                                </span>
                              </div>
                            </div>

                            {/* Bottom Save / Verify Action Row */}
                            <div className="flex items-center justify-between gap-2">
                              {log?.note ? (
                                <span className="text-[11px] text-amber-700 truncate">
                                  💬 หมายเหตุ: {log.note}
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-400">
                                  เทียบเลขในรูปกับช่อง &quot;เลขครั้งนี้&quot;
                                </span>
                              )}

                              <div className="flex items-center gap-1.5 shrink-0">
                                {savedToastRoomNo === room.room_no && (
                                  <span className="text-[11px] font-bold text-emerald-600">
                                    ✅ บันทึกแล้ว!
                                  </span>
                                )}
                                <button
                                  type="button"
                                  disabled={savingRoomNo === room.room_no}
                                  onClick={() => handleInlineMeterSave(room)}
                                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-xl shadow-xs text-xs transition disabled:opacity-50"
                                >
                                  {savingRoomNo === room.room_no
                                    ? 'กำลังบันทึก...'
                                    : isRead
                                    ? '💾 บันทึก / ยืนยันเลข'
                                    : '💾 บันทึกเลขมิเตอร์'}
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
            {/* TAB 2: BILLING & 4-PER-A4 PDF                                         */}
            {/* ===================================================================== */}
            {activeTab === 'billing' && (
              <div className="space-y-4">
                {/* Billing Summary Banner */}
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center justify-between">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base">การออกบิล ประจำรอบ {period}</h2>
                    <p className="text-xs text-slate-500">
                      รวมใช้น้ำ {billingSummary.totalWaterUnits.toLocaleString()} หน่วย • ค่าน้ำ {billingSummary.totalWaterAmt.toLocaleString()} บ. • ค่าส่วนกลาง {billingSummary.totalCommonFee.toLocaleString()} บ.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={isGeneratingQr}
                      onClick={handleOpenPrint}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md text-xs flex items-center gap-2"
                    >
                      {isGeneratingQr ? 'กำลังสร้าง QR Code...' : '🖨️ พิมพ์ 4 บิลต่อ 1 A4 (เลือกกรองห้องได้)'}
                    </button>
                  </div>
                </div>

                {/* Calculation Cards Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">รวมค่าน้ำ + บำบัด</span>
                    <span className="text-base font-bold text-slate-800">
                      {(billingSummary.totalWaterAmt + billingSummary.totalWastewaterAmt).toLocaleString()} บ.
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">รวมค่าส่วนกลาง</span>
                    <span className="text-base font-bold text-slate-800">
                      {billingSummary.totalCommonFee.toLocaleString()} บ.
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">หักเครดิตสมทบทุนซ่อมตึก</span>
                    <span className="text-base font-bold text-emerald-700">
                      -{billingSummary.totalContribDeducted.toLocaleString()} บ.
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200 bg-blue-50/30">
                    <span className="text-slate-500 block">ยอดรวมเรียกเก็บทั้งตึก</span>
                    <span className="text-base font-bold text-blue-700 font-mono">
                      {billingSummary.totalBilled.toLocaleString()} บ.
                    </span>
                  </div>
                </div>

                {/* Bills Table Preview */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b">
                        <tr>
                          <th className="py-2.5 px-3 text-left">ห้อง</th>
                          <th className="py-2.5 px-3 text-center">รูปมิเตอร์</th>
                          <th className="py-2.5 px-3 text-right">ครั้งก่อน ➔ ครั้งนี้</th>
                          <th className="py-2.5 px-3 text-right">หน่วยน้ำ</th>
                          <th className="py-2.5 px-3 text-right">ค่าน้ำ+บำบัด</th>
                          <th className="py-2.5 px-3 text-right">ค่าส่วนกลาง</th>
                          <th className="py-2.5 px-3 text-right">หักเครดิตสมทบ</th>
                          <th className="py-2.5 px-3 text-right">หักเงินฝาก</th>
                          <th className="py-2.5 px-3 text-right font-bold">ยอดเรียกเก็บสุทธิ</th>
                          <th className="py-2.5 px-3 text-center">รหัส LINE</th>
                          <th className="py-2.5 px-3 text-center">สถานะ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-800">
                        {filteredRooms.map((room) => {
                          const bill = billMap[room.room_no];
                          if (!bill) return null;
                          const log = logMap[room.room_no];
                          const isPaid = log?.is_paid;

                          return (
                            <tr key={room.room_no} className="hover:bg-slate-50">
                              <td className="py-2 px-3 font-bold text-blue-700 font-mono">
                                {bill.formatted_room}
                              </td>
                              <td className="py-2 px-3 text-center">
                                {log?.meter_photo_url ? (
                                  <button
                                    type="button"
                                    onClick={() => setLightboxRoom(room)}
                                    className="text-blue-600 hover:underline font-medium"
                                  >
                                    📷 ดูรูป
                                  </button>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-600">
                                {bill.prev_meter} ➔ <b className="text-slate-900">{bill.curr_meter}</b>
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold">
                                {bill.units_used}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {(bill.water_amount + bill.wastewater_amount).toFixed(2)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">{bill.common_fee.toFixed(2)}</td>
                              <td className="py-2 px-3 text-right font-mono text-emerald-600">
                                {bill.contribution_deducted > 0 ? `-${bill.contribution_deducted.toFixed(2)}` : '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-emerald-600">
                                {bill.prepaid_deducted > 0 ? `-${bill.prepaid_deducted.toFixed(2)}` : '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-blue-700">
                                {bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 px-3 text-center font-mono text-[11px] text-emerald-700 font-bold bg-emerald-50/50">
                                {bill.line_reg_code}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                                  isPaid ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {isPaid ? 'ชำระแล้ว' : 'ยังไม่ชำระ'}
                                </span>
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
            {/* TAB 3: PAYMENTS & AR                                                  */}
            {/* ===================================================================== */}
            {activeTab === 'payments' && (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center justify-between">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base">ระบบรับชำระเงิน & ติดตามหนี้ค้าง</h2>
                    <p className="text-xs text-slate-500">
                      ชำระแล้ว {totalCollected.toLocaleString()} บ. จากยอดเรียกเก็บ {billingSummary.totalBilled.toLocaleString()} บ.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {filteredRooms.map((room) => {
                    const log = logMap[room.room_no];
                    const bill = billMap[room.room_no];
                    const isPaid = log?.is_paid;
                    const dueAmt = bill ? bill.total_amount : Number(room.outstanding_balance) || 0;

                    return (
                      <div
                        key={room.room_no}
                        className={`p-3 rounded-xl border bg-white flex flex-col justify-between ${
                          isPaid ? 'border-emerald-200' : 'border-slate-200'
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-start mb-1.5">
                            <span className="font-bold text-sm text-blue-700">{formatRoomNo(room.room_no)}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {isPaid ? 'ชำระแล้ว' : 'รอชำระ'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mb-2">
                            {room.owner_name || 'เจ้าของห้อง'} (ใช้น้ำ {bill?.units_used || 0} หน่วย)
                          </div>
                          <div className="bg-slate-50 p-2 rounded-lg flex justify-between items-center text-xs">
                            <span className="text-slate-500">ยอดสุทธิรอบนี้:</span>
                            <span className="font-bold font-mono text-slate-800">
                              {dueAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                            </span>
                          </div>
                        </div>

                        <div className="pt-2 mt-2 border-t flex gap-1">
                          {!isPaid ? (
                            <button
                              onClick={() => setPaymentRoom(room)}
                              className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs"
                            >
                              💵 บันทึกรับชำระ
                            </button>
                          ) : (
                            <span className="w-full py-1.5 text-center text-[11px] text-emerald-700 font-medium">
                              ชำระแล้วผ่าน {log?.paid_type || 'พร้อมเพย์'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 4: ROOMS & WALLETS                                                */}
            {/* ===================================================================== */}
            {activeTab === 'rooms' && (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-4 justify-between items-center">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base">ทะเบียนห้องชุด & กระเป๋าเงิน (195 ห้อง)</h2>
                    <p className="text-xs text-slate-500">
                      จัดการเจ้าของ/ผู้เช่า, เครดิตสมทบทุนซ่อมตึก, เงินฝากล่วงหน้า, และห้องมีปัญหา
                    </p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                    <div className="text-[11px] text-emerald-700">ยอดกองทุนสมทบรวม</div>
                    <div className="text-base font-bold text-emerald-900 font-mono">
                      {totalContributionFund.toLocaleString()} บาท
                    </div>
                  </div>
                </div>

                {/* Rooms Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b">
                        <tr>
                          <th className="py-2.5 px-3 text-left">เลขห้อง</th>
                          <th className="py-2.5 px-3 text-left">ชั้น</th>
                          <th className="py-2.5 px-3 text-left">ประเภทห้อง</th>
                          <th className="py-2.5 px-3 text-left">สถานะ</th>
                          <th className="py-2.5 px-3 text-left">เจ้าของ / ผู้เช่า</th>
                          <th className="py-2.5 px-3 text-center">รหัส LINE</th>
                          <th className="py-2.5 px-3 text-right">💰 เครดิตสมทบทุน</th>
                          <th className="py-2.5 px-3 text-right">💵 เงินฝากล่วงหน้า</th>
                          <th className="py-2.5 px-3 text-center">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-800">
                        {filteredRooms.map((room) => {
                          const rawPhone = (room.owner_phone || room.tenant_phone || '').replace(/[^0-9]/g, '');
                          const phoneSuffix = rawPhone.length >= 3 ? rawPhone.slice(-3) : '';
                          const regCode = phoneSuffix ? `${room.room_no}${phoneSuffix}` : '-';

                          return (
                            <tr key={room.room_no} className="hover:bg-slate-50">
                              <td className="py-2 px-3 font-bold text-blue-700 font-mono">
                                {formatRoomNo(room.room_no)}
                              </td>
                              <td className="py-2 px-3 text-slate-500">ชั้น {room.floor}</td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                                  room.room_type === 'ห้องใหญ่' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {room.room_type} ({room.room_type === 'ห้องใหญ่' ? '500' : '300'} บ.)
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                                  room.status === 'ปกติ' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800 font-bold'
                                }`}>
                                  {room.status}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <div className="font-medium">{room.owner_name || '-'}</div>
                                {room.tenant_name && (
                                  <div className="text-[10px] text-slate-500">ผู้เช่า: {room.tenant_name}</div>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center font-mono font-bold text-emerald-800 bg-emerald-50/50">
                                {regCode}
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
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium"
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
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 5: ACCOUNTING & WATER RECONCILIATION                              */}
            {/* ===================================================================== */}
            {activeTab === 'accounting' && (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-3 items-center justify-between">
                  <div>
                    <h2 className="font-bold text-slate-800 text-base">บัญชีรายรับ-รายจ่าย & กองทุนคอนโด</h2>
                    <p className="text-xs text-slate-500">แยกบัญชีกองทุนดำเนินงาน และกองทุนสมทบซ่อมบำรุงตึก</p>
                  </div>
                  <button
                    onClick={() => setShowExpenseModal(true)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow text-xs flex items-center gap-1.5"
                  >
                    ＋ บันทึกรายจ่าย
                  </button>
                </div>

                {/* Water Reconciliation Card */}
                <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-2xl">
                  <h3 className="font-bold text-blue-900 text-sm mb-1">💧 รายงานส่วนต่างค่าน้ำประปา</h3>
                  <p className="text-xs text-blue-700 mb-3">
                    ตรวจสอบการรั่วไหลของน้ำ โดยเทียบหน่วยรวมที่เก็บจาก 195 ห้องกับบิลการประปา
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3 rounded-xl border border-blue-100 text-xs">
                    <div>
                      <span className="text-slate-500 block">หน่วยน้ำที่เก็บได้จาก 195 ห้อง</span>
                      <span className="text-lg font-bold text-blue-800 font-mono">
                        {billingSummary.totalWaterUnits.toLocaleString()} หน่วย
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">ยอดค่าน้ำที่เรียกเก็บ (35 บ./หน่วย)</span>
                      <span className="text-lg font-bold text-slate-800 font-mono">
                        {billingSummary.totalWaterAmt.toLocaleString()} บ.
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">ค่าบำบัดน้ำเสียที่เรียกเก็บ (5 บ./หน่วย)</span>
                      <span className="text-lg font-bold text-slate-800 font-mono">
                        {billingSummary.totalWastewaterAmt.toLocaleString()} บ.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Transactions Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-3 border-b flex justify-between items-center">
                    <h4 className="font-bold text-slate-800 text-xs">รายการรับ-จ่ายล่าสุด</h4>
                    <span className="text-[11px] text-slate-500">แสดง 100 รายการล่าสุด</span>
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
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-800">
                        {transactions.map((tx) => (
                          <tr key={tx.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3 text-slate-500">{tx.tx_date}</td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                                tx.fund_type === 'maintenance_fund'
                                  ? 'bg-emerald-100 text-emerald-800 font-bold'
                                  : 'bg-slate-100 text-slate-700'
                              }`}>
                                {tx.fund_type === 'maintenance_fund' ? 'ซ่อมบำรุงตึก' : 'ดำเนินงาน'}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span className={`font-bold ${tx.type === 'รายรับ' ? 'text-emerald-600' : 'text-red-600'}`}>
                                {tx.type}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <div className="font-medium">{tx.category}</div>
                              <div className="text-[10px] text-slate-500">{tx.note}</div>
                            </td>
                            <td className={`py-2 px-3 text-right font-mono font-bold ${
                              tx.type === 'รายรับ' ? 'text-emerald-600' : 'text-red-600'
                            }`}>
                              {tx.type === 'รายรับ' ? `+${Number(tx.amount).toLocaleString()}` : `-${Number(tx.amount).toLocaleString()}`}
                            </td>
                            <td className="py-2 px-3 text-slate-500">{tx.payment_method || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* TAB 6: LINE OA & REGISTRATION                                         */}
            {/* ===================================================================== */}
            {activeTab === 'line' && (
              <div className="space-y-4 max-w-4xl mx-auto">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📲</span>
                    <div>
                      <h2 className="font-bold text-slate-900 text-base">ระบบลงทะเบียนรับบิลผ่าน LINE Official Account</h2>
                      <p className="text-xs text-slate-500">ผูกห้องชุดด้วยรหัส: เลขห้อง 3 หลัก + เบอร์โทร 3 ตัวท้าย</p>
                    </div>
                  </div>

                  <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl text-xs space-y-2 text-emerald-900">
                    <div className="font-bold">💡 กฎการสร้างรหัสลงทะเบียนสำหรับลูกบ้าน:</div>
                    <p className="leading-relaxed">
                      ลูกบ้านเพิ่มเพื่อน LINE OA แล้วพิมพ์รหัส <b>เลขห้อง 3 หลัก ตามด้วยเลข 3 หลักสุดท้ายของเบอร์โทรศัพท์</b><br />
                      ตัวอย่างเช่น: <b>ห้อง 645/005</b> เบอร์โทรลงท้าย <b>273</b> รหัสยืนยันคือ <span className="bg-white px-2 py-0.5 rounded border border-emerald-300 font-mono font-bold text-sm text-slate-900">005273</span>
                    </p>
                  </div>
                </div>

                {/* Live Code Tester */}
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
                  <h3 className="font-bold text-slate-800 text-sm">🧪 ทดสอบตรวจสอบรหัสลงทะเบียน LINE</h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={testLineCode}
                      onChange={(e) => setTestLineCode(e.target.value)}
                      placeholder="พิมพ์รหัส 6 หลัก เช่น 005273..."
                      className="border rounded-xl px-3 py-2 text-xs font-mono font-bold flex-1"
                    />
                    <button
                      type="button"
                      onClick={handleTestLineCode}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm"
                    >
                      ตรวจสอบรหัส
                    </button>
                  </div>

                  {testLineResult && (
                    <div className={`p-3 rounded-xl text-xs ${
                      testLineResult.match ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'
                    }`}>
                      {testLineResult.message}
                    </div>
                  )}
                </div>

                {/* Registered Rooms Summary Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-3 border-b flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-800">สถานะการผูก LINE ของแต่ละห้อง ({lineRegisteredCount} / {rooms.length} ห้อง)</span>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b sticky top-0">
                        <tr>
                          <th className="py-2 px-3 text-left">เลขห้อง</th>
                          <th className="py-2 px-3 text-left">ชื่อผู้ติดต่อ</th>
                          <th className="py-2 px-3 text-left">เบอร์โทรศัพท์</th>
                          <th className="py-2 px-3 text-center">รหัสลงทะเบียน</th>
                          <th className="py-2 px-3 text-center">สถานะ LINE</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-800">
                        {rooms.map((room) => {
                          const rawPhone = (room.owner_phone || room.tenant_phone || '').replace(/[^0-9]/g, '');
                          const phoneSuffix = rawPhone.length >= 3 ? rawPhone.slice(-3) : '';
                          const regCode = phoneSuffix ? `${room.room_no}${phoneSuffix}` : '-';
                          const isLinked = !!room.line_user_id;

                          return (
                            <tr key={room.room_no} className="hover:bg-slate-50">
                              <td className="py-2 px-3 font-bold text-blue-700 font-mono">{formatRoomNo(room.room_no)}</td>
                              <td className="py-2 px-3">{room.owner_name || room.tenant_name || '-'}</td>
                              <td className="py-2 px-3 font-mono">{room.owner_phone || room.tenant_phone || '-'}</td>
                              <td className="py-2 px-3 text-center font-mono font-bold text-emerald-800 bg-emerald-50/40">
                                {regCode}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                                  isLinked ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {isLinked ? '✅ ผูกแล้ว' : '⏳ ยังไม่ผูก'}
                                </span>
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
            {/* TAB 7: SETTINGS                                                       */}
            {/* ===================================================================== */}
            {activeTab === 'settings' && (
              <div className="max-w-2xl mx-auto bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4 text-xs">
                <div className="border-b pb-3">
                  <h2 className="font-bold text-slate-800 text-base">ตั้งค่าระบบคอนโด 645</h2>
                  <p className="text-slate-500">ปรับเปลี่ยนอัตราค่าน้ำ ค่าส่วนกลาง บัญชีธนาคาร และรอบบิล</p>
                </div>

                {settingsSaved && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-bold">
                    ✅ บันทึกการตั้งค่าเรียบร้อยแล้ว
                  </div>
                )}

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
                  <h3 className="font-bold text-slate-800">ข้อมูลบัญชีรับเงิน & พร้อมเพย์</h3>
                  <div>
                    <label className="text-slate-700 font-bold block mb-1">เบอร์พร้อมเพย์ / เลขผู้เสียภาษีนิติ (สำหรับ QR Code บนบิล)</label>
                    <input
                      type="text"
                      value={promptpayNo}
                      onChange={(e) => setPromptpayNo(e.target.value)}
                      placeholder="เช่น 0812345678 หรือ 0105555555555"
                      className="w-full border rounded-lg p-2 font-mono font-bold text-slate-800"
                    />
                  </div>
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

                <div className="border-t pt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-700 font-bold block mb-1">รอบบิลปัจจุบัน</label>
                    <input
                      type="text"
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                      placeholder="YYYY-MM เช่น 2026-11"
                      className="w-full border rounded-lg p-2 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-700 font-bold block mb-1">วันที่ครบกำหนดชำระของทุกเดือน</label>
                    <input
                      type="number"
                      value={dueDay}
                      onChange={(e) => setDueDay(e.target.value)}
                      placeholder="5"
                      className="w-full border rounded-lg p-2 font-mono"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md text-sm mt-3"
                >
                  💾 บันทึกการตั้งค่า
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ===================================================================== */}
      {/* FULL-SCREEN PHOTO ZOOM & COMPARISON LIGHTBOX MODAL                    */}
      {/* ===================================================================== */}
      {lightboxRoom && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={() => setLightboxRoom(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 text-white w-full max-w-3xl rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-slate-950 flex items-center justify-between border-b border-slate-800">
              <div>
                <h3 className="font-bold text-base text-sky-400">
                  🔍 ตรวจสอบรูปหน้าปัดมิเตอร์ — ห้อง {formatRoomNo(lightboxRoom.room_no)}
                </h3>
                <p className="text-xs text-slate-400">
                  เทียบตัวเลขบนหน้าปัดมิเตอร์ในรูป กับตัวเลขที่บันทึกด้านล่าง
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxRoom(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="bg-black flex items-center justify-center p-2 max-h-[65vh] overflow-hidden">
              {logMap[lightboxRoom.room_no]?.meter_photo_url ? (
                <img
                  src={logMap[lightboxRoom.room_no].meter_photo_url!}
                  alt="Meter Full"
                  className="max-h-[62vh] w-auto object-contain rounded"
                />
              ) : (
                <div className="py-16 text-slate-400 text-sm">ไม่มีรูปถ่ายสำหรับห้องนี้</div>
              )}
            </div>

            {/* Bottom Verification Strip inside Lightbox */}
            {(() => {
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
              const units = Math.max(0, currNum - prevNum);

              return (
                <div className="p-4 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-slate-400 block text-[11px]">เลขครั้งก่อน</span>
                      <input
                        type="number"
                        value={prevVal}
                        onChange={(e) =>
                          setInlineEdits((prev) => ({
                            ...prev,
                            [lightboxRoom.room_no]: { prev: e.target.value, curr: currVal },
                          }))
                        }
                        className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono font-bold text-base text-slate-200"
                      />
                    </div>
                    <span className="text-slate-500 text-lg mt-4">➔</span>
                    <div>
                      <span className="text-sky-400 font-bold block text-[11px]">เลขครั้งนี้ (แก้ได้)</span>
                      <input
                        type="number"
                        value={currVal}
                        onChange={(e) =>
                          setInlineEdits((prev) => ({
                            ...prev,
                            [lightboxRoom.room_no]: { prev: prevVal, curr: e.target.value },
                          }))
                        }
                        className="w-28 bg-white text-blue-700 border-2 border-sky-400 rounded-lg px-2.5 py-1.5 font-mono font-bold text-base"
                      />
                    </div>
                    <div className="pl-2">
                      <span className="text-slate-400 block text-[11px]">ใช้น้ำรอบนี้</span>
                      <span className="text-lg font-bold text-emerald-400 font-mono">
                        {units} หน่วย
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await handleInlineMeterSave(lightboxRoom);
                        setLightboxRoom(null);
                      }}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow text-xs"
                    >
                      ✅ ยืนยันตัวเลขถูกต้อง & บันทึก
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

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
            fetchData();
          }}
        />
      )}

      {/* MODAL: ROOM DETAIL & WALLETS */}
      {detailRoom && (
        <RoomDetailModal
          room={detailRoom}
          onClose={() => setDetailRoom(null)}
          onRoomUpdated={(updatedRoom) => {
            setRooms((prev) =>
              prev.map((r) => (r.room_no === updatedRoom.room_no ? updatedRoom : r))
            );
            setDetailRoom(null);
            fetchData();
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
          onPaymentSuccess={() => {
            fetchData();
          }}
        />
      )}

      {/* MODAL: EXPENSE ENTRY */}
      {showExpenseModal && (
        <ExpenseModal
          onClose={() => setShowExpenseModal(false)}
          onSuccess={() => {
            fetchData();
          }}
        />
      )}

      {/* MODAL: 4-PER-A4 BILL PRINT PREVIEW */}
      {showPrintModal && (
        <PrintBills4PerA4
          bills={calculatedBills}
          rooms={rooms}
          config={config}
          qrMap={qrMap}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
}
