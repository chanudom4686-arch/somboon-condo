'use client';

// Printable A4 Monthly Noticeboard Report & Annual 12-Month Payment History Report
// Version 1.9 - Fixed A4 Pagination, 100% Black & White Print Layout, High-Contrast Inverted Highlight for Unpaid/Overdue/Problem Rooms

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
  const incomeTx = periodTx.filter((tx) => tx.type === 'รายรับ' || tx.type === 'income');
  const expenseTx = periodTx.filter((tx) => tx.type === 'รายจ่าย' || tx.type === 'expense');

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
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm overflow-y-auto print:static print:inset-auto print:z-auto print:bg-white print:overflow-visible print:backdrop-blur-none">
      {/* Screen Top Bar */}
      <div className="sticky top-0 z-50 bg-white border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm print:hidden">
        <div>
          <h2 className="font-bold text-slate-800 text-base sm:text-lg">
            📋 รายงานส่งมอบนิติบุคคล & ติดบอร์ดประกาศ ขาว-ดำ ({condoName})
          </h2>
          <p className="text-xs text-slate-500">
            จัดหน้ากระดาษ A4 สำหรับพิมพ์ขาว-ดำ • ไฮไลท์แถบดำเด่นชัดสำหรับห้องที่ค้างชำระหรือมีปัญหา
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setReportType('monthly')}
            className={`px-3.5 py-2 rounded-xl font-bold ${
              reportType === 'monthly'
                ? 'bg-slate-900 text-white'
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
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            📅 รายงานรายปี (ประวัติครบทุกห้อง)
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-xl shadow flex items-center gap-1.5"
          >
            🖨️ พิมพ์รายงานขาว-ดำ A4 / บันทึก PDF
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

      {/* Print Stylesheet for Proper A4 Multi-Page Formatting & B&W High Contrast */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          @page {
            size: A4 portrait;
            margin: 8mm 8mm;
          }
          .report-a4-container {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .print-avoid-break {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          table.a4-report-table {
            width: 100%;
            border-collapse: collapse;
          }
          table.a4-report-table thead {
            display: table-header-group;
          }
          table.a4-report-table tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      `,
        }}
      />

      {/* Printable Report Sheet */}
      <div className="report-a4-container max-w-4xl mx-auto my-6 bg-white p-6 sm:p-8 rounded-2xl shadow-lg text-black text-xs space-y-4">
        {/* Document Header */}
        <div className="text-center border-b-2 border-black pb-3">
          <h1 className="text-lg font-extrabold text-black">{condoName}</h1>
          <h2 className="text-sm font-bold text-black mt-0.5">
            {reportType === 'monthly'
              ? `ประกาศสรุปบัญชีรายรับ–รายจ่าย และสถานะการชำระค่าส่วนกลาง/ค่าน้ำ ประจำเดือน ${period}`
              : `รายงานสรุปภาพรวมรายปี และประวัติการชำระเงินของห้องชุดทั้งหมด (${rooms.length} มิเตอร์ / 195 ห้องชุด)`}
          </h2>
          <p className="text-[11px] text-neutral-700 mt-1">
            จัดทำโดย: ระบบบริหารบัญชีและติดตามค่าส่วนกลาง (ข้อมูล ณ วันที่{' '}
            {new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })})
          </p>
        </div>

        {reportType === 'monthly' ? (
          <>
            {/* 1. Executive Financial Summary (4 Boxes in B&W High Contrast) */}
            <div className="grid grid-cols-4 gap-2.5 print-avoid-break">
              <div className="border border-black rounded-lg p-2.5 bg-white">
                <span className="text-neutral-700 block text-[10px] font-semibold">ห้องที่ชำระแล้ว</span>
                <span className="text-sm font-extrabold text-black font-mono">
                  {paidRooms.length} / {rooms.length} ห้อง ({collectionPct}%)
                </span>
              </div>
              <div className="border-2 border-black rounded-lg p-2.5 bg-neutral-900 text-white">
                <span className="text-neutral-200 block text-[10px] font-semibold">
                  ⚠ ห้องค้างชำระ / ยังไม่ชำระ
                </span>
                <span className="text-sm font-extrabold text-white font-mono">
                  {unpaidRooms.length} ห้อง
                </span>
              </div>
              <div className="border border-black rounded-lg p-2.5 bg-white">
                <span className="text-neutral-700 block text-[10px] font-semibold">รายรับรวมประจำเดือน</span>
                <span className="text-sm font-extrabold text-black font-mono">
                  +{totalIncome.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                </span>
              </div>
              <div className="border border-black rounded-lg p-2.5 bg-neutral-100">
                <span className="text-neutral-700 block text-[10px] font-semibold">
                  รายจ่ายรวม / คงเหลือสุทธิ
                </span>
                <span className="text-xs font-extrabold text-black font-mono block">
                  จ่าย: -{totalExpense.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                </span>
                <span className="text-[11px] font-bold text-black font-mono block">
                  สุทธิ: {(totalIncome - totalExpense).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                </span>
              </div>
            </div>

            {/* 2. Monthly Expense Itemization */}
            <div className="space-y-1.5">
              <h3 className="font-bold text-black text-xs">
                1. รายละเอียดรายจ่ายประจำเดือน {period} ({expenseTx.length} รายการ)
              </h3>
              {expenseTx.length === 0 ? (
                <div className="p-2.5 border border-black rounded-lg text-neutral-700 text-center text-[11px]">
                  ไม่มีรายการรายจ่ายที่บันทึกในรอบเดือนนี้
                </div>
              ) : (
                <table className="a4-report-table w-full border-collapse border border-black text-[11px] text-black">
                  <thead>
                    <tr className="bg-neutral-200 text-black">
                      <th className="border border-black py-1.5 px-2 text-left">วันที่</th>
                      <th className="border border-black py-1.5 px-2 text-left">กองทุน</th>
                      <th className="border border-black py-1.5 px-2 text-left">หมวดหมู่</th>
                      <th className="border border-black py-1.5 px-2 text-left">รายละเอียด</th>
                      <th className="border border-black py-1.5 px-2 text-right">จำนวนเงิน (บาท)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseTx.map((tx) => (
                      <tr key={tx.id}>
                        <td className="border border-black py-1 px-2 font-mono">{tx.tx_date}</td>
                        <td className="border border-black py-1 px-2">
                          {tx.fund_type === 'maintenance_fund' ? 'กองทุนซ่อมบำรุง' : 'กองทุนดำเนินงาน'}
                        </td>
                        <td className="border border-black py-1 px-2 font-semibold">{tx.category}</td>
                        <td className="border border-black py-1 px-2">{tx.note || '-'}</td>
                        <td className="border border-black py-1 px-2 text-right font-mono font-bold">
                          {Number(tx.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 3. All 195 Rooms Payment Status Grid (5 Columns on A4 with B&W High-Contrast Highlight for Unpaid Rooms) */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black pb-1">
                <h3 className="font-bold text-black text-xs">
                  2. สรุปสถานะการชำระเงินรายห้อง ครบทุกห้องชุด (รอบบิล {period})
                </h3>
                <div className="flex items-center gap-3 text-[10px] font-bold">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-3 border border-black bg-white" />
                    ช่องสีขาว = ชำระแล้ว ({paidRooms.length} ห้อง)
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-3 border border-black bg-neutral-900" />
                    แถบสีดำตัวอักษรขาว = ค้างชำระ / ยังไม่ชำระ ({unpaidRooms.length} ห้อง)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-1.5 text-[10px]">
                {rooms.map((room) => {
                  const log = logMap[room.room_no];
                  const bill = billMap[room.room_no];
                  const isPaid = !!log?.is_paid;
                  const isProblemStatus = room.status && room.status !== 'ปกติ';
                  const amt = bill ? bill.total_amount : 0;

                  return (
                    <div
                      key={room.room_no}
                      className={`print-avoid-break px-1.5 py-1 rounded flex items-center justify-between ${
                        !isPaid
                          ? 'bg-neutral-900 text-white border-2 border-black font-bold'
                          : isProblemStatus
                          ? 'bg-neutral-200 text-black border-2 border-black font-bold'
                          : 'bg-white border border-neutral-400 text-black'
                      }`}
                    >
                      <span className="font-bold font-mono">
                        {!isPaid ? `⚠ ${formatRoomNo(room.room_no)}` : formatRoomNo(room.room_no)}
                      </span>
                      <span className="font-mono text-[9.5px]">
                        {isPaid
                          ? log?.is_late_payment
                            ? '✓ ชำระ(ล่าช้า)'
                            : '✓ ชำระแล้ว'
                          : `ค้าง ${amt.toLocaleString()} บ.`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          /* Annual Report (195 Rooms Payment History & Arrears Summary - B&W High Contrast) */
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-black text-xs">
                สรุปประวัติการชำระเงินรายปี และยอดค้างชำระสะสมของทุกห้องชุด
              </h3>
              <div className="flex items-center gap-3 text-[10px] font-bold">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-3 border border-black bg-white" />
                  แถวสีขาว = ชำระปกติ ไม่มียอดค้าง
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-3 border border-black bg-neutral-900" />
                  แถบสีดำ / พื้นเทา = ห้องค้างชำระ หรือห้องมีปัญหา
                </span>
              </div>
            </div>

            <table className="a4-report-table w-full border-collapse border border-black text-[10.5px] text-black">
              <thead>
                <tr className="bg-neutral-200 text-black">
                  <th className="border border-black py-1.5 px-2 text-left">ห้องชุด</th>
                  <th className="border border-black py-1.5 px-2 text-left">ประเภท</th>
                  <th className="border border-black py-1.5 px-2 text-center">สถานะห้อง</th>
                  <th className="border border-black py-1.5 px-2 text-center">รอบที่ชำระแล้ว</th>
                  <th className="border border-black py-1.5 px-2 text-center">รอบที่ค้างชำระ</th>
                  <th className="border border-black py-1.5 px-2 text-right">เครดิตสมทบคงเหลือ</th>
                  <th className="border border-black py-1.5 px-2 text-right">ยอดค้างชำระสะสม (บาท)</th>
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
                  const hasIssueOrArrears =
                    totalArrears > 0 || unpaidCount > 0 || (room.status && room.status !== 'ปกติ');

                  return (
                    <tr
                      key={room.room_no}
                      className={hasIssueOrArrears ? 'bg-neutral-200 font-bold' : 'bg-white'}
                    >
                      <td
                        className={`border border-black py-1 px-2 font-bold font-mono ${
                          hasIssueOrArrears ? 'bg-neutral-900 text-white' : 'text-black'
                        }`}
                      >
                        {hasIssueOrArrears
                          ? `⚠ ${formatRoomNo(room.room_no)}`
                          : formatRoomNo(room.room_no)}
                      </td>
                      <td className="border border-black py-1 px-2">{room.room_type}</td>
                      <td
                        className={`border border-black py-1 px-2 text-center ${
                          room.status !== 'ปกติ' ? 'underline font-extrabold' : ''
                        }`}
                      >
                        {room.status}
                      </td>
                      <td className="border border-black py-1 px-2 text-center font-mono">
                        {paidCount} งวด
                      </td>
                      <td
                        className={`border border-black py-1 px-2 text-center font-mono ${
                          unpaidCount > 0 ? 'font-extrabold underline' : ''
                        }`}
                      >
                        {unpaidCount > 0 ? `ค้าง ${unpaidCount} งวด` : '0 งวด'}
                      </td>
                      <td className="border border-black py-1 px-2 text-right font-mono">
                        {(Number(room.contribution_credit) || 0).toLocaleString()}
                      </td>
                      <td
                        className={`border border-black py-1 px-2 text-right font-mono font-bold ${
                          totalArrears > 0 ? 'bg-neutral-900 text-white' : 'text-black'
                        }`}
                      >
                        {totalArrears > 0
                          ? `⚠ ${totalArrears.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Signature Footer for Noticeboard */}
        <div className="print-avoid-break pt-6 grid grid-cols-2 gap-8 text-center text-xs text-black">
          <div>
            <p>ลงชื่อ ............................................................ ผู้จัดทำรายงาน</p>
            <p className="text-neutral-700 mt-1">(บริษัท โอเอสดี ซัน ทีอาร์พี กรุ๊ป จำกัด)</p>
          </div>
          <div>
            <p>ลงชื่อ ............................................................ ผู้ตรวจรับรายงาน</p>
            <p className="text-neutral-700 mt-1">(ผู้จัดการนิติบุคคล / คณะกรรมการนิติบุคคลฯ)</p>
          </div>
        </div>
      </div>
    </div>
  );
};
