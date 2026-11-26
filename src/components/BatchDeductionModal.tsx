'use client';

import React, { useState } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo, calculateBill } from '@/utils/billing';

interface BatchDeductionModalProps {
  selectedRoomNos: string[];
  allRooms: Room[];
  logMap: Record<string, MeterLog>;
  period: string;
  config: Partial<CondoConfig>;
  onClose: () => void;
  onSuccess: () => void;
}

export const BatchDeductionModal: React.FC<BatchDeductionModalProps> = ({
  selectedRoomNos,
  allRooms,
  logMap,
  period,
  config,
  onClose,
  onSuccess,
}) => {
  const supabase = createClient();
  const [deductionMode, setDeductionMode] = useState<'zero' | 'full' | 'custom'>('zero');
  const [customAmountStr, setCustomAmountStr] = useState('100');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedRooms = allRooms.filter((r) => selectedRoomNos.includes(r.room_no));
  const roomsWithFund = selectedRooms.filter((r) => (Number(r.contribution_credit) || 0) > 0);
  const totalFundSelected = selectedRooms.reduce((sum, r) => sum + (Number(r.contribution_credit) || 0), 0);

  const handleApply = async () => {
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const updates: Array<{
        period: string;
        room_no: string;
        prev_meter: number;
        curr_meter: number;
        units_used: number;
        water_amount: number;
        wastewater_amount: number;
        common_fee_amount: number;
        late_fee: number;
        special_items: number;
        special_items_note: string | null;
        contribution_deducted: number;
        prepaid_deducted: number;
        total_amount: number;
        is_paid: boolean;
        paid_type: string | null;
        paid_timestamp: string | null;
        slip_url: string | null;
        meter_photo_url: string | null;
        line_push_status: string | null;
        note: string | null;
        recorded_at: string;
      }> = [];

      for (const room of selectedRooms) {
        const log = logMap[room.room_no];
        const prev = log ? Number(log.prev_meter) : Number(room.latest_meter) || 0;
        const curr = log ? Number(log.curr_meter) : prev;
        const fundBefore = Number(room.contribution_credit) || 0;

        let targetDeduction = 0;
        if (deductionMode === 'zero') {
          targetDeduction = 0;
        } else if (deductionMode === 'full') {
          // Full common fee, capped by available fund
          const commonFee = room.room_type === 'ห้องใหญ่' ? 500 : (room.room_type?.includes('ห้องคู่') ? 600 : 300);
          targetDeduction = Math.min(commonFee, fundBefore);
        } else if (deductionMode === 'custom') {
          const customAmt = Math.max(0, parseFloat(customAmountStr) || 0);
          const commonFee = room.room_type === 'ห้องใหญ่' ? 500 : (room.room_type?.includes('ห้องคู่') ? 600 : 300);
          targetDeduction = Math.min(commonFee, Math.min(fundBefore, customAmt));
        }

        const bill = calculateBill(
          room,
          curr,
          period,
          config,
          log ? Number(log.special_items) || 0 : 0,
          log?.special_items_note || log?.note || '',
          Number(room.outstanding_balance) || 0,
          prev,
          log ? Number(log.late_fee) || 0 : 0,
          targetDeduction
        );

        updates.push({
          period,
          room_no: room.room_no,
          prev_meter: prev,
          curr_meter: curr,
          units_used: bill.units_used,
          water_amount: bill.water_amount,
          wastewater_amount: bill.wastewater_amount,
          common_fee_amount: bill.common_fee,
          late_fee: bill.late_fee,
          special_items: bill.special_items,
          special_items_note: bill.special_items_note || null,
          contribution_deducted: targetDeduction,
          prepaid_deducted: bill.prepaid_deducted,
          total_amount: bill.total_amount,
          is_paid: log?.is_paid || false,
          paid_type: log?.paid_type || null,
          paid_timestamp: log?.paid_timestamp || null,
          slip_url: log?.slip_url || null,
          meter_photo_url: log?.meter_photo_url || null,
          line_push_status: log?.line_push_status || 'ยังไม่ส่ง',
          note: log?.note || null,
          recorded_at: log?.recorded_at || new Date().toISOString(),
        });
      }

      // Upsert to Supabase in batches
      for (let i = 0; i < updates.length; i += 50) {
        const chunk = updates.slice(i, i + 50);
        const { error: upsertErr } = await supabase.from('meter_logs').upsert(chunk, { onConflict: 'period,room_no' });
        if (upsertErr) throw upsertErr;
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Batch deduction error:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการบันทึกยอดลดหย่อน');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col text-xs">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm flex items-center gap-2">
              <span>💰 กำหนดยอดลดหย่อนเงินสมทบระดมทุน (กลุ่มห้องที่เลือก)</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              รอบบิล: <b className="text-sky-300 font-mono">{period}</b> • เลือกไว้ทั้งหมด{' '}
              <b className="text-white">{selectedRooms.length}</b> ห้อง
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl font-medium">
              {errorMsg}
            </div>
          )}

          {/* Status Banner */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 space-y-1">
            <div className="font-bold text-emerald-950 flex items-center justify-between">
              <span>📊 สรุปยอดเงินสมทบของห้องที่เลือก:</span>
              <span className="font-mono text-emerald-800 text-sm">
                {totalFundSelected.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
              </span>
            </div>
            <div className="text-[11px] text-emerald-800">
              มีห้องที่มีเงินสมทบสะสม <b>{roomsWithFund.length}</b> ห้อง (จากที่เลือกทั้งหมด {selectedRooms.length} ห้อง)
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2.5">
            <label className="font-bold text-slate-800 block text-xs">
              เลือกรูปแบบการกำหนดยอดลดหย่อนสำหรับรอบบิล {period}:
            </label>

            {/* Option 1: 0 THB */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                deductionMode === 'zero'
                  ? 'bg-slate-100 border-slate-900 shadow-xs'
                  : 'bg-white hover:bg-slate-50 border-slate-200'
              }`}
            >
              <input
                type="radio"
                name="deductionMode"
                checked={deductionMode === 'zero'}
                onChange={() => setDeductionMode('zero')}
                className="mt-0.5 text-slate-900"
              />
              <div>
                <div className="font-bold text-slate-900">
                  ❌ ไม่ลดหย่อน (0 บาท สำหรับทุกห้องที่เลือก)
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  ตั้งค่ายอดลดหย่อนในบิลเป็น 0 บาท เงินสมทบสะสมของลูกบ้านจะยังคงอยู่ครบ ไม่ถูกหักในรอบบิลนี้
                </div>
              </div>
            </label>

            {/* Option 2: Full Common Fee */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                deductionMode === 'full'
                  ? 'bg-emerald-50 border-emerald-600 shadow-xs'
                  : 'bg-white hover:bg-slate-50 border-slate-200'
              }`}
            >
              <input
                type="radio"
                name="deductionMode"
                checked={deductionMode === 'full'}
                onChange={() => setDeductionMode('full')}
                className="mt-0.5 text-emerald-600"
              />
              <div>
                <div className="font-bold text-emerald-950">
                  ✨ ลดหย่อนเต็มจำนวนค่าส่วนกลาง (300 / 500 / 600 บ.)
                </div>
                <div className="text-[11px] text-emerald-700 mt-0.5">
                  หักค่าส่วนกลางเต็มจำนวนให้ทันทีเฉพาะห้องที่มีเงินสมทบสะสม (หากเงินสะสมน้อยกว่าค่าส่วนกลาง จะหักเท่าที่เงินมี)
                </div>
              </div>
            </label>

            {/* Option 3: Custom Amount */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                deductionMode === 'custom'
                  ? 'bg-blue-50 border-blue-600 shadow-xs'
                  : 'bg-white hover:bg-slate-50 border-slate-200'
              }`}
            >
              <input
                type="radio"
                name="deductionMode"
                checked={deductionMode === 'custom'}
                onChange={() => setDeductionMode('custom')}
                className="mt-0.5 text-blue-600"
              />
              <div className="flex-1">
                <div className="font-bold text-blue-950">
                  🔢 กำหนดจำนวนเงินลดหย่อนเอง (บาท)
                </div>
                <div className="text-[11px] text-blue-700 mt-0.5 mb-2">
                  ระบุจำนวนเงินที่ต้องการลดหย่อนให้เท่ากันทุกห้อง (สูงสุดไม่เกินค่าส่วนกลางและยอดเงินสมทบของห้องนั้น)
                </div>
                {deductionMode === 'custom' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={customAmountStr}
                      onChange={(e) => setCustomAmountStr(e.target.value)}
                      className="border-2 border-blue-400 rounded-lg p-2 font-mono font-bold text-blue-900 bg-white w-32"
                      placeholder="100"
                    />
                    <span className="font-bold text-slate-700">บาท / ห้อง</span>
                  </div>
                )}
              </div>
            </label>
          </div>

          <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
            ℹ️ <b>หมายเหตุ:</b> การแก้ไขนี้จะมีผลต่อใบแจ้งหนี้รอบบิล <b>{period}</b> ทันที และแอดมินยังสามารถกดปุ่ม "✏️ แก้บิล" เพื่อปรับยอดรายห้องได้ตลอดเวลาครับ
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-5 py-3 border-t flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 border rounded-xl font-bold text-slate-600 hover:bg-slate-100"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isProcessing}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs disabled:opacity-50 flex items-center gap-2"
          >
            {isProcessing ? 'กำลังบันทึก...' : `💾 ยืนยันกำหนดยอดลดหย่อน (${selectedRooms.length} ห้อง)`}
          </button>
        </div>
      </div>
    </div>
  );
};
