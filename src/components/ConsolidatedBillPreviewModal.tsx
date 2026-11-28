'use client';

// Modal component for Previewing, Copying, and Sending Consolidated Multi-Room Bills
// Version 2.20 - Full Bilingual Preview, Copy-to-Clipboard, One-Click LINE Push & 4-per-A4 Print

import React, { useState } from 'react';
import { Room, MeterLog, CondoConfig, BillCalculationResult } from '@/types/condo';
import { formatRoomNo, formatConsolidatedBillText } from '@/utils/billing';

interface ConsolidatedBillPreviewModalProps {
  ownerName: string;
  rooms: Room[];
  billMap: Record<string, BillCalculationResult>;
  logMap: Record<string, MeterLog>;
  period: string;
  config: Partial<CondoConfig>;
  onClose: () => void;
  onSendLine: (roomNos: string[]) => Promise<void>;
  onPrint: (roomNos: string[]) => void;
  isSendingLine?: boolean;
}

export function ConsolidatedBillPreviewModal({
  ownerName,
  rooms,
  billMap,
  logMap,
  period,
  config,
  onClose,
  onSendLine,
  onPrint,
  isSendingLine = false,
}: ConsolidatedBillPreviewModalProps) {
  const [copied, setCopied] = useState(false);

  // Compile bill items
  const items = rooms
    .map((room) => ({ room, bill: billMap[room.room_no] }))
    .filter((item): item is { room: Room; bill: BillCalculationResult } => !!item.bill);

  const formatted = formatConsolidatedBillText(ownerName, items, period, config);

  const linkedCount = rooms.filter((r) => !!r.line_user_id).length;
  const pushedCount = rooms.filter((r) => !!logMap[r.room_no]?.line_push_status).length;
  const ownerPhone = rooms.find((r) => r.owner_phone)?.owner_phone || '-';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatted.messageText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = formatted.messageText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleConfirmSendLine = async () => {
    if (linkedCount === 0) {
      alert(`⚠️ เจ้าของท่านนี้ยังไม่ได้ผูก LINE OA กับห้องชุดใดเลย (${ownerName})`);
      return;
    }
    const confirmMsg =
      `ยืนยันส่งบิลรวม ${rooms.length} ห้องชุด ให้ "${ownerName}" ผ่าน LINE OA?\n` +
      `• ยอดรวมสุทธิ: ${formatted.consolidatedTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท\n` +
      `• ห้องที่ผูก LINE: ${linkedCount} ห้อง\n` +
      `• กำหนดชำระ: ${formatted.dueDate}`;
    if (!window.confirm(confirmMsg)) return;

    await onSendLine(rooms.map((r) => r.room_no));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-purple-800 via-indigo-800 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-xl shadow-inner border border-white/10">
              👑
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base sm:text-lg">
                  ตัวอย่างบิลรวม: คุณ{ownerName}
                </h3>
                <span className="text-[11px] bg-purple-400/20 text-purple-200 border border-purple-300/30 px-2.5 py-0.5 rounded-full font-bold">
                  {rooms.length} ห้องชุด
                </span>
                {linkedCount === rooms.length ? (
                  <span className="text-[11px] bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 px-2 py-0.5 rounded-full font-bold">
                    ✅ ผูก LINE ครบ ({linkedCount}/{rooms.length})
                  </span>
                ) : linkedCount > 0 ? (
                  <span className="text-[11px] bg-amber-500/20 text-amber-200 border border-amber-400/30 px-2 py-0.5 rounded-full font-bold">
                    ⚠️ ผูก LINE บางห้อง ({linkedCount}/{rooms.length})
                  </span>
                ) : (
                  <span className="text-[11px] bg-red-500/20 text-red-200 border border-red-400/30 px-2 py-0.5 rounded-full font-bold">
                    ❌ ยังไม่ผูก LINE
                  </span>
                )}
              </div>
              <p className="text-xs text-purple-200/80 mt-0.5">
                รอบบิล {period} • เบอร์โทร: {ownerPhone} • ตรวจสอบความถูกต้องก่อนส่ง LINE OA หรือคัดลอกส่งต่อ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Column: Financial & Room Breakdown */}
            <div className="lg:col-span-5 space-y-4">
              {/* Grand Total Highlight Box */}
              <div className="bg-gradient-to-br from-purple-50 via-indigo-50 to-blue-50 border border-purple-200 rounded-2xl p-4 shadow-xs">
                <span className="text-xs text-purple-900 font-bold block uppercase tracking-wider">
                  💰 ยอดรวมทุกห้องที่ต้องชำระ (Total Due)
                </span>
                <div className="text-3xl font-black text-purple-950 font-mono mt-1">
                  {formatted.consolidatedTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}{' '}
                  <span className="text-sm font-bold text-purple-800">บาท / THB</span>
                </div>
                <div className="text-xs text-slate-600 mt-2 flex items-center justify-between border-t border-purple-200/60 pt-2">
                  <span>📅 กำหนดชำระภายใน:</span>
                  <span className="font-bold text-slate-900 font-mono">{formatted.dueDate || '-'}</span>
                </div>
              </div>

              {/* Aggregated Cost Breakdown */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 pb-1 border-b border-slate-100 flex items-center justify-between">
                  <span>📊 รายละเอียดสรุปยอดรวมทั้งกลุ่ม</span>
                  <span className="text-slate-500 font-normal">{items.length} ห้อง</span>
                </h4>
                <div className="flex justify-between items-center text-slate-700">
                  <span>• ค่าน้ำประปา ({formatted.totalUnitsUsed} หน่วย):</span>
                  <span className="font-mono font-bold text-slate-900">
                    {formatted.totalWaterAmount.toLocaleString()} บ.
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-700">
                  <span>• ค่าบำบัดน้ำเสีย:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {formatted.totalWastewaterAmount.toLocaleString()} บ.
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-700">
                  <span>• ค่าส่วนกลางรวม:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {formatted.totalCommonFee.toLocaleString()} บ.
                  </span>
                </div>
                {formatted.totalOutstanding > 0 && (
                  <div className="flex justify-between items-center text-amber-700">
                    <span>• ยอดค้างชำระยกมารวม:</span>
                    <span className="font-mono font-bold">
                      +{formatted.totalOutstanding.toLocaleString()} บ.
                    </span>
                  </div>
                )}
                {formatted.totalLateFee > 0 && (
                  <div className="flex justify-between items-center text-red-600">
                    <span>• เบี้ยปรับชำระล่าช้ารวม:</span>
                    <span className="font-mono font-bold">
                      +{formatted.totalLateFee.toLocaleString()} บ.
                    </span>
                  </div>
                )}
                {formatted.totalDeductions > 0 && (
                  <div className="flex justify-between items-center text-emerald-700 font-medium">
                    <span>• หักลดหย่อน (เงินสมทบ/ฝากล่วงหน้า):</span>
                    <span className="font-mono font-bold">
                      -{formatted.totalDeductions.toLocaleString()} บ.
                    </span>
                  </div>
                )}
              </div>

              {/* Per-Room Mini Table */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                <div className="bg-slate-50 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs">🏠 รายชื่อห้องในกลุ่มนี้</span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    ส่ง LINE แล้ว: {pushedCount}/{rooms.length}
                  </span>
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 text-xs">
                  {items.map(({ room, bill }) => {
                    const isPushed = !!logMap[room.room_no]?.line_push_status;
                    const hasLine = !!room.line_user_id;

                    return (
                      <div key={room.room_no} className="p-2.5 hover:bg-slate-50 flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900 font-mono">
                            {formatRoomNo(room.room_no)}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            มิเตอร์: {bill.prev_meter}➔{bill.curr_meter} ({bill.units_used} น.)
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-blue-700 font-mono">
                            {bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                          </div>
                          <div className="text-[10px]">
                            {isPushed ? (
                              <span className="text-emerald-600 font-bold">✅ ส่งบิลแล้ว</span>
                            ) : hasLine ? (
                              <span className="text-sky-600 font-medium">📲 พร้อมส่ง LINE</span>
                            ) : (
                              <span className="text-slate-400">⚠️ ไม่มี LINE</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: Live LINE Chat Message Preview */}
            <div className="lg:col-span-7 flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <span className="text-emerald-600 text-base">💬</span>
                  <span>ตัวอย่างข้อความที่ส่งใน LINE OA (2 ภาษา TH/EN)</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                    copied
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                  }`}
                >
                  <span>{copied ? '✅' : '📋'}</span>
                  <span>{copied ? 'คัดลอกข้อความแล้ว!' : 'คัดลอกข้อความบิลรวม'}</span>
                </button>
              </div>

              {/* Chat Bubble Container */}
              <div className="bg-[#7895b2]/15 border border-slate-200 rounded-2xl p-4 flex-1 flex flex-col justify-start overflow-hidden">
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 font-sans text-xs text-slate-800 leading-relaxed overflow-y-auto max-h-[460px] whitespace-pre-wrap select-text">
                  {formatted.messageText}
                </div>
                <div className="text-[11px] text-slate-500 mt-2 text-right">
                  💡 ข้อความนี้จัดรูปแบบตรงตามที่ส่งเข้า LINE OA 100% พร้อมบัญชีโอนชำระและรายการแจกแจง
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-600 flex items-center gap-2">
            <span>สถานะ LINE:</span>
            {linkedCount > 0 ? (
              <span className="font-bold text-emerald-700">
                พร้อมส่ง {linkedCount} จากทั้งหมด {rooms.length} ห้อง
              </span>
            ) : (
              <span className="font-bold text-amber-700">
                ยังไม่มีห้องใดผูก LINE (สามารถใช้ปุ่มคัดลอกข้อความได้)
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>{copied ? '✅' : '📋'}</span>
              <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onPrint(rooms.map((r) => r.room_no));
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>🖨️</span>
              <span>พิมพ์บิลกลุ่มนี้ (4 บิล/A4)</span>
            </button>
            <button
              type="button"
              disabled={linkedCount === 0 || isSendingLine}
              onClick={handleConfirmSendLine}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs disabled:opacity-40 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>📲</span>
              <span>{isSendingLine ? 'กำลังส่ง LINE...' : `ส่งบิล LINE รวม (${linkedCount} ห้อง)`}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs rounded-xl transition-colors cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
