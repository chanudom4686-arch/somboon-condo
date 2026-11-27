'use client';

// Batch Receipt Image Generator & LINE Push Modal
// Version 2.7 - Supports Smart Unsent-only Filtering, Bilingual Receipt Image Generation & Real-time Progress Tracking

import React, { useState, useRef } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { formatRoomNo, calculateBill, generateReceiptNo } from '@/utils/billing';
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

        // 2. Render DOM to PNG dataUrl
        const dataUrl = await toPng(hiddenReceiptRef.current, {
          cacheBust: true,
          quality: 0.95,
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

        {/* HIDDEN OFFSCREEN RECEIPT COMPONENT FOR toPng RENDERING */}
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: '380px' }}>
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

            return (
              <div
                ref={hiddenReceiptRef}
                className="bg-white border-2 border-slate-900 rounded-xl p-4 text-black text-xs space-y-2 shadow-xs"
              >
                {/* Receipt Header */}
                <div className="text-center border-b border-black pb-2">
                  <div className="font-extrabold text-sm text-black">{condoName}</div>
                  <div className="text-[11px] font-bold text-black mt-0.5">
                    ใบเสร็จรับเงิน / RECEIPT
                  </div>
                  <div className="text-[10px] text-neutral-600 font-mono mt-0.5">
                    เลขที่ / No: {rReceiptNo} • รอบบิล / Period: {period}
                  </div>
                </div>

                {/* Room & Payer Info */}
                <div className="grid grid-cols-2 gap-2 text-[11px] py-1 border-b border-neutral-300">
                  <div>
                    <span className="text-neutral-500 block text-[9.5px]">ห้องชุด / Room</span>
                    <span className="font-mono font-bold text-sm">{formatRoomNo(renderRoom.room_no)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-neutral-500 block text-[9.5px]">วันที่รับชำระ / Date</span>
                    <span className="font-mono font-semibold">
                      {rLog?.paid_timestamp
                        ? new Date(rLog.paid_timestamp).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })
                        : new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block text-[9.5px]">เจ้าของร่วม / Name</span>
                    <span className="font-medium truncate block">
                      {renderRoom.owner_name || renderRoom.tenant_name || 'ท่านเจ้าของร่วม'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-neutral-500 block text-[9.5px]">วิธีชำระ / Method</span>
                    <span className="font-semibold text-[10px]">{rPaidMethod}</span>
                  </div>
                </div>

                {/* Items Table */}
                <div className="space-y-1 py-1 text-[10.5px]">
                  <div className="flex justify-between py-0.5">
                    <span>1. ค่าน้ำประปา / Water ({rBill.units_used} units @ 35 ฿)</span>
                    <span className="font-mono font-semibold">{rBill.water_amount.toLocaleString()} ฿</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span>2. ค่าบำบัดน้ำเสีย / Wastewater ({rBill.units_used} units @ 5 ฿)</span>
                    <span className="font-mono font-semibold">{rBill.wastewater_amount.toLocaleString()} ฿</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span>3. ค่าส่วนกลาง / Common Area Fee</span>
                    <span className="font-mono font-semibold">{rBill.common_fee.toLocaleString()} ฿</span>
                  </div>
                  {rBill.late_fee > 0 && (
                    <div className="flex justify-between py-0.5 text-rose-700 font-semibold">
                      <span>4. เบี้ยปรับชำระล่าช้า / Late Fee</span>
                      <span className="font-mono">+{rBill.late_fee.toLocaleString()} ฿</span>
                    </div>
                  )}
                  {rBill.special_items !== 0 && (
                    <div className="flex justify-between py-0.5">
                      <span>5. รายการพิเศษ / Extra ({rBill.special_items_note || '-'})</span>
                      <span className="font-mono font-semibold">
                        {rBill.special_items > 0 ? '+' : ''}{rBill.special_items.toLocaleString()} ฿
                      </span>
                    </div>
                  )}
                  {rBill.contribution_deducted > 0 && (
                    <div className="flex justify-between py-0.5 text-blue-700">
                      <span>• หักเครดิตสมทบทุน / Fund Credit</span>
                      <span className="font-mono">-{rBill.contribution_deducted.toLocaleString()} ฿</span>
                    </div>
                  )}
                  {rBill.prepaid_deducted > 0 && (
                    <div className="flex justify-between py-0.5 text-emerald-700">
                      <span>• หักเงินฝากล่วงหน้า / Prepaid Deposit</span>
                      <span className="font-mono">-{rBill.prepaid_deducted.toLocaleString()} ฿</span>
                    </div>
                  )}
                  {rBill.outstanding_balance > 0 && (
                    <div className="flex justify-between py-0.5 text-amber-800">
                      <span>• ยอดค้างชำระยกมา / Outstanding Balance</span>
                      <span className="font-mono">+{rBill.outstanding_balance.toLocaleString()} ฿</span>
                    </div>
                  )}
                </div>

                {/* Total Row */}
                <div className="border-t-2 border-black pt-1.5 flex justify-between items-center text-sm font-extrabold">
                  <span>ยอดเงินที่รับชำระทั้งสิ้น / TOTAL RECEIVED</span>
                  <span className="font-mono text-emerald-800">
                    {rBill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท (THB)
                  </span>
                </div>

                {/* Receipt Footer */}
                <div className="text-[9.5px] text-center text-neutral-500 pt-1 border-t border-neutral-300">
                  {config.RECEIPT_FOOTER_TEXT || 'ออกแบบใบเสร็จรับเงิน ออกโดย วชิรดา'}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
