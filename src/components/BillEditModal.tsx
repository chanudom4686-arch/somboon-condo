'use client';

// Per-Room Bill Customization Modal with Dynamic Multi-Item Add/Delete List
// Version 1.5 - Shows itemized list (Water 35 THB, Wastewater 5 THB, Common Fee, and unlimited add/delete custom items/discounts)

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

export interface CustomBillLineItem {
  id: string;
  type: 'charge' | 'discount';
  title: string;
  amount: number;
}

// Parse existing special_items_note and special_items into structured line items
function parseExistingLineItems(noteStr?: string | null, totalSpecial = 0): CustomBillLineItem[] {
  const cleanNote = (noteStr || '').trim();
  if (!cleanNote && totalSpecial === 0) return [];

  // Format: "ค่าคีย์การ์ด (+100 บ.) | ส่วนลดพิเศษ (-50 บ.)"
  if (cleanNote.includes('|') || /\([+-]?\d+(\.\d+)?\s*บ\.\)/.test(cleanNote)) {
    const parts = cleanNote.split('|').map((p) => p.trim()).filter(Boolean);
    const parsed: CustomBillLineItem[] = [];
    parts.forEach((part, idx) => {
      const match = part.match(/^(.*?)\s*\(([+-]?\d+(?:\.\d+)?)\s*บ\.\)$/);
      if (match) {
        const title = match[1].trim() || 'รายการเพิ่มเติม';
        const val = parseFloat(match[2]) || 0;
        parsed.push({
          id: `item-${idx}-${Date.now()}`,
          type: val < 0 ? 'discount' : 'charge',
          title,
          amount: Math.abs(val),
        });
      } else {
        parsed.push({
          id: `item-${idx}-${Date.now()}`,
          type: totalSpecial < 0 ? 'discount' : 'charge',
          title: part,
          amount: parts.length === 1 ? Math.abs(totalSpecial) : 0,
        });
      }
    });
    if (parsed.length > 0) return parsed;
  }

  return [
    {
      id: `item-0-${Date.now()}`,
      type: totalSpecial < 0 ? 'discount' : 'charge',
      title: cleanNote || (totalSpecial < 0 ? 'ส่วนลดพิเศษ' : 'ค่าใช้จ่ายเพิ่มเติม'),
      amount: Math.abs(totalSpecial),
    },
  ];
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

  // Multi-item state list
  const [items, setItems] = useState<CustomBillLineItem[]>(() =>
    parseExistingLineItems(meterLog?.special_items_note || meterLog?.note, initialSpecial)
  );

  // New item draft input row
  const [newItemType, setNewItemType] = useState<'charge' | 'discount'>('charge');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemAmountStr, setNewItemAmountStr] = useState('');

  const [lateFeeStr, setLateFeeStr] = useState(String(meterLog ? Number(meterLog.late_fee) || 0 : 0));
  const [outstandingStr, setOutstandingStr] = useState(String(Number(room.outstanding_balance) || 0));

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const prevMeter = Number(prevMeterStr) || 0;
  const currMeter = Number(currMeterStr) || 0;
  const lateFee = Math.max(0, Number(lateFeeStr) || 0);
  const outstandingBalance = Number(outstandingStr) || 0;

  // Sum all custom line items
  const signedSpecialTotal = items.reduce((sum, item) => {
    const amt = Math.abs(Number(item.amount) || 0);
    return sum + (item.type === 'discount' ? -amt : amt);
  }, 0);

  // Serialize line items into readable string
  const serializedSpecialNote = items
    .filter((i) => i.title.trim() !== '' || i.amount > 0)
    .map((i) => {
      const sign = i.type === 'discount' ? '-' : '+';
      const cleanTitle = i.title.trim() || (i.type === 'discount' ? 'ส่วนลดพิเศษ' : 'ค่าใช้จ่ายอื่น');
      return `${cleanTitle} (${sign}${Math.abs(Number(i.amount) || 0)} บ.)`;
    })
    .join(' | ');

  const previewBill = calculateBill(
    room,
    currMeter,
    period,
    config,
    signedSpecialTotal,
    serializedSpecialNote,
    outstandingBalance,
    prevMeter,
    lateFee
  );

  // Add a line item to the list
  const handleAddItem = (type: 'charge' | 'discount', title: string, amount: number) => {
    if (!title.trim() && amount <= 0) return;
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        title: title.trim() || (type === 'discount' ? 'ส่วนลดพิเศษ' : 'ค่าใช้จ่ายเพิ่มเติม'),
        amount: Math.abs(amount),
      },
    ]);
  };

  const handleAddFromDraft = () => {
    const amt = Math.abs(parseFloat(newItemAmountStr) || 0);
    if (!newItemTitle.trim() && amt <= 0) {
      setErrorMsg('กรุณาระบุชื่อรายการและจำนวนเงินก่อนกดเพิ่มรายการ');
      return;
    }
    setErrorMsg(null);
    handleAddItem(newItemType, newItemTitle, amt);
    setNewItemTitle('');
    setNewItemAmountStr('');
  };

  // Remove a line item by id
  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Update an existing item in place
  const handleUpdateItem = (id: string, patch: Partial<CustomBillLineItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);
    try {
      // If user typed something in the draft box but forgot to click "+ เพิ่ม", add it automatically!
      let finalItems = [...items];
      const draftAmt = Math.abs(parseFloat(newItemAmountStr) || 0);
      if (newItemTitle.trim() !== '' || draftAmt > 0) {
        finalItems.push({
          id: `item-${Date.now()}`,
          type: newItemType,
          title: newItemTitle.trim() || (newItemType === 'discount' ? 'ส่วนลดพิเศษ' : 'ค่าใช้จ่ายเพิ่มเติม'),
          amount: draftAmt,
        });
      }

      const finalSpecialTotal = finalItems.reduce((sum, item) => {
        const amt = Math.abs(Number(item.amount) || 0);
        return sum + (item.type === 'discount' ? -amt : amt);
      }, 0);

      const finalSpecialNote = finalItems
        .filter((i) => i.title.trim() !== '' || i.amount > 0)
        .map((i) => {
          const sign = i.type === 'discount' ? '-' : '+';
          const cleanTitle = i.title.trim() || (i.type === 'discount' ? 'ส่วนลดพิเศษ' : 'ค่าใช้จ่ายอื่น');
          return `${cleanTitle} (${sign}${Math.abs(Number(i.amount) || 0)} บ.)`;
        })
        .join(' | ');

      const finalBill = calculateBill(
        room,
        currMeter,
        period,
        config,
        finalSpecialTotal,
        finalSpecialNote,
        outstandingBalance,
        prevMeter,
        lateFee
      );

      const { error: logErr } = await supabase
        .from('meter_logs')
        .upsert(
          {
            period,
            room_no: room.room_no,
            prev_meter: prevMeter,
            curr_meter: currMeter,
            units_used: finalBill.units_used,
            water_amount: finalBill.water_amount,
            wastewater_amount: finalBill.wastewater_amount,
            common_fee_amount: finalBill.common_fee,
            late_fee: lateFee,
            special_items: finalSpecialTotal,
            special_items_note: finalSpecialNote || null,
            contribution_deducted: finalBill.contribution_deducted,
            prepaid_deducted: finalBill.prepaid_deducted,
            total_amount: finalBill.total_amount,
            meter_photo_url: meterLog?.meter_photo_url || null,
            note: finalSpecialNote || meterLog?.note || null,
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
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-sky-400">
              ✏️ จัดการรายการบิล / เพิ่มค่าใช้จ่าย / ส่วนลด — ห้อง {formatRoomNo(room.room_no)}
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

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {errorMsg && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl font-medium">
              {errorMsg}
            </div>
          )}

          {/* 1. Meter Numbers Input */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div className="font-bold text-slate-800 mb-2">1. ตัวเลขมิเตอร์น้ำประปา</div>
            <div className="grid grid-cols-3 gap-3">
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
              <div className="flex flex-col justify-center items-end pr-2 bg-white rounded-lg border px-3">
                <span className="text-slate-500 text-[10px]">จำนวนหน่วยที่ใช้</span>
                <span className="text-lg font-bold font-mono text-blue-700">
                  {previewBill.units_used} <span className="text-xs font-normal">หน่วย</span>
                </span>
              </div>
            </div>
          </div>

          {/* 2. All Bill Line Items Table (Standard + Custom Added Items with Delete Button) */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-800 text-white px-3.5 py-2 flex items-center justify-between">
              <span className="font-bold">2. รายการทั้งหมดในใบแจ้งหนี้ (กดเพิ่มหรือลบรายการได้ทันที)</span>
              <span className="text-[11px] text-sky-300">แยกค่าน้ำ 35 บ. และค่าบำบัด 5 บ.</span>
            </div>

            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-600 border-b">
                <tr>
                  <th className="py-2 px-3 text-left">รายการ</th>
                  <th className="py-2 px-3 text-center w-28">ประเภท</th>
                  <th className="py-2 px-3 text-right w-32">จำนวนเงิน (บาท)</th>
                  <th className="py-2 px-3 text-center w-16">ลบ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {/* Base Item 1: Water (35 THB/unit) */}
                <tr className="bg-slate-50/60">
                  <td className="py-2 px-3 font-medium text-slate-800">
                    1. ค่าน้ำประปา ({previewBill.units_used} หน่วย × {previewBill.water_rate} บาท)
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-bold">
                      รายการหลัก
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-slate-800">
                    {previewBill.water_amount.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-center text-slate-300">-</td>
                </tr>

                {/* Base Item 2: Wastewater (5 THB/unit) */}
                <tr className="bg-slate-50/60">
                  <td className="py-2 px-3 font-medium text-slate-800">
                    2. ค่าบำบัดน้ำเสีย ({previewBill.units_used} หน่วย × {previewBill.wastewater_rate} บาท)
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-bold">
                      รายการหลัก
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-slate-800">
                    {previewBill.wastewater_amount.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-center text-slate-300">-</td>
                </tr>

                {/* Base Item 3: Common Fee */}
                <tr className="bg-slate-50/60">
                  <td className="py-2 px-3 font-medium text-slate-800">
                    3. ค่าส่วนกลางประจำเดือน ({room.room_type})
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-bold">
                      รายการหลัก
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-slate-800">
                    {previewBill.common_fee.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-center text-slate-300">-</td>
                </tr>

                {/* Dynamic Custom Line Items (Editable & Deletable!) */}
                {items.map((item, idx) => (
                  <tr
                    key={item.id}
                    className={item.type === 'discount' ? 'bg-emerald-50/40' : 'bg-amber-50/40'}
                  >
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400 font-mono">{idx + 4}.</span>
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => handleUpdateItem(item.id, { title: e.target.value })}
                          placeholder="ชื่อรายการ..."
                          className="w-full border rounded-lg px-2 py-1 bg-white font-medium"
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <select
                        value={item.type}
                        onChange={(e) =>
                          handleUpdateItem(item.id, { type: e.target.value as 'charge' | 'discount' })
                        }
                        className={`border rounded-lg px-2 py-1 font-bold text-[11px] ${
                          item.type === 'discount'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : 'bg-amber-100 text-amber-800 border-amber-300'
                        }`}
                      >
                        <option value="charge">➕ เรียกเก็บเพิ่ม</option>
                        <option value="discount">➖ ส่วนลด</option>
                      </select>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        step="any"
                        value={item.amount}
                        onChange={(e) =>
                          handleUpdateItem(item.id, { amount: Math.abs(parseFloat(e.target.value) || 0) })
                        }
                        className={`w-24 text-right border rounded-lg px-2 py-1 font-mono font-bold bg-white ${
                          item.type === 'discount' ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      />
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-bold text-[11px]"
                        title="ลบรายการนี้ออกจากบิล"
                      >
                        🗑️ ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Add New Line Item Bar */}
            <div className="p-3 bg-slate-50 border-t space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-700">＋ เพิ่มรายการใหม่ลงในบิล:</span>
                {/* Quick One-Click Add Presets */}
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: '+ ค่าคีย์การ์ด (100)', type: 'charge' as const, title: 'ค่าคีย์การ์ด', amt: 100 },
                    { label: '+ ค่าซ่อมบำรุง (200)', type: 'charge' as const, title: 'ค่าซ่อมบำรุง', amt: 200 },
                    { label: '- ส่วนลดพิเศษ (100)', type: 'discount' as const, title: 'ส่วนลดพิเศษ', amt: 100 },
                    { label: '- หักค่าสำรองจ่าย (300)', type: 'discount' as const, title: 'หักคืนค่าสำรองจ่าย', amt: 300 },
                  ].map((preset, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleAddItem(preset.type, preset.title, preset.amt)}
                      className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition ${
                        preset.type === 'discount'
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                          : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                <select
                  value={newItemType}
                  onChange={(e) => setNewItemType(e.target.value as 'charge' | 'discount')}
                  className={`border rounded-xl px-2.5 py-2 font-bold ${
                    newItemType === 'discount'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-amber-100 text-amber-800 border-amber-300'
                  }`}
                >
                  <option value="charge">➕ เรียกเก็บเพิ่ม (+)</option>
                  <option value="discount">➖ ส่วนลดพิเศษ (-)</option>
                </select>

                <input
                  type="text"
                  value={newItemTitle}
                  onChange={(e) => setNewItemTitle(e.target.value)}
                  placeholder="พิมพ์ชื่อรายการ เช่น ค่าคีย์การ์ด หรือ ส่วนลด..."
                  className="flex-1 border rounded-xl px-3 py-2 bg-white"
                />

                <input
                  type="number"
                  step="any"
                  value={newItemAmountStr}
                  onChange={(e) => setNewItemAmountStr(e.target.value)}
                  placeholder="จำนวนเงิน (บาท)"
                  className="w-32 border rounded-xl px-3 py-2 bg-white font-mono font-bold"
                />

                <button
                  type="button"
                  onClick={handleAddFromDraft}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl shrink-0"
                >
                  ＋ เพิ่มลงตาราง
                </button>
              </div>
            </div>
          </div>

          {/* 3. Late Fee & Outstanding Balance */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
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
              สรุปยอดใบแจ้งหนี้สุทธิ
            </div>
            <div className="flex justify-between text-[11px] text-slate-300">
              <span>1. ค่าน้ำประปา ({previewBill.units_used} หน่วย × {previewBill.water_rate} บ.):</span>
              <span className="font-mono">{previewBill.water_amount.toFixed(2)} บ.</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-300">
              <span>2. ค่าบำบัดน้ำเสีย ({previewBill.units_used} หน่วย × {previewBill.wastewater_rate} บ.):</span>
              <span className="font-mono">{previewBill.wastewater_amount.toFixed(2)} บ.</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-300">
              <span>3. ค่าส่วนกลาง ({room.room_type}):</span>
              <span className="font-mono">{previewBill.common_fee.toFixed(2)} บ.</span>
            </div>
            {items.map((item, i) => (
              <div
                key={item.id}
                className={`flex justify-between text-[11px] font-bold ${
                  item.type === 'discount' ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                <span>
                  {i + 4}. {item.title || (item.type === 'discount' ? 'ส่วนลด' : 'รายการเพิ่ม')}:
                </span>
                <span className="font-mono">
                  {item.type === 'discount' ? `-${item.amount.toFixed(2)}` : `+${item.amount.toFixed(2)}`} บ.
                </span>
              </div>
            ))}
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
            {isSaving ? 'กำลังบันทึก...' : '💾 บันทึกรายการบิล'}
          </button>
        </div>
      </div>
    </div>
  );
};
