'use client';

// Room Details & Wallet (Contribution Credit & Prepaid Deposit) Modal
// Version 1.4 - Zero Floor Reference + Editable Starting Meter & Outstanding Balance

import React, { useState, useEffect } from 'react';
import { Room, WalletLedgerItem } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';
import { formatRoomNo } from '@/utils/billing';

interface RoomDetailModalProps {
  room: Room;
  onClose: () => void;
  onRoomUpdated: (updatedRoom: Room) => void;
}

export const RoomDetailModal: React.FC<RoomDetailModalProps> = ({
  room,
  onClose,
  onRoomUpdated,
}) => {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'info' | 'wallet' | 'status'>('info');

  // Form states
  const [status, setStatus] = useState(room.status || 'ปกติ');
  const [roomType, setRoomType] = useState(room.room_type || 'ห้องเล็ก');
  const [primaryPayer, setPrimaryPayer] = useState(room.primary_payer || 'เจ้าของ');
  const [ownerName, setOwnerName] = useState(room.owner_name || '');
  const [ownerPhone, setOwnerPhone] = useState(room.owner_phone || '');
  const [tenantName, setTenantName] = useState(room.tenant_name || '');
  const [tenantPhone, setTenantPhone] = useState(room.tenant_phone || '');
  const [lineUserId, setLineUserId] = useState(room.line_user_id || '');
  const [language, setLanguage] = useState(room.language || 'ไทย');
  const [latestMeter, setLatestMeter] = useState(String(room.latest_meter || 0));
  const [outstandingBalance, setOutstandingBalance] = useState(String(room.outstanding_balance || 0));
  const [note, setNote] = useState(room.note || '');

  // Wallet operations
  const [walletAmount, setWalletAmount] = useState<string>('');
  const [walletDesc, setWalletDesc] = useState<string>('');
  const [ledger, setLedger] = useState<WalletLedgerItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadLedger = async () => {
    const { data } = await supabase
      .from('wallet_ledger')
      .select('*')
      .eq('room_no', room.room_no)
      .order('created_at', { ascending: false });
    if (data) setLedger(data as WalletLedgerItem[]);
  };

  useEffect(() => {
    loadLedger();
  }, [room.room_no]);

  const handleSaveInfo = async () => {
    setIsSubmitting(true);
    setMessage(null);
    try {
      const { data, error } = await supabase
        .from('rooms')
        .update({
          status,
          room_type: roomType,
          primary_payer: primaryPayer,
          owner_name: ownerName,
          owner_phone: ownerPhone,
          tenant_name: tenantName,
          tenant_phone: tenantPhone,
          line_user_id: lineUserId,
          language,
          latest_meter: Number(latestMeter) || 0,
          outstanding_balance: Number(outstandingBalance) || 0,
          note,
          updated_at: new Date().toISOString(),
        })
        .eq('room_no', room.room_no)
        .select()
        .single();

      if (error) throw error;
      onRoomUpdated(data as Room);
      setMessage({ text: 'บันทึกข้อมูลห้องสำเร็จ', type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'บันทึกล้มเหลว: ' + err.message, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddContribution = async () => {
    const amount = parseFloat(walletAmount);
    if (!amount || amount <= 0) {
      setMessage({ text: 'กรุณากรอกจำนวนเงินที่ถูกต้อง', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    try {
      const newBalance = (Number(room.contribution_credit) || 0) + amount;

      const { data: updatedRoom, error: roomErr } = await supabase
        .from('rooms')
        .update({
          contribution_credit: newBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('room_no', room.room_no)
        .select()
        .single();

      if (roomErr) throw roomErr;

      await supabase.from('wallet_ledger').insert({
        room_no: room.room_no,
        wallet_type: 'contribution',
        entry_type: 'credit_in',
        amount,
        balance_after: newBalance,
        description_th: walletDesc || 'สมทบทุนซ่อมบำรุงตึก',
        description_en: 'Building maintenance fund contribution',
        created_by: 'admin',
      });

      await supabase.from('transactions').insert({
        fund_type: 'maintenance_fund',
        type: 'รายรับ',
        category: 'เงินสมทบทุนซ่อมบำรุง',
        amount,
        tx_date: new Date().toISOString().split('T')[0],
        room_no: room.room_no,
        payment_method: 'โอนเงิน',
        note: `ห้อง ${formatRoomNo(room.room_no)} สมทบทุนซ่อมตึก (${walletDesc || '-'})`,
      });

      onRoomUpdated(updatedRoom as Room);
      setWalletAmount('');
      setWalletDesc('');
      loadLedger();
      setMessage({ text: `บันทึกเงินสมทบทุน ${amount.toLocaleString()} บาท สำเร็จ`, type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'เกิดข้อผิดพลาด: ' + err.message, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddPrepaid = async () => {
    const amount = parseFloat(walletAmount);
    if (!amount || amount <= 0) {
      setMessage({ text: 'กรุณากรอกจำนวนเงินที่ถูกต้อง', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    try {
      const newBalance = (Number(room.prepaid_credit) || 0) + amount;

      const { data: updatedRoom, error: roomErr } = await supabase
        .from('rooms')
        .update({
          prepaid_credit: newBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('room_no', room.room_no)
        .select()
        .single();

      if (roomErr) throw roomErr;

      await supabase.from('wallet_ledger').insert({
        room_no: room.room_no,
        wallet_type: 'prepaid',
        entry_type: 'credit_in',
        amount,
        balance_after: newBalance,
        description_th: walletDesc || 'รับเงินฝากล่วงหน้า',
        description_en: 'Prepaid deposit received',
        created_by: 'admin',
      });

      onRoomUpdated(updatedRoom as Room);
      setWalletAmount('');
      setWalletDesc('');
      loadLedger();
      setMessage({ text: `รับเงินฝากล่วงหน้า ${amount.toLocaleString()} บาท สำเร็จ`, type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'เกิดข้อผิดพลาด: ' + err.message, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForfeitContributionOnSale = async () => {
    const currentContrib = Number(room.contribution_credit) || 0;
    if (currentContrib <= 0) {
      setMessage({ text: 'ห้องนี้ไม่มียอดสมทบคงเหลือ', type: 'error' });
      return;
    }

    const confirmAction = window.confirm(
      `ยืนยันการตัดยอดเครดิตสมทบทุนจำนวน ${currentContrib.toLocaleString()} บาท ออกเนื่องจากมีการขาย/โอนห้องชุด?\n(ยอดนี้จะถูกเคลียร์เป็น 0 บาทตามนโยบาย)`
    );
    if (!confirmAction) return;

    setIsSubmitting(true);
    try {
      const { data: updatedRoom, error: roomErr } = await supabase
        .from('rooms')
        .update({
          contribution_credit: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('room_no', room.room_no)
        .select()
        .single();

      if (roomErr) throw roomErr;

      await supabase.from('wallet_ledger').insert({
        room_no: room.room_no,
        wallet_type: 'contribution',
        entry_type: 'forfeit_on_sale',
        amount: -currentContrib,
        balance_after: 0,
        description_th: 'ตัดเครดิตสมทบทุนคงเหลือเนื่องจากขาย/โอนห้อง',
        description_en: 'Contribution credit forfeited upon room sale',
        created_by: 'admin',
      });

      onRoomUpdated(updatedRoom as Room);
      loadLedger();
      setMessage({ text: `ตัดยอดเครดิตสมทบทุนเรียบร้อยแล้ว`, type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'เกิดข้อผิดพลาด: ' + err.message, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header (No Floor Reference) */}
        <div className="bg-slate-900 text-white px-5 py-3 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-sky-400">ห้อง {formatRoomNo(room.room_no)}</h3>
            <p className="text-xs text-slate-400">ประเภท: {room.room_type} • สถานะ: {room.status}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b bg-slate-50 text-xs font-medium">
          <button
            onClick={() => setActiveTab('info')}
            className={`flex-1 py-2.5 border-b-2 text-center ${
              activeTab === 'info'
                ? 'border-blue-600 text-blue-600 font-bold bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            📋 ข้อมูลห้อง & ผู้ติดต่อ
          </button>
          <button
            onClick={() => setActiveTab('wallet')}
            className={`flex-1 py-2.5 border-b-2 text-center ${
              activeTab === 'wallet'
                ? 'border-blue-600 text-blue-600 font-bold bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            💰 เครดิตสมทบ & เงินฝาก
          </button>
          <button
            onClick={() => setActiveTab('status')}
            className={`flex-1 py-2.5 border-b-2 text-center ${
              activeTab === 'status'
                ? 'border-blue-600 text-blue-600 font-bold bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            ⚠️ สถานะห้อง & หนี้ค้าง
          </button>
        </div>

        {message && (
          <div
            className={`mx-4 mt-3 p-2.5 rounded-lg text-xs flex justify-between items-center ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} className="font-bold">✕</button>
          </div>
        )}

        {/* Tab 1: Info */}
        {activeTab === 'info' && (
          <div className="p-4 space-y-3 overflow-y-auto flex-1 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 font-medium block mb-1">ประเภทห้อง (ค่าส่วนกลาง)</label>
                <select
                  value={roomType}
                  onChange={(e) => setRoomType(e.target.value)}
                  className="w-full border rounded-lg p-2 bg-white"
                >
                  <option value="ห้องเล็ก">ห้องเล็ก (300 บาท/เดือน)</option>
                  <option value="ห้องใหญ่">ห้องใหญ่ (500 บาท/เดือน)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-600 font-medium block mb-1">ส่งบิลให้ใคร</label>
                <select
                  value={primaryPayer}
                  onChange={(e) => setPrimaryPayer(e.target.value)}
                  className="w-full border rounded-lg p-2 bg-white"
                >
                  <option value="เจ้าของ">เจ้าของห้อง</option>
                  <option value="ผู้เช่า">ผู้เช่า</option>
                  <option value="ทั้งคู่">ส่งทั้งคู่</option>
                </select>
              </div>
            </div>

            <div className="border-t pt-2 mt-2">
              <h4 className="font-bold text-slate-800 mb-2">เจ้าของห้อง</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 block mb-0.5">ชื่อ-นามสกุล</label>
                  <input
                    type="text"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="เช่น สมชาย ใจดี"
                    className="w-full border rounded p-1.5"
                  />
                </div>
                <div>
                  <label className="text-slate-500 block mb-0.5">เบอร์โทรศัพท์ (ใช้ผูก LINE 3 ตัวท้าย)</label>
                  <input
                    type="tel"
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    placeholder="08X-XXX-XXXX"
                    className="w-full border rounded p-1.5"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-2 mt-2">
              <h4 className="font-bold text-slate-800 mb-2">ผู้เช่า (ถ้ามี)</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 block mb-0.5">ชื่อผู้เช่า</label>
                  <input
                    type="text"
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    placeholder="ชื่อผู้เช่า"
                    className="w-full border rounded p-1.5"
                  />
                </div>
                <div>
                  <label className="text-slate-500 block mb-0.5">เบอร์โทรผู้เช่า</label>
                  <input
                    type="tel"
                    value={tenantPhone}
                    onChange={(e) => setTenantPhone(e.target.value)}
                    placeholder="08X-XXX-XXXX"
                    className="w-full border rounded p-1.5"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-2 mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="text-slate-500 block mb-0.5">เลขมิเตอร์น้ำล่าสุด</label>
                <input
                  type="number"
                  value={latestMeter}
                  onChange={(e) => setLatestMeter(e.target.value)}
                  className="w-full border rounded p-1.5 font-mono font-bold text-blue-700"
                />
              </div>
              <div>
                <label className="text-slate-500 block mb-0.5">ยอดหนี้ค้างชำระยกมา (บาท)</label>
                <input
                  type="number"
                  step="any"
                  value={outstandingBalance}
                  onChange={(e) => setOutstandingBalance(e.target.value)}
                  className="w-full border rounded p-1.5 font-mono font-bold text-red-600"
                />
              </div>
            </div>

            <div className="border-t pt-2 mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="text-slate-500 block mb-0.5">LINE User ID</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={lineUserId}
                    onChange={(e) => setLineUserId(e.target.value)}
                    placeholder="ยังไม่ได้ผูก LINE"
                    className="w-full border rounded p-1.5 font-mono"
                  />
                  {lineUserId && (
                    <button
                      type="button"
                      onClick={() => setLineUserId('')}
                      className="px-2 bg-red-100 text-red-700 rounded font-bold shrink-0"
                      title="ล้างค่าเพื่อยกเลิกผูก LINE"
                    >
                      ล้าง
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-slate-500 block mb-0.5">ภาษาที่ใช้สื่อสาร</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full border rounded p-1.5 bg-white"
                >
                  <option value="ไทย">ภาษาไทย (TH)</option>
                  <option value="อังกฤษ">English (EN)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-slate-500 block mb-0.5">หมายเหตุประจำห้อง</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="บันทึกข้อความภายใน เช่น มีปัญหาน้ำรั่วซึมบ่อย"
                rows={2}
                className="w-full border rounded p-1.5"
              />
            </div>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSaveInfo}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg mt-2"
            >
              {isSubmitting ? 'กำลังบันทึก...' : '💾 บันทึกข้อมูลห้อง'}
            </button>
          </div>
        )}

        {/* Tab 2: Wallets (Contribution & Prepaid) */}
        {activeTab === 'wallet' && (
          <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
                <div className="text-emerald-700 font-bold mb-0.5">💰 เครดิตสมทบทุนซ่อมตึก</div>
                <div className="text-xl font-bold text-emerald-900 font-mono">
                  {(Number(room.contribution_credit) || 0).toLocaleString()} <span className="text-xs font-normal">บาท</span>
                </div>
                <div className="text-[10px] text-emerald-600 mt-1">
                  *หักลดหย่อนค่าส่วนกลางอัตโนมัติ
                </div>
              </div>

              <div className="bg-sky-50 border border-sky-200 p-3 rounded-xl">
                <div className="text-sky-700 font-bold mb-0.5">💵 เงินฝากล่วงหน้า</div>
                <div className="text-xl font-bold text-sky-900 font-mono">
                  {(Number(room.prepaid_credit) || 0).toLocaleString()} <span className="text-xs font-normal">บาท</span>
                </div>
                <div className="text-[10px] text-sky-600 mt-1">
                  *หักค่าน้ำ/ค่าส่วนกลางได้ทุกรายการ
                </div>
              </div>
            </div>

            <div className="border rounded-xl p-3 bg-slate-50 space-y-2">
              <h4 className="font-bold text-slate-800">เพิ่มยอดเงิน / รับชำระล่วงหน้า</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 block mb-1">จำนวนเงิน (บาท)</label>
                  <input
                    type="number"
                    value={walletAmount}
                    onChange={(e) => setWalletAmount(e.target.value)}
                    placeholder="เช่น 6000"
                    className="w-full border rounded p-1.5 font-bold text-blue-700 bg-white"
                  />
                </div>
                <div>
                  <label className="text-slate-500 block mb-1">บันทึกช่วยจำ</label>
                  <input
                    type="text"
                    value={walletDesc}
                    onChange={(e) => setWalletDesc(e.target.value)}
                    placeholder="เช่น สมทบทุนซ่อมดาดฟ้า"
                    className="w-full border rounded p-1.5 bg-white"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleAddContribution}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-xs"
                >
                  ＋ สมทบทุนซ่อมตึก
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleAddPrepaid}
                  className="flex-1 py-2 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg text-xs"
                >
                  ＋ รับเงินฝากล่วงหน้า
                </button>
              </div>
            </div>

            <div className="border border-amber-200 bg-amber-50/70 p-3 rounded-xl flex items-center justify-between">
              <div>
                <div className="font-bold text-amber-900">กรณีขายห้องชุด / โอนกรรมสิทธิ์</div>
                <div className="text-[11px] text-amber-700">ตัดยอดสมทบทุนคงเหลือออกตามนโยบาย</div>
              </div>
              <button
                type="button"
                onClick={handleForfeitContributionOnSale}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-[11px]"
              >
                ตัดเครดิตสมทบออก
              </button>
            </div>

            <div>
              <h4 className="font-bold text-slate-800 mb-2">ประวัติการเคลื่อนไหว</h4>
              {ledger.length === 0 ? (
                <p className="text-slate-400 text-center py-4 bg-slate-50 rounded-lg">ยังไม่มีประวัติการเคลื่อนไหว</p>
              ) : (
                <div className="border rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-100 text-slate-600 sticky top-0">
                      <tr>
                        <th className="py-1 px-2 text-left">วันที่</th>
                        <th className="py-1 px-2 text-left">ประเภท</th>
                        <th className="py-1 px-2 text-right">จำนวน</th>
                        <th className="py-1 px-2 text-right">คงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {ledger.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="py-1 px-2 text-slate-500">
                            {new Date(item.created_at).toLocaleDateString('th-TH')}
                          </td>
                          <td className="py-1 px-2">
                            <span className={item.wallet_type === 'contribution' ? 'text-emerald-700' : 'text-sky-700'}>
                              {item.description_th || item.entry_type}
                            </span>
                          </td>
                          <td className={`py-1 px-2 text-right font-medium ${item.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {item.amount > 0 ? `+${item.amount.toLocaleString()}` : item.amount.toLocaleString()}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">
                            {item.balance_after.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Status / Problem Room */}
        {activeTab === 'status' && (
          <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
            <div>
              <label className="text-slate-700 font-bold block mb-1">สถานะห้อง</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border rounded-lg p-2 bg-white text-sm font-medium"
              >
                <option value="ปกติ">ปกติ (อยู่อาศัย / ปล่อยเช่าปกติ)</option>
                <option value="ติดต่อไม่ได้">⚠️ ติดต่อไม่ได้ (ออกบิลสะสมหนี้ ไม่ออกกระดาษ/LINE)</option>
                <option value="ธนาคารยึด">🏦 โดนธนาคารยึด (รอสถาบันการเงินประสานงาน)</option>
                <option value="รอขาย">🏷️ กำลังรอขาย (เตรียมปิดยอดเมื่อโอนกรรมสิทธิ์)</option>
              </select>
            </div>

            <div>
              <label className="text-slate-700 font-bold block mb-1">ยอดหนี้ค้างชำระสะสมยกมา (บาท)</label>
              <input
                type="number"
                step="any"
                value={outstandingBalance}
                onChange={(e) => setOutstandingBalance(e.target.value)}
                className="w-full border rounded-lg p-2 font-mono font-bold text-red-600 text-sm"
              />
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
              <h4 className="font-bold text-slate-800">แนวทางสำหรับห้องมีปัญหา:</h4>
              <ul className="list-disc list-inside text-slate-600 space-y-1 text-[11px]">
                <li>ระบบจะคำนวณบิลสะสมหนี้ไว้ทุกเดือนตามปกติ เพื่อใช้เป็นหลักฐานในการคิดเงิน</li>
                <li>ไม่เปลืองกระดาษพิมพ์บิล และไม่ส่ง LINE ให้รบกวน</li>
                <li>เมื่อมีผู้ซื้อหรือธนาคารติดต่อขอโอนกรรมสิทธิ์ สามารถเรียกเก็บยอดหนี้สะสมก่อนออกหนังสือรับรองปลอดหนี้ได้ทันที</li>
              </ul>
            </div>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSaveInfo}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg mt-2"
            >
              {isSubmitting ? 'กำลังบันทึก...' : '💾 บันทึกสถานะห้อง'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
