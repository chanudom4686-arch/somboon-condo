'use client';

// Batch Receipt Image Generator & LINE Push Modal
// Version 2.7 - Supports Smart Unsent-only Filtering, Bilingual Receipt Image Generation & Real-time Progress Tracking

import React, { useState, useRef } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { formatRoomNo, calculateBill, generateReceiptNo, getPrintableCustomItems } from '@/utils/billing';
import { createClient } from '@/utils/supabase/client';
import { toPng } from 'html-to-image';

interface BatchReceiptSendModalProps {
  rooms: Room[];
  logMap: Record<string, MeterLog>;
  config: Partial<CondoConfig>;
  period: string;
  initialFilterMode?: 'unsent' | 'all';
  preselectedRoomNos?: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export const BatchReceiptSendModal: React.FC<BatchReceiptSendModalProps> = ({
  rooms,
  logMap,
  config,
  period,
  initialFilterMode = 'unsent',
  preselectedRoomNos,
  onClose,
  onSuccess,
}) => {
  const supabase = createClient();
  const hiddenReceiptRef = useRef<HTMLDivElement>(null);

  const condoName = config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (674)';

  // All paid rooms
  const paidRooms = rooms.filter((r) => !!logMap[r.room_no]?.is_paid);

  // Filter mode inside modal: 'unsent' (only paid rooms without receipt sent) or 'all'
  const [filterMode, setFilterMode] = useState<'unsent' | 'all'>(initialFilterMode);

  const isRoomReceiptSent = (roomNo: string) => {
    const log = logMap[roomNo];
    if (!log) return false;
    return log.followup_status === 'receipt_sent' || (!!log.slip_url && log.slip_url.includes('receipt'));
  };

  // Eligible rooms based on filter
  const displayedRooms = paidRooms.filter((r) => {
    if (filterMode === 'unsent') {
      return !isRoomReceiptSent(r.room_no);
    }
    return true;
  });

  // Selected room numbers to send
  const [selectedRoomNos, setSelectedRoomNos] = useState<string[]>(() => {
    if (preselectedRoomNos && preselectedRoomNos.length > 0) {
      return preselectedRoomNos;
    }
    // By default, select all displayed rooms that HAVE line_user_id
    return displayedRooms.filter((r) => !!r.line_user_id).map((r) => r.room_no);
  });

  // Sending state & progress
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentRoom: string } | null>(null);
  const [sendLogs, setSendLogs] = useState<Array<{ roomNo: string; success: boolean; message: string }>>([]);
  const [isFinished, setIsFinished] = useState(false);

  // Active room currently rendering in hidden receipt DOM
  const [renderRoom, setRenderRoom] = useState<Room | null>(null);

  const toggleRoom = (roomNo: string) => {
    setSelectedRoomNos((prev) =>
      prev.includes(roomNo) ? prev.filter((r) => r !== roomNo) : [...prev, roomNo]
    );
  };

  const selectAll = () => {
    const validRooms = displayedRooms.filter((r) => !!r.line_user_id).map((r) => r.room_no);
    setSelectedRoomNos(validRooms);
  };

  const deselectAll = () => {
    setSelectedRoomNos([]);
  };

