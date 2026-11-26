'use client';

// Expense & Accounting Entry Modal
// Version 1.9 - Fixed transactions_type_check constraint ('expense') & Bangkok timezone date

import React, { useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface ExpenseModalProps {
  onClose: () => void;
  onSuccess: () => void;
  currentPeriod?: string;
}

export const ExpenseModal: React.FC<ExpenseModalProps> = ({ onClose, onSuccess, currentPeriod }) => {
  const supabase = createClient();

  const [fundType, setFundType] = useState<'operating' | 'maintenance_fund'>('operating');
  const [category, setCategory] = useState<string>('ค่าน้ำประปา (จ่ายการประปา)');
  const [amountStr, setAmountStr] = useState<string>('');
  const [txDate, setTxDate] = useState<string>(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  );
  const [billingPeriod, setBillingPeriod] = useState<string>(
    currentPeriod || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7)
  );
  const [paymentMethod, setPaymentMethod] = useState<string>('โอนเงิน');
  const [isPaid, setIsPaid] = useState<boolean>(true);
  const [note, setNote] = useState<string>('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const categories = fundType === 'operating'
    ? [
        'ค่าน้ำประปา (จ่ายการประปา)',
        'ค่าไฟส่วนกลาง',
        'เงินเดือนพนักงาน',
        'ค่ารักษาความปลอดภัย (รปภ.)',
        'ค่าทำความสะอาด',
        'ค่าเก็บขยะ',
        'ค่าซ่อมบำรุงทั่วไป',
        'ค่าธรรมเนียมธนาคาร',
        'อื่นๆ',
      ]
    : [
        'ค่าซ่อมบำรุงใหญ่ (ดาดฟ้า/ผนัง)',
        'ค่าซ่อมลิฟต์',
        'ค่าทาสีอาคาร',
        'ค่าเปลี่ยนระบบท่อน้ำส่วนกลาง',
        'ค่าอุปกรณ์ความปลอดภัย/ถังดับเพลิง',
        'ค่าซ่อมปั๊มน้ำอาคาร',
        'อื่นๆ',
      ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) {
      setErrorMessage('กรุณาระบุจำนวนเงินที่ถูกต้อง');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      let receiptUrl: string | null = null;

      if (receiptFile) {
        const fileName = `expenses/${Date.now()}_${receiptFile.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('slips')
          .upload(fileName, receiptFile, { upsert: true });

        if (!uploadErr && uploadData) {
          const { data: urlData } = supabase.storage.from('slips').getPublicUrl(uploadData.path);
          receiptUrl = urlData.publicUrl;
        }
      }

      const { error: txErr } = await supabase.from('transactions').insert({
        fund_type: fundType,
        type: 'expense',
        category,
        amount,
        tx_date: txDate,
        billing_period: billingPeriod,
        payment_method: paymentMethod,
        slip_url: receiptUrl,
        note: note || category,
        is_paid: isPaid,
      });

      if (txErr) throw txErr;

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Expense insert error:', err);
      setErrorMessage('บันทึกรายจ่ายไม่สำเร็จ: ' + err.message);
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
            <h3 className="text-base font-bold text-sky-400">บันทึกรายจ่ายคอนโด</h3>
            <p className="text-xs text-slate-400">ระบุประเภทกองทุนและหมวดหมู่รายจ่าย</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center">
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs">
          {errorMessage && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg">
              {errorMessage}
            </div>
          )}

          {/* Fund Selection */}
          <div>
            <label className="text-slate-700 font-bold block mb-1">กองทุนที่ใช้จ่าย</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setFundType('operating');
                  setCategory('ค่าน้ำประปา (จ่ายการประปา)');
                }}
                className={`py-2 px-2 text-center rounded-lg border font-medium ${
                  fundType === 'operating'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                🏢 กองทุนดำเนินงานปกติ
              </button>
              <button
                type="button"
                onClick={() => {
                  setFundType('maintenance_fund');
                  setCategory('ค่าซ่อมบำรุงใหญ่ (ดาดฟ้า/ผนัง)');
                }}
                className={`py-2 px-2 text-center rounded-lg border font-medium ${
                  fundType === 'maintenance_fund'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700 font-bold'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                🛠️ กองทุนซ่อมบำรุงตึก
              </button>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="text-slate-700 font-bold block mb-1">หมวดหมู่รายจ่าย</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border rounded-lg p-2 bg-white"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Amount & Date */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-slate-700 font-bold block mb-1">จำนวนเงิน (บาท) *</label>
              <input
                type="number"
                step="any"
                required
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.00"
                className="w-full border rounded-lg p-2 font-bold text-red-600 font-mono"
              />
            </div>
            <div>
              <label className="text-slate-700 font-bold block mb-1">วันที่จ่าย</label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => {
                  setTxDate(e.target.value);
                }}
                className="w-full border rounded-lg p-2"
              />
            </div>
          </div>

          {/* Billing Period Allocation */}
          <div className="bg-sky-50/70 p-2.5 rounded-xl border border-sky-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sky-950 font-bold block text-xs">
                📅 บันทึกเข้างวด / ประจำรอบบิล
              </label>
              <span className="text-[10px] text-sky-800 font-mono font-bold bg-white px-2 py-0.5 rounded border border-sky-200">
                งวด {billingPeriod}
              </span>
            </div>
            <p className="text-[10px] text-sky-800 leading-tight">
              💡 เลือกรอบบิลที่ต้องการให้รายการนี้ไปปรากฏ (เช่น จ่ายค่าไฟวันที่ 27 พ.ย. แต่เป็นของรอบบิลเดือน 12)
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <input
                  type="month"
                  value={billingPeriod}
                  onChange={(e) => setBillingPeriod(e.target.value)}
                  className="w-full border border-sky-300 rounded-lg p-1.5 bg-white font-mono font-bold text-sky-900"
                />
              </div>
              <div className="flex items-center gap-1">
                {currentPeriod && (
                  <button
                    type="button"
                    onClick={() => setBillingPeriod(currentPeriod)}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[10.5px] font-bold border transition ${
                      billingPeriod === currentPeriod
                        ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                        : 'bg-white text-sky-800 border-sky-200 hover:bg-sky-100'
                    }`}
                    title="เลือกรอบบิลปัจจุบัน"
                  >
                    รอบปัจจุบัน ({currentPeriod})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBillingPeriod(txDate.slice(0, 7))}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[10.5px] font-bold border transition ${
                    billingPeriod === txDate.slice(0, 7) && billingPeriod !== currentPeriod
                      ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                  title="เลือกรอบบิลตามวันที่จ่ายจริง"
                >
                  ตามวันจ่าย ({txDate.slice(0, 7)})
                </button>
              </div>
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="text-slate-700 font-bold block mb-1">วิธีชำระเงิน</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full border rounded-lg p-2 bg-white"
            >
              <option value="โอนเงิน">โอนเงินผ่านบัญชีธนาคาร</option>
              <option value="พร้อมเพย์">พร้อมเพย์</option>
              <option value="เงินสด">เงินสด</option>
              <option value="เช็ค">เช็คสั่งจ่าย</option>
            </select>
          </div>

          {/* Payment Status (ชำระแล้ว / ยังไม่ชำระ) */}
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
            <label className="text-slate-800 font-bold block mb-1.5">สถานะการชำระเงิน</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsPaid(true)}
                className={`py-2 px-3 rounded-lg border font-bold flex items-center justify-center gap-1.5 transition ${
                  isPaid
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <span>✅ ชำระแล้ว (Paid)</span>
              </button>
              <button
                type="button"
                onClick={() => setIsPaid(false)}
                className={`py-2 px-3 rounded-lg border font-bold flex items-center justify-center gap-1.5 transition ${
                  !isPaid
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <span>⏳ ยังไม่ชำระ (Unpaid)</span>
              </button>
            </div>
            {!isPaid && (
              <p className="text-[10px] text-amber-700 mt-1.5">
                * รายการนี้จะถูกบันทึกเป็นหนี้ค้างจ่าย และสามารถคลิกเปลี่ยนเป็น &quot;ชำระแล้ว&quot; ได้ในภายหลังเมื่อจ่ายเงินเสร็จสิ้น
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="text-slate-700 font-bold block mb-1">รายละเอียด / ผู้รับเงิน / หมายเหตุ</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น จ่ายค่าไฟส่วนกลาง บิล กฟภ. ประจำเดือน พ.ย. 69"
              rows={2}
              className="w-full border rounded-lg p-2"
            />
          </div>

          {/* File Attachment */}
          <div>
            <label className="text-slate-700 font-bold block mb-1">แนบรูปใบเสร็จ / บิลค่าใช้จ่าย (ถ้ามี)</label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
            />
          </div>

          {/* Footer buttons */}
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-slate-300 text-slate-700 font-medium rounded-xl text-xs hover:bg-slate-100"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs shadow-md disabled:opacity-50"
            >
              {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกรายจ่าย'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
