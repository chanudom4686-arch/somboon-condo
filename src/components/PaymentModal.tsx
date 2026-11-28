'use client';

// Payment Recording Modal & Automatic Receipt Launcher with LINE Receipt Image Push
// Version 2.5 - Supports Suggested Late Fee Engine (50 THB/day + 2% compound), Generates Receipt Image & Pushes to LINE

import React, { useState, useRef } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo, generateReceiptNo, calculateBill, isPeriodPastDue, calculateSuggestedLateFee, getPrintableCustomItems } from '@/utils/billing';
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
      // 1. Render DOM node to high-res PNG dataURL (Retina 2.5x for crystal-clear mobile viewing)
      const dataUrl = await toPng(receiptRef.current, {
        cacheBust: true,
        pixelRatio: 2.5,
        quality: 1,
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
        <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto">
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

          <div className="p-4 space-y-3.5 overflow-x-auto">
            {/* Visual Receipt Node to capture as Image (Official Web Layout, High DPI) */}
            {(() => {
              const customLineItems = getPrintableCustomItems(billCalc.special_items_note, billCalc.special_items);
              const paidDateStr = new Date(successReceipt.paidTimestamp).toLocaleDateString('th-TH', {
                timeZone: 'Asia/Bangkok',
              });

              return (
                <div
                  ref={receiptRef}
                  style={{ width: '540px' }}
                  className="bg-white border-2 border-black rounded-lg p-5 text-black text-xs space-y-2.5 shadow-sm mx-auto"
                >
                  {/* Header (Matching Official Web Printout) */}
                  <div className="flex justify-between items-start border-b-2 border-black pb-2 mb-2">
                    <div>
                      <div className="font-bold text-base text-black">{config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (674)'}</div>
                      <div className="text-[12px] font-bold text-black mt-0.5">
                        ใบเสร็จรับเงิน / RECEIPT
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-extrabold text-black text-base border-2 border-black px-2.5 py-0.5 rounded bg-neutral-100 inline-block font-mono">
                        ห้อง / Room {formatRoomNo(room.room_no)}
                      </div>
                      <div className="text-[11px] text-neutral-800 mt-1 font-mono">
                        เลขที่ / No: {successReceipt.receiptNo}
                      </div>
                    </div>
                  </div>

                  {/* Period & Paid Date */}
                  <div className="flex justify-between border border-black bg-neutral-100 px-3 py-1.5 rounded mb-2 text-xs text-black">
                    <div>
                      <span>รอบบิล / Period: </span>
                      <span className="font-bold">{period}</span>
                    </div>
                    <div>
                      <span>วันที่ชำระ / Paid Date: </span>
                      <span className="font-bold underline">{paidDateStr}</span>
                    </div>
                  </div>

                  {/* Meter Info Box */}
                  <div className="border border-black rounded p-2 mb-2 bg-white text-xs text-black">
                    <div className="flex justify-between items-center">
                      <span>
                        เลขมิเตอร์น้ำ / Meter: <b>{billCalc.prev_meter} ➔ {billCalc.curr_meter}</b>
                      </span>
                      <span className="font-bold">ใช้น้ำ / Used: {billCalc.units_used} หน่วย (Units)</span>
                    </div>
                  </div>

                  {/* Calculation Breakdown Table */}
                  <table className="w-full text-xs mb-2 text-black border-collapse">
                    <tbody>
                      <tr className="border-b border-neutral-300">
                        <td className="py-1">1. ค่าน้ำประปา / Water Supply ({billCalc.units_used} Units × {billCalc.water_rate} ฿)</td>
                        <td className="text-right font-mono font-medium">{billCalc.water_amount.toFixed(2)}</td>
                      </tr>
                      <tr className="border-b border-neutral-300">
                        <td className="py-1">2. ค่าบำบัดน้ำเสีย / Wastewater ({billCalc.units_used} Units × {billCalc.wastewater_rate} ฿)</td>
                        <td className="text-right font-mono font-medium">{billCalc.wastewater_amount.toFixed(2)}</td>
                      </tr>
                      <tr className="border-b border-neutral-300">
                        <td className="py-1">3. ค่าส่วนกลาง / Common Area Fee</td>
                        <td className="text-right font-mono font-medium">{billCalc.common_fee.toFixed(2)}</td>
                      </tr>
                      {customLineItems.map((cItem, cIdx) => (
                        <tr key={cIdx} className="border-b border-neutral-300 font-semibold">
                          <td className="py-1">{cIdx + 4}. {cItem.label}</td>
                          <td className="text-right font-mono">{cItem.amount > 0 ? `+${cItem.amount.toFixed(2)}` : cItem.amount.toFixed(2)}</td>
                        </tr>
                      ))}
                      {billCalc.late_fee > 0 && (
                        <tr className="border-b border-neutral-300 font-semibold text-rose-800">
                          <td className="py-1">เบี้ยปรับชำระล่าช้า / Late Payment Fee</td>
                          <td className="text-right font-mono">+{billCalc.late_fee.toFixed(2)}</td>
                        </tr>
                      )}
                      {billCalc.contribution_deducted > 0 && (
                        <tr className="border-b border-neutral-300 font-semibold text-blue-800">
                          <td className="py-1">★ หักเครดิตสมทบทุน / Fund Credit</td>
                          <td className="text-right font-mono">-{billCalc.contribution_deducted.toFixed(2)}</td>
                        </tr>
                      )}
                      {billCalc.prepaid_deducted > 0 && (
                        <tr className="border-b border-neutral-300 font-semibold text-emerald-800">
                          <td className="py-1">★ หักเงินฝากล่วงหน้า / Prepaid Deposit</td>
                          <td className="text-right font-mono">-{billCalc.prepaid_deducted.toFixed(2)}</td>
                        </tr>
                      )}
                      {billCalc.outstanding_balance > 0 && (
                        <tr className="border-b border-neutral-300 font-bold text-amber-900">
                          <td className="py-1">ค้างชำระยกมา / Outstanding Balance</td>
                          <td className="text-right font-mono">+{billCalc.outstanding_balance.toFixed(2)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {/* Total Received Box */}
                  <div className="border-2 border-black bg-neutral-100 text-black p-2.5 rounded flex justify-between items-center mb-2">
                    <div>
                      <div className="text-xs font-bold text-black">ยอดรับชำระสุทธิ</div>
                      <div className="text-[10px] font-semibold text-neutral-700">TOTAL RECEIVED</div>
                    </div>
                    <div className="text-right">
                      <span className="text-xl font-extrabold text-black font-mono">
                        {successReceipt.paidAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-xs font-bold text-black ml-1.5">บาท/THB</span>
                    </div>
                  </div>

                  {/* Paid Status & Signature */}
                  <div className="bg-white border border-black p-2.5 rounded text-xs text-black flex justify-between items-center">
                    <div className="space-y-1">
                      <div className="font-bold text-black">
                        ✓ ได้รับชำระเงินเรียบร้อยแล้ว / Paid Successfully {isLatePayment ? '(ชำระล่าช้า / Late)' : '(ตรงตามกำหนด / On Time)'}
                      </div>
                      <div className="text-neutral-800">
                        รับชำระโดย / Paid by: <b className="underline">{successReceipt.paymentMethod}</b>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-neutral-700">ผู้รับเงิน / Authorized Signature</div>
                      <div className="font-bold text-black mt-1.5">________________</div>
                    </div>
                  </div>

                  {/* Notes / Footer */}
                  <div className="mt-1 text-[11px] text-black text-center border-t border-neutral-300 pt-1">
                    <div>{config.RECEIPT_FOOTER_TEXT || 'ออกแบบใบเสร็จรับเงิน ออกโดย วชิรดา'}</div>
                  </div>
                </div>
              );
            })()}

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