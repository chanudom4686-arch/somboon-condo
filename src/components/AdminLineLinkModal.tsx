'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Room } from '@/types/condo';
import { formatRoomNo } from '@/utils/billing';

export interface LineRecentUser {
  line_user_id: string;
  display_name?: string;
  picture_url?: string;
  status_message?: string;
  last_message?: string;
  message_type?: string;
  last_seen_at?: string;
  created_at?: string;
}

interface AdminLineLinkModalProps {
  user: LineRecentUser | null;
  availableUsers?: LineRecentUser[];
  rooms: Room[];
  preselectedRoomNo?: string;
  onClose: () => void;
  onLink: (
    user: LineRecentUser,
    roomNo: string,
    sendWelcomePush: boolean,
    customMessage?: string
  ) => Promise<void>;
  isLinking: boolean;
}

export function AdminLineLinkModal({
  user,
  availableUsers = [],
  rooms,
  preselectedRoomNo = '',
  onClose,
  onLink,
  isLinking,
}: AdminLineLinkModalProps) {
  const [selectedUserId, setSelectedUserId] = useState<string>(
    user?.line_user_id || (availableUsers.length > 0 ? availableUsers[0].line_user_id : '')
  );
  const [selectedRoomNo, setSelectedRoomNo] = useState<string>(preselectedRoomNo);
  const [roomSearch, setRoomSearch] = useState<string>('');
  const [sendWelcomePush, setSendWelcomePush] = useState<boolean>(true);
  const [customMessage, setCustomMessage] = useState<string>('');

  // Active user object based on selectedUserId
  const currentUser = useMemo(() => {
    if (user && user.line_user_id === selectedUserId) return user;
    const found = availableUsers.find((u) => u.line_user_id === selectedUserId);
    return found || user;
  }, [user, availableUsers, selectedUserId]);

  const targetRoom = useMemo(() => {
    return rooms.find((r) => r.room_no === selectedRoomNo);
  }, [rooms, selectedRoomNo]);

  // Auto-detect room number from user's last message
  const detectedRoomNo = useMemo(() => {
    if (!currentUser?.last_message) return null;
    const msg = currentUser.last_message;
    for (const r of rooms) {
      const bareNo = r.room_no.replace(/^0+/, '');
      const regex = new RegExp(`(^|\\D)(${r.room_no}|${bareNo})(\\D|$)`);
      if (regex.test(msg)) {
        return r.room_no;
      }
    }
    return null;
  }, [currentUser?.last_message, rooms]);

  useEffect(() => {
    if (!preselectedRoomNo && detectedRoomNo && !selectedRoomNo) {
      setSelectedRoomNo(detectedRoomNo);
    }
  }, [detectedRoomNo, preselectedRoomNo, selectedRoomNo]);

  // Initialize custom welcome message
  useEffect(() => {
    const rNo = selectedRoomNo ? formatRoomNo(selectedRoomNo) : '...';
    const name = targetRoom?.owner_name || currentUser?.display_name || 'ลูกบ้าน';
    setCustomMessage(
      `🎉 ยินดีต้อนรับค่ะคุณ ${name}!\n\nแอดมินนิติคอนโดได้ดำเนินการผูกบัญชี LINE ของท่านเข้ากับห้อง "${rNo}" เรียบร้อยแล้วนะคะ ✅\n\n📌 จากนี้ไปท่านสามารถ:\n- ดูบิลค่าน้ำและค่าส่วนกลางผ่าน LINE ได้ทันที\n- รับการแจ้งเตือนยอดชำระประจำเดือน\n- ส่งสลิปโอนเงินผ่านห้องแชทนี้ได้เลยค่ะ 😊`
    );
  }, [selectedRoomNo, targetRoom, currentUser]);

  const applyPreset = (type: 'standard' | 'bill' | 'short') => {
    const rNo = selectedRoomNo ? formatRoomNo(selectedRoomNo) : '...';
    const name = targetRoom?.owner_name || currentUser?.display_name || 'ลูกบ้าน';
    if (type === 'standard') {
      setCustomMessage(
        `🎉 ยินดีต้อนรับค่ะคุณ ${name}!\n\nแอดมินนิติคอนโดได้ดำเนินการผูกบัญชี LINE ของท่านเข้ากับห้อง "${rNo}" เรียบร้อยแล้วนะคะ ✅\n\n📌 จากนี้ไปท่านสามารถดูบิลค่าน้ำ ค่าส่วนกลาง และส่งสลิปโอนเงินผ่านห้องแชทนี้ได้ทันทีค่ะ 😊`
      );
    } else if (type === 'bill') {
      setCustomMessage(
        `สวัสดีค่ะคุณ ${name} นิติผูกบัญชี LINE ให้กับห้อง "${rNo}" เรียบร้อยแล้วนะคะ ✅\n\nท่านสามารถพิมพ์คำว่า "ดูบิล" เพื่อตรวจสอบยอดค่าน้ำและค่าส่วนกลางรอบปัจจุบันได้ทันทีค่ะ หรือส่งสลิปโอนเงินในห้องแชทนี้ได้เลยนะคะ 🧾`
      );
    } else if (type === 'short') {
      setCustomMessage(
        `สวัสดีค่ะ นิติผูกห้อง "${rNo}" ให้เรียบร้อยแล้วนะคะ ตรวจสอบบิลได้เลยค่ะ 😊`
      );
    }
  };

  // Filtered rooms list for quick search
  const filteredRooms = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((r) => {
      const rNo = (r.room_no || '').toLowerCase();
      const owner = (r.owner_name || '').toLowerCase();
      const tenant = (r.tenant_name || '').toLowerCase();
      return rNo.includes(q) || owner.includes(q) || tenant.includes(q);
    });
  }, [rooms, roomSearch]);

  const isRoomAlreadyLinked = targetRoom && !!targetRoom.line_user_id;
  const isLinkedToSameUser = targetRoom?.line_user_id === currentUser?.line_user_id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      alert('กรุณาเลือกลูกบ้าน LINE ที่ต้องการผูก');
      return;
    }
    if (!selectedRoomNo) {
      alert('กรุณาเลือกเลขห้องที่ต้องการผูก');
      return;
    }
    await onLink(currentUser, selectedRoomNo, sendWelcomePush, customMessage);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-slate-800 p-5 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-2xl p-2 bg-white/10 rounded-2xl">🔗</span>
            <div>
              <h3 className="font-bold text-base sm:text-lg">แอดมินช่วยผูกห้อง LINE</h3>
              <p className="text-xs text-emerald-100">
                ผูกห้องและส่งข้อความตอบกลับเข้า LINE ลูกบ้านในคลิกเดียว (ลูกบ้านไม่ต้องพิมพ์อะไรเลย)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLinking}
            className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* User Selector Dropdown (if multiple users available) */}
          {availableUsers.length > 1 && (
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 block">
                👤 เลือกลูกบ้าน LINE ที่ติดต่อเข้ามา:
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
              >
                {availableUsers.map((u) => {
                  const linkedRoom = rooms.find((r) => r.line_user_id === u.line_user_id);
                  return (
                    <option key={u.line_user_id} value={u.line_user_id}>
                      {u.display_name || 'ไม่ระบุชื่อ'}{' '}
                      {linkedRoom ? `(ผูกห้อง ${formatRoomNo(linkedRoom.room_no)} แล้ว)` : '(ยังไม่ผูกห้อง)'}{' '}
                      - ข้อความ: {u.last_message ? `"${u.last_message.slice(0, 30)}"` : 'ไม่มีข้อความ'}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* User Profile Card */}
          {currentUser ? (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 flex items-start gap-3">
              {currentUser.picture_url ? (
                <img
                  src={currentUser.picture_url}
                  alt={currentUser.display_name || 'LINE User'}
                  className="w-12 h-12 rounded-full border border-slate-300 object-cover shrink-0 shadow-sm"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg shrink-0">
                  {(currentUser.display_name || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 text-sm truncate">
                    {currentUser.display_name || 'ไม่ระบุชื่อ'}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-semibold">
                    LINE OA
                  </span>
                </div>
                <p className="font-mono text-[10px] text-slate-400 truncate mt-0.5">
                  ID: {currentUser.line_user_id}
                </p>
                {currentUser.last_message && (
                  <div className="mt-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1 text-slate-600 italic">
                    💬 &quot;{currentUser.last_message}&quot;
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl text-center">
              ไม่พบข้อมูลผู้ใช้ LINE กรุณารีเฟรชหรือเลือกลูกบ้านที่ติดต่อเข้ามา
            </div>
          )}

          {/* Smart Auto-Detection Prompt */}
          {detectedRoomNo && detectedRoomNo !== selectedRoomNo && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center justify-between gap-2 text-amber-900">
              <div className="flex items-center gap-2">
                <span className="text-base">💡</span>
                <span>
                  ตรวจพบเลขห้องที่น่าจะตรงกัน: <b>ห้อง {formatRoomNo(detectedRoomNo)}</b>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRoomNo(detectedRoomNo)}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[11px] shrink-0"
              >
                เลือกห้องนี้
              </button>
            </div>
          )}

          {/* Room Selector */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700 block">
              🏢 เลือกห้องที่ต้องการผูกให้ลูกบ้านท่านนี้:
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="🔍 พิมพ์ค้นหาเลขห้อง หรือชื่อเจ้าของ..."
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <select
              value={selectedRoomNo}
              onChange={(e) => setSelectedRoomNo(e.target.value)}
              required
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
            >
              <option value="">-- กรุณาเลือกห้อง (รวมทั้งหมด {rooms.length} ห้อง) --</option>
              {filteredRooms.map((r) => {
                const isLinked = !!r.line_user_id;
                const statusTag = isLinked
                  ? r.line_user_id === currentUser?.line_user_id
                    ? '✅ ผูกกับบัญชีนี้อยู่แล้ว'
                    : '⚠️ มีการผูกแล้ว'
                  : '🟢 ว่าง (ยังไม่ผูก)';
                return (
                  <option key={r.room_no} value={r.room_no}>
                    ห้อง {formatRoomNo(r.room_no)} - {r.owner_name || r.tenant_name || 'ไม่ระบุชื่อ'} ({statusTag})
                  </option>
                );
              })}
            </select>
          </div>

          {/* Selected Room Details Preview */}
          {targetRoom && (
            <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-3.5 space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="font-bold text-emerald-900 text-sm">
                  ห้อง {formatRoomNo(targetRoom.room_no)}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    isRoomAlreadyLinked
                      ? isLinkedToSameUser
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {isRoomAlreadyLinked
                    ? isLinkedToSameUser
                      ? 'ผูกกับคนนี้อยู่แล้ว'
                      : 'ผูกกับ LINE อื่นอยู่'
                    : 'ห้องว่างยังไม่ผูก'}
                </span>
              </div>
              <div className="text-slate-600 grid grid-cols-2 gap-1 text-[11px]">
                <div>
                  เจ้าของ: <b>{targetRoom.owner_name || '-'}</b>
                </div>
                <div>
                  ผู้เช่า: <b>{targetRoom.tenant_name || '-'}</b>
                </div>
                <div>
                  เบอร์โทร: <b>{targetRoom.owner_phone || targetRoom.tenant_phone || '-'}</b>
                </div>
                <div>
                  ประเภทห้อง: <b>{targetRoom.room_type || '-'}</b>
                </div>
              </div>

              {isRoomAlreadyLinked && !isLinkedToSameUser && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-2 text-amber-800 text-[11px] leading-relaxed">
                  ⚠️ <b>ข้อควรระวัง:</b> ห้องนี้เคยผูกกับ LINE ID อื่นไว้แล้ว
                  หากกดยืนยัน ระบบจะยกเลิกคนเดิมและเปลี่ยนผู้รับข้อมูลเป็นคุณ &quot;
                  {currentUser?.display_name || 'ลูกบ้าน'}&quot; แทนทันที
                </div>
              )}
            </div>
          )}

          {/* Quick Chat Box to Resident */}
          <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <label className="font-bold text-slate-800 block">
                💬 ข้อความแชทส่งตอบกลับเข้า LINE ลูกบ้าน (ลูกบ้านไม่ต้องพิมพ์อะไรเลย):
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => applyPreset('standard')}
                  className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded-md text-[10px] font-medium text-slate-700"
                >
                  👋 ต้อนรับมาตรฐาน
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('bill')}
                  className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded-md text-[10px] font-medium text-slate-700"
                >
                  🧾 บิล &amp; ยอดชำระ
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('short')}
                  className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded-md text-[10px] font-medium text-slate-700"
                >
                  💬 สั้นกระชับ
                </button>
              </div>
            </div>

            <textarea
              rows={4}
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="พิมพ์ข้อความที่ต้องการส่งเข้า LINE ลูกบ้าน..."
              className="w-full border border-slate-300 rounded-xl p-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white leading-relaxed font-sans"
            />

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sendWelcomePush"
                checked={sendWelcomePush}
                onChange={(e) => setSendWelcomePush(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <label htmlFor="sendWelcomePush" className="text-slate-600 cursor-pointer select-none text-[11px]">
                ส่งข้อความนี้เข้าแชท LINE ของลูกบ้านท่านนี้ทันทีเมื่อผูกสำเร็จ
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={onClose}
              disabled={isLinking}
              className="px-4 py-2 border border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-100 transition"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isLinking || !selectedRoomNo || !currentUser}
              className={`px-5 py-2 font-bold text-white rounded-xl shadow-md transition flex items-center gap-2 ${
                isLinking || !selectedRoomNo || !currentUser
                  ? 'bg-slate-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'
              }`}
            >
              {isLinking ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  กำลังผูกห้อง...
                </>
              ) : (
                <>
                  <span>🚀 ส่งข้อความ &amp; ผูกห้องทันที</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