  const handleStartBatchSend = async () => {
    if (selectedRoomNos.length === 0) {
      alert('กรุณาเลือกห้องชุดที่ต้องการส่งรูปใบเสร็จอย่างน้อย 1 ห้อง');
      return;
    }

    setIsSending(true);
    setIsFinished(false);
    setSendLogs([]);

    const roomsToSend = rooms.filter((r) => selectedRoomNos.includes(r.room_no));
    const results: Array<{ roomNo: string; success: boolean; message: string }> = [];

    for (let i = 0; i < roomsToSend.length; i++) {
      const targetRoom = roomsToSend[i];
      setProgress({
        current: i + 1,
        total: roomsToSend.length,
        currentRoom: formatRoomNo(targetRoom.room_no),
      });

      try {
        if (!targetRoom.line_user_id) {
          throw new Error('ห้องนี้ยังไม่ได้ลงทะเบียน LINE หรือไม่มี LINE User ID');
        }

        const log = logMap[targetRoom.room_no];
        const prevM = log ? Number(log.prev_meter) : Number(targetRoom.latest_meter) || 0;
        const currM = log ? Number(log.curr_meter) : prevM;
        const bill = calculateBill(
          targetRoom,
          currM,
          period,
          config,
          log ? Number(log.special_items) || 0 : 0,
          log?.special_items_note || '',
          Number(targetRoom.outstanding_balance) || 0,
          prevM,
          log ? Number(log.late_fee) || 0 : 0
        );

        const receiptNo = generateReceiptNo(bill.invoice_no, 1);
        const paidMethod =
          log?.paid_type === 'cash' || log?.paid_type === 'เงินสด'
            ? 'เงินสด (Cash)'
            : 'โอนเงินเข้าบัญชีธนาคาร (Bank Transfer)';

        // 1. Set renderRoom to update hidden receipt DOM
        setRenderRoom(targetRoom);
        // Wait 100ms for React DOM to paint
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (!hiddenReceiptRef.current) {
          throw new Error('Receipt DOM element not ready');
        }

        // 2. Render DOM to PNG dataUrl (Retina 2.5x for crystal-clear mobile viewing)
        const dataUrl = await toPng(hiddenReceiptRef.current, {
          cacheBust: true,
          pixelRatio: 2.5,
          quality: 1,
          backgroundColor: '#ffffff',
        });

        const blobRes = await fetch(dataUrl);
        const blob = await blobRes.blob();

        // 3. Upload to Supabase Storage
        const receiptNoClean = receiptNo.replace(/[^a-zA-Z0-9_-]/g, '_');
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

        // 4. Update meter_logs with slip_url and followup_status: 'receipt_sent'
        await supabase
          .from('meter_logs')
          .update({
            slip_url: publicReceiptUrl,
            followup_status: 'receipt_sent',
            followup_note: new Date().toISOString(),
          })
          .eq('period', period)
          .eq('room_no', targetRoom.room_no);

        // 5. Call LINE Push API
        const pushRes = await fetch('/api/line/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'receipt_image',
            roomNo: targetRoom.room_no,
            imageUrl: publicReceiptUrl,
            period,
            receiptText: `🧾 ใบเสร็จรับเงิน ห้อง ${formatRoomNo(targetRoom.room_no)} เลขที่ ${receiptNo}\nรอบบิล / Period: ${period}\nยอดชำระ / Amount: ${bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท (${paidMethod})\nขอบพระคุณที่ชำระเงินตรงเวลาครับ 🙏`,
          }),
        });

        const pushJson = await pushRes.json();
        if (!pushRes.ok) throw new Error(pushJson.error || 'ส่ง LINE ไม่สำเร็จ');

        results.push({
          roomNo: targetRoom.room_no,
          success: true,
          message: `ส่งรูปใบเสร็จเข้า LINE สำเร็จ`,
        });
      } catch (err: any) {
        console.error(`Batch send receipt error for room ${targetRoom.room_no}:`, err);
        results.push({
          roomNo: targetRoom.room_no,
          success: false,
          message: err.message || 'เกิดข้อผิดพลาดในการส่ง',
        });
      }

      setSendLogs([...results]);
    }

    setIsSending(false);
    setIsFinished(true);
    onSuccess();
  };

  const successCount = sendLogs.filter((l) => l.success).length;
  const failCount = sendLogs.filter((l) => !l.success).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl">📲</span>
            <div>
              <h2 className="font-bold text-sm sm:text-base">ส่งรูปใบเสร็จรับเงินเข้า LINE ลูกบ้าน (รอบบิล {period})</h2>
              <p className="text-xs text-slate-400">
                ระบบสร้างรูปใบเสร็จ PNG สองภาษา 2 ภาษา อัตโนมัติและส่งตรงเข้าแชทลูกบ้าน
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSending}
            className="text-slate-400 hover:text-white p-1 rounded-full text-lg leading-none disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-3.5 text-xs flex-1">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={isSending}
                onClick={() => {
                  setFilterMode('unsent');
                  const unsentRooms = paidRooms.filter((r) => !isRoomReceiptSent(r.room_no) && !!r.line_user_id);
                  setSelectedRoomNos(unsentRooms.map((r) => r.room_no));
                }}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 ${
                  filterMode === 'unsent'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>⚠️ เฉพาะห้องที่ยังไม่ส่ง</span>
                <span className="bg-white/20 px-1.5 py-0.2 rounded-full text-[10px]">
                  {paidRooms.filter((r) => !isRoomReceiptSent(r.room_no)).length}
                </span>
              </button>

              <button
                type="button"
                disabled={isSending}
                onClick={() => {
                  setFilterMode('all');
                  const allValid = paidRooms.filter((r) => !!r.line_user_id).map((r) => r.room_no);
                  setSelectedRoomNos(allValid);
                }}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 ${
                  filterMode === 'all'
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>ทั้งหมดที่ชำระแล้ว</span>
                <span className="bg-white/20 px-1.5 py-0.2 rounded-full text-[10px]">{paidRooms.length}</span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                disabled={isSending}
                onClick={selectAll}
                className="text-blue-600 hover:underline font-bold"
              >
                เลือกทั้งหมด
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                disabled={isSending}
                onClick={deselectAll}
                className="text-slate-500 hover:underline font-bold"
              >
                ยกเลิกทั้งหมด
              </button>
            </div>
          </div>

          {/* Progress / Running View */}
          {isSending && progress && (
            <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
              <div className="flex justify-between items-center text-blue-900 font-bold">
                <span className="flex items-center gap-1.5">
                  <span className="animate-spin inline-block">⏳</span>
                  <span>กำลังประมวลผล: ห้อง {progress.currentRoom}</span>
                </span>
                <span className="font-mono">
                  {progress.current} / {progress.total} ห้อง ({Math.round((progress.current / progress.total) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Summary Banner after finish */}
          {isFinished && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-sm">
                <span>🎉</span>
                <span>ส่งรูปใบเสร็จเข้า LINE เสร็จสิ้นแล้ว!</span>
              </div>
              <div className="text-xs">
                สำเร็จ: <b className="text-emerald-700">{successCount}</b> ห้อง • ไม่สำเร็จ:{' '}
                <b className="text-rose-600">{failCount}</b> ห้อง
              </div>
            </div>
          )}

          {/* Rooms Table / List */}
          <div className="border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-bold text-[11px] sticky top-0 z-10 border-b">
                <tr>
                  <th className="p-2 text-center w-8">
                    <input
                      type="checkbox"
                      disabled={isSending}
                      checked={
                        selectedRoomNos.length > 0 &&
                        selectedRoomNos.length === displayedRooms.filter((r) => !!r.line_user_id).length
                      }
                      onChange={(e) => (e.target.checked ? selectAll() : deselectAll())}
                    />
                  </th>
                  <th className="p-2">ห้องชุด</th>
                  <th className="p-2">เจ้าของร่วม</th>
                  <th className="p-2 text-right">ยอดชำระ</th>
                  <th className="p-2 text-center">สถานะ LINE</th>
                  <th className="p-2 text-center">สถานะใบเสร็จ</th>
                  {isFinished && <th className="p-2 text-center">ผลลัพธ์</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedRooms.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      ไม่มีห้องชุดที่ตรงตามเงื่อนไข (ส่งรูปใบเสร็จครบทุกห้องแล้ว 🎉)
                    </td>
                  </tr>
                ) : (
                  displayedRooms.map((room) => {
                    const log = logMap[room.room_no];
                    const bill = calculateBill(
                      room,
                      log ? Number(log.curr_meter) : Number(room.latest_meter) || 0,
                      period,
                      config,
                      log ? Number(log.special_items) || 0 : 0,
                      log?.special_items_note || '',
                      Number(room.outstanding_balance) || 0,
                      log ? Number(log.prev_meter) : Number(room.latest_meter) || 0,
                      log ? Number(log.late_fee) || 0 : 0
                    );
                    const isSelected = selectedRoomNos.includes(room.room_no);
                    const hasLine = !!room.line_user_id;
                    const isSent = isRoomReceiptSent(room.room_no);
                    const roomLog = sendLogs.find((l) => l.roomNo === room.room_no);

                    return (
                      <tr
                        key={room.room_no}
                        className={`hover:bg-slate-50 transition ${isSelected ? 'bg-blue-50/40' : ''}`}
                      >
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            disabled={isSending || !hasLine}
                            checked={isSelected}
                            onChange={() => toggleRoom(room.room_no)}
                          />
                        </td>
                        <td className="p-2 font-mono font-bold text-blue-700">
                          {formatRoomNo(room.room_no)}
                        </td>
                        <td className="p-2 truncate max-w-[120px]">
                          {room.owner_name || room.tenant_name || '-'}
                        </td>
                        <td className="p-2 text-right font-mono font-medium">
                          {bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.
                        </td>
                        <td className="p-2 text-center">
                          {hasLine ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              🟢 ผูก LINE แล้ว
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px]">
                              ⚠️ ยังไม่ผูก
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {isSent ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              ✅ ส่งแล้ว
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                              ⏳ ยังไม่ส่ง
                            </span>
                          )}
                        </td>
                        {isFinished && (
                          <td className="p-2 text-center text-[10px]">
                            {roomLog ? (
                              roomLog.success ? (
                                <span className="text-emerald-700 font-bold">✓ สำเร็จ</span>
                              ) : (
                                <span className="text-rose-600 font-bold" title={roomLog.message}>
                                  ✕ ล้มเหลว
                                </span>
                              )
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 px-5 py-3 border-t flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-slate-600">
            เลือกไว้:{' '}
            <b className="text-blue-700 font-mono text-sm">{selectedRoomNos.length}</b> / {displayedRooms.length} ห้อง
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isSending}
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-xl font-bold text-slate-700 hover:bg-slate-100 transition"
            >
              {isFinished ? 'ปิดหน้าต่าง' : 'ยกเลิก'}
            </button>

            {!isFinished && (
              <button
                type="button"
                disabled={isSending || selectedRoomNos.length === 0}
                onClick={handleStartBatchSend}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                <span>📲</span>
                <span>
                  {isSending
                    ? 'กำลังส่งรูปใบเสร็จ...'
                    : `เริ่มส่งรูปใบเสร็จ (${selectedRoomNos.length} ห้อง)`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* HIDDEN OFFSCREEN RECEIPT COMPONENT FOR toPng RENDERING (Official Web Layout, High DPI) */}
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: '560px' }}>
          {renderRoom && (() => {
            const rLog = logMap[renderRoom.room_no];
            const rPrevM = rLog ? Number(rLog.prev_meter) : Number(renderRoom.latest_meter) || 0;
            const rCurrM = rLog ? Number(rLog.curr_meter) : rPrevM;
            const rBill = calculateBill(
              renderRoom,
              rCurrM,
              period,
              config,
              rLog ? Number(rLog.special_items) || 0 : 0,
              rLog?.special_items_note || '',
              Number(renderRoom.outstanding_balance) || 0,
              rPrevM,
              rLog ? Number(rLog.late_fee) || 0 : 0
            );
            const rReceiptNo = generateReceiptNo(rBill.invoice_no, 1);
            const rPaidMethod =
              rLog?.paid_type === 'cash' || rLog?.paid_type === 'เงินสด'
                ? 'เงินสด (Cash)'
                : 'โอนเงินเข้าบัญชีธนาคาร (Bank Transfer)';
            const rCustomItems = getPrintableCustomItems(rBill.special_items_note, rBill.special_items);
            const rPaidDateStr = rLog?.paid_timestamp
              ? new Date(rLog.paid_timestamp).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })
              : new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });

            return (
              <div
                ref={hiddenReceiptRef}
                style={{ width: '540px' }}
                className="bg-white border-2 border-black rounded-lg p-5 text-black text-xs space-y-2.5 shadow-sm"
              >
                {/* Header (Matching Official Web Printout) */}
                <div className="flex justify-between items-start border-b-2 border-black pb-2 mb-2">
                  <div>
                    <div className="font-bold text-base text-black">{condoName}</div>
                    <div className="text-[12px] font-bold text-black mt-0.5">
                      ใบเสร็จรับเงิน / RECEIPT
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-extrabold text-black text-base border-2 border-black px-2.5 py-0.5 rounded bg-neutral-100 inline-block font-mono">
                      ห้อง / Room {formatRoomNo(renderRoom.room_no)}
                    </div>
                    <div className="text-[11px] text-neutral-800 mt-1 font-mono">
                      เลขที่ / No: {rReceiptNo}
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
                    <span className="font-bold underline">{rPaidDateStr}</span>
                  </div>
                </div>

                {/* Meter Info Box */}
                <div className="border border-black rounded p-2 mb-2 bg-white text-xs text-black">
                  <div className="flex justify-between items-center">
                    <span>
                      เลขมิเตอร์น้ำ / Meter: <b>{rBill.prev_meter} ➔ {rBill.curr_meter}</b>
                    </span>
                    <span className="font-bold">ใช้น้ำ / Used: {rBill.units_used} หน่วย (Units)</span>
                  </div>
                </div>

                {/* Calculation Breakdown Table */}
                <table className="w-full text-xs mb-2 text-black border-collapse">
                  <tbody>
                    <tr className="border-b border-neutral-300">
                      <td className="py-1">1. ค่าน้ำประปา / Water Supply ({rBill.units_used} Units × {rBill.water_rate} ฿)</td>
                      <td className="text-right font-mono font-medium">{rBill.water_amount.toFixed(2)}</td>
                    </tr>
                    <tr className="border-b border-neutral-300">
                      <td className="py-1">2. ค่าบำบัดน้ำเสีย / Wastewater ({rBill.units_used} Units × {rBill.wastewater_rate} ฿)</td>
                      <td className="text-right font-mono font-medium">{rBill.wastewater_amount.toFixed(2)}</td>
                    </tr>
                    <tr className="border-b border-neutral-300">
                      <td className="py-1">3. ค่าส่วนกลาง / Common Area Fee</td>
                      <td className="text-right font-mono font-medium">{rBill.common_fee.toFixed(2)}</td>
                    </tr>
                    {rCustomItems.map((cItem, cIdx) => (
                      <tr key={cIdx} className="border-b border-neutral-300 font-semibold">
                        <td className="py-1">{cIdx + 4}. {cItem.label}</td>
                        <td className="text-right font-mono">{cItem.amount > 0 ? `+${cItem.amount.toFixed(2)}` : cItem.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                    {rBill.late_fee > 0 && (
                      <tr className="border-b border-neutral-300 font-semibold text-rose-800">
                        <td className="py-1">เบี้ยปรับชำระล่าช้า / Late Payment Fee</td>
                        <td className="text-right font-mono">+{rBill.late_fee.toFixed(2)}</td>
                      </tr>
                    )}
                    {rBill.contribution_deducted > 0 && (
                      <tr className="border-b border-neutral-300 font-semibold text-blue-800">
                        <td className="py-1">★ หักเครดิตสมทบทุน / Fund Credit</td>
                        <td className="text-right font-mono">-{rBill.contribution_deducted.toFixed(2)}</td>
                      </tr>
                    )}
                    {rBill.prepaid_deducted > 0 && (
                      <tr className="border-b border-neutral-300 font-semibold text-emerald-800">
                        <td className="py-1">★ หักเงินฝากล่วงหน้า / Prepaid Deposit</td>
                        <td className="text-right font-mono">-{rBill.prepaid_deducted.toFixed(2)}</td>
                      </tr>
                    )}
                    {rBill.outstanding_balance > 0 && (
                      <tr className="border-b border-neutral-300 font-bold text-amber-900">
                        <td className="py-1">ค้างชำระยกมา / Outstanding Balance</td>
                        <td className="text-right font-mono">+{rBill.outstanding_balance.toFixed(2)}</td>
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
                      {rBill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs font-bold text-black ml-1.5">บาท/THB</span>
                  </div>
                </div>

                {/* Paid Status & Signature */}
                <div className="bg-white border border-black p-2.5 rounded text-xs text-black flex justify-between items-center">
                  <div className="space-y-1">
                    <div className="font-bold text-black">
                      ✓ ได้รับชำระเงินเรียบร้อยแล้ว / Paid Successfully {rLog?.is_late_payment ? '(ชำระล่าช้า / Late)' : '(ตรงตามกำหนด / On Time)'}
                    </div>
                    <div className="text-neutral-800">
                      รับชำระโดย / Paid by: <b className="underline">{rPaidMethod}</b>
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
        </div>
      </div>
    </div>
  );
};
