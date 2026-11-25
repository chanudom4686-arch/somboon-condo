'use client';

// Payment Recording Modal & Automatic Receipt Launcher
// Version 1.8 - Transfer/Cash only (no PromptPay button, no slip upload), Late Payment support, and auto-launches Receipt upon saving

import React, { useState } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo, generateReceiptNo, calculateBill, isPeriodPastDue } from '@/utils/billing';

interface PaymentModalProps {
  room: Room;
  meterLog?: MeterLog | null;
  period: string;
  config: Partial<CondoConfig>;
  onClose: () => void;
  onPaymentSuccess: (paidRoomNo: string) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  room,
  meterLog,
  period,
  config,
  onClose,
  onPaymentSuccess,
}) => {
  const supabase = createClient();

  const dueDay = Number(config.BILL_DUE_DAY) || 5;
  const autoPastDue = isPeriodPastDue(period, dueDay);

  const prevM = meterLog ? Number(meterLog.prev_meter) : Number(room.latest_meter) || 0;
  const currM = meterLog ? Number(meterLog.curr_meter) : prevM;
  const initialLateFee = meterLog ? Number(meterLog.late_fee) || 0 : 0;

  const [isLatePayment, setIsLatePayment] = useState<boolean>(
    meterLog?.is_late_payment !== undefined ? !!meterLog.is_late_payment : autoPastDue
  );
  const [lateFeeStr, setLateFeeStr] = useState<string>(String(initialLateFee));

  const currentLateFee = Math.max(0, parseFloat(lateFeeStr) || 0);

  const billCalc = calculateBill(
    room,
    currM,
    period,
    config,
    meterLog ? Number(meterLog.special_items) || 0 : 0,
    meterLog?.special_items_note || meterLog?.note || '',
    Number(room.outstanding_balance) || 0,
    prevM,
    currentLateFee
  );

  const totalDue = billCalc.total_amount;

  const [amountStr, setAmountStr] = useState<string>(String(totalDue));
  const [paymentMethod, setPaymentMethod] = useState<'โอนเงิน' | 'เงินสด'>('โอนเงิน');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync amountStr when lateFee changes
  const handleLateFeeChange = (val: string) => {
    setLateFeeStr(val);
    const lf = Math.max(0, parseFloat(val) || 0);
    const updatedBill = calculateBill(
      room,
      currM,
      period,
      config,
      meterLog ? Number(meterLog.special_items) || 0 : 0,
      meterLog?.special_items_note || meterLog?.note || '',
      Number(room.outstanding_balance) || 0,
      prevM,
      lf
    );
    setAmountStr(String(updatedBill.total_amount));
  };

  const amount = parseFloat(amountStr) || 0;
  const isOverpaid = amount > totalDue;
  const overpaidAmount = isOverpaid ? amount - totalDue : 0;

  const handleSubmit = async () => {
    if (amount <= 0 && totalDue > 0) {
      setErrorMessage('กรุณาระบุยอดเงินที่ชำระ');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // 1. Upsert meter_logs as paid (with paymentMethod and is_late_payment)
      const { error: logErr } = await supabase
        .from('meter_logs')
        .upsert(
          {
            period,
            room_no: room.room_no,
            prev_meter: billCalc.prev_meter,
            curr_meter: billCalc.curr_meter,
            units_used: billCalc.units_used,
            water_amount: billCalc.water_amount,
            wastewater_amount: billCalc.wastewater_amount,
            common_fee_amount: billCalc.common_fee,
            late_fee: currentLateFee,
            special_items: billCalc.special_items,
            special_items_note: billCalc.special_items_note || null,
            contribution_deducted: billCalc.contribution_deducted,
            prepaid_deducted: billCalc.prepaid_deducted,
            total_amount: billCalc.total_amount,
            is_paid: true,
            is_late_payment: isLatePayment,
            paid_type: paymentMethod,
            paid_timestamp: new Date().toISOString(),
            followup_status: 'none',
            recorded_at: meterLog?.recorded_at || new Date().toISOString(),
          },
          { onConflict: 'period,room_no' }
        );

      if (logErr) throw logErr;

      // 2. If overpaid, add excess to prepaid_credit
      if (isOverpaid && overpaidAmount > 0) {
        const newPrepaid = (Number(room.prepaid_credit) || 0) + overpaidAmount;
        await supabase
          .from('rooms')
          .update({
            prepaid_credit: newPrepaid,
            updated_at: new Date().toISOString(),
          })
          .eq('room_no', room.room_no);

        await supabase.from('wallet_ledger').insert({
          room_no: room.room_no,
          wallet_type: 'prepaid',
          entry_type: 'credit_in',
          amount: overpaidAmount,
          balance_after: newPrepaid,
          description_th: `ชำระบิลรอบ ${period} เกินยอด (${overpaidAmount} บาท) โอนเข้าเงินฝากล่วงหน้า`,
          description_en: `Overpayment on period ${period} credited to prepaid deposit`,
          created_by: 'admin',
        });
      }

      // 3. Record accounting transaction
      const invoiceNo = `${formatRoomNo(room.room_no)}-${period}`;
      const receiptNo = generateReceiptNo(invoiceNo, 1);

      await supabase.from('transactions').insert({
        fund_type: 'operating',
        type: 'รายรับ',
        category: 'รับชำระบิลค่าน้ำและค่าส่วนกลาง',
        amount: amount,
        tx_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
        room_no: room.room_no,
        payment_method: paymentMethod,
        note: `ห้อง ${formatRoomNo(room.room_no)} รอบบิล ${period} (ใบเสร็จ: ${receiptNo} • ${paymentMethod}${isLatePayment ? ' • ชำระล่าช้า' : ''}) ${note ? `[${note}]` : ''}`,
      });

      onPaymentSuccess(room.room_no);
      onClose();
    } catch (err: any) {
      console.error('Payment record error:', err);
      setErrorMessage('บันทึกการชำระเงินไม่สำเร็จ: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex justify-between items-center">
          <div>
            <h3 className="text-base font-bold text-sky-400">รับชำระเงิน — ห้อง {formatRoomNo(room.room_no)}</h3>
            <p className="text-xs text-slate-400">รอบบิล {period} • บันทึกและออกใบเสร็จรับเงิน</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg">
              {errorMessage}
            </div>
          )}

          {/* Due Summary with Separated Water (35) & Wastewater (5) */}
          <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl flex justify-between items-center">
            <div>
              <span className="text-slate-500 block text-[11px]">ยอดที่ต้องชำระตามบิล:</span>
              <span className="text-lg font-bold text-slate-800 font-mono">
                {totalDue.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
              </span>
            </div>
            <div className="text-right text-[11px] text-slate-600 space-y-0.5">
              <div>1. ค่าน้ำประปา (35 บ./น.): <b>{billCalc.water_amount.toLocaleString()} บ.</b></div>
              <div>2. ค่าบำบัดน้ำเสีย (5 บ./น.): <b>{billCalc.wastewater_amount.toLocaleString()} บ.</b></div>
              <div>3. ค่าส่วนกลาง: <b>{billCalc.common_fee.toLocaleString()} บ.</b></div>
            </div>
          </div>

          {/* Late Payment Status & Optional Late Fee */}
          <div className={`p-3 rounded-xl border space-y-2 ${isLatePayment ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
                <input
                  type="checkbox"
                  checked={isLatePayment}
                  onChange={(e) => setIsLatePayment(e.target.checked)}
                  className="rounded text-amber-600 w-4 h-4"
                />
                <span>⏰ บันทึกเป็นการชำระล่าช้า (เกินกำหนดวันที่ {dueDay})</span>
              </label>
            </div>
            {isLatePayment && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-amber-900 font-medium">เบี้ยปรับชำระล่าช้า (บาท - ถ้ามี):</span>
                <input
                  type="number"
                  step="any"
                  value={lateFeeStr}
                  onChange={(e) => handleLateFeeChange(e.target.value)}
                  className="w-28 border border-amber-400 rounded-lg px-2.5 py-1 bg-white font-mono font-bold text-right text-red-600"
                />
              </div>
            )}
          </div>

          {/* Amount Input */}
          <div>
            <label className="text-slate-700 font-bold block mb-1">ยอดเงินที่รับชำระจริง (บาท)</label>
            <input
              type="number"
              step="any"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full text-lg font-bold text-blue-700 font-mono border rounded-xl p-2.5 outline-none focus:ring-2 focus:ring-blue-500"
            />
            {isOverpaid && (
              <p className="text-emerald-700 mt-1 text-[11px] font-medium">
                ★ ยอดชำระเกิน {overpaidAmount.toLocaleString()} บาท จะถูกนำไปสะสมเป็น <b>เงินฝากล่วงหน้า</b> สำหรับหักบิลเดือนถัดไปอัตโนมัติ
              </p>
            )}
          </div>

          {/* Payment Method (Transfer or Cash Only — PromptPay removed as requested) */}
          <div>
            <label className="text-slate-700 font-bold block mb-1.5">วิธีการรับชำระเงิน (ระบุลงในใบเสร็จ)</label>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { id: 'โอนเงิน', label: '🏦 โอนเงินเข้าบัญชี' },
                { id: 'เงินสด', label: '💵 เงินสด' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id as 'โอนเงิน' | 'เงินสด')}
                  className={`py-2.5 px-2 text-center rounded-xl border font-bold transition ${
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
            <label className="text-slate-500 block mb-0.5">หมายเหตุเพิ่มเติมบนใบเสร็จ (ถ้ามี)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น โอนจากธนาคารกสิกรไทย เวลา 14:20 น."
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
            disabled={isSubmitting}
            onClick={handleSubmit}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md disabled:opacity-50"
          >
            {isSubmitting ? 'กำลังบันทึก...' : '🧾 บันทึกรับชำระ & ออกใบเสร็จ'}
          </button>
        </div>
      </div>
    </div>
  );
};
