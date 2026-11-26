'use client';

// Printable A4 Monthly Noticeboard Report & Annual 12-Month Payment History Report
// Version 2.5 - Supports 2 Report Editions:
// 1. Juristic Full Detail (ฉบับนิติบุคคล & กรรมการ: ข้อมูลครบถ้วนสำหรับบริหารจัดการและตรวจสอบบัญชี)
// 2. Resident & Public PDPA (ฉบับเจ้าของร่วม / ติดบอร์ด: อ่านง่าย สรุปชัดเจน ป้องกันข้อมูลส่วนบุคคลตาม พ.ร.บ. PDPA ไม่ระบุชื่อและยอดหนี้รายบุคคล)

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
  const [audience, setAudience] = useState<'juristic' | 'resident'>('juristic');
  const [reportType, setReportType] = useState<'monthly' | 'annual'>('monthly');

  const condoName = config.CONDO_NAME || 'นิติบุคคลอาคารชุดสมบูรณ์คอนโดทาวน์ (645)';
  const periodTx = transactions.filter((tx) => (tx.tx_date || '').startsWith(period));
  const incomeTx = periodTx.filter((tx) => tx.type === 'รายรับ' || tx.type === 'income');
  const expenseTx = periodTx.filter((tx) => tx.type === 'รายจ่าย' || tx.type === 'expense');

  const totalIncome = incomeTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalExpense = expenseTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const netSurplus = totalIncome - totalExpense;

  // Breakdown expenses by category
  const expenseByCategory: Record<string, number> = {};
  expenseTx.forEach((tx) => {
    const cat = tx.category || 'ค่าใช้จ่ายทั่วไป';
    expenseByCategory[cat] = (expenseByCategory[cat] || 0) + (Number(tx.amount) || 0);
  });

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

  // Calculate annual transaction sums
  const currentYear = period.split('-')[0] || '2026';
  const yearTx = transactions.filter((tx) => (tx.tx_date || '').startsWith(currentYear));
  const yearIncomeTx = yearTx.filter((tx) => tx.type === 'รายรับ' || tx.type === 'income');
  const yearExpenseTx = yearTx.filter((tx) => tx.type === 'รายจ่าย' || tx.type === 'expense');
  const totalYearIncome = yearIncomeTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalYearExpense = yearExpenseTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const yearExpenseByCategory: Record<string, number> = {};
  yearExpenseTx.forEach((tx) => {
    const cat = tx.category || 'ค่าใช้จ่ายทั่วไป';
    yearExpenseByCategory[cat] = (yearExpenseByCategory[cat] || 0) + (Number(tx.amount) || 0);
  });

  // Total fund contribution credit across all rooms
  const totalFundCredit = rooms.reduce((s, r) => s + (Number(r.contribution_credit) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm overflow-y-auto print:static print:inset-auto print:z-auto print:bg-white print:overflow-visible print:backdrop-blur-none">
      {/* Screen Top Bar */}
      <div className="sticky top-0 z-50 bg-white border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm print:hidden">
        <div>
          <h2 className="font-bold text-slate-800 text-base sm:text-lg flex items-center gap-2">
            <span>📋 บัญชีรายรับ-รายจ่าย & รายงานส่งมอบนิติบุคคล</span>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                audience === 'resident'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-blue-100 text-blue-800 border border-blue-300'
              }`}
            >
              {audience === 'resident' ? '👥 ฉบับเจ้าของร่วม (PDPA)' : '🏢 ฉบับนิติบุคคล (เต็ม)'}
            </span>
          </h2>
          <p className="text-xs text-slate-500">
            {audience === 'resident'
              ? 'สรุปภาพรวมรายรับ-รายจ่าย อ่านเข้าใจง่าย ไม่ระบุชื่อและยอดหนี้รายบุคคลตามมาตรฐาน PDPA'
              : 'รายงานรายละเอียดทางการเงินและสถานะครบ 195 ห้อง สำหรับกรรมการนิติและผู้ตรวจสอบบัญชี'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Audience Switcher */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setAudience('juristic')}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1 ${
                audience === 'juristic'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🏢 ฉบับนิติบุคคล
            </button>
            <button
              type="button"
              onClick={() => setAudience('resident')}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1 ${
                audience === 'resident'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              👥 ฉบับเจ้าของร่วม (PDPA)
            </button>
          </div>

          {/* Period Switcher */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setReportType('monthly')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                reportType === 'monthly'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📄 รายเดือน ({period})
            </button>
            <button
              type="button"
              onClick={() => setReportType('annual')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                reportType === 'annual'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📅 รายปี ({currentYear})
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-xl shadow flex items-center gap-1.5"
          >
            🖨️ พิมพ์ A4 / บันทึก PDF
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

      {/* Print Stylesheet for Proper A4 Multi-Page Formatting & High Contrast */}
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
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono border border-black px-2 py-0.5 rounded font-bold">
              {audience === 'resident'
                ? '👥 ฉบับเจ้าของร่วม / ติดบอร์ด (PDPA Compliant)'
                : '🏢 ฉบับนิติบุคคล & คณะกรรมการ (Internal Juristic)'}
            </span>
            <span className="text-[10px] text-neutral-600 font-mono">
              พิมพ์เมื่อ:{' '}
              {new Date().toLocaleDateString('th-TH', {
                timeZone: 'Asia/Bangkok',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
          <h1 className="text-lg font-extrabold text-black mt-2">{condoName}</h1>
          <h2 className="text-sm font-bold text-black mt-0.5">
            {audience === 'resident'
              ? reportType === 'monthly'
                ? `รายงานสรุปภาพรวมรายรับ–รายจ่าย ประจำเดือน ${period}`
                : `รายงานสรุปภาพรวมการเงินและรายรับ-รายจ่าย ประจำปี ${currentYear}`
              : reportType === 'monthly'
              ? `ประกาศสรุปบัญชีรายรับ–รายจ่าย และสถานะการชำระค่าส่วนกลาง/ค่าน้ำ ประจำเดือน ${period}`
              : `รายงานสรุปภาพรวมรายปี และประวัติการชำระเงินของห้องชุดทั้งหมด (${rooms.length} มิเตอร์ / 195 ห้องชุด)`}
          </h2>
          {audience === 'resident' && (
            <p className="text-[10px] text-emerald-800 font-medium mt-1 bg-emerald-50 border border-emerald-300 py-1 px-3 rounded inline-block">
              🛡️ รายงานนี้สรุปความโปร่งใสทางการเงินตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA) โดยไม่เปิดเผยชื่อหรือยอดค้างชำระของบุคคล
            </p>
          )}
        </div>

        {/* ======================================================== */}
        {/* VIEW 1: RESIDENT & PUBLIC PDPA VERSION (ฉบับเจ้าของร่วม) */}
        {/* ======================================================== */}
        {audience === 'resident' ? (
          reportType === 'monthly' ? (
            /* Monthly Resident PDPA View */
            <div className="space-y-4">
              {/* 1. Executive Summary Cards (Clean & Readable) */}
              <div className="grid grid-cols-4 gap-2.5 print-avoid-break">
                <div className="border-2 border-emerald-700 bg-emerald-50/50 rounded-xl p-3">
                  <span className="text-emerald-900 block text-[10px] font-bold">💰 รายรับรวมประจำเดือน</span>
                  <span className="text-base font-extrabold text-emerald-950 font-mono block mt-0.5">
                    +{totalIncome.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                  </span>
                  <span className="text-[9.5px] text-emerald-800">ค่าส่วนกลาง, ค่าน้ำ, รายรับอื่น</span>
                </div>
                <div className="border-2 border-rose-700 bg-rose-50/50 rounded-xl p-3">
                  <span className="text-rose-900 block text-[10px] font-bold">💸 รายจ่ายรวมประจำเดือน</span>
                  <span className="text-base font-extrabold text-rose-950 font-mono block mt-0.5">
                    -{totalExpense.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                  </span>
                  <span className="text-[9.5px] text-rose-800">ค่าสาธารณูปโภค & บริหารตึก</span>
                </div>
                <div className={`border-2 rounded-xl p-3 ${netSurplus >= 0 ? 'border-blue-700 bg-blue-50/50' : 'border-amber-700 bg-amber-50/50'}`}>
                  <span className="text-slate-900 block text-[10px] font-bold">⚖️ คงเหลือสุทธิประจำงวด</span>
                  <span className="text-base font-extrabold text-slate-950 font-mono block mt-0.5">
                    {netSurplus >= 0 ? '+' : ''}{netSurplus.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                  </span>
                  <span className="text-[9.5px] text-slate-700">
                    {netSurplus >= 0 ? 'ดุลการเงินเป็นบวก' : 'รายจ่ายเกินรายรับในงวดนี้'}
                  </span>
                </div>
                <div className="border-2 border-black bg-neutral-900 text-white rounded-xl p-3">
                  <span className="text-neutral-300 block text-[10px] font-bold">🏢 อัตราการชำระเงิน</span>
                  <span className="text-base font-extrabold text-white font-mono block mt-0.5">
                    {collectionPct}%
                  </span>
                  <span className="text-[9.5px] text-neutral-300">
                    ชำระแล้ว {paidRooms.length} / {rooms.length} ห้อง
                  </span>
                </div>
              </div>

              {/* 2. Breakdown of Monthly Operating Expenses (หมวดหมู่รายจ่ายที่เจ้าของร่วมต้องการทราบ) */}
              <div className="space-y-1.5 print-avoid-break">
                <h3 className="font-bold text-black text-xs flex items-center justify-between border-b border-black pb-1">
                  <span>1. รายละเอียดค่าใช้จ่ายในการบริหารอาคารประจำเดือน {period}</span>
                  <span className="font-mono text-neutral-600">รวม {expenseTx.length} รายการ</span>
                </h3>
                {Object.keys(expenseByCategory).length === 0 ? (
                  <div className="p-3 border border-neutral-300 rounded-lg text-center text-neutral-500 text-[11px]">
                    ไม่มีบันทึกรายการรายจ่ายในรอบเดือนนี้
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {Object.entries(expenseByCategory).map(([cat, amt]) => {
                      const pct = totalExpense > 0 ? ((amt / totalExpense) * 100).toFixed(1) : '0';
                      return (
                        <div key={cat} className="flex items-center justify-between p-2 border border-neutral-300 rounded-lg bg-neutral-50">
                          <span className="font-semibold text-slate-800">
                            • {cat}
                          </span>
                          <span className="font-mono font-bold text-black">
                            {amt.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ. <span className="text-[9.5px] text-neutral-500 font-normal">({pct}%)</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 3. Building Maintenance Fund Summary (กองทุนสมทบซ่อมบำรุง) */}
              <div className="p-3 bg-amber-50/60 border border-amber-300 rounded-xl space-y-1 print-avoid-break">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-950 text-xs">🔨 กองทุนสมทบซ่อมบำรุงอาคารและระบบสาธารณูปโภค</span>
                  <span className="font-mono font-bold text-amber-950 text-xs">
                    ยอดเครดิตสะสมรวม: {totalFundCredit.toLocaleString()} บาท
                  </span>
                </div>
                <p className="text-[10px] text-amber-900 leading-relaxed">
                  เป็นเงินที่ระดมทุนจากเจ้าของร่วมทุกท่านเพื่อใช้เป็นค่าใช้จ่ายในการปรับปรุง ซ่อมแซมระบบปั๊มน้ำ ลิฟต์ ระบบไฟฟ้า และโครงสร้างอาคารส่วนกลาง โดยจะถูกนำมาหักลดหย่อนค่าส่วนกลางตามสัดส่วนที่ระเบียบกำหนด
                </p>
              </div>

              {/* 3. Monthly Collection Summary Banner (NO individual rooms listed) */}
              <div className="p-3.5 bg-neutral-50 border border-neutral-300 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs print-avoid-break">
                <div>
                  <span className="font-bold text-neutral-800 text-xs block">
                    📊 สรุปสถานะการชำระเงินของอาคาร (รอบบิล {period} • ทั้งหมด {rooms.length} ห้องชุด)
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    * ไม่ระบุเลขห้องหรือข้อมูลส่วนบุคคลตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA)
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs font-bold font-mono">
                  <span className="bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-300">
                    ✅ ชำระแล้ว {paidRooms.length} ห้อง ({collectionPct}%)
                  </span>
                  <span className="bg-amber-100 text-amber-900 px-3 py-1.5 rounded-lg border border-amber-300">
                    ⏳ ยังไม่ชำระ {unpaidRooms.length} ห้อง
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Annual Resident PDPA View */
            <div className="space-y-4">
              {/* Annual Executive Cards */}
              <div className="grid grid-cols-3 gap-3 print-avoid-break">
                <div className="border-2 border-emerald-700 bg-emerald-50 rounded-xl p-3">
                  <span className="text-emerald-900 block text-[10px] font-bold">รายรับรวมทั้งปี ({currentYear})</span>
                  <span className="text-base font-extrabold text-emerald-950 font-mono block mt-1">
                    +{totalYearIncome.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                  </span>
                </div>
                <div className="border-2 border-rose-700 bg-rose-50 rounded-xl p-3">
                  <span className="text-rose-900 block text-[10px] font-bold">รายจ่ายรวมทั้งปี ({currentYear})</span>
                  <span className="text-base font-extrabold text-rose-950 font-mono block mt-1">
                    -{totalYearExpense.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                  </span>
                </div>
                <div className="border-2 border-blue-700 bg-blue-50 rounded-xl p-3">
                  <span className="text-blue-900 block text-[10px] font-bold">เงินคงเหลือสุทธิสะสมทั้งปี</span>
                  <span className="text-base font-extrabold text-blue-950 font-mono block mt-1">
                    {(totalYearIncome - totalYearExpense).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                  </span>
                </div>
              </div>

              {/* Annual Expense Categories */}
              <div className="space-y-1.5 print-avoid-break">
                <h3 className="font-bold text-black text-xs border-b border-black pb-1">
                  สรุปรายจ่ายแยกตามหมวดหมู่ตลอดปี {currentYear}
                </h3>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {Object.entries(yearExpenseByCategory).map(([cat, amt]) => {
                    const pct = totalYearExpense > 0 ? ((amt / totalYearExpense) * 100).toFixed(1) : '0';
                    return (
                      <div key={cat} className="flex items-center justify-between p-2.5 border border-neutral-300 rounded-lg bg-neutral-50">
                        <span className="font-semibold text-slate-800">• {cat}</span>
                        <span className="font-mono font-bold text-black">
                          {amt.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ. <span className="text-[9.5px] text-neutral-500 font-normal">({pct}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Annual Collection Summary Banner (NO floor or room breakdown) */}
              <div className="p-3.5 bg-neutral-50 border border-neutral-300 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs print-avoid-break">
                <div>
                  <span className="font-bold text-neutral-800 text-xs block">
                    📊 สรุปสถานะการชำระเงินของอาคาร ประจำปี {currentYear} (ทั้งหมด {rooms.length} ห้องชุด)
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    * สถิติภาพรวมเพื่อความโปร่งใส ไม่ระบุข้อมูลส่วนบุคคลตามหลักเกณฑ์ PDPA
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-bold font-mono">
                  <span className="bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-300">
                    ✅ ชำระครบถ้วน {paidRooms.length} ห้อง ({collectionPct}%)
                  </span>
                  <span className="bg-amber-100 text-amber-900 px-3 py-1.5 rounded-lg border border-amber-300">
                    ⏳ มียอดค้างชำระ {unpaidRooms.length} ห้อง
                  </span>
                </div>
              </div>
            </div>
          )
        ) : (
          /* ============================================================== */
          /* VIEW 2: JURISTIC FULL DETAIL VERSION (ฉบับนิติบุคคล & กรรมการ) */
          /* ============================================================== */
          reportType === 'monthly' ? (
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
            /* Annual Juristic View */
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
                        <td className="border border-black py-1 px-2 text-center font-mono ${
                          unpaidCount > 0 ? 'font-extrabold underline' : ''
                        }">
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
          )
        )}

        {/* Signature Footer for Noticeboard */}
        <div className="print-avoid-break pt-6 grid grid-cols-2 gap-8 text-center text-xs text-black border-t border-neutral-300 mt-4">
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