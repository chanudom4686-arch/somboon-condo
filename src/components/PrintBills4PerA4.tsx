'use client';

// Printable 4-Bills-Per-A4 Component
// Version 1.3 - Bilingual (TH/EN) with Dynamic PromptPay QR, Room Status Filter & Floor Filter

import React, { useState, useMemo } from 'react';
import { BillCalculationResult, CondoConfig, Room } from '@/types/condo';

interface PrintBillsProps {
  bills: BillCalculationResult[];
  rooms?: Room[];
  config: Partial<CondoConfig>;
  qrMap: Record<string, string>; // room_no -> qrDataUrl
  onClose?: () => void;
}

export const PrintBills4PerA4: React.FC<PrintBillsProps> = ({
  bills,
  rooms = [],
  config,
  qrMap,
  onClose,
}) => {
  const [excludeProblemRooms, setExcludeProblemRooms] = useState<boolean>(true);
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [roomSearch, setRoomSearch] = useState<string>('');

  const roomMap = useMemo(() => {
    const map: Record<string, Room> = {};
    rooms.forEach((r) => {
      map[r.room_no] = r;
    });
    return map;
  }, [rooms]);

  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      const r = roomMap[b.room_no];
      if (excludeProblemRooms && r && r.status && r.status !== 'ปกติ') {
        return false;
      }
      if (selectedFloor !== 'all' && r && r.floor !== selectedFloor) {
        return false;
      }
      if (roomSearch.trim() !== '') {
        const q = roomSearch.trim();
        if (!b.room_no.includes(q) && !b.formatted_room.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [bills, roomMap, excludeProblemRooms, selectedFloor, roomSearch]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm overflow-y-auto">
      {/* Top Bar for Screen Preview */}
      <div className="sticky top-0 z-50 bg-white border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm print:hidden">
        <div>
          <h2 className="font-bold text-slate-800 text-base sm:text-lg">
            ตัวอย่างพิมพ์บิล 4 บิลต่อ 1 A4 (แสดง {filteredBills.length} ห้อง / {Math.ceil(filteredBills.length / 4)} แผ่น A4)
          </h2>
          <p className="text-xs text-slate-500">
            ระบบจัดหน้า 4 บิลต่อหน้า A4 อัตโนมัติ พร้อมเส้นประสำหรับตัดแจก และ QR PromptPay
          </p>
        </div>

        {/* Print Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer font-medium text-slate-700">
            <input
              type="checkbox"
              checked={excludeProblemRooms}
              onChange={(e) => setExcludeProblemRooms(e.target.checked)}
              className="rounded text-blue-600"
            />
            <span>ข้ามห้องมีปัญหา (ประหยัดกระดาษ)</span>
          </label>

          <select
            value={selectedFloor}
            onChange={(e) => setSelectedFloor(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="border rounded-lg px-2.5 py-1.5 bg-white font-medium text-slate-700"
          >
            <option value="all">ทุกชั้น (1-8)</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((fl) => (
              <option key={fl} value={fl}>
                เฉพาะชั้น {fl}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={roomSearch}
            onChange={(e) => setRoomSearch(e.target.value)}
            placeholder="ค้นหาเลขห้อง..."
            className="border rounded-lg px-2.5 py-1.5 w-28 bg-white"
          />

          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow flex items-center gap-1.5 text-xs sm:text-sm"
          >
            <span>🖨️ สั่งพิมพ์ / บันทึก PDF</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs sm:text-sm font-medium"
            >
              ปิดหน้าต่าง
            </button>
          )}
        </div>
      </div>

      {/* Printable Sheet Container */}
      <div className="p-4 flex flex-col items-center print:p-0">
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            body {
              background: white !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            .print\\:hidden {
              display: none !important;
            }
            @page {
              size: A4 portrait;
              margin: 5mm;
            }
            .a4-page {
              width: 200mm;
              height: 287mm;
              page-break-after: always;
              display: grid;
              grid-template-columns: 1fr 1fr;
              grid-template-rows: 1fr 1fr;
              box-sizing: border-box;
            }
          }
          @media screen {
            .a4-page {
              width: 210mm;
              min-height: 297mm;
              background: white;
              margin-bottom: 20px;
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
              display: grid;
              grid-template-columns: 1fr 1fr;
              grid-template-rows: 1fr 1fr;
              padding: 5mm;
              box-sizing: border-box;
            }
          }
        `}} />

        {/* Chunk bills into groups of 4 for each A4 sheet */}
        {Array.from({ length: Math.ceil(filteredBills.length / 4) }).map((_, pageIdx) => {
          const pageBills = filteredBills.slice(pageIdx * 4, pageIdx * 4 + 4);

          return (
            <div key={pageIdx} className="a4-page">
              {pageBills.map((bill) => {
                const qrUrl = qrMap[bill.room_no] || '';
                const condoName = config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (645)';
                const bankName = config.BANK_NAME || 'กสิกรไทย';
                const bankAccNo = config.BANK_ACCOUNT_NO || 'xxx-x-xxxxx-x';
                const bankAccName = config.BANK_ACCOUNT_NAME || 'นิติบุคคลอาคารชุด สมบูรณ์คอนโดทาวน์';

                return (
                  <div
                    key={bill.room_no}
                    className="p-3 border border-dashed border-slate-300 flex flex-col justify-between text-slate-800 text-xs box-sizing:border-box"
                    style={{ minHeight: '140mm' }}
                  >
                    {/* Header */}
                    <div>
                      <div className="flex justify-between items-start border-b pb-1.5 mb-1.5">
                        <div>
                          <div className="font-bold text-sm text-slate-900">{condoName}</div>
                          <div className="text-[10px] text-slate-500">ใบแจ้งหนี้ประจำเดือน / INVOICE</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-blue-700 text-sm">ห้อง {bill.formatted_room}</div>
                          <div className="text-[10px] text-slate-500">เลขที่: {bill.invoice_no}</div>
                        </div>
                      </div>

                      {/* Period & Due Date */}
                      <div className="flex justify-between bg-slate-50 px-2 py-1 rounded mb-2 text-[11px]">
                        <div>
                          <span className="text-slate-500">รอบบิล/Period: </span>
                          <span className="font-semibold">{bill.period}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">ครบกำหนด/Due: </span>
                          <span className="font-semibold text-red-600">{bill.due_date}</span>
                        </div>
                      </div>

                      {/* Meter Info Box */}
                      <div className="border border-slate-200 rounded p-1.5 mb-2 bg-blue-50/40 text-[11px]">
                        <div className="flex justify-between">
                          <span>เลขมิเตอร์น้ำ/Meter: <b>{bill.curr_meter}</b></span>
                          <span className="text-slate-500">(ครั้งก่อน: {bill.prev_meter})</span>
                          <span className="font-bold text-blue-800">ใช้น้ำ: {bill.units_used} หน่วย/units</span>
                        </div>
                      </div>

                      {/* Calculation Breakdown Table */}
                      <table className="w-full text-[11px] mb-2">
                        <tbody>
                          <tr className="border-b border-slate-100">
                            <td className="py-0.5">1. ค่าน้ำประปา / Water ({bill.units_used} × {bill.water_rate})</td>
                            <td className="text-right font-medium">{bill.water_amount.toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-slate-100">
                            <td className="py-0.5">2. ค่าบำบัดน้ำเสีย / Wastewater ({bill.units_used} × {bill.wastewater_rate})</td>
                            <td className="text-right font-medium">{bill.wastewater_amount.toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-slate-100">
                            <td className="py-0.5">3. ค่าส่วนกลาง / Common Fee</td>
                            <td className="text-right font-medium">{bill.common_fee.toFixed(2)}</td>
                          </tr>
                          {bill.special_items !== 0 && (
                            <tr className="border-b border-slate-100 text-amber-700">
                              <td className="py-0.5">4. รายการพิเศษ: {bill.special_items_note || 'ซ่อมบำรุง/ปรับปรุง'}</td>
                              <td className="text-right font-medium">{bill.special_items.toFixed(2)}</td>
                            </tr>
                          )}
                          {bill.contribution_deducted > 0 && (
                            <tr className="border-b border-slate-100 text-emerald-700">
                              <td className="py-0.5">★ หักเครดิตสมทบทุนซ่อมตึก / Fund Credit</td>
                              <td className="text-right font-semibold">-{bill.contribution_deducted.toFixed(2)}</td>
                            </tr>
                          )}
                          {bill.prepaid_deducted > 0 && (
                            <tr className="border-b border-slate-100 text-emerald-700">
                              <td className="py-0.5">★ หักเงินฝากล่วงหน้า / Prepaid Deposit</td>
                              <td className="text-right font-semibold">-{bill.prepaid_deducted.toFixed(2)}</td>
                            </tr>
                          )}
                          {bill.outstanding_balance > 0 && (
                            <tr className="border-b border-slate-100 text-red-600">
                              <td className="py-0.5">ค้างชำระยกมา / Outstanding Balance</td>
                              <td className="text-right font-semibold">+{bill.outstanding_balance.toFixed(2)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Total & Payment Section */}
                    <div>
                      {/* Total Box */}
                      <div className="bg-slate-900 text-white p-2 rounded flex justify-between items-center mb-2">
                        <div>
                          <div className="text-[10px] text-slate-300">ยอดรวมที่ต้องชำระ</div>
                          <div className="text-[9px] text-slate-400">TOTAL AMOUNT DUE</div>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-bold text-sky-400">{bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                          <span className="text-[10px] text-slate-300 ml-1">บาท/THB</span>
                        </div>
                      </div>

                      {/* Payment QR & Details */}
                      <div className="flex gap-2 items-center bg-slate-50 p-1.5 rounded border border-slate-200">
                        {qrUrl ? (
                          <img
                            src={qrUrl}
                            alt="PromptPay QR"
                            className="w-16 h-16 border rounded bg-white p-0.5"
                          />
                        ) : (
                          <div className="w-16 h-16 border rounded bg-slate-200 flex items-center justify-center text-[9px] text-slate-500 text-center">
                            QR พร้อมเพย์
                          </div>
                        )}
                        <div className="text-[10px] leading-tight flex-1">
                          <div className="font-bold text-slate-800">สแกนจ่ายผ่านพร้อมเพย์</div>
                          <div className="text-slate-600">หรือโอน: {bankName}</div>
                          <div className="font-mono text-slate-900 font-semibold">{bankAccNo}</div>
                          <div className="text-slate-500 truncate">{bankAccName}</div>
                          {bill.contribution_after > 0 && (
                            <div className="text-emerald-700 font-medium mt-0.5">
                              เครดิตสมทบคงเหลือ: {bill.contribution_after.toLocaleString()} บ.
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Notes / Footer */}
                      <div className="mt-1 text-[9px] text-slate-500 text-center border-t border-slate-100 pt-0.5">
                        <div>โปรดชำระเงินภายในวันที่ {bill.due_date} หากชำระแล้วแจ้งสลิปทาง LINE OA</div>
                        <div className="text-emerald-800 font-medium mt-0.5">
                          📱 รับบิลทาง LINE OA พิมพ์รหัส: <b className="font-mono bg-emerald-100 text-slate-900 px-1 py-0.2 rounded border border-emerald-300">{bill.line_reg_code}</b>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
