'use client';

// Per-Room Bill Customization Modal (Add Charges, Discounts, Late Fees, Outstanding Balance)
// Version 1.4

import React, { useState } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo, calculateBill } from '@/utils/billing';

interface BillEditModalProps {
  room: Room;
  meterLog?: MeterLog | null;
  period: string;
  config: Partial<CondoConfig>;
  onClose: () => void;
  onSaved: () => void;
}

export const BillEditModal: React.FC<BillEditModalProps> = ({
  room,
  meterLog,
  period,
  config,
  onClose,
  onSaved,
}) => {
  const supabase = createClient();

  const initialPrev = meterLog ? Number(meterLog.prev_meter) : Number(room.latest_meter) || 0;
  const initialCurr = meterLog ? Number(meterLog.curr_meter) : initialPrev;
  const initialSpecial = meterLog ? Number(meterLog.special_items) || 0 : 0;

  const [prevMeterStr, setPrevMeterStr] = useState(String(initialPrev));
  const [currMeterStr, setCurrMeterStr] = useState(String(initialCurr));

  // Separate mode for easy Charge (+) vs Discount (-)
  const [adjustMode, setAdjustMode] = useState<'charge' | 'discount'>(
    initialSpecial < 0 ? 'discount' : 'charge'
  );
  const [specialAmtStr, setSpecialAmtStr] = useState(String(Math.abs(initialSpecial)));
  const [specialNote, setSpecialNote] = useState(
    meterLog?.special_items_note || meterLog?.note || ''
  );
  const [lateFeeStr, setLateFeeStr] = useState(String(meterLog ? Number(meterLog.late_fee) || 0 : 0));
  const [outstandingStr, setOutstandingStr] = useState(String(Number(room.outstanding_balance) || 0));

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const prevMeter = Number(prevMeterStr) || 0;
  const currMeter = Number(currMeterStr) || 0;
  const rawSpecial = Math.abs(Number(specialAmtStr) || 0);
  const signedSpecial = adjustMode === 'discount' ? -rawSpecial : rawSpecial;
  const lateFee = Math.max(0, Number(lateFeeStr) || 0);
  const outstandingBalance = Number(outstandingStr) || 0;

  const previewBill = calculateBill(
    room,
    currMeter,
    period,
    config,
    signedSpecial,
    specialNote,
    outstandingBalance,
    prevMeter,
    lateFee
  );

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const { error: logErr } = await supabase
        .from('meter_logs')
        .upsert(
          {
            period,
            room_no: room.room_no,
            prev_meter: prevMeter,
            curr_meter: currMeter,
            units_used: previewBill.units_used,
            water_amount: previewBill.water_amount,
            wastewater_amount: previewBill.wastewater_amount,
            common_fee_amount: previewBill.common_fee,
            late_fee: lateFee,
            special_items: signedSpecial,
            special_items_note: specialNote || null,
            contribution_deducted: previewBill.contribution_deducted,
            prepaid_deducted: previewBill.prepaid_deducted,
            total_amount: previewBill.total_amount,
            meter_photo_url: meterLog?.meter_photo_url || null,
            note: specialNote || meterLog?.note || null,
            is_verified: true,
            recorded_at: new Date().toISOString(),
          },
          { onConflict: 'period,room_no' }
        );

      if (logErr) throw logErr;

      const { error: roomErr } = await supabase
        .from('rooms')
        .update({
          latest_meter: currMeter,
          outstanding_balance: outstandingBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('room_no', room.room_no);

      if (roomErr) throw roomErr;

      onSaved();
      onClose();
    } catch (err: any) {
      setErrorMsg('บันทึกการแก้ไขบิลไม่สำเร็จ: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-sky-400">
              ✏️ จัดการบิล / เพิ่มรายการ / ส่วนลด — ห้อง {formatRoomNo(room.room_no)}
            </h3>
            <p className="text-xs text-slate-400">
              รอบบิล {period} • {room.room_type} ({room.owner_name || 'เจ้าของห้อง'})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {errorMsg && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl font-medium">
              {errorMsg}
            </div>
          )}

          {/* 1. Meter Numbers */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
            <div className="font-bold text-slate-800">1. ตัวเลขมิเตอร์น้ำประปา</div>
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="text-slate-500 block mb-1">เลขครั้งก่อน</label>
                <input
                  type="number"
                  value={prevMeterStr}
                  onChange={(e) => setPrevMeterStr(e.target.value)}
                  className="w-full border rounded-lg p-2 font-mono font-bold bg-white"
                />
              </div>
              <div>
                <label className="text-blue-700 font-bold block mb-1">เลขครั้งนี้</label>
                <input
                  type="number"
                  value={currMeterStr}
                  onChange={(e) => setCurrMeterStr(e.target.value)}
                  className="w-full border-2 border-blue-400 rounded-lg p-2 font-mono font-bold text-blue-700 bg-white"
                />
              </div>
              <div className="flex flex-col justify-center items-end pr-2">
                <span className="text-slate-500 text-[11px]">ใช้น้ำ</span>
                <span className="text-base font-bold font-mono text-slate-900">
                  {previewBill.units_used} หน่วย
                </span>
                <span className="text-[11px] text-slate-500">
                  {(previewBill.water_amount + previewBill.wastewater_amount).toLocaleString()} บ.
                </span>
              </div>
            </div>
          </div>

          {/* 2. Additional Charges (+) or Discount (-) */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800">2. รายการเรียกเก็บเพิ่ม หรือ ส่วนลดพิเศษ</span>
              <div className="flex rounded-lg overflow-hidden border border-slate-300 text-[11px]">
                <button
                  type="button"
                  onClick={() => setAdjustMode('charge')}
                  className={`px-2.5 py-1 font-bold ${
                    adjustMode === 'charge'
                      ? 'bg-amber-600 text-white'
                      : 'bg-white text-slate-600'
                  }`}
                >
                  ➕ เรียกเก็บเพิ่ม (+)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustMode('discount')}
                  className={`px-2.5 py-1 font-bold ${
                    adjustMode === 'discount'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-slate-600'
                  }`}
                >
                  ➖ ใส่ส่วนลด (-)
                </button>
              </div>
            </div>

            {/* Quick Preset Chips */}
            <div className="flex flex-wrap gap-1">
              {[
                { label: '+ ค่าคีย์การ์ด 100 บ.', mode: 'charge', amt: 100, text: 'ค่าคีย์การ์ด' },
                { label: '+ ค่าซ่อมบำรุง 200 บ.', mode: 'charge', amt: 200, text: 'ค่าซ่อมบำรุงในห้องชุด' },
                { label: '- ส่วนลดพิเศษ 100 บ.', mode: 'discount', amt: 100, text: 'ส่วนลดพิเศษ' },
                { label: '- หักค่าสำรองจ่าย', mode: 'discount', amt: 300, text: 'หักคืนค่าสำรองจ่าย' },
                { label: 'ล้างค่า (0 บ.)', mode: 'charge', amt: 0, text: '' },
              ].map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setAdjustMode(p.mode as any);
                    setSpecialAmtStr(String(p.amt));
                    if (p.text !== undefined) setSpecialNote(p.text);
                  }}
                  className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-[10px] font-medium text-slate-700"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="text-slate-600 block mb-1">
                  {adjustMode === 'discount' ? 'จำนวนเงินส่วนลด (บาท)' : 'จำนวนเงินเรียกเก็บเพิ่ม (บาท)'}
                </label>
                <input
                  type="number"
                  step="any"
                  value={specialAmtStr}
                  onChange={(e) => setSpecialAmtStr(e.target.value)}
                  className={`w-full border rounded-lg p-2 font-mono font-bold bg-white ${
                    adjustMode === 'discount' ? 'text-emerald-700 border-emerald-400' : 'text-amber-700'
                  }`}
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1">ชื่อรายการที่จะแสดงบนบิล</label>
                <input
                  type="text"
                  value={specialNote}
                  onChange={(e) => setSpecialNote(e.target.value)}
                  placeholder={
                    adjustMode === 'discount'
                      ? 'เช่น ส่วนลดพิเศษ / หักค่าสำรองจ่าย'
                      : 'เช่น ค่าคีย์การ์ด 1 ใบ / ค่าซ่อมก๊อกน้ำ'
                  }
                  className="w-full border rounded-lg p-2 bg-white"
                />
              </div>
            </div>
          </div>

          {/* 3. Late Fee & Outstanding Balance */}
          <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div>
              <label className="text-slate-600 font-bold block mb-1">3. เบี้ยปรับชำระล่าช้า (บาท)</label>
              <input
                type="number"
                step="any"
                value={lateFeeStr}
                onChange={(e) => setLateFeeStr(e.target.value)}
                className="w-full border rounded-lg p-2 font-mono font-bold bg-white text-red-600"
              />
            </div>
            <div>
              <label className="text-slate-600 font-bold block mb-1">4. ยอดค้างชำระยกมา (บาท)</label>
              <input
                type="number"
                step="any"
                value={outstandingStr}
                onChange={(e) => setOutstandingStr(e.target.value)}
                className="w-full border rounded-lg p-2 font-mono font-bold bg-white text-red-600"
              />
            </div>
          </div>

          {/* Live Bill Breakdown Preview */}
          <div className="bg-slate-900 text-white p-3.5 rounded-xl space-y-1.5">
            <div className="text-xs font-bold text-sky-400 border-b border-slate-700 pb-1">
              สรุปยอดใบแจ้งหนี้หลังปรับปรุง
            </div>
            <div className="flex justify-between text-[11px] text-slate-300">
              <span>ค่าน้ำประปา + ค่าบำบัด ({previewBill.units_used} หน่วย):</span>
              <span className="font-mono">{(previewBill.water_amount + previewBill.wastewater_amount).toFixed(2)} บ.</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-300">
              <span>ค่าส่วนกลาง ({room.room_type}):</span>
              <span className="font-mono">{previewBill.common_fee.toFixed(2)} บ.</span>
            </div>
            {signedSpecial !== 0 && (
              <div className={`flex justify-between text-[11px] font-bold ${signedSpecial < 0 ? 'text-emerald-400' : 'text-amber-300'}`}>
                <span>{signedSpecial < 0 ? 'ส่วนลดพิเศษ' : 'รายการเพิ่มเติม'} ({specialNote || '-'}):</span>
                <span className="font-mono">{signedSpecial > 0 ? `+${signedSpecial.toFixed(2)}` : signedSpecial.toFixed(2)} บ.</span>
              </div>
            )}
            {lateFee > 0 && (
              <div className="flex justify-between text-[11px] text-red-400">
                <span>เบี้ยปรับล่าช้า:</span>
                <span className="font-mono">+{lateFee.toFixed(2)} บ.</span>
              </div>
            )}
            {previewBill.contribution_deducted > 0 && (
              <div className="flex justify-between text-[11px] text-emerald-400">
                <span>★ หักเครดิตสมทบทุนซ่อมตึก:</span>
                <span className="font-mono">-{previewBill.contribution_deducted.toFixed(2)} บ.</span>
              </div>
            )}
            {previewBill.prepaid_deducted > 0 && (
              <div className="flex justify-between text-[11px] text-emerald-400">
                <span>★ หักเงินฝากล่วงหน้า:</span>
                <span className="font-mono">-{previewBill.prepaid_deducted.toFixed(2)} บ.</span>
              </div>
            )}
            {outstandingBalance > 0 && (
              <div className="flex justify-between text-[11px] text-red-400">
                <span>ยอดค้างชำระยกมา:</span>
                <span className="font-mono">+{outstandingBalance.toFixed(2)} บ.</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-1.5 border-t border-slate-700 text-sm font-bold">
              <span>ยอดสุทธิที่ต้องชำระ:</span>
              <span className="text-lg font-mono text-sky-400">
                {previewBill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-100 border-t flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 border border-slate-300 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-200"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-md disabled:opacity-50"
          >
            {isSaving ? 'กำลังบันทึก...' : '💾 บันทึกการปรับปรุงบิล'}
          </button>
        </div>
      </div>
    </div>
  );
};
