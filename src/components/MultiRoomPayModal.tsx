'use client';

// Batch Payment Recording Modal for Multi-Room Owners
// Version 2.5 - Allows Juristic Admin to record 1 combined payment across multiple rooms of the same owner in 1 click

import React, { useState, useMemo } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo, calculateBill, generateReceiptNo } from '@/utils/billing';

interface MultiRoomPayModalProps {
  rooms: Room[];
  logMap: Record<string, MeterLog>;
  period: string;
  config: Partial<CondoConfig>;
  onClose: () => void;
  onSuccess: () => void;
}

export const MultiRoomPayModal: React.FC<MultiRoomPayModalProps> = ({
  rooms,
  logMap,
  period,
  config,
  onClose,
  onSuccess,
}) => {
  const supabase = createClient();

  // Find all owners who have > 1 room
  const multiRoomOwners = useMemo(() => {
    const ownerMap: Record<string, Room[]> = {};
    rooms.forEach((r) => {
      const name = (r.owner_name || '').trim();
      if (!name) return;
      if (!ownerMap[name]) ownerMap[name] = [];
      ownerMap[name].push(r);
    });

    return Object.entries(ownerMap)
      .filter(([_, oRooms]) => oRooms.length > 1)
      .map(([name, oRooms]) => {
        const unpaidCount = oRooms.filter((r) => !logMap[r.room_no]?.is_paid).length;
        return {
          ownerName: name,
          rooms: oRooms,
          unpaidCount,
        };
      })
      .sort((a, b) => b.unpaidCount - a.unpaidCount || a.ownerName.localeCompare(b.ownerName, 'th'));
  }, [rooms, logMap]);

  const [selectedOwnerName, setSelectedOwnerName] = useState<string>(
    multiRoomOwners[0]?.ownerName || ''
  );

  const selectedOwner = useMemo(() => {
    return multiRoomOwners.find((o) => o.ownerName === selectedOwnerName) || null;
  }, [multiRoomOwners, selectedOwnerName]);

  // Selected room numbers to pay
  const [selectedRoomNos, setSelectedRoomNos] = useState<string[]>(() => {
    if (!selectedOwner) return [];
    return selectedOwner.rooms.filter((r) => !logMap[r.room_no]?.is_paid).map((r) => r.room_no);
  });

  // When owner changes, reset checked rooms to unpaid rooms
  const handleSelectOwner = (ownerName: string) => {
    setSelectedOwnerName(ownerName);
    const ownerObj = multiRoomOwners.find((o) => o.ownerName === ownerName);
    if (ownerObj) {
      setSelectedRoomNos(
        ownerObj.rooms.filter((r) => !logMap[r.room_no]?.is_paid).map((r) => r.room_no)
      );
    } else {
      setSelectedRoomNos([]);
    }
  };

  // Calculate bills for selected owner's rooms
  const roomBills = useMemo(() => {
    if (!selectedOwner) return [];
    return selectedOwner.rooms.map((room) => {
      const log = logMap[room.room_no];
      const prevM = log ? Number(log.prev_meter) : Number(room.latest_meter) || 0;
      const currM = log ? Number(log.curr_meter) : prevM;
      const lateFee = log ? Number(log.late_fee) || 0 : 0;
      const bill = calculateBill(
        room,
        currM,
        period,
        config,
        log ? Number(log.special_items) || 0 : 0,
        log?.special_items_note || log?.note || '',
        Number(room.outstanding_balance) || 0,
        prevM,
        lateFee
      );
      const isPaid = !!log?.is_paid;
      return { room, log, bill, isPaid };
    });
  }, [selectedOwner, logMap, period, config]);

  // Calculate sum of checked rooms
  const checkedBills = roomBills.filter((rb) => selectedRoomNos.includes(rb.room.room_no));
  const totalAmountDue = checkedBills.reduce((s, rb) => s + rb.bill.total_amount, 0);

  const [amountStr, setAmountStr] = useState<string>(String(totalAmountDue));
  const [paymentMethod, setPaymentMethod] = useState<'โอนเงิน' | 'เงินสด'>('โอนเงิน');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync amountStr when checked rooms change
  React.useEffect(() => {
    setAmountStr(String(totalAmountDue));
  }, [totalAmountDue]);

  const paidAmount = parseFloat(amountStr) || 0;
  const isOverpaid = paidAmount > totalAmountDue;
  const overpaidAmount = isOverpaid ? paidAmount - totalAmountDue : 0;

  const handleSubmit = async () => {
    if (checkedBills.length === 0) {
      setErrorMsg('กรุณาเลือกห้องชุดที่ต้องการตัดยอดอย่างน้อย 1 ห้อง');
      return;
    }
    if (paidAmount <= 0 && totalAmountDue > 0) {
      setErrorMsg('กรุณาระบุยอดเงินที่รับชำระ');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const nowIso = new Date().toISOString();
      const txDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

      // 1. Mark each selected room as paid in meter_logs
      for (const rb of checkedBills) {
        await supabase.from('meter_logs').upsert(
          {
            period,
            room_no: rb.room.room_no,
            prev_meter: rb.bill.prev_meter,
            curr_meter: rb.bill.curr_meter,
            units_used: rb.bill.units_used,
            water_amount: rb.bill.water_amount,
            wastewater_amount: rb.bill.wastewater_amount,
            common_fee_amount: rb.bill.common_fee,
            late_fee: rb.bill.late_fee,
            special_items: rb.bill.special_items,
            special_items_note: rb.bill.special_items_note || null,
            contribution_deducted: rb.bill.contribution_deducted,
            prepaid_deducted: rb.bill.prepaid_deducted,
            total_amount: rb.bill.total_amount,
            is_paid: true,
            is_late_payment: false,
            paid_type: paymentMethod,
            paid_timestamp: nowIso,
            followup_status: 'none',
            recorded_at: rb.log?.recorded_at || nowIso,
          },
          { onConflict: 'period,room_no' }
        );
      }

      // 2. If overpaid, credit excess to prepaid deposit of first checked room
      if (isOverpaid && overpaidAmount > 0 && checkedBills.length > 0) {
        const firstRoom = checkedBills[0].room;
        const newPrepaid = (Number(firstRoom.prepaid_credit) || 0) + overpaidAmount;
        await supabase
          .from('rooms')
          .update({
            prepaid_credit: newPrepaid,
            updated_at: nowIso,
          })
          .eq('room_no', firstRoom.room_no);

        await supabase.from('wallet_ledger').insert({
          room_no: firstRoom.room_no,
          wallet_type: 'prepaid',
          entry_type: 'credit_in',
          amount: overpaidAmount,
          balance_after: newPrepaid,
          description_th: `ชำระบิลรวมหลายห้องรอบ ${period} เกิน (${overpaidAmount} บ.) โอนเข้าเงินฝากห้อง ${formatRoomNo(firstRoom.room_no)}`,
          description_en: `Multi-room overpayment credited to room ${formatRoomNo(firstRoom.room_no)}`,
          created_by: 'admin',
        });
      }

      // 3. Record combined income transaction
      const roomLabels = checkedBills.map((rb) => formatRoomNo(rb.room.room_no)).join(', ');
      await supabase.from('transactions').insert({
        fund_type: 'operating',
        type: 'income',
        category: 'รับชำระบิลรวมหลายห้อง',
        amount: paidAmount,
        tx_date: txDate,
        room_no: checkedBills[0]?.room.room_no || 'MULTI',
        payment_method: paymentMethod,
        note: `รับชำระรวม ${checkedBills.length} ห้อง (${roomLabels}) เจ้าของ: ${selectedOwnerName} รอบบิล ${period} • ${paymentMethod} ${note ? `[${note}]` : ''}`,
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Batch payment error:', err);
      setErrorMsg('เกิดข้อผิดพลาดในการบันทึกรับชำระ: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex justify-between items-center">
          <div>
            <h2 className="font-bold text-sm sm:text-base flex items-center gap-1.5">
              <span>👥</span>
              <span>รวมชำระเงินเจ้าของหลายห้อง (Batch Payment)</span>
            </h2>
            <p className="text-xs text-slate-400">
              ตัดยอดหลายห้องพร้อมกันใน 1 สลิป • รอบบิล {period}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-full text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 space-y-3.5 text-xs overflow-y-auto">
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-2.5 rounded-xl text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Select Owner Dropdown */}
          <div>
            <label className="text-slate-700 font-bold block mb-1">
              เลือกเจ้าของร่วมที่มีมากกว่า 1 ห้อง ({multiRoomOwners.length} ท่าน)
            </label>
            <select
              value={selectedOwnerName}
              onChange={(e) => handleSelectOwner(e.target.value)}
              className="w-full border rounded-xl p-2.5 bg-white font-bold text-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
            >
              {multiRoomOwners.map((o) => (
                <option key={o.ownerName} value={o.ownerName}>
                  {o.ownerName} ({o.rooms.length} ห้อง {o.unpaidCount > 0 ? `• ค้าง ${o.unpaidCount} ห้อง` : '• ชำระครบแล้ว'})
                </option>
              ))}
            </select>
          </div>

          {/* Room Selection Checklist */}
          {selectedOwner && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-100 px-3 py-2 border-b flex justify-between items-center font-bold text-slate-700">
                <span>ติ๊กเลือกห้องที่ต้องการตัดยอดพร้อมกัน:</span>
                <span className="text-[11px] text-blue-700">
                  เลือก {selectedRoomNos.length} จาก {selectedOwner.rooms.length} ห้อง
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {roomBills.map(({ room, bill, isPaid }) => {
                  const isChecked = selectedRoomNos.includes(room.room_no);
                  return (
                    <label
                      key={room.room_no}
                      className={`flex items-center justify-between p-2.5 hover:bg-slate-50 cursor-pointer ${
                        isChecked ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRoomNos((prev) => [...prev, room.room_no]);
                            } else {
                              setSelectedRoomNos((prev) => prev.filter((r) => r !== room.room_no));
                            }
                          }}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <div>
                          <span className="font-mono font-bold text-blue-800 text-sm">
                            {formatRoomNo(room.room_no)}
                          </span>
                          <span className="text-slate-500 ml-2 text-[11px]">
                            {room.room_type}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-slate-800 block text-xs">
                          {bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                        </span>
                        <span
                          className={`text-[9.5px] px-1.5 py-0.2 rounded font-semibold ${
                            isPaid
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isPaid ? '✓ ชำระแล้ว' : '⏳ รอชำระ'}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Amount Input */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-600 font-semibold">ยอดรวมบิลที่เลือก ({checkedBills.length} ห้อง):</span>
              <span className="text-base font-extrabold text-blue-700 font-mono">
                {totalAmountDue.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
              </span>
            </div>

            <div>
              <label className="text-slate-700 font-bold block mb-1">ยอดเงินตามสลิปโอนชำระจริง (บาท)</label>
              <input
                type="number"
                step="any"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="w-full text-lg font-bold text-emerald-700 font-mono border rounded-xl p-2.5 bg-white outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {isOverpaid && (
                <p className="text-emerald-700 mt-1 text-[11px] font-medium">
                  ★ ยอดชำระเกิน {overpaidAmount.toLocaleString()} บาท จะถูกโอนเป็น <b>เงินฝากล่วงหน้า</b> เข้าห้อง {formatRoomNo(checkedBills[0]?.room.room_no || '')} อัตโนมัติ
                </p>
              )}
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="text-slate-700 font-bold block mb-1.5">ช่องทางรับชำระ</label>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { id: 'โอนเงิน', label: '🏦 โอนเงินเข้าบัญชี' },
                { id: 'เงินสด', label: '💵 เงินสด' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id as 'โอนเงิน' | 'เงินสด')}
                  className={`py-2 px-2 text-center rounded-xl border font-bold transition ${
                    paymentMethod === m.id
                      ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="text-slate-500 block mb-0.5">หมายเหตุเพิ่มเติม (ถ้ามี)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น โอนก้อนเดียวตัด 3 ห้อง เวลา 11:30 น."
              className="w-full border rounded-lg p-2 text-xs"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 border border-slate-300 text-slate-700 font-medium rounded-xl text-xs hover:bg-slate-100"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={isSubmitting || checkedBills.length === 0}
            onClick={handleSubmit}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md disabled:opacity-50"
          >
            {isSubmitting ? 'กำลังบันทึกตัดยอด...' : `🧾 ยืนยันตัดยอด ${checkedBills.length} ห้อง`}
          </button>
        </div>
      </div>
    </div>
  );
};