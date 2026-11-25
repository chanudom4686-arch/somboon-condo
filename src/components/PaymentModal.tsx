'use client';

// Payment Recording Modal & Receipt Generator
// Version 1.5 - Explicitly separates Water (35 THB/unit) and Wastewater (5 THB/unit)

import React, { useState } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo, generateReceiptNo } from '@/utils/billing';

interface PaymentModalProps {
  room: Room;
  meterLog?: MeterLog | null;
  period: string;
  config: Partial<CondoConfig>;
  onClose: () => void;
  onPaymentSuccess: () => void;
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
  const totalDue = meterLog ? Number(meterLog.total_amount) || 0 : (Number(room.outstanding_balance) || 0);

  const [amountStr, setAmountStr] = useState<string>(String(totalDue));
  const [paymentMethod, setPaymentMethod] = useState<'transfer' | 'promptpay' | 'cash'>('promptpay');
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const amount = parseFloat(amountStr) || 0;
  const isOverpaid = amount > totalDue;
  const overpaidAmount = isOverpaid ? amount - totalDue : 0;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSlipFile(file);
      setSlipPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async () => {
    if (amount <= 0) {
      setErrorMessage('กรุณาระบุยอดเงินที่ชำระ');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      let slipUrl: string | null = null;

      if (slipFile) {
        const fileName = `${period}/${room.room_no}_slip_${Date.now()}.jpg`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('slips')
          .upload(fileName, slipFile, { upsert: true });

        if (!uploadErr && uploadData) {
          const { data: urlData } = supabase.storage.from('slips').getPublicUrl(uploadData.path);
          slipUrl = urlData.publicUrl;
        }
      }

      if (meterLog) {
        await supabase
          .from('meter_logs')
          .update({
            is_paid: true,
            paid_type: paymentMethod,
            paid_timestamp: new Date().toISOString(),
            slip_url: slipUrl || meterLog.slip_url,
            followup_status: 'none',
          })
          .eq('id', meterLog.id);
      }

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

      const invoiceNo = `${formatRoomNo(room.room_no)}-${period}`;
      const receiptNo = generateReceiptNo(invoiceNo, 1);

      await supabase.from('transactions').insert({
        fund_type: 'operating',
        type: 'รายรับ',
        category: 'รับชำระบิลค่าน้ำและค่าส่วนกลาง',
        amount: amount,
        tx_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
        room_no: room.room_no,
        payment_method: paymentMethod === 'promptpay' ? 'พร้อมเพย์' : paymentMethod === 'transfer' ? 'โอนเงิน' : 'เงินสด',
        slip_url: slipUrl,
        note: `ห้อง ${formatRoomNo(room.room_no)} รอบบิล ${period} (ใบเสร็จ: ${receiptNo}) ${note ? `[${note}]` : ''}`,
      });

      onPaymentSuccess();
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
            <p className="text-xs text-slate-400">รอบบิล {period}</p>
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
            {meterLog && (
              <div className="text-right text-[11px] text-slate-600 space-y-0.5">
                <div>1. ค่าน้ำประปา (35 บ./น.): <b>{Number(meterLog.water_amount).toLocaleString()} บ.</b></div>
                <div>2. ค่าบำบัดน้ำเสีย (5 บ./น.): <b>{Number(meterLog.wastewater_amount).toLocaleString()} บ.</b></div>
                <div>3. ค่าส่วนกลาง: <b>{Number(meterLog.common_fee_amount).toLocaleString()} บ.</b></div>
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

          {/* Payment Method */}
          <div>
            <label className="text-slate-700 font-bold block mb-1.5">ช่องทางชำระเงิน</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'promptpay', label: '📱 พร้อมเพย์' },
                { id: 'transfer', label: '🏦 โอนเงิน' },
                { id: 'cash', label: '💵 เงินสด' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id as any)}
                  className={`py-2 px-1 text-center rounded-lg border font-medium ${
                    paymentMethod === m.id
                      ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Slip Attachment */}
          <div>
            <label className="text-slate-700 font-bold block mb-1">แนบรูปสลิป / หลักฐานการโอน (เก็บใน Supabase Storage)</label>
            {slipPreview ? (
              <div className="relative aspect-video rounded-lg overflow-hidden border bg-slate-100 flex items-center justify-center">
                <img src={slipPreview} alt="Slip" className="w-full h-full object-contain" />
                <button
                  type="button"
                  onClick={() => {
                    setSlipFile(null);
                    setSlipPreview(null);
                  }}
                  className="absolute top-2 right-2 bg-black/60 text-white rounded-full px-2 py-1 text-[10px]"
                >
                  ลบรูป
                </button>
              </div>
            ) : (
              <label className="border-2 border-dashed border-slate-300 hover:border-blue-400 p-3 rounded-xl flex flex-col items-center justify-center cursor-pointer bg-slate-50 text-slate-500">
                <span>📎 กดเพื่อเลือกรูปสลิป</span>
                <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
              </label>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="text-slate-500 block mb-0.5">หมายเหตุ</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น โอนจาก SCB เวลา 14:20 น."
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
            {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันรับชำระเงิน'}
          </button>
        </div>
      </div>
    </div>
  );
};
