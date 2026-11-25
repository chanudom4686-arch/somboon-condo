'use client';

// Main Application Page for Condo 645 Management System
// Version 1.2 - Admin & Management Portal (Zero PIN hassle, one-way link to /meter)

import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { formatRoomNo, calculateBill } from '@/utils/billing';
import { generatePromptPayQRDataUrl } from '@/utils/promptpay';
import { RoomDetailModal } from '@/components/RoomDetailModal';
import { PrintBills4PerA4 } from '@/components/PrintBills4PerA4';
import { PaymentModal } from '@/components/PaymentModal';
import { ExpenseModal } from '@/components/ExpenseModal';

export default function AdminCondoApp() {
  const supabase = createClient();

  // Navigation Tabs (Admin Focused)
  const [activeTab, setActiveTab] = useState<'billing' | 'payments' | 'rooms' | 'accounting' | 'line' | 'settings'>('billing');

  // Core Data
  const [rooms, setRooms] = useState<Room[]>([]);
  const [config, setConfig] = useState<Partial<CondoConfig>>({});
  const [meterLogs, setMeterLogs] = useState<MeterLog[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Current active period (e.g. "2026-11")
  const [period, setPeriod] = useState<string>('2026-11');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterFloor, setFilterFloor] = useState<number | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Modal States
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
      if (configData) {
        const configMap: Record<string, string> = {};
        configData.forEach((item: any) => {
          configMap[item.key] = item.value;
        });
        setConfig(configMap);
        if (configMap.CURRENT_BILLING_PERIOD) {
          setPeriod(configMap.CURRENT_BILLING_PERIOD);
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
      const currentP = config.CURRENT_BILLING_PERIOD || period;
      const { data: logsData } = await supabase
        .from('meter_logs')
        .select('*')
        .eq('period', currentP);
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

  // Meter Reading Progress
  const readCount = useMemo(() => meterLogs.length, [meterLogs]);
  const readPercentage = useMemo(() => {
    if (rooms.length === 0) return 0;
    return Math.round((readCount / rooms.length) * 100);
  }, [readCount, rooms.length]);

  // Filtered Rooms
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

      let matchesStatus = true;
      const isRead = !!logMap[r.room_no];
      if (filterStatus === 'unread') matchesStatus = !isRead;
      else if (filterStatus === 'read') matchesStatus = isRead;
      else if (filterStatus === 'problem') matchesStatus = r.status !== 'ปกติ';
      else if (filterStatus === 'line_registered') matchesStatus = !!r.line_user_id;

      return matchesSearch && matchesFloor && matchesStatus;
    });
  }, [rooms, searchQuery, filterFloor, filterStatus, logMap]);

  // Calculated Bills for Billing Tab
  const calculatedBills = useMemo(() => {
    return rooms.map((room) => {
      const log = logMap[room.room_no];
      const curr = log ? Number(log.curr_meter) : Number(room.latest_meter) || 0;
      return calculateBill(
        room,
        curr,
        period,
        config,
        log ? Number(log.special_items) || 0 : 0,
        log?.note || '',
        Number(room.outstanding_balance) || 0
      );
    });
  }, [rooms, logMap, period, config]);

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
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
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
                <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                  ระบบบริหารนิติบุคคล
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">195 ห้อง • รอบบิล {period}</p>
            </div>
          </div>

          {/* Quick Action: Open Meter App */}
          <div className="flex items-center gap-2.5">
            <a
              href="/meter"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600 text-white font-bold rounded-xl text-xs shadow-md flex items-center gap-2 transition active:scale-95 border border-sky-400/30"
              title="เปิดหน้าจดมิเตอร์สำหรับพนักงานในหน้าต่างใหม่"
            >
              <span>📱 ไปหน้าจดมิเตอร์ (พนักงาน/นิติ)</span>
              <span className="text-sky-200">↗</span>
            </a>

            <div className="bg-slate-800 px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 border border-slate-700">
              <span className="text-slate-400 text-[11px]">รอบบิล:</span>
              <span className="font-bold text-sky-400 font-mono">{period}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main App Navigation Tabs */}
      <nav className="bg-white border-b shadow-sm sticky top-[65px] z-30 overflow-x-auto text-xs">
        <div className="max-w-7xl mx-auto flex">
          {[
            { id: 'billing', label: '🧾 ออกบิล & พิมพ์ PDF (4/A4)' },
            { id: 'payments', label: '💰 รับชำระ & ลูกหนี้' },
            { id: 'rooms', label: '🏢 จัดการ 195 ห้อง & สมทบทุน', count: `${rooms.length}` },
            { id: 'accounting', label: '📊 บัญชีกองทุน & ส่วนต่างน้ำ' },
            { id: 'line', label: '📲 LINE OA & ลงทะเบียน', count: `${lineRegisteredCount}/${rooms.length}` },
            { id: 'settings', label: '⚙️ ตั้งค่าระบบ' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3.5 px-4 font-bold border-b-2 whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count && (
                <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-mono">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto w-full p-3 sm:p-5 flex-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">กำลังเชื่อมต่อฐานข้อมูล Supabase...</p>
          </div>
        ) : (
          <>
            {/* Quick Banner: Meter Reading Status */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-3.5 rounded-2xl shadow-sm mb-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📱</span>
                <div>
                  <span className="text-slate-300 font-medium">สถานะการจดมิเตอร์น้ำรอบ {period}: </span>
                  <span className="font-bold text-sky-400 font-mono text-sm">จดแล้ว {readCount} / {rooms.length} ห้อง ({readPercentage}%)</span>
                </div>
              </div>
              <a
                href="/meter"
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-sm transition active:scale-95"
              >
                ▶ เปิดแอปจดมิเตอร์น้ำ ↗
              </a>
            </div>

            {/* TAB 1: BILLING & 4-PER-A4 PDF */}
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
                      {isGeneratingQr ? 'กำลังสร้าง QR Code...' : '🖨️ พิมพ์ 4 บิลต่อ 1 A4 (ทุกห้อง)'}
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
                          <th className="py-2.5 px-3 text-left">เลขที่บิล</th>
                          <th className="py-2.5 px-3 text-left">ห้อง</th>
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
                        {calculatedBills.map((bill) => {
                          const log = logMap[bill.room_no];
                          const isPaid = log?.is_paid;

                          return (
                            <tr key={bill.room_no} className="hover:bg-slate-50">
                              <td className="py-2 px-3 font-mono text-slate-500">{bill.invoice_no}</td>
                              <td className="py-2 px-3 font-bold text-blue-700">{bill.formatted_room}</td>
                              <td className="py-2 px-3 text-right font-mono">{bill.units_used}</td>
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

            {/* TAB 2: PAYMENTS & AR */}
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
                  {rooms.map((room) => {
                    const log = logMap[room.room_no];
                    const isPaid = log?.is_paid;
                    const dueAmt = log ? Number(log.total_amount) : (Number(room.outstanding_balance) || 0);

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
                            {room.owner_name || 'เจ้าของห้อง'}
                          </div>
                          <div className="bg-slate-50 p-2 rounded-lg flex justify-between items-center text-xs">
                            <span className="text-slate-500">ยอดบิลรอบนี้:</span>
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
                              ชำระแล้วผ่าน {log.paid_type || 'พร้อมเพย์'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 3: ROOMS & WALLETS */}
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

            {/* TAB 4: ACCOUNTING & WATER RECONCILIATION */}
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

            {/* TAB 5: LINE OA & REGISTRATION */}
            {activeTab === 'line' && (
              <div className="space-y-4 max-w-4xl mx-auto">
                {/* Instructions Card */}
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
                    <p className="text-[11px] text-emerald-700">
                      *รหัสนี้จะถูกพิมพ์ไว้บนบิลกระดาษ 4 ต่อ A4 โดยอัตโนมัติ เพื่อให้ลูกบ้านเห็นและพิมพ์ลงทะเบียนได้ทันที
                    </p>
                  </div>

                  {/* Webhook Endpoint Info */}
                  <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs space-y-1">
                    <span className="font-bold text-slate-700 block">URL Webhook สำหรับใส่ใน LINE Developers Console:</span>
                    <div className="bg-white p-2 rounded border font-mono text-slate-800 text-[11px] select-all">
                      https://[ชื่อโดเมนของคอนโดคุณ]/api/line/webhook
                    </div>
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

            {/* TAB 6: SETTINGS */}
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
          config={config}
          qrMap={qrMap}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
}
