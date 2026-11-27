'use client';

// Printable 4-Bills-Per-A4 Component (Invoices & Receipts)
// Version 1.9 - 100% Monochrome Black & White Print Design, Clean A4 Page Isolation & Pagination

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

      if (docType === 'receipt' && preselectedRoomNos.length === 0) {
        if (!logMap[b.room_no]?.is_paid) return false;
      }

      if (roomSearch.trim() !== '') {
        const q = roomSearch.trim();
        if (!b.room_no.includes(q) && !b.formatted_room.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [bills, roomMap, logMap, docType, excludeProblemRooms, onlySelected, preselectedRoomNos, roomSearch]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm overflow-y-auto print:static print:inset-auto print:z-auto print:bg-white print:overflow-visible print:backdrop-blur-none">
      {/* Top Bar for Screen Preview */}
      <div className="sticky top-0 z-50 bg-white border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm print:hidden">
        <div>
          <h2 className="font-bold text-slate-800 text-base sm:text-lg">
            {docType === 'receipt'
              ? '🧾 พิมพ์ใบเสร็จรับเงินขาว-ดำ (RECEIPT)'
              : '🖨️ พิมพ์ใบแจ้งหนี้ขาว-ดำ (INVOICE)'}{' '}
            (แสดง {filteredBills.length} ห้อง / {Math.max(1, Math.ceil(filteredBills.length / 4))} แผ่น A4)
          </h2>
          <p className="text-xs text-slate-500">
            โหมดพิมพ์ขาว-ดำคมชัด (Black & White) จัดหน้า 4 ใบต่อ 1 แผ่น A4 พร้อมเส้นประสำหรับตัดแจก
          </p>
        </div>

        {/* Print Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as 'invoice' | 'receipt')}
            className="border-2 border-slate-800 rounded-lg px-2.5 py-1.5 bg-slate-100 font-bold text-slate-900"
          >
            <option value="invoice">📄 ใบแจ้งหนี้ (INVOICE - ขาวดำ)</option>
            <option value="receipt">🧾 ใบเสร็จรับเงิน (RECEIPT - ขาวดำ)</option>
          </select>

          {preselectedRoomNos.length > 0 && (
            <label className="flex items-center gap-1.5 bg-slate-200 text-slate-900 px-3 py-1.5 rounded-lg cursor-pointer font-bold">
              <input
                type="checkbox"
                checked={onlySelected}
                onChange={(e) => setOnlySelected(e.target.checked)}
                className="rounded text-slate-900"
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
                  className="rounded text-slate-900"
                />
                <span>ข้ามห้องมีปัญหา</span>
              </label>

              <input
                type="text"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                placeholder="🔍 ค้นหาเลขห้อง..."
                className="border rounded-lg px-2.5 py-1.5 w-36 bg-white"
              />
            </>
          )}

          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-lg shadow flex items-center gap-1.5 text-xs sm:text-sm"
          >
            <span>🖨️ สั่งพิมพ์ขาว-ดำ / บันทึก PDF</span>
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
      <div className="p-4 flex flex-col items-center print:p-0 print:block">
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
              margin: 5mm;
            }
            .a4-page {
              width: 200mm;
              height: 286mm;
              page-break-after: always;
              break-after: page;
              page-break-inside: avoid;
              break-inside: avoid;
              display: grid;
              grid-template-columns: 1fr 1fr;
              grid-template-rows: 1fr 1fr;
              box-sizing: border-box;
              background: white !important;
            }
            .a4-page:last-child {
              page-break-after: auto;
              break-after: auto;
            }
          }
          @media screen {
            .a4-page {
              width: 210mm;
              min-height: 297mm;
              background: white;
              margin-bottom: 20px;
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.15);
              display: grid;
              grid-template-columns: 1fr 1fr;
              grid-template-rows: 1fr 1fr;
              padding: 5mm;
              box-sizing: border-box;
            }
          }
        `,
          }}
        />

        {Array.from({ length: Math.max(1, Math.ceil(filteredBills.length / 4)) }).map((_, pageIdx) => {
          const pageBills = filteredBills.slice(pageIdx * 4, pageIdx * 4 + 4);

          return (
            <div key={pageIdx} className="a4-page">
              {pageBills.map((bill) => {
                const qrUrl = qrMap[bill.room_no] || '';
                const log = logMap[bill.room_no];
                const condoName = config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (674)';
                const bankName = config.BANK_NAME || 'กสิกรไทย';
                const bankAccNo = config.BANK_ACCOUNT_NO || 'xxx-x-xxxxx-x';
                const bankAccName = config.BANK_ACCOUNT_NAME || 'นิติบุคคลอาคารชุด สมบูรณ์คอนโดทาวน์';
                const isReceipt = docType === 'receipt';
                const docNo = isReceipt ? generateReceiptNo(bill.invoice_no, 1) : bill.invoice_no;
                const customLineItems = getPrintableCustomItems(bill.special_items_note, bill.special_items);
                const paidMethodLabel =
                  log?.paid_type === 'cash' || log?.paid_type === 'เงินสด'
                    ? 'เงินสด (Cash)'
                    : 'โอนเงินเข้าบัญชีธนาคาร (Bank Transfer)';
                const showLineQr = config.SHOW_PRINT_LINE_QR !== 'false';
                const lineQrUrl = config.LINE_QR_IMAGE_URL || '';
                const receiptFooterText = config.RECEIPT_FOOTER_TEXT || 'ออกแบบใบเสร็จรับเงิน ออกโดย วชิรดา';

                return (
                  <div
                    key={bill.room_no}
                    className="p-3 border border-dashed border-black flex flex-col justify-between text-black text-xs box-border bg-white"
                    style={{ minHeight: '140mm' }}
                  >
                    {/* Header (100% Black & White) */}
                    <div>
                      <div className="flex justify-between items-start border-b-2 border-black pb-1.5 mb-1.5">
                        <div>
                          <div className="font-bold text-sm text-black">{condoName}</div>
                          <div className="text-[10px] font-bold text-black">
                            {isReceipt ? 'ใบเสร็จรับเงิน / RECEIPT' : 'ใบแจ้งหนี้ประจำเดือน / INVOICE'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-extrabold text-black text-sm border border-black px-2 py-0.5 rounded bg-neutral-100 inline-block">
                            ห้อง / Room {bill.formatted_room}
                          </div>
                          <div className="text-[10px] text-neutral-800 mt-0.5 font-mono">เลขที่ / No: {docNo}</div>
                        </div>
                      </div>

                      {/* Period & Due Date */}
                      <div className="flex justify-between border border-black bg-neutral-100 px-2 py-1 rounded mb-1.5 text-[11px] text-black">
                        <div>
                          <span>รอบบิล / Period: </span>
                          <span className="font-bold">{bill.period}</span>
                        </div>
                        <div>
                          {isReceipt ? (
                            <>
                              <span>วันที่ชำระ / Paid Date: </span>
                              <span className="font-bold underline">
                                {log?.paid_timestamp
                                  ? new Date(log.paid_timestamp).toLocaleDateString('th-TH', {
                                      timeZone: 'Asia/Bangkok',
                                    })
                                  : new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}
                              </span>
                            </>
                          ) : (
                            <>
                              <span>ครบกำหนด / Due Date: </span>
                              <span className="font-bold underline">{bill.due_date}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Meter Info Box */}
                      <div className="border border-black rounded p-1.5 mb-1.5 bg-white text-[11px] text-black">
                        <div className="flex justify-between">
                          <span>
                            เลขมิเตอร์ / Meter: <b>{bill.curr_meter}</b>
                          </span>
                          <span>(ก่อนหน้า / Prev: {bill.prev_meter})</span>
                          <span className="font-bold">ใช้น้ำ / Used: {bill.units_used} หน่วย (Units)</span>
                        </div>
                      </div>

                      {/* Calculation Breakdown Table (Pure Black & White) */}
                      <table className="w-full text-[11px] mb-1.5 text-black">
                        <tbody>
                          <tr className="border-b border-neutral-300">
                            <td className="py-0.5">
                              1. ค่าน้ำประปา / Water Supply ({bill.units_used} Units × {bill.water_rate} ฿)
                            </td>
                            <td className="text-right font-mono font-medium">{bill.water_amount.toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-neutral-300">
                            <td className="py-0.5">
                              2. ค่าบำบัดน้ำเสีย / Wastewater ({bill.units_used} Units × {bill.wastewater_rate} ฿)
                            </td>
                            <td className="text-right font-mono font-medium">
                              {bill.wastewater_amount.toFixed(2)}
                            </td>
                          </tr>
                          <tr className="border-b border-neutral-300">
                            <td className="py-0.5">3. ค่าส่วนกลาง / Common Area Fee</td>
                            <td className="text-right font-mono font-medium">{bill.common_fee.toFixed(2)}</td>
                          </tr>
                          {customLineItems.map((cItem, cIdx) => (
                            <tr key={cIdx} className="border-b border-neutral-300 font-semibold">
                              <td className="py-0.5">
                                {cIdx + 4}. {cItem.label}
                              </td>
                              <td className="text-right font-mono">
                                {cItem.amount > 0 ? `+${cItem.amount.toFixed(2)}` : cItem.amount.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                          {(bill.late_fee || 0) > 0 && (
                            <tr className="border-b border-neutral-300 font-semibold">
                              <td className="py-0.5">เบี้ยปรับชำระล่าช้า / Late Payment Fee</td>
                              <td className="text-right font-mono">+{bill.late_fee.toFixed(2)}</td>
                            </tr>
                          )}
                          {bill.contribution_deducted > 0 && (
                            <tr className="border-b border-neutral-300 font-semibold">
                              <td className="py-0.5">★ หักเครดิตสมทบทุน / Fund Credit</td>
                              <td className="text-right font-mono">-{bill.contribution_deducted.toFixed(2)}</td>
                            </tr>
                          )}
                          {bill.prepaid_deducted > 0 && (
                            <tr className="border-b border-neutral-300 font-semibold">
                              <td className="py-0.5">★ หักเงินฝากล่วงหน้า / Prepaid Deposit</td>
                              <td className="text-right font-mono">-{bill.prepaid_deducted.toFixed(2)}</td>
                            </tr>
                          )}
                          {bill.outstanding_balance > 0 && (
                            <tr className="border-b border-neutral-300 font-bold">
                              <td className="py-0.5">ค้างชำระยกมา / Outstanding Balance</td>
                              <td className="text-right font-mono">+{bill.outstanding_balance.toFixed(2)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Total & Payment Section (Black & White High-Contrast) */}
                    <div>
                      <div className="border-2 border-black bg-neutral-100 text-black p-2 rounded flex justify-between items-center mb-1.5">
                        <div>
                          <div className="text-[11px] font-bold text-black">
                            {isReceipt ? 'ยอดรับชำระสุทธิ' : 'ยอดรวมที่ต้องชำระ'}
                          </div>
                          <div className="text-[9px] font-semibold text-neutral-700">
                            {isReceipt ? 'TOTAL RECEIVED' : 'TOTAL AMOUNT DUE'}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-extrabold text-black font-mono">
                            {bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-[10px] font-bold text-black ml-1">บาท/THB</span>
                        </div>
                      </div>

                      {isReceipt ? (
                        <div className="bg-white border border-black p-2 rounded text-[10px] text-black flex justify-between items-center">
                          <div className="space-y-0.5">
                            <div className="font-bold text-black">
                              ✓ ได้รับชำระเงินเรียบร้อยแล้ว / Paid Successfully{' '}
                              {log?.is_late_payment ? '(ชำระล่าช้า / Late)' : '(ตรงตามกำหนด / On Time)'}
                            </div>
                            <div className="text-black">
                              รับชำระโดย / Paid by: <b className="underline">{paidMethodLabel}</b>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-neutral-700">ผู้รับเงิน / Authorized Signature</div>
                            <div className="font-bold text-black mt-1">________________</div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 items-center bg-white p-1 rounded border border-black text-black">
                          {/* PromptPay QR */}
                          <div className="flex flex-col items-center shrink-0">
                            {qrUrl ? (
                              <img
                                src={qrUrl}
                                alt="PromptPay QR"
                                className={`${showLineQr && lineQrUrl ? 'w-14 h-14' : 'w-16 h-16'} border border-black rounded bg-white p-0.5 object-contain`}
                              />
                            ) : (
                              <div
                                className={`${showLineQr && lineQrUrl ? 'w-14 h-14' : 'w-16 h-16'} border border-black rounded bg-neutral-100 flex items-center justify-center text-[8px] text-black text-center`}
                              >
                                QR พร้อมเพย์
                              </div>
                            )}
                            <span className="text-[7.5px] font-bold mt-0.5">PromptPay</span>
                          </div>

                          {/* LINE OA QR Code (If enabled) */}
                          {showLineQr && lineQrUrl && (
                            <div className="flex flex-col items-center shrink-0">
                              <img
                                src={lineQrUrl}
                                alt="LINE OA QR"
                                className="w-14 h-14 border border-black rounded bg-white p-0.5 object-contain"
                              />
                              <span className="text-[7.5px] font-bold mt-0.5">LINE OA</span>
                            </div>
                          )}

                          <div className="text-[9.5px] leading-tight flex-1 text-black min-w-0">
                            <div className="font-bold truncate">สแกนจ่าย / พร้อมเพย์ QR</div>
                            <div className="truncate">โอน: {bankName}</div>
                            <div className="font-mono font-bold truncate">{bankAccNo}</div>
                            <div className="truncate">{bankAccName}</div>
                            {bill.contribution_after > 0 && (
                              <div className="font-semibold text-[8.5px] mt-0.5 truncate">
                                เครดิต / Credit: {bill.contribution_after.toLocaleString()} ฿
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Notes / Footer */}
                      <div className="mt-1 text-[9px] text-black text-center border-t border-neutral-400 pt-0.5">
                        <div>
                          {isReceipt
                            ? receiptFooterText
                            : `โปรดชำระภายในวันที่ ${bill.due_date} หากโอนแล้วแจ้งสลิปทาง LINE OA / Please pay by due date & notify via LINE OA`}
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
