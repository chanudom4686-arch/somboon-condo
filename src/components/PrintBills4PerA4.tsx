'use client';

// Printable 4-Bills-Per-A4 Component
// Version 1.5 - Renders Multiple Custom Line Items Separately & Explicit Water (35 THB) / Wastewater (5 THB)

import React, { useState, useMemo } from 'react';
import { BillCalculationResult, CondoConfig, Room, MeterLog } from '@/types/condo';
import { generateReceiptNo } from '@/utils/billing';

interface PrintBillsProps {
  bills: BillCalculationResult[];
  rooms?: Room[];
  logMap?: Record<string, MeterLog>;
  config: Partial<CondoConfig>;
  qrMap: Record<string, string>;
  docType?: 'invoice' | 'receipt';
  preselectedRoomNos?: string[];
  onClose?: () => void;
}

// Helper to parse serialized custom line items for clean row-by-row printing on the bill
function getPrintableCustomItems(noteStr?: string, totalSpecial = 0): { label: string; amount: number }[] {
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

export const PrintBills4PerA4: React.FC<PrintBillsProps> = ({
  bills,
  rooms = [],
  logMap = {},
  config,
  qrMap,
  docType: initialDocType = 'invoice',
  preselectedRoomNos = [],
  onClose,
}) => {
  const [docType, setDocType] = useState<'invoice' | 'receipt'>(initialDocType);
  const [excludeProblemRooms, setExcludeProblemRooms] = useState<boolean>(
    preselectedRoomNos.length === 0
  );
  const [onlySelected, setOnlySelected] = useState<boolean>(preselectedRoomNos.length > 0);
  const [roomRange, setRoomRange] = useState<'all' | '1-50' | '51-100' | '101-150' | '151-195'>('all');
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
      if (onlySelected && preselectedRoomNos.length > 0) {
        return preselectedRoomNos.includes(b.room_no);
      }

      const r = roomMap[b.room_no];
      if (excludeProblemRooms && r && r.status && r.status !== 'ปกติ') {
        return false;
      }

      const num = parseInt(b.room_no.replace(/[^0-9]/g, ''), 10) || 0;
      if (roomRange === '1-50' && !(num >= 1 && num <= 50)) return false;
      if (roomRange === '51-100' && !(num >= 51 && num <= 100)) return false;
      if (roomRange === '101-150' && !(num >= 101 && num <= 150)) return false;
      if (roomRange === '151-195' && !(num >= 151 && num <= 195)) return false;

      if (roomSearch.trim() !== '') {
        const q = roomSearch.trim();
        if (!b.room_no.includes(q) && !b.formatted_room.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [bills, roomMap, excludeProblemRooms, onlySelected, preselectedRoomNos, roomRange, roomSearch]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm overflow-y-auto">
      {/* Top Bar for Screen Preview */}
      <div className="sticky top-0 z-50 bg-white border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm print:hidden">
        <div>
          <h2 className="font-bold text-slate-800 text-base sm:text-lg">
            {docType === 'receipt' ? '🧾 ตัวอย่างพิมพ์ใบเสร็จรับเงิน' : '🖨️ ตัวอย่างพิมพ์ใบแจ้งหนี้'}{' '}
            (แสดง {filteredBills.length} ห้อง / {Math.max(1, Math.ceil(filteredBills.length / 4))} แผ่น A4)
          </h2>
          <p className="text-xs text-slate-500">
            ระบบจัดหน้า 4 ใบต่อ 1 แผ่น A4 อัตโนมัติ พร้อมเส้นประสำหรับตัดแจก
          </p>
        </div>

        {/* Print Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as 'invoice' | 'receipt')}
            className="border-2 border-blue-500 rounded-lg px-2.5 py-1.5 bg-blue-50 font-bold text-blue-800"
          >
            <option value="invoice">📄 ใบแจ้งหนี้ (INVOICE)</option>
            <option value="receipt">🧾 ใบเสร็จรับเงิน (RECEIPT)</option>
          </select>

          {preselectedRoomNos.length > 0 && (
            <label className="flex items-center gap-1.5 bg-blue-100 text-blue-900 px-3 py-1.5 rounded-lg cursor-pointer font-bold">
              <input
                type="checkbox"
                checked={onlySelected}
                onChange={(e) => setOnlySelected(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span>เฉพาะห้องที่เลือก ({preselectedRoomNos.length} ห้อง)</span>
            </label>
          )}

          {!onlySelected && (
            <>
              <label className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={excludeProblemRooms}
                  onChange={(e) => setExcludeProblemRooms(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <span>ข้ามห้องมีปัญหา</span>
              </label>

              <select
                value={roomRange}
                onChange={(e) => setRoomRange(e.target.value as any)}
                className="border rounded-lg px-2.5 py-1.5 bg-white font-medium text-slate-700"
              >
                <option value="all">ทุกห้อง (001-195)</option>
                <option value="1-50">ห้อง 001-050</option>
                <option value="51-100">ห้อง 051-100</option>
                <option value="101-150">ห้อง 101-150</option>
                <option value="151-195">ห้อง 151-195</option>
              </select>

              <input
                type="text"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                placeholder="ค้นหาเลขห้อง..."
                className="border rounded-lg px-2.5 py-1.5 w-28 bg-white"
              />
            </>
          )}

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

        {Array.from({ length: Math.max(1, Math.ceil(filteredBills.length / 4)) }).map((_, pageIdx) => {
          const pageBills = filteredBills.slice(pageIdx * 4, pageIdx * 4 + 4);

          return (
            <div key={pageIdx} className="a4-page">
              {pageBills.map((bill) => {
                const qrUrl = qrMap[bill.room_no] || '';
                const log = logMap[bill.room_no];
                const condoName = config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (645)';
                const bankName = config.BANK_NAME || 'กสิกรไทย';
                const bankAccNo = config.BANK_ACCOUNT_NO || 'xxx-x-xxxxx-x';
                const bankAccName = config.BANK_ACCOUNT_NAME || 'นิติบุคคลอาคารชุด สมบูรณ์คอนโดทาวน์';
                const isReceipt = docType === 'receipt';
                const docNo = isReceipt ? generateReceiptNo(bill.invoice_no, 1) : bill.invoice_no;
                const customLineItems = getPrintableCustomItems(bill.special_items_note, bill.special_items);

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
                          <div className="text-[10px] font-bold text-slate-600">
                            {isReceipt ? 'ใบเสร็จรับเงิน / RECEIPT' : 'ใบแจ้งหนี้ประจำเดือน / INVOICE'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-blue-700 text-sm">ห้อง {bill.formatted_room}</div>
                          <div className="text-[10px] text-slate-500">เลขที่: {docNo}</div>
                        </div>
                      </div>

                      {/* Period & Due Date */}
                      <div className="flex justify-between bg-slate-50 px-2 py-1 rounded mb-1.5 text-[11px]">
                        <div>
                          <span className="text-slate-500">รอบบิล/Period: </span>
                          <span className="font-semibold">{bill.period}</span>
                        </div>
                        <div>
                          {isReceipt ? (
                            <>
                              <span className="text-slate-500">วันที่รับชำระ: </span>
                              <span className="font-semibold text-emerald-700">
                                {log?.paid_timestamp
                                  ? new Date(log.paid_timestamp).toLocaleDateString('th-TH')
                                  : new Date().toLocaleDateString('th-TH')}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-slate-500">ครบกำหนด/Due: </span>
                              <span className="font-semibold text-red-600">{bill.due_date}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Meter Info Box */}
                      <div className="border border-slate-200 rounded p-1.5 mb-1.5 bg-blue-50/40 text-[11px]">
                        <div className="flex justify-between">
                          <span>เลขมิเตอร์น้ำ/Meter: <b>{bill.curr_meter}</b></span>
                          <span className="text-slate-500">(ครั้งก่อน: {bill.prev_meter})</span>
                          <span className="font-bold text-blue-800">ใช้น้ำ: {bill.units_used} หน่วย</span>
                        </div>
                      </div>

                      {/* Calculation Breakdown Table */}
                      <table className="w-full text-[11px] mb-1.5">
                        <tbody>
                          <tr className="border-b border-slate-100">
                            <td className="py-0.5">1. ค่าน้ำประปา / Water ({bill.units_used} หน่วย × {bill.water_rate} บ.)</td>
                            <td className="text-right font-medium">{bill.water_amount.toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-slate-100">
                            <td className="py-0.5">2. ค่าบำบัดน้ำเสีย / Wastewater ({bill.units_used} หน่วย × {bill.wastewater_rate} บ.)</td>
                            <td className="text-right font-medium">{bill.wastewater_amount.toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-slate-100">
                            <td className="py-0.5">3. ค่าส่วนกลาง / Common Fee</td>
                            <td className="text-right font-medium">{bill.common_fee.toFixed(2)}</td>
                          </tr>
                          {customLineItems.map((cItem, cIdx) => (
                            <tr
                              key={cIdx}
                              className={`border-b border-slate-100 ${
                                cItem.amount < 0 ? 'text-emerald-700' : 'text-amber-700'
                              }`}
                            >
                              <td className="py-0.5">
                                {cIdx + 4}. {cItem.label}
                              </td>
                              <td className="text-right font-semibold">
                                {cItem.amount > 0 ? `+${cItem.amount.toFixed(2)}` : cItem.amount.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                          {(bill.late_fee || 0) > 0 && (
                            <tr className="border-b border-slate-100 text-red-600">
                              <td className="py-0.5">เบี้ยปรับชำระล่าช้า / Late Fee</td>
                              <td className="text-right font-semibold">+{bill.late_fee.toFixed(2)}</td>
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
                      <div className={`${isReceipt ? 'bg-emerald-900' : 'bg-slate-900'} text-white p-2 rounded flex justify-between items-center mb-1.5`}>
                        <div>
                          <div className="text-[10px] text-slate-200">
                            {isReceipt ? 'ยอดรับชำระสุทธิ' : 'ยอดรวมที่ต้องชำระ'}
                          </div>
                          <div className="text-[9px] text-slate-300">
                            {isReceipt ? 'TOTAL RECEIVED' : 'TOTAL AMOUNT DUE'}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-bold text-sky-300">
                            {bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-[10px] text-slate-200 ml-1">บาท/THB</span>
                        </div>
                      </div>

                      {isReceipt ? (
                        <div className="bg-emerald-50 border border-emerald-200 p-2 rounded text-[10px] flex justify-between items-center">
                          <div>
                            <div className="font-bold text-emerald-900">✅ ได้รับชำระเงินเรียบร้อยแล้ว</div>
                            <div className="text-slate-600">ช่องทาง: {log?.paid_type || 'โอนเงิน/พร้อมเพย์'}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-slate-500">ผู้รับเงิน / นิติบุคคล</div>
                            <div className="font-bold text-slate-800 mt-1">________________</div>
                          </div>
                        </div>
                      ) : (
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
                      )}

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
