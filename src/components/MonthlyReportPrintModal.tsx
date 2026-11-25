'use client';

// Printable A4 Monthly Noticeboard Report & Annual 12-Month Payment History Report
// Version 1.4 - Matches Proposal Section 1.2 & Section 3.2 (KPI 3)

import React, { useState } from 'react';
import { Room, MeterLog, BillCalculationResult, CondoConfig } from '@/types/condo';
import { formatRoomNo } from '@/utils/billing';

interface MonthlyReportPrintModalProps {
  period: string;
  rooms: Room[];
  bills: BillCalculationResult[];
  logMap: Record<string, MeterLog>;
  transactions: any[];
  config: Partial<CondoConfig>;
  allYearLogs?: MeterLog[];
  onClose: () => void;
}

export const MonthlyReportPrintModal: React.FC<MonthlyReportPrintModalProps> = ({
  period,
  rooms,
  bills,
  logMap,
  transactions,
  config,
  allYearLogs = [],
  onClose,
}) => {
  const [reportType, setReportType] = useState<'monthly' | 'annual'>('monthly');

  const condoName = config.CONDO_NAME || 'นิติบุคคลอาคารชุดสมบูรณ์คอนโดทาวน์ (645)';
  const periodTx = transactions.filter((tx) => (tx.tx_date || '').startsWith(period));
  const incomeTx = periodTx.filter((tx) => tx.type === 'รายรับ');
  const expenseTx = periodTx.filter((tx) => tx.type === 'รายจ่าย');

  const totalIncome = incomeTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalExpense = expenseTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const paidRooms = rooms.filter((r) => logMap[r.room_no]?.is_paid);
  const unpaidRooms = rooms.filter((r) => !logMap[r.room_no]?.is_paid);
  const collectionPct = rooms.length > 0 ? ((paidRooms.length / rooms.length) * 100).toFixed(1) : '0.0';

  const billMap: Record<string, BillCalculationResult> = {};
  bills.forEach((b) => {
    billMap[b.room_no] = b;
  });

  // Group allYearLogs by room_no for annual report
  const logsByRoom: Record<string, MeterLog[]> = {};
  allYearLogs.forEach((l) => {
    if (!logsByRoom[l.room_no]) logsByRoom[l.room_no] = [];
    logsByRoom[l.room_no].push(l);
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm overflow-y-auto">
      {/* Screen Top Bar */}
      <div className="sticky top-0 z-50 bg-white border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm print:hidden">
        <div>
          <h2 className="font-bold text-slate-800 text-base sm:text-lg">
            📋 รายงานส่งมอบนิติบุคคล & ติดบอร์ดประกาศ ({condoName})
          </h2>
          <p className="text-xs text-slate-500">
            ตามขอบเขตงานบริการข้อ 1.2: รายงานรายเดือนติดประกาศครบ 195 ห้อง และรายงานสรุปรายปี
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setReportType('monthly')}
            className={`px-3.5 py-2 rounded-xl font-bold ${
              reportType === 'monthly'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            📄 รายงานรายเดือน ({period})
          </button>
          <button
            type="button"
            onClick={() => setReportType('annual')}
            className={`px-3.5 py-2 rounded-xl font-bold ${
              reportType === 'annual'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            📅 รายงานรายปี (ประวัติ 195 ห้อง)
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow flex items-center gap-1.5"
          >
            🖨️ พิมพ์รายงาน A4 / บันทึก PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-medium"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>

      {/* Printable Report Sheet */}
      <div className="max-w-4xl mx-auto my-6 bg-white p-6 sm:p-8 rounded-2xl shadow-lg print:shadow-none print:my-0 print:p-4 text-slate-800 text-xs space-y-5">
        <div className="text-center border-b pb-4">
          <h1 className="text-lg font-bold text-slate-900">{condoName}</h1>
          <h2 className="text-sm font-bold text-blue-700 mt-0.5">
            {reportType === 'monthly'
              ? `ประกาศสรุปรายรับ–รายจ่าย และสถานะการชำระค่าส่วนกลาง/ค่าน้ำ ประจำเดือน ${period}`
              : `รายงานสรุปภาพรวมรายปี และประวัติการชำระเงินของห้องชุดทั้ง 195 ห้อง`}
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">
            จัดทำโดย: ระบบบริหารบัญชีและติดตามค่าส่วนกลาง (ข้อมูล ณ วันที่ {new Date().toLocaleDateString('th-TH')})
          </p>
        </div>

        {reportType === 'monthly' ? (
          <>
            {/* 1. Executive Financial Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="border rounded-xl p-3 bg-slate-50">
                <span className="text-slate-500 block text-[11px]">ห้องที่ชำระแล้ว</span>
                <span className="text-base font-bold text-emerald-700 font-mono">
                  {paidRooms.length} / {rooms.length} ห้อง ({collectionPct}%)
                </span>
              </div>
              <div className="border rounded-xl p-3 bg-slate-50">
                <span className="text-slate-500 block text-[11px]">รายรับรวมประจำเดือน</span>
                <span className="text-base font-bold text-emerald-700 font-mono">
                  +{totalIncome.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                </span>
              </div>
              <div className="border rounded-xl p-3 bg-slate-50">
                <span className="text-slate-500 block text-[11px]">รายจ่ายรวมประจำเดือน</span>
                <span className="text-base font-bold text-red-600 font-mono">
                  -{totalExpense.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                </span>
              </div>
              <div className="border rounded-xl p-3 bg-slate-50">
                <span className="text-slate-500 block text-[11px]">คงเหลือสุทธิประจำเดือน</span>
                <span className={`text-base font-bold font-mono ${totalIncome - totalExpense >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                  {(totalIncome - totalExpense).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                </span>
              </div>
            </div>

            {/* 2. Monthly Expense Itemization */}
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-2">
                1. รายละเอียดรายจ่ายประจำเดือน {period} ({expenseTx.length} รายการ)
              </h3>
              {expenseTx.length === 0 ? (
                <div className="p-3 border rounded-xl text-slate-400 text-center">
                  ไม่มีรายการรายจ่ายที่บันทึกในรอบเดือนนี้
                </div>
              ) : (
                <table className="w-full border-collapse border border-slate-300 text-[11px]">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="border border-slate-300 py-1.5 px-2 text-left">วันที่</th>
                      <th className="border border-slate-300 py-1.5 px-2 text-left">กองทุน</th>
                      <th className="border border-slate-300 py-1.5 px-2 text-left">หมวดหมู่</th>
                      <th className="border border-slate-300 py-1.5 px-2 text-left">รายละเอียด</th>
                      <th className="border border-slate-300 py-1.5 px-2 text-right">จำนวนเงิน (บาท)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseTx.map((tx) => (
                      <tr key={tx.id}>
                        <td className="border border-slate-300 py-1 px-2">{tx.tx_date}</td>
                        <td className="border border-slate-300 py-1 px-2">
                          {tx.fund_type === 'maintenance_fund' ? 'กองทุนซ่อมบำรุง' : 'กองทุนดำเนินงาน'}
                        </td>
                        <td className="border border-slate-300 py-1 px-2 font-medium">{tx.category}</td>
                        <td className="border border-slate-300 py-1 px-2">{tx.note || '-'}</td>
                        <td className="border border-slate-300 py-1 px-2 text-right font-mono">
                          {Number(tx.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 3. All 195 Rooms Payment Status Grid (For Noticeboard Transparency) */}
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-2">
                2. สรุปสถานะการชำระเงินรายห้อง ครบทั้ง 195 ห้องชุด (รอบบิล {period})
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 text-[10px]">
                {rooms.map((room) => {
                  const log = logMap[room.room_no];
                  const bill = billMap[room.room_no];
                  const isPaid = log?.is_paid;
                  const amt = bill ? bill.total_amount : 0;

                  return (
                    <div
                      key={room.room_no}
                      className={`p-1.5 rounded border flex items-center justify-between ${
                        isPaid
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      <span className="font-bold font-mono">{formatRoomNo(room.room_no)}</span>
                      <span className="font-mono">
                        {isPaid ? '✅ ชำระแล้ว' : `${amt.toLocaleString()} บ.`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          /* Annual Report (195 Rooms Payment History & Arrears Summary) */
          <div className="space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">
              สรุปประวัติการชำระเงินรายปี และยอดค้างชำระคงเหลือของทั้ง 195 ห้องชุด
            </h3>
            <table className="w-full border-collapse border border-slate-300 text-[11px]">
              <thead className="bg-slate-100">
                <tr>
                  <th className="border border-slate-300 py-1.5 px-2 text-left">ห้องชุด</th>
                  <th className="border border-slate-300 py-1.5 px-2 text-left">ประเภท</th>
                  <th className="border border-slate-300 py-1.5 px-2 text-center">สถานะห้อง</th>
                  <th className="border border-slate-300 py-1.5 px-2 text-center">จำนวนรอบที่ชำระแล้ว</th>
                  <th className="border border-slate-300 py-1.5 px-2 text-center">จำนวนรอบที่ค้าง/ล่าช้า</th>
                  <th className="border border-slate-300 py-1.5 px-2 text-right">เครดิตสมทบคงเหลือ</th>
                  <th className="border border-slate-300 py-1.5 px-2 text-right">ยอดค้างชำระสะสม (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => {
                  const rLogs = logsByRoom[room.room_no] || (logMap[room.room_no] ? [logMap[room.room_no]] : []);
                  const paidCount = rLogs.filter((l) => l.is_paid).length;
                  const unpaidCount = rLogs.filter((l) => !l.is_paid).length;
                  const currentUnpaidAmt = rLogs
                    .filter((l) => !l.is_paid)
                    .reduce((s, l) => s + (Number(l.total_amount) || 0), 0);
                  const totalArrears = (Number(room.outstanding_balance) || 0) + currentUnpaidAmt;

                  return (
                    <tr key={room.room_no}>
                      <td className="border border-slate-300 py-1 px-2 font-bold font-mono">
                        {formatRoomNo(room.room_no)}
                      </td>
                      <td className="border border-slate-300 py-1 px-2">{room.room_type}</td>
                      <td className="border border-slate-300 py-1 px-2 text-center">{room.status}</td>
                      <td className="border border-slate-300 py-1 px-2 text-center font-mono text-emerald-700 font-bold">
                        {paidCount} งวด
                      </td>
                      <td className="border border-slate-300 py-1 px-2 text-center font-mono text-amber-700">
                        {unpaidCount} งวด
                      </td>
                      <td className="border border-slate-300 py-1 px-2 text-right font-mono text-emerald-700">
                        {(Number(room.contribution_credit) || 0).toLocaleString()}
                      </td>
                      <td className="border border-slate-300 py-1 px-2 text-right font-mono font-bold text-red-600">
                        {totalArrears > 0 ? totalArrears.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Signature Footer for Noticeboard */}
        <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs">
          <div>
            <p>ลงชื่อ ............................................................ ผู้จัดทำรายงาน</p>
            <p className="text-slate-500 mt-1">(บริษัท โอเอสดี ซัน ทีอาร์พี กรุ๊ป จำกัด)</p>
          </div>
          <div>
            <p>ลงชื่อ ............................................................ ผู้ตรวจรับรายงาน</p>
            <p className="text-slate-500 mt-1">(ผู้จัดการนิติบุคคล / คณะกรรมการนิติบุคคลฯ)</p>
          </div>
        </div>
      </div>
    </div>
  );
};
