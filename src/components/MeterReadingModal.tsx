'use client';

// Mobile-optimized Meter Reading Modal with Stable Camera & Deferred Auto-Watermark
// Version 1.3 - Fixes keyboard autoFocus popup, camera open/close race condition, and 0-unit watermark bug

import React, { useState, useRef, useEffect } from 'react';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { processAndWatermarkImage } from '@/utils/watermark';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo, calculateBill } from '@/utils/billing';

interface MeterReadingModalProps {
  room: Room;
  period: string; // e.g. "2026-11"
  existingLog?: MeterLog | null;
  config?: Partial<CondoConfig>;
  isAdminMode?: boolean;
  onClose: () => void;
  onSaved: (updatedRoom: Room) => void;
  onNextRoom?: () => void;
}

export const MeterReadingModal: React.FC<MeterReadingModalProps> = ({
  room,
  period,
  existingLog,
  config = {},
  isAdminMode = false,
  onClose,
  onSaved,
  onNextRoom,
}) => {
  const supabase = createClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Determine true previous meter: if already logged in this period, preserve existingLog.prev_meter!
  const initialPrevMeter =
    existingLog && existingLog.prev_meter !== undefined && existingLog.prev_meter !== null
      ? Number(existingLog.prev_meter)
      : Number(room.latest_meter) || 0;

  const [prevMeterStr, setPrevMeterStr] = useState<string>(String(initialPrevMeter));
  const [currMeterStr, setCurrMeterStr] = useState<string>(
    existingLog && existingLog.curr_meter !== undefined && existingLog.curr_meter !== null
      ? String(existingLog.curr_meter)
      : ''
  );

  // Raw image kept in memory so watermark always embeds the final meter numbers even if typed after taking photo
  const [rawImageSource, setRawImageSource] = useState<File | HTMLCanvasElement | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingLog?.meter_photo_url || null);
  const [imageSizeKb, setImageSizeKb] = useState<number>(0);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string>(existingLog?.note || '');

  const prevMeter = prevMeterStr === '' ? 0 : Number(prevMeterStr);
  const currMeter = currMeterStr === '' ? prevMeter : Number(currMeterStr);
  const unitsUsed = Math.max(0, currMeter - prevMeter);

  // Reset all state cleanly whenever room changes (e.g. clicking "บันทึก & ห้องถัดไป")
  useEffect(() => {
    stopCamera();
    const nextPrev =
      existingLog && existingLog.prev_meter !== undefined && existingLog.prev_meter !== null
        ? Number(existingLog.prev_meter)
        : Number(room.latest_meter) || 0;

    setPrevMeterStr(String(nextPrev));
    setCurrMeterStr(
      existingLog && existingLog.curr_meter !== undefined && existingLog.curr_meter !== null
        ? String(existingLog.curr_meter)
        : ''
    );
    setRawImageSource(null);
    setCapturedBlob(null);
    setPreviewUrl(existingLog?.meter_photo_url || null);
    setImageSizeKb(0);
    setNote(existingLog?.note || '');
    setErrorMessage(null);

    return () => {
      stopCamera();
    };
  }, [room.room_no, existingLog?.id]);

  // Attach MediaStream to <video> element ONLY AFTER isCameraActive renders the <video> tag
  useEffect(() => {
    if (isCameraActive && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch((err) => {
        console.warn('Video play error:', err);
      });
    }
  }, [isCameraActive]);

  // Re-render watermark preview automatically when user edits meter numbers after taking a photo
  useEffect(() => {
    if (!rawImageSource) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await processAndWatermarkImage(rawImageSource, {
          roomNo: formatRoomNo(room.room_no),
          period,
          prevMeter,
          currMeter,
          unitsUsed,
          readerName: isAdminMode ? 'นิติบุคคล (ตรวจสอบ)' : 'พนักงานจดมิเตอร์',
          maxDimension: 960,
          quality: 0.68,
        });
        if (!cancelled) {
          setCapturedBlob(result.blob);
          setPreviewUrl(result.dataUrl);
          setImageSizeKb(result.sizeKb);
        }
      } catch (err) {
        console.warn('Watermark update warning:', err);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rawImageSource, prevMeter, currMeter, unitsUsed, room.room_no, period, isAdminMode]);

  // Start Live Web Camera (Optional mode)
  const startCamera = async () => {
    setErrorMessage(null);
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraActive(true);
    } catch (err: any) {
      console.error('Camera access error:', err);
      setErrorMessage('ไม่สามารถเปิดกล้องสดบนเว็บได้ กรุณากดปุ่มสีฟ้า "📸 ถ่ายรูปด้วยกล้องมือถือ" ด้านล่างแทน');
      setIsCameraActive(false);
    }
  };

  // Stop Live Web Camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  // Capture photo from live web video stream
  const captureFromLiveVideo = async () => {
    if (!videoRef.current) return;
    setIsProcessing(true);
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 960;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      stopCamera();
      setRawImageSource(canvas);
    } catch (err: any) {
      console.error('Failed to capture photo:', err);
      setErrorMessage('เกิดข้อผิดพลาดในการถ่ายภาพ: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle native mobile camera or gallery upload (Most reliable on smartphones!)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      stopCamera();
      setRawImageSource(file);
      const result = await processAndWatermarkImage(file, {
        roomNo: formatRoomNo(room.room_no),
        period,
        prevMeter,
        currMeter,
        unitsUsed,
        readerName: isAdminMode ? 'นิติบุคคล (ตรวจสอบ)' : 'พนักงานจดมิเตอร์',
        maxDimension: 960,
        quality: 0.68,
      });
      setCapturedBlob(result.blob);
      setPreviewUrl(result.dataUrl);
      setImageSizeKb(result.sizeKb);
    } catch (err: any) {
      console.error('Upload process error:', err);
      setErrorMessage('ไม่สามารถประมวลผลรูปได้: ' + err.message);
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  };

  // Save to Supabase with freshly watermarked image & unified billing calculation
  const handleSave = async (autoNext = false) => {
    if (currMeterStr.trim() === '') {
      setErrorMessage('⚠️ กรุณากรอก "เลขมิเตอร์ครั้งนี้" ก่อนกดบันทึก (หากไม่ใช้น้ำเลย ให้กดปุ่ม "เท่าเดิม")');
      return;
    }

    if (currMeter < prevMeter) {
      const confirmSave = window.confirm(
        `เลขมิเตอร์ครั้งนี้ (${currMeter}) น้อยกว่าครั้งก่อน (${prevMeter})\nยืนยันการบันทึกเป็นกรณีเปลี่ยนมิเตอร์ใหม่ / มิเตอร์วนรอบใช่หรือไม่?`
      );
      if (!confirmSave) return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      let photoUrl: string | null = existingLog?.meter_photo_url || null;

      // 1. If a new photo was taken/selected, generate final watermark with the exact numbers and upload
      if (rawImageSource) {
        const finalWatermark = await processAndWatermarkImage(rawImageSource, {
          roomNo: formatRoomNo(room.room_no),
          period,
          prevMeter,
          currMeter,
          unitsUsed,
          readerName: isAdminMode ? 'นิติบุคคล (ตรวจสอบ)' : 'พนักงานจดมิเตอร์',
          maxDimension: 960,
          quality: 0.68,
        });

        const fileName = `${period}/${room.room_no}_${Date.now()}.webp`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('meter-photos')
          .upload(fileName, finalWatermark.blob, {
            contentType: 'image/webp',
            upsert: true,
          });

        if (uploadErr) {
          console.warn('Storage upload error, continuing without photo:', uploadErr);
        } else if (uploadData) {
          const { data: publicUrlData } = supabase.storage
            .from('meter-photos')
            .getPublicUrl(uploadData.path);
          photoUrl = publicUrlData.publicUrl;
        }
      }

      // 2. Calculate complete bill (including contribution credit & prepaid deposit deduction)
      const billCalc = calculateBill(
        room,
        currMeter,
        period,
        config,
        existingLog ? Number(existingLog.special_items) || 0 : 0,
        note || '',
        Number(room.outstanding_balance) || 0,
        prevMeter
      );

      // 3. Upsert into meter_logs
      const { error: logErr } = await supabase
        .from('meter_logs')
        .upsert(
          {
            period,
            room_no: room.room_no,
            prev_meter: prevMeter,
            curr_meter: currMeter,
            units_used: unitsUsed,
            water_amount: billCalc.water_amount,
            wastewater_amount: billCalc.wastewater_amount,
            common_fee_amount: billCalc.common_fee,
            contribution_deducted: billCalc.contribution_deducted,
            prepaid_deducted: billCalc.prepaid_deducted,
            total_amount: billCalc.total_amount,
            meter_photo_url: photoUrl,
            note: note || null,
            recorded_at: new Date().toISOString(),
          },
          { onConflict: 'period,room_no' }
        );

      if (logErr) {
        throw new Error('บันทึกประวัติมิเตอร์ไม่สำเร็จ: ' + logErr.message);
      }

      // 4. Update room's latest_meter
      const { data: updatedRoomData, error: roomErr } = await supabase
        .from('rooms')
        .update({
          latest_meter: currMeter,
          updated_at: new Date().toISOString(),
        })
        .eq('room_no', room.room_no)
        .select()
        .single();

      if (roomErr) {
        throw new Error('ไม่สามารถอัปเดตข้อมูลห้องได้: ' + roomErr.message);
      }

      const updatedRoom: Room = updatedRoomData || {
        ...room,
        latest_meter: currMeter,
      };

      onSaved(updatedRoom);

      if (autoNext && onNextRoom) {
        onNextRoom();
      } else {
        onClose();
      }
    } catch (err: any) {
      console.error('Save error:', err);
      setErrorMessage(err.message || 'บันทึกข้อมูลล้มเหลว');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh]">
        {/* Top Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-sky-400">ห้อง {formatRoomNo(room.room_no)}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                ชั้น {room.floor} | {room.room_type}
              </span>
            </div>
            <div className="text-xs text-slate-400">
              {existingLog ? '✏️ แก้ไขข้อมูลมิเตอร์รอบบิล: ' : 'จดมิเตอร์รอบบิล: '}
              <b className="text-sky-300">{period}</b>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center text-base"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-3.5 space-y-3.5 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="bg-red-50 border border-red-300 text-red-700 text-xs p-3 rounded-xl font-medium">
              {errorMessage}
            </div>
          )}

          {/* STEP 1: PHOTO CAPTURE (No keyboard popup blocking the screen!) */}
          <div className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800">
            <div className="bg-slate-800/80 px-3 py-1.5 flex items-center justify-between text-xs text-slate-200">
              <span className="font-bold">ขั้นที่ 1: ถ่ายรูปหน้าปัดมิเตอร์</span>
              {previewUrl && (
                <span className="text-emerald-400 font-bold text-[11px]">
                  ✅ มีรูปถ่ายแล้ว {imageSizeKb > 0 ? `(${imageSizeKb} KB)` : ''}
                </span>
              )}
            </div>

            {previewUrl && !isCameraActive ? (
              /* Preview of Captured / Existing Photo */
              <div className="relative bg-slate-950 aspect-video flex items-center justify-center">
                <img
                  src={previewUrl}
                  alt="Meter Preview"
                  className="w-full h-full object-contain max-h-60"
                />
                <div className="absolute bottom-2 inset-x-2 flex justify-center gap-2">
                  <label className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow-lg cursor-pointer flex items-center gap-1.5">
                    <span>📸 ถ่ายรูปใหม่ (กล้องมือถือ)</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                  <label className="px-3 py-2 bg-slate-800/90 hover:bg-slate-700 text-white text-xs font-medium rounded-xl shadow cursor-pointer">
                    🖼️ เลือกจากอัลบั้ม
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>
              </div>
            ) : isCameraActive ? (
              /* Optional In-Browser Live Camera */
              <div className="relative bg-black aspect-video flex items-center justify-center">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-6 border-2 border-dashed border-sky-400 rounded-xl pointer-events-none flex items-start justify-center pt-2">
                  <span className="bg-black/60 text-white text-[11px] px-2.5 py-0.5 rounded-full">
                    เล็งตัวเลขหน้าปัดมิเตอร์ในกรอบ
                  </span>
                </div>
                <div className="absolute bottom-3 inset-x-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-3 py-1.5 bg-slate-800/90 text-white text-xs rounded-lg"
                  >
                    ปิดกล้องสด
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={captureFromLiveVideo}
                    className="px-5 py-2.5 rounded-full border-2 border-white bg-sky-500 hover:bg-sky-400 active:scale-95 shadow-lg font-bold text-white text-xs flex items-center gap-1.5"
                  >
                    📸 กดแชะภาพ
                  </button>
                </div>
              </div>
            ) : (
              /* Clean, Never-Flickering Action Buttons for Mobile Camera */
              <div className="p-4 text-center space-y-3">
                <p className="text-xs text-slate-300">
                  กดปุ่มด้านล่างเพื่อเปิดกล้องมือถือถ่ายหน้าปัดมิเตอร์ (เปิดแฟลชและซูมได้ชัดเจน)
                </p>

                <label className="w-full py-3.5 px-4 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 active:scale-[0.98] text-white font-bold text-sm rounded-xl shadow-lg cursor-pointer flex items-center justify-center gap-2 transition">
                  <span className="text-lg">📸</span>
                  <span>กดถ่ายรูปมิเตอร์ (กล้องมือถือชัดสุด)</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>

                <div className="flex gap-2 justify-center pt-1">
                  <label className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl cursor-pointer flex items-center justify-center gap-1.5">
                    <span>🖼️ เลือกรูปในเครื่อง</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={startCamera}
                    className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <span>🎥 กล้องสดบนเว็บ</span>
                  </button>
                </div>
              </div>
            )}

            {isProcessing && (
              <div className="bg-sky-900/80 text-white text-xs py-2 px-3 text-center font-medium">
                ⏳ กำลังบีบอัดรูปและฝังลายน้ำอัตโนมัติ...
              </div>
            )}
          </div>

          {/* STEP 2: ENTER METER NUMBER (Looking at the photo above) */}
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">ขั้นที่ 2: กรอกตัวเลขมิเตอร์น้ำ</span>
              <span className="text-[11px] text-slate-500">ดูตัวเลขจากรูปด้านบนแล้วพิมพ์</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Previous Meter */}
              <div>
                <label className="text-[11px] font-medium text-slate-500 block mb-1">
                  เลขครั้งก่อน {isAdminMode && '(แก้ได้)'}
                </label>
                {isAdminMode ? (
                  <input
                    type="number"
                    inputMode="numeric"
                    value={prevMeterStr}
                    onChange={(e) => setPrevMeterStr(e.target.value)}
                    className="w-full text-xl font-bold text-slate-700 font-mono bg-white px-3 py-2.5 rounded-xl border border-slate-300 outline-none focus:ring-2 focus:ring-slate-400"
                  />
                ) : (
                  <div className="text-xl font-bold text-slate-700 font-mono bg-slate-200/70 px-3 py-2.5 rounded-xl border border-slate-300">
                    {prevMeter}
                  </div>
                )}
              </div>

              {/* Current Meter (NO autoFocus so it never jumps on mobile!) */}
              <div>
                <label className="text-[11px] font-bold text-blue-700 block mb-1">
                  เลขครั้งนี้ <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={currMeterStr}
                  onChange={(e) => setCurrMeterStr(e.target.value)}
                  placeholder={`เช่น ${prevMeter + 5}`}
                  className="w-full text-xl font-bold text-blue-700 font-mono bg-white px-3 py-2.5 rounded-xl border-2 border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                />
              </div>
            </div>

            {/* Quick One-Handed Helper Buttons */}
            <div>
              <span className="text-[10px] text-slate-500 block mb-1">ปุ่มลัดกดเร็ว (บวกเพิ่มจากเลขครั้งก่อน {prevMeter}):</span>
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { label: 'เท่าเดิม (0)', add: 0 },
                  { label: '+1', add: 1 },
                  { label: '+3', add: 3 },
                  { label: '+5', add: 5 },
                  { label: '+10', add: 10 },
                ].map((btn) => (
                  <button
                    key={btn.add}
                    type="button"
                    onClick={() => {
                      const base = currMeterStr !== '' && btn.add > 0 ? Number(currMeterStr) : prevMeter;
                      setCurrMeterStr(String(btn.add === 0 ? prevMeter : base + btn.add));
                    }}
                    className="py-1.5 px-1 bg-white hover:bg-blue-50 active:scale-95 border border-slate-300 rounded-lg text-[11px] font-bold text-slate-700 shadow-xs"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Usage Summary Banner */}
            <div className="bg-sky-50 border border-sky-200 p-2.5 rounded-xl flex items-center justify-between">
              <span className="text-xs text-sky-900 font-bold">จำนวนหน่วยน้ำที่ใช้รอบนี้:</span>
              <div className="text-right">
                <span className="text-xl font-bold text-sky-700 font-mono">{unitsUsed}</span>
                <span className="text-xs text-sky-800 ml-1 font-bold">หน่วย</span>
              </div>
            </div>

            {currMeterStr !== '' && currMeter < prevMeter && (
              <div className="bg-amber-50 border border-amber-300 text-amber-800 text-xs p-2.5 rounded-xl font-medium">
                ⚠️ เลขใหม่ ({currMeter}) น้อยกว่าเลขครั้งก่อน ({prevMeter}) โปรดตรวจสอบว่าพิมพ์เลขถูกหรือไม่
              </div>
            )}

            {unitsUsed > 40 && (
              <div className="bg-amber-50 border border-amber-300 text-amber-800 text-xs p-2.5 rounded-xl font-medium">
                ⚠️ ใช้น้ำสูงผิดปกติ ({unitsUsed} หน่วย) โปรดเทียบตัวเลขกับรูปถ่ายอีกครั้ง
              </div>
            )}

            {/* Note Input */}
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">หมายเหตุ (ถ้ามี)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="เช่น หน้าปัดมัว, น้ำหยด, ห้องว่างไม่มีคนอยู่"
                className="w-full text-xs px-3 py-2 bg-white border rounded-xl outline-none focus:border-blue-400"
              />
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="p-3 bg-slate-100 border-t flex gap-2">
          <button
            type="button"
            disabled={isSaving || isProcessing}
            onClick={() => handleSave(false)}
            className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-xl transition active:scale-98 disabled:opacity-50"
          >
            {isSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>

          {onNextRoom && (
            <button
              type="button"
              disabled={isSaving || isProcessing}
              onClick={() => handleSave(true)}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl shadow-md transition active:scale-98 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {isSaving ? 'กำลังบันทึก...' : 'บันทึก & ห้องถัดไป ▶'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
