'use client';

// Mobile-optimized Meter Reading Modal with Camera & Auto-Watermark
// Version 1.0

import React, { useState, useRef, useEffect } from 'react';
import { Room } from '@/types/condo';
import { processAndWatermarkImage } from '@/utils/watermark';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo } from '@/utils/billing';

interface MeterReadingModalProps {
  room: Room;
  period: string; // e.g. "2026-11"
  onClose: () => void;
  onSaved: (updatedRoom: Room) => void;
  onNextRoom?: () => void;
}

export const MeterReadingModal: React.FC<MeterReadingModalProps> = ({
  room,
  period,
  onClose,
  onSaved,
  onNextRoom,
}) => {
  const supabase = createClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const prevMeter = Number(room.latest_meter) || 0;
  const [currMeterStr, setCurrMeterStr] = useState<string>('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageSizeKb, setImageSizeKb] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string>('');

  const currMeter = currMeterStr === '' ? prevMeter : Number(currMeterStr);
  const unitsUsed = Math.max(0, currMeter - prevMeter);

  // Start Camera
  const startCamera = async () => {
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }, // Back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsCameraActive(true);
    } catch (err: any) {
      console.error('Camera access error:', err);
      setErrorMessage('ไม่สามารถเปิดกล้องได้ โปรดอนุญาตการเข้าถึงกล้อง หรือเลือกอัปโหลดไฟล์รูปภาพแทน');
      setIsCameraActive(false);
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  // Capture photo from video stream
  const capturePhoto = async () => {
    if (!videoRef.current) return;
    setIsProcessing(true);
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Process watermark and compress to 30-60 KB WebP
      const result = await processAndWatermarkImage(canvas, {
        roomNo: formatRoomNo(room.room_no),
        period,
        prevMeter,
        currMeter,
        unitsUsed,
        readerName: 'นิติบุคคล',
        maxDimension: 960,
        quality: 0.65,
      });

      setCapturedBlob(result.blob);
      setPreviewUrl(result.dataUrl);
      setImageSizeKb(result.sizeKb);
      stopCamera();
    } catch (err: any) {
      console.error('Failed to capture photo:', err);
      setErrorMessage('เกิดข้อผิดพลาดในการประมวลผลรูปภาพ: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle file upload fallback
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const result = await processAndWatermarkImage(file, {
        roomNo: formatRoomNo(room.room_no),
        period,
        prevMeter,
        currMeter,
        unitsUsed,
        readerName: 'นิติบุคคล',
        maxDimension: 960,
        quality: 0.65,
      });
      setCapturedBlob(result.blob);
      setPreviewUrl(result.dataUrl);
      setImageSizeKb(result.sizeKb);
      stopCamera();
    } catch (err: any) {
      console.error('Upload process error:', err);
      setErrorMessage('ไม่สามารถประมวลผลรูปได้: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Save to Supabase
  const handleSave = async (autoNext = false) => {
    if (currMeter < prevMeter) {
      const confirmSave = window.confirm(
        `เลขมิเตอร์ใหม่ (${currMeter}) น้อยกว่าครั้งก่อน (${prevMeter})\nคุณต้องการบันทึกเป็นกรณีเปลี่ยนมิเตอร์/วนรอบใช่หรือไม่?`
      );
      if (!confirmSave) return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      let photoUrl: string | null = null;

      // 1. Upload photo to Supabase Storage if captured
      if (capturedBlob) {
        const fileName = `${period}/${room.room_no}_${Date.now()}.webp`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('meter-photos')
          .upload(fileName, capturedBlob, {
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

      // 2. Insert or update meter_logs
      const waterAmount = unitsUsed * 35;
      const wastewaterAmount = unitsUsed * 5;
      const commonFeeAmount = room.room_type === 'ห้องใหญ่' ? 500 : 300;
      const totalAmount = waterAmount + wastewaterAmount + commonFeeAmount;

      const { error: logErr } = await supabase
        .from('meter_logs')
        .upsert(
          {
            period,
            room_no: room.room_no,
            prev_meter: prevMeter,
            curr_meter: currMeter,
            units_used: unitsUsed,
            water_amount: waterAmount,
            wastewater_amount: wastewaterAmount,
            common_fee_amount: commonFeeAmount,
            total_amount: totalAmount,
            meter_photo_url: photoUrl,
            note: note || null,
            recorded_at: new Date().toISOString(),
          },
          { onConflict: 'period,room_no' }
        );

      if (logErr) {
        console.error('Failed to save meter log:', logErr);
      }

      // 3. Update room's latest_meter
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
        throw new Error('ไม่สามารถอัปเดตห้องได้: ' + roomErr.message);
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
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-sky-400">ห้อง {formatRoomNo(room.room_no)}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                ชั้น {room.floor} | {room.room_type}
              </span>
            </div>
            <div className="text-xs text-slate-400">จดมิเตอร์รอบบิล: {period}</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Camera / Photo Preview Area */}
        <div className="relative bg-slate-950 aspect-video flex items-center justify-center overflow-hidden">
          {previewUrl ? (
            /* Captured photo preview */
            <div className="relative w-full h-full">
              <img
                src={previewUrl}
                alt="Captured Meter"
                className="w-full h-full object-contain"
              />
              <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded backdrop-blur-sm">
                ขนาดรูป: {imageSizeKb} KB (WebP บีบอัด)
              </div>
              <button
                type="button"
                onClick={() => {
                  setPreviewUrl(null);
                  setCapturedBlob(null);
                  startCamera();
                }}
                className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white text-xs px-2.5 py-1 rounded-full backdrop-blur-sm flex items-center gap-1"
              >
                🔄 ถ่ายใหม่
              </button>
            </div>
          ) : isCameraActive ? (
            /* Live camera view with targeting frame */
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {/* Centered Aiming Frame for meter face */}
              <div className="absolute inset-8 border-2 border-dashed border-sky-400 rounded-lg pointer-events-none flex items-center justify-center">
                <span className="bg-black/50 text-white text-[11px] px-2 py-1 rounded backdrop-blur-sm">
                  วางหน้าปัดมิเตอร์ในกรอบนี้
                </span>
              </div>
              {/* Shutter Button */}
              <button
                type="button"
                disabled={isProcessing}
                onClick={capturePhoto}
                className="absolute bottom-3 w-14 h-14 rounded-full border-4 border-white bg-sky-500 hover:bg-sky-400 active:scale-95 shadow-lg flex items-center justify-center text-white"
              >
                📷
              </button>
            </div>
          ) : (
            /* Camera off / fallback */
            <div className="text-center p-4 text-slate-400">
              <div className="text-3xl mb-2">📷</div>
              <p className="text-xs mb-3">กล้องไม่ได้เปิดใช้งาน</p>
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs rounded-lg font-medium"
                >
                  เปิดกล้อง
                </button>
                <label className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg font-medium cursor-pointer">
                  เลือกรูปในเครื่อง
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-white text-sm">
              กำลังประมวลผลลายน้ำและบีบอัดรูป...
            </div>
          )}
        </div>

        {/* Input & Meter Numbers Area */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2.5 rounded-lg">
              {errorMessage}
            </div>
          )}

          {/* Meter Readings Grid */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">เลขครั้งก่อน</label>
              <div className="text-lg font-bold text-slate-700 font-mono bg-white px-3 py-2 rounded-lg border">
                {prevMeter}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-700 block mb-1">
                เลขครั้งนี้ <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={currMeterStr}
                onChange={(e) => setCurrMeterStr(e.target.value)}
                placeholder={String(prevMeter)}
                className="w-full text-lg font-bold text-blue-700 font-mono bg-white px-3 py-2 rounded-lg border border-blue-400 focus:ring-2 focus:ring-blue-500 outline-none"
                autoFocus
              />
            </div>
          </div>

          {/* Usage Alert / Summary */}
          <div className="bg-sky-50 border border-sky-200 p-2.5 rounded-xl flex items-center justify-between">
            <span className="text-xs text-sky-800 font-medium">ใช้น้ำรอบนี้:</span>
            <div className="text-right">
              <span className="text-xl font-bold text-sky-700">{unitsUsed}</span>
              <span className="text-xs text-sky-800 ml-1">หน่วย</span>
              <span className="text-[11px] text-slate-500 block">
                ค่าน้ำ ~{(unitsUsed * 35).toLocaleString()} บ. | บำบัด ~{(unitsUsed * 5).toLocaleString()} บ.
              </span>
            </div>
          </div>

          {currMeter < prevMeter && (
            <div className="bg-amber-50 border border-amber-300 text-amber-800 text-xs p-2 rounded-lg">
              ⚠️ เลขใหม่ ({currMeter}) น้อยกว่าเลขเดิม ({prevMeter}) หากมิเตอร์วนรอบหรือเปลี่ยนมิเตอร์ใหม่ ระบบจะบันทึกตามปกติ
            </div>
          )}

          {unitsUsed > 50 && (
            <div className="bg-amber-50 border border-amber-300 text-amber-800 text-xs p-2 rounded-lg">
              ⚠️ ใช้น้ำสูงผิดปกติ ({unitsUsed} หน่วย) โปรดตรวจเช็คเลขมิเตอร์ซ้ำ
            </div>
          )}

          {/* Note Input */}
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">หมายเหตุ (ถ้ามี)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น หน้าปัดมัว, น้ำหยด, ห้องไม่มีคนอยู่"
              className="w-full text-xs px-3 py-2 border rounded-lg outline-none focus:border-slate-400"
            />
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="p-3 bg-slate-50 border-t flex gap-2">
          <button
            type="button"
            disabled={isSaving || isProcessing}
            onClick={() => handleSave(false)}
            className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm rounded-xl transition active:scale-98 disabled:opacity-50"
          >
            {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
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
