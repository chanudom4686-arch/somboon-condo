'use client';

// Payment Recording Modal & Automatic Receipt Launcher with LINE Receipt Image Push
// Version 2.5 - Supports Suggested Late Fee Engine (50 THB/day + 2% compound), Generates Receipt Image & Pushes to LINE

import React, { useState, useRef } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo, generateReceiptNo, calculateBill, isPeriodPastDue, calculateSuggestedLateFee } from '@/utils/billing';
import { toPng } from 'html-to-image';

interface PaymentModalProps {
  room: Room;
  meterLog?: MeterLog | null;
  period: string;
  config: Partial<CondoConfig>;
  onClose: () => void;
  onPaymentSuccess: (paidRoomNo: string) => void;
  onOpenPrintReceipt?: (paidRoomNo: string) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  room,
  meterLog,
  period,
  config,
  onClose,
  onPaymentSuccess,
  onOpenPrintReceipt,
}) => {
  const supabase = createClient();
  const receiptRef = useRef<HTMLDivElement>(null);

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

  // Suggested Late Fee calculation
  const suggested = calculateSuggestedLateFee(
    room,
    period,
    config,
    totalDue - currentLateFee
  );

  const [amountStr, setAmountStr] = useState<string>(String(totalDue));
  const [paymentMethod, setPaymentMethod] = useState<'โอนเงิน' | 'เงินสด'>('โอนเงิน');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Success state for displaying receipt and pushing to LINE
  const [successReceipt, setSuccessReceipt] = useState<{
    receiptNo: string;
    paidAmount: number;
    paidTimestamp: string;
    paymentMethod: string;
  } | null>(null);
  const [isSendingLine, setIsSendingLine] = useState(false);
  const [lineSendSuccess, setLineSendSuccess] = useState<string | null>(null);
  const [lineSendError, setLineSendError] = useState<string | null>(null);

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
      const nowIso = new Date().toISOString();
      const invoiceNo = `${formatRoomNo(room.room_no)}-${period}`;
      const receiptNo = generateReceiptNo(invoiceNo, 1);

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
            paid_timestamp: nowIso,
            followup_status: 'none',
            recorded_at: meterLog?.recorded_at || nowIso,
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
            updated_at: nowIso,
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
      await supabase.from('transactions').insert({
        fund_type: 'operating',
        type: 'income',
        category: 'รับชำระบิลค่าน้ำและค่าส่วนกลาง',
        amount: amount,
        tx_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
        room_no: room.room_no,
        payment_method: paymentMethod,
        note: `ห้อง ${formatRoomNo(room.room_no)} รอบบิล ${period} (ใบเสร็จ: ${receiptNo} • ${paymentMethod}${isLatePayment ? ' • ชำระล่าช้า' : ''}) ${note ? `[${note}]` : ''}`,
      });

      // Show receipt view with option to push image to LINE
      setSuccessReceipt({
        receiptNo,
        paidAmount: amount,
        paidTimestamp: nowIso,
        paymentMethod,
      });

      onPaymentSuccess(room.room_no);
    } catch (err: any) {
      console.error('Payment record error:', err);
      setErrorMessage('บันทึกการชำระเงินไม่สำเร็จ: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Convert receipt DOM to PNG image, upload to Supabase Storage, and push to LINE
  const handleSendReceiptImageToLine = async () => {
    if (!receiptRef.current) return;
    setIsSendingLine(true);
    setLineSendSuccess(null);
    setLineSendError(null);

    try {
      // 1. Render DOM node to high-res PNG dataURL
      const dataUrl = await toPng(receiptRef.current, {
        cacheBust: true,
        quality: 0.95,
        backgroundColor: '#ffffff',
      });

      // 2. Convert to Blob
      const blobRes = await fetch(dataUrl);
      const blob = await blobRes.blob();

      // 3. Upload to Supabase Storage in bucket 'slips' under 'receipts/'
      const receiptNoClean = (successReceipt?.receiptNo || `rec-${room.room_no}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = `receipts/${receiptNoClean}_${Date.now()}.png`;

      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('slips')
        .upload(filePath, blob, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('slips').getPublicUrl(uploadData.path);
      const publicReceiptUrl = urlData.publicUrl;

      // 4. Update meter_logs.slip_url and mark followup_status as receipt_sent
      await supabase
        .from('meter_logs')
        .update({
          slip_url: publicReceiptUrl,
          followup_status: 'receipt_sent',
          followup_note: new Date().toISOString(),
        })
        .eq('period', period)
        .eq('room_no', room.room_no);

      // 5. Call LINE Push API
      const pushRes = await fetch('/api/line/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'receipt_image',
          roomNo: room.room_no,
          imageUrl: publicReceiptUrl,
          period,
          receiptText: `🧾 ใบเสร็จรับเงิน ห้อง ${formatRoomNo(room.room_no)} เลขที่ ${successReceipt?.receiptNo}\nรอบบิล: ${period}\nยอดชำระ: ${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท (${paymentMethod})\nขอบพระคุณที่ชำระเงินตรงเวลาครับ 🙏`,
        }),
      });

      const pushJson = await pushRes.json();
      if (!pushRes.ok) {
        throw new Error(pushJson.error || 'ส่งรูปใบเสร็จไปที่ LINE ไม่สำเร็จ');
      }

      setLineSendSuccess(`ส่งรูปใบเสร็จเข้า LINE ห้อง ${formatRoomNo(room.room_no)} เรียบร้อยแล้ว!`);
    } catch (err: any) {
      console.error('Send receipt image error:', err);
      setLineSendError(err.message || 'เกิดข้อผิดพลาดในการส่งรูปใบเสร็จ');
    } finally {
      setIsSendingLine(false);
    }
  };

  // ==========================================
  // VIEW: SUCCESS RECEIPT VIEW (AFTER PAYMENT)
  // ==========================================
  if (successReceipt) {
    return (
      <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 overflow-y-auto">
        <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col">
          {/* Top Bar */}
          <div className="bg-emerald-700 text-white px-5 py-3.5 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-xl">✅</span>
              <div>
                <h2 className="font-bold text-sm sm:text-base">บันทึกรับชำระเงินเรียบร้อยแล้ว</h2>
                <p className="text-xs text-emerald-150">เลขที่: {successReceipt.receiptNo}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white p-1 rounded-full text-lg leading-none"
            >
              ✕
            </button>
          </div>

          <div className="p-4 space-y-3.5">
            {/* Visual Receipt Node to capture as Image */}
            <div
              ref={receiptRef}
              className="bg-white border-2 border-slate-900 rounded-xl p-4 text-black text-xs space-y-2 shadow-xs"
            >
              {/* Receipt Header */}
              <div className="text-center border-b border-black pb-2">
                <div className="font-extrabold text-sm text-black">
                  {config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (645)'}
                </div>
                <div className="text-[11px] font-bold text-black mt-0.5">
                  ใบเสร็จรับเงิน / RECEIPT
                </div>
                <div className="text-[10px] text-neutral-600 font-mono mt-0.5">
                  เลขที่: {successReceipt.receiptNo} • รอบบิล: {period}
                </div>
              </div>

              {/* Room & Payer Info */}
              <div className="grid grid-cols-2 gap-2 text-[11px] py-1 border-b border-neutral-300">
                <div>
                  <span className="text-neutral-500 block text-[9.5px]">ห้องชุด / Room</span>
                  <span className="font-mono font-bold text-sm">{formatRoomNo(room.room_no)}</span>
                </div>
                <div className="text-right">
                  <span className="text-neutral-500 block text-[9.5px]">วันที่รับชำระ / Date</span>
                  <span className="font-mono font-semibold">
                    {new Date(successReceipt.paidTimestamp).toLocaleDateString('th-TH', {
                      timeZone: 'Asia/Bangkok',
                    })}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-500 block text-[9.5px]">เจ้าของร่วม / Name</span>
                  <span className="font-medium truncate block">
                    {room.owner_name || room.tenant_name || 'ท่านเจ้าของร่วม'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-neutral-500 block text-[9.5px]">วิธีชำระ / Method</span>
                  <span className="font-semibold">{successReceipt.paymentMethod}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-1 py-1 text-[10.5px]">
                <div className="flex justify-between py-0.5">
                  <span>1. ค่าน้ำประปา / Water Supply ({billCalc.units_used} units @ 35 ฿)</span>
                  <span className="font-mono font-semibold">{billCalc.water_amount.toLocaleString()} ฿</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>2. ค่าบำบัดน้ำเสีย / Wastewater ({billCalc.units_used} units @ 5 ฿)</span>
                  <span className="font-mono font-semibold">{billCalc.wastewater_amount.toLocaleString()} ฿</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>3. ค่าส่วนกลาง / Common Area Fee</span>
                  <span className="font-mono font-semibold">{billCalc.common_fee.toLocaleString()} ฿</span>
                </div>
                {billCalc.late_fee > 0 && (
                  <div className="flex justify-between py-0.5 text-rose-700 font-semibold">
                    <span>4. เบี้ยปรับชำระล่าช้า / Late Fee</span>
                    <span className="font-mono">+{billCalc.late_fee.toLocaleString()} ฿</span>
                  </div>
                )}
                {billCalc.special_items !== 0 && (
                  <div className="flex justify-between py-0.5">
                    <span>5. รายการพิเศษ / Extra Items ({billCalc.special_items_note || '-'})</span>
                    <span className="font-mono font-semibold">
                      {billCalc.special_items > 0 ? '+' : ''}{billCalc.special_items.toLocaleString()} ฿
                    </span>
                  </div>
                )}
                {billCalc.contribution_deducted > 0 && (
                  <div className="flex justify-between py-0.5 text-blue-700">
                    <span>• หักเครดิตสมทบทุน / Fund Credit</span>
                    <span className="font-mono">-{billCalc.contribution_deducted.toLocaleString()} ฿</span>
                  </div>
                )}
                {billCalc.prepaid_deducted > 0 && (
                  <div className="flex justify-between py-0.5 text-emerald-700">
                    <span>• หักเงินฝากล่วงหน้า / Prepaid Deposit</span>
                    <span className="font-mono">-{billCalc.prepaid_deducted.toLocaleString()} ฿</span>
                  </div>
                )}
                {billCalc.outstanding_balance > 0 && (
                  <div className="flex justify-between py-0.5 text-amber-800">
                    <span>• ยอดค้างชำระยกมา / Outstanding Balance</span>
                    <span className="font-mono">+{billCalc.outstanding_balance.toLocaleString()} ฿</span>
                  </div>
                )}
              </div>

              {/* Total Row */}
              <div className="border-t-2 border-black pt-1.5 flex justify-between items-center text-sm font-extrabold">
                <span>ยอดเงินที่รับชำระทั้งสิ้น / TOTAL RECEIVED</span>
                <span className="font-mono text-emerald-800">
                  {successReceipt.paidAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท (THB)
                </span>
              </div>

              {/* Receipt Footer */}
              <div className="text-[9.5px] text-center text-neutral-500 pt-1 border-t border-neutral-300">
                ออกโดย: ระบบบริหารจัดการคอนโดมิเนียม • สมบูรณ์คอนโดทาวน์ (645) / Somboon Condo Town
              </div>
            </div>

            {/* Notification messages */}
            {lineSendSuccess && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl text-xs font-bold text-center">
                ✅ {lineSendSuccess}
              </div>
            )}
            {lineSendError && (
              <div className="p-2.5 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-medium text-center">
                ⚠️ {lineSendError}
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={isSendingLine}
                onClick={handleSendReceiptImageToLine}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                <span>📲</span>
                <span>{isSendingLine ? 'กำลังสร้างรูปและส่ง LINE...' : 'ส่งรูปใบเสร็จไปที่ LINE ลูกบ้าน'}</span>
              </button>

              {onOpenPrintReceipt && (
                <button
                  type="button"
                  onClick={() => onOpenPrintReceipt(room.room_no)}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-xs flex items-center justify-center gap-2 transition"
                >
                  <span>🖨️</span>
                  <span>พิมพ์ใบเสร็จ A4 (RECEIPT)</span>
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
              >
                เสร็จสิ้น / ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: PAYMENT RECORDING FORM
  // ==========================================
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex justify-between items-center">
          <div>
            <h2 className="font-bold text-sm sm:text-base">💰 บันทึกรับชำระเงิน & ออกใบเสร็จ</h2>
            <p className="text-xs text-slate-400">
              ห้อง {formatRoomNo(room.room_no)} • รอบบิล {period}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-full text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3.5 text-xs">
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-2.5 rounded-xl text-xs font-medium">
              {errorMessage}
            </div>
          )}

          {/* Room Summary Header Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex justify-between items-center">
            <div>
              <span className="text-slate-500 block text-[10px]">เจ้าของห้อง / ผู้เช่า</span>
              <span className="font-bold text-slate-800 text-sm">
                {room.owner_name || room.tenant_name || 'ท่านเจ้าของร่วม'}
              </span>
              <span className="text-[10px] text-slate-500 block font-mono">
                เบอร์: {room.owner_phone || room.tenant_phone || '-'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-500 block text-[10px]">ยอดที่ต้องชำระตามบิล</span>
              <span className="text-base font-extrabold text-blue-700 font-mono">
                {totalDue.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
              </span>
            </div>
          </div>

          {/* Late Payment & Suggested Late Fee Section */}
          <div className="bg-amber-50/70 border border-amber-300 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
                <input
                  type="checkbox"
                  checked={isLatePayment}
                  onChange={(e) => setIsLatePayment(e.target.checked)}
                  className="rounded text-amber-600 w-4 h-4"
                />
                <span>⏰ ชำระล่าช้า (เกินกำหนดวันที่ {dueDay})</span>
              </label>
            </div>

            {/* Suggested Late Fee Recommendation Box */}
            {suggested.totalSuggestedLateFee > 0 && (
              <div className="bg-white border border-amber-400 rounded-lg p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-amber-950 flex items-center gap-1">
                    <span>💡</span> ค่าปรับที่แนะนำตามเกณฑ์:{' '}
                    <b className="font-mono text-rose-700 text-xs">
                      {suggested.totalSuggestedLateFee.toLocaleString()} บาท
                    </b>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleLateFeeChange(String(suggested.totalSuggestedLateFee))}
                    className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-bold shadow-xs transition"
                  >
                    นำยอดนี้ไปใช้
                  </button>
                </div>
                <p className="text-[9.5px] text-amber-800 font-mono">
                  สูตร: {suggested.formulaExplanation}
                </p>
              </div>
            )}

            {isLatePayment && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-amber-900 font-medium">เบี้ยปรับชำระล่าช้า (บาท):</span>
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

          {/* Payment Method */}
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