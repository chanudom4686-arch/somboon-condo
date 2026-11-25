'use client';

// Staff Meter Reading App (Dedicated Route: /meter)
// Version 1.3 - Pure Meter Reading Mode with Photo Thumbnails & Accurate Log Editing

import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Room, MeterLog, CondoConfig } from '@/types/condo';
import { formatRoomNo } from '@/utils/billing';
import { MeterReadingModal } from '@/components/MeterReadingModal';

export default function StaffMeterReadingPage() {
  const supabase = createClient();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [meterLogs, setMeterLogs] = useState<MeterLog[]>([]);
  const [config, setConfig] = useState<Partial<CondoConfig>>({});
  const [period, setPeriod] = useState<string>('2026-11');
  const [condoName, setCondoName] = useState<string>('สมบูรณ์คอนโดทาวน์ (645)');
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterFloor, setFilterFloor] = useState<number | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread' | 'read'>('all');

  // Active Reading Modal
  const [readingRoom, setReadingRoom] = useState<Room | null>(null);

  // Fetch rooms and current period logs
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Get current billing period and condo config
      const { data: configData } = await supabase.from('condo_config').select('key, value');
      let currentPeriod = '2026-11';
      const configMap: Record<string, string> = {};
      if (configData) {
        configData.forEach((c) => {
          configMap[c.key] = c.value;
          if (c.key === 'CURRENT_BILLING_PERIOD') currentPeriod = c.value;
          if (c.key === 'CONDO_NAME') setCondoName(c.value);
        });
      }
      setConfig(configMap);
      setPeriod(currentPeriod);

      // 2. Fetch all 195 rooms
      const { data: roomsData } = await supabase
        .from('rooms')
        .select('*')
        .order('room_no', { ascending: true });
      if (roomsData) setRooms(roomsData as Room[]);

      // 3. Fetch meter logs for this period
      const { data: logsData } = await supabase
        .from('meter_logs')
        .select('*')
        .eq('period', currentPeriod);
      if (logsData) setMeterLogs(logsData as MeterLog[]);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Map of logs by room_no
  const logMap = useMemo(() => {
    const map: Record<string, MeterLog> = {};
    meterLogs.forEach((l) => {
      map[l.room_no] = l;
    });
    return map;
  }, [meterLogs]);

  // Read progress
  const readCount = useMemo(() => meterLogs.length, [meterLogs]);
  const totalCount = rooms.length || 195;
  const readPercentage = Math.round((readCount / totalCount) * 100);

  // Filtered rooms
  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      const formatted = formatRoomNo(r.room_no);
      const matchesSearch =
        searchQuery === '' ||
        r.room_no.includes(searchQuery) ||
        formatted.includes(searchQuery);

      const matchesFloor = filterFloor === 'all' || r.floor === filterFloor;

      const isRead = !!logMap[r.room_no];
      let matchesStatus = true;
      if (filterStatus === 'unread') matchesStatus = !isRead;
      if (filterStatus === 'read') matchesStatus = isRead;

      return matchesSearch && matchesFloor && matchesStatus;
    });
  }, [rooms, searchQuery, filterFloor, filterStatus, logMap]);

  // Next unread room
  const getNextUnreadRoom = (currentRoomNo: string): Room | null => {
    const currentIndex = rooms.findIndex((r) => r.room_no === currentRoomNo);
    for (let i = currentIndex + 1; i < rooms.length; i++) {
      if (!logMap[rooms[i].room_no]) return rooms[i];
    }
    for (let i = 0; i < currentIndex; i++) {
      if (!logMap[rooms[i].room_no]) return rooms[i];
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 pb-12">
      {/* Top Mobile App Bar */}
      <header className="bg-slate-900 text-white sticky top-0 z-40 shadow-md">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">📱</span>
            <div>
              <h1 className="font-bold text-base leading-tight text-white">{condoName}</h1>
              <p className="text-xs text-sky-400 font-medium">แอปจดมิเตอร์น้ำ (พนักงาน) • v1.3</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-slate-400 block">รอบบิล</span>
            <span className="text-xs font-bold text-sky-400 font-mono bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              {period}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-3xl mx-auto px-3 py-4 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="w-9 h-9 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">กำลังโหลดข้อมูลห้อง...</p>
          </div>
        ) : (
          <>
            {/* Progress Card */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <div className="text-xs text-slate-500">ความคืบหน้าการจดมิเตอร์</div>
                  <div className="text-lg font-bold text-slate-800">
                    จดแล้ว <span className="text-blue-600 font-mono">{readCount}</span> / {totalCount} ห้อง ({readPercentage}%)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = rooms.find((r) => !logMap[r.room_no]);
                    if (next) setReadingRoom(next);
                    else alert('ยอดเยี่ยม! คุณจดมิเตอร์ครบ 195 ห้องแล้ว 🎉');
                  }}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow flex items-center gap-1.5 transition"
                >
                  ▶ ไปห้องที่ยังไม่จด
                </button>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-500 to-sky-400 h-full rounded-full transition-all duration-300"
                  style={{ width: `${readPercentage}%` }}
                />
              </div>
            </div>

            {/* Search & Floor Filters */}
            <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 space-y-2 text-xs">
              {/* Search Bar */}
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 text-sm">🔍</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="พิมพ์เลขห้องเพื่อค้นหา เช่น 005 หรือ 087..."
                  className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Status Filter Tabs */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setFilterStatus('all')}
                  className={`py-2 text-center rounded-xl font-bold transition ${
                    filterStatus === 'all'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  ทั้งหมด ({rooms.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('unread')}
                  className={`py-2 text-center rounded-xl font-bold transition ${
                    filterStatus === 'unread'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  ⏳ ยังไม่จด ({rooms.length - readCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('read')}
                  className={`py-2 text-center rounded-xl font-bold transition ${
                    filterStatus === 'read'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  ✅ จดแล้ว ({readCount})
                </button>
              </div>

              {/* Floor Buttons Horizontal Scroll */}
              <div className="flex gap-1.5 overflow-x-auto pt-1 pb-0.5">
                <button
                  type="button"
                  onClick={() => setFilterFloor('all')}
                  className={`px-3.5 py-1.5 rounded-xl whitespace-nowrap font-bold text-xs ${
                    filterFloor === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  ทุกชั้น
                </button>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((fl) => (
                  <button
                    key={fl}
                    type="button"
                    onClick={() => setFilterFloor(fl)}
                    className={`px-3.5 py-1.5 rounded-xl whitespace-nowrap font-bold text-xs ${
                      filterFloor === fl ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    ชั้น {fl}
                  </button>
                ))}
              </div>
            </div>

            {/* Room List */}
            <div className="space-y-2">
              {filteredRooms.length === 0 ? (
                <div className="bg-white p-8 text-center text-slate-400 rounded-2xl border">
                  ไม่พบห้องที่ตรงกับเงื่อนไขค้นหา
                </div>
              ) : (
                filteredRooms.map((room) => {
                  const log = logMap[room.room_no];
                  const isRead = !!log;
                  const prevM = log ? Number(log.prev_meter) : Number(room.latest_meter) || 0;
                  const currM = log ? Number(log.curr_meter) : prevM;
                  const units = log ? Number(log.units_used) : 0;

                  return (
                    <div
                      key={room.room_no}
                      onClick={() => setReadingRoom(room)}
                      className={`p-3 rounded-2xl border transition active:scale-[0.99] cursor-pointer flex items-center justify-between gap-3 shadow-sm ${
                        isRead ? 'bg-emerald-50/50 border-emerald-300' : 'bg-white border-slate-200'
                      }`}
                    >
                      {/* Left: Room Badge & Details */}
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold font-mono text-base shadow-sm shrink-0 ${
                            isRead
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-800 text-sky-400'
                          }`}
                        >
                          {room.room_no}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                            <span>{formatRoomNo(room.room_no)}</span>
                            <span className="text-[10px] text-slate-500 font-normal bg-slate-100 px-1.5 py-0.5 rounded">
                              ชั้น {room.floor}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">
                            ครั้งก่อน: <span className="font-mono font-bold">{prevM}</span>
                            {isRead && (
                              <span className="ml-2 text-emerald-800 font-medium">
                                ➔ ครั้งนี้: <b className="font-mono text-blue-700">{currM}</b> ({units} หน่วย)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Thumbnail + Status / Action Button */}
                      <div className="flex items-center gap-2.5">
                        {log?.meter_photo_url && (
                          <img
                            src={log.meter_photo_url}
                            alt={`มิเตอร์ ${room.room_no}`}
                            className="w-12 h-12 object-cover rounded-lg border border-emerald-300 shadow-xs shrink-0"
                          />
                        )}
                        <div className="text-right">
                          {isRead ? (
                            <div className="flex flex-col items-end">
                              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-full">
                                ✅ จดแล้ว
                              </span>
                              <span className="text-[10px] text-slate-500 mt-1 underline">
                                {log?.meter_photo_url ? 'กดเพื่อดู/แก้ไข' : '⚠️ ยังไม่มีรูป (กดเพิ่ม)'}
                              </span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="px-3.5 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl shadow-sm hover:bg-blue-700"
                            >
                              📸 จดมิเตอร์
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </main>

      {/* Meter Reading Camera Modal (keyed by room_no to guarantee fresh state) */}
      {readingRoom && (
        <MeterReadingModal
          key={readingRoom.room_no}
          room={readingRoom}
          period={period}
          existingLog={logMap[readingRoom.room_no] || null}
          config={config}
          onClose={() => setReadingRoom(null)}
          onSaved={(updatedRoom) => {
            setRooms((prev) =>
              prev.map((r) => (r.room_no === updatedRoom.room_no ? updatedRoom : r))
            );
            fetchData();
          }}
          onNextRoom={() => {
            const next = getNextUnreadRoom(readingRoom.room_no);
            if (next) {
              setReadingRoom(next);
            } else {
              setReadingRoom(null);
              alert('ยินดีด้วย! คุณจดมิเตอร์ครบ 195 ห้องแล้ว 🎉');
            }
          }}
        />
      )}
    </div>
  );
}
