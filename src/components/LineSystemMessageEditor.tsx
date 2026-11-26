'use client';

// LINE OA System Messages Editor with Drag-and-Drop Variable Chips & Live Phone Simulator
// Version 2.8 - Allows Full Customization of Welcome, Registration Steps, Error & Fallback Messages

import React, { useState, useRef } from 'react';
import { CondoConfig } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';

interface LineSystemMessageEditorProps {
  config: Partial<CondoConfig>;
  onSaved: () => void;
}

interface MessageDefinition {
  key: string;
  title: string;
  badge: string;
  description: string;
  defaultText: string;
  allowedTags: Array<{ tag: string; label: string; desc: string }>;
}

export const LineSystemMessageEditor: React.FC<LineSystemMessageEditorProps> = ({ config, onSaved }) => {
  const supabase = createClient();
  const condoName = config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (645)';

  const MESSAGE_DEFINITIONS: MessageDefinition[] = [
    {
      key: 'LINE_GREETING_MESSAGE',
      title: 'ข้อความเริ่มต้นเมื่อพิมพ์ไม่ตรงคีย์เวิร์ด (Default Fallback)',
      badge: '💬 ทักทายทั่วไป',
      description: 'ข้อความที่บอทตอบกลับอัตโนมัติเมื่อลูกบ้านพิมพ์คำทั่วไปที่ไม่ตรงกับคำสั่งใดๆ',
      defaultText:
        config.LINE_GREETING_MESSAGE ||
        `สวัสดีครับ ยินดีต้อนรับสู่ LINE OA {condo_name} 🏢\nWelcome to {condo_name} Official LINE!\n\n📌 การลงทะเบียนผูกห้องชุด / Room Registration:\n• กดปุ่ม "ลงทะเบียน" ที่ริชเมนูด้านล่าง หรือพิมพ์คำว่า "ลงทะเบียน" / "Register"\n  Tap "Register" on the Rich Menu or type "ลงทะเบียน" / "Register"\n\n📌 คำสั่งตรวจสอบข้อมูล / Commands (หลังลงทะเบียนแล้ว):\n• พิมพ์ "ดูบิล" หรือ "bill" — ดูใบแจ้งหนี้ / Current bill\n• พิมพ์ "ใบเสร็จ" หรือ "receipt" — ดูใบเสร็จรับเงิน / Receipt\n• พิมพ์ "สเตทเมนท์" หรือ "statement" — ประวัติชำระ 12 เดือน / 12-month history\n• พิมพ์ "เมนู" หรือ "menu" — ดูคำสั่งทั้งหมด / All commands\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น. (12:00 PM - 12:00 AM)`,
      allowedTags: [
        { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
        { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
      ],
    },
    {
      key: 'LINE_WELCOME_NEW_FRIEND',
      title: 'ข้อความต้อนรับผู้ใช้ใหม่เมื่อกดเพิ่มเพื่อน (Follow Event)',
      badge: '👋 แอดไลน์ครั้งแรก',
      description: 'ข้อความแรกที่จะเด้งเข้าแชททันทีเมื่อมีคนกด Add Friend เข้ามาใน LINE OA คอนโด',
      defaultText:
        config.LINE_WELCOME_NEW_FRIEND ||
        `สวัสดีครับ ยินดีต้อนรับสู่ LINE OA {condo_name} 🏢\nWelcome to {condo_name} Official LINE!\n\n📌 วิธีลงทะเบียนผูกห้องชุด / How to Register:\nกรุณากดปุ่ม "ลงทะเบียน" ที่ริชเมนูด้านล่าง (หรือพิมพ์คำว่า "ลงทะเบียน" / "Register") เพื่อผูกห้องชุดรับบิลค่าน้ำและค่าส่วนกลาง\nPlease tap "ลงทะเบียน (Register)" on the Rich Menu below (or type "ลงทะเบียน" / "Register") to link your room.\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours:\n12.00 - 24.00 น. (12:00 PM - 12:00 AM) ทุกวัน / Daily`,
      allowedTags: [
        { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
        { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
      ],
    },
    {
      key: 'LINE_REG_PROMPT_PHONE',
      title: 'ขั้นตอนลงทะเบียน (1): เมื่อพิมพ์เลขห้องแล้วถามหาเบอร์ 4 ตัวท้าย',
      badge: '📱 ขอเบอร์ยืนยัน',
      description: 'ส่งหาลูกบ้านเพื่อยืนยันตัวตนตามหลักความปลอดภัย PDPA เมื่อลูกบ้านพิมพ์เลขห้องเข้ามา',
      defaultText:
        config.LINE_REG_PROMPT_PHONE ||
        `🔍 ตรวจพบข้อมูลห้องชุด {room_no}\n👤 ผู้ลงทะเบียน / Resident: คุณ {owner_name}\n\n🔒 เพื่อความปลอดภัยตามหลัก PDPA กรุณาพิมพ์ "ตัวเลข 4 ตัวท้าย" ของเบอร์โทรศัพท์ที่ลงทะเบียนไว้กับห้องชุดนี้ เพื่อยืนยันตัวตนครับ\nFor security reasons, please type the last 4 digits of your registered phone number.\n\n(หากต้องการเปลี่ยนห้องชุด สามารถพิมพ์เลขห้องใหม่ได้ตลอดเวลา)\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      allowedTags: [
        { tag: '{room_no}', label: 'เลขห้อง', desc: '645/64-65' },
        { tag: '{owner_name}', label: 'ชื่อเจ้าของ', desc: 'คุณสมศักดิ์' },
        { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      ],
    },
    {
      key: 'LINE_REG_SUCCESS',
      title: 'ขั้นตอนลงทะเบียน (2): เมื่อยืนยันเบอร์ถูกต้องและผูกห้องสำเร็จ',
      badge: '🎉 ผูกห้องสำเร็จ',
      description: 'ส่งแจ้งลูกบ้านทันทีที่ยืนยันเบอร์โทรศัพท์ 4 ตัวท้ายตรงกับข้อมูลในระบบ พร้อมแสดงเมนูคำสั่ง',
      defaultText:
        config.LINE_REG_SUCCESS ||
        `🎉 ลงทะเบียนผูกห้อง {room_no} สำเร็จแล้วครับ!\nRegistration Complete for Room(s): {room_no}!\n👤 ผู้รับข้อมูล / Resident: คุณ {owner_name}\n\n📌 คำสั่งตรวจสอบข้อมูลอัตโนมัติ (Thai / English Commands):\n• พิมพ์ "ดูบิล" หรือ "bill" — ดูใบแจ้งหนี้ทุกห้องที่ผูกไว้ / View current bill\n• พิมพ์ "ใบเสร็จ" หรือ "receipt" — ดูใบเสร็จรับเงิน / Payment receipt\n• พิมพ์ "สเตทเมนท์" หรือ "statement" — ประวัติชำระ 12 เดือน / 12-month history\n• พิมพ์ "เงินระดมทุน" หรือ "fund" — ยอดเงินระดมทุนซ่อมตึก / Maintenance fund\n• พิมพ์ "การเงิน" หรือ "finance" — สรุปรายรับ-รายจ่ายตึก / Building finance\n• พิมพ์ "เลขบัญชี" หรือ "bank" — ช่องทางโอนเงิน / Bank account\n• พิมพ์ "เมนู" หรือ "menu" — ดูคำสั่งทั้งหมด / All commands\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      allowedTags: [
        { tag: '{room_no}', label: 'เลขห้อง', desc: '645/64-65' },
        { tag: '{owner_name}', label: 'ชื่อเจ้าของ', desc: 'คุณสมศักดิ์' },
        { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      ],
    },
    {
      key: 'LINE_REG_PHONE_ERROR',
      title: 'ขั้นตอนลงทะเบียน (3): เมื่อพิมพ์เลข 4 ตัวท้ายไม่ตรง',
      badge: '❌ เบอร์ไม่ตรง',
      description: 'ส่งแจ้งเตือนเมื่อลูกบ้านกรอกเลข 4 ตัวท้ายไม่ตรงกับฐานข้อมูลของห้องชุดนั้นๆ',
      defaultText:
        config.LINE_REG_PHONE_ERROR ||
        `❌ ตัวเลข 4 ตัวท้ายที่พิมพ์มา ไม่ตรงกับเบอร์โทรศัพท์ที่ลงทะเบียนไว้ของห้อง {room_no} ({masked_phone})\nThe last 4 digits do not match our records.\n\n• กรุณาพิมพ์ตัวเลข 4 ตัวท้ายของเบอร์โทรศัพท์อีกครั้ง\n  Please enter the last 4 digits again.\n• หรือพิมพ์เลขห้องใหม่ (เช่น 001 หรือ 001,002) หากต้องการเปลี่ยนห้อง\n  Or type room number(s) again (e.g. 001 or 001,002).\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      allowedTags: [
        { tag: '{room_no}', label: 'เลขห้อง', desc: '645/64-65' },
        { tag: '{masked_phone}', label: 'เบอร์ซ่อนท้าย', desc: '089-xxx-6273' },
      ],
    },
    {
      key: 'LINE_PDPA_WARNING',
      title: 'แจ้งเตือนความปลอดภัย PDPA: ผู้ใช้ยังไม่ลงทะเบียนพยายามดูบิล',
      badge: '🔒 เตือนความปลอดภัย',
      description: 'ส่งแจ้งเตือนเมื่อมีคนพิมพ์ "ดูบิล", "ใบเสร็จ" หรือ "สเตทเมนท์" โดยที่บัญชี LINE ยังไม่ได้ผูกห้องชุด',
      defaultText:
        config.LINE_PDPA_WARNING ||
        `🔒 ตามหลักคุ้มครองข้อมูลส่วนบุคคล (PDPA) กรุณาลงทะเบียนผูกห้องชุดก่อนดูข้อมูลบิล รูปมิเตอร์ และสเตทเมนท์ครับ\nPlease register your room before viewing bills, meter photos, or statements.\n\n📌 วิธีลงทะเบียน / How to Register:\nกดปุ่ม "ลงทะเบียน" ที่ริชเมนูด้านล่าง หรือพิมพ์คำว่า "ลงทะเบียน" / "Register" (หรือพิมพ์เลขห้อง เช่น 001 หรือหลายห้อง 001,002)\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      allowedTags: [
        { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      ],
    },
    {
      key: 'LINE_UNLINK_SUCCESS',
      title: 'ข้อความยืนยันเมื่อพิมพ์ "ยกเลิกผูกห้อง" (Unlink Complete)',
      badge: '🔓 ยกเลิกผูกห้อง',
      description: 'ส่งแจ้งยืนยันเมื่อลูกบ้านพิมพ์คำว่า "ยกเลิกผูกห้อง", "ยกเลิกลงทะเบียน" หรือ "unlink"',
      defaultText:
        config.LINE_UNLINK_SUCCESS ||
        `✅ ยกเลิกการผูกห้องชุดเรียบร้อยแล้วครับ\nRoom unlinked successfully.\n\nหากต้องการลงทะเบียนผูกห้องใหม่ สามารถพิมพ์ "ลงทะเบียน" หรือพิมพ์เลขห้องได้ตลอดเวลาครับ\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      allowedTags: [
        { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      ],
    },
  ];

  // Active selected message key
  const [selectedKey, setSelectedKey] = useState<string>(MESSAGE_DEFINITIONS[0].key);

  // Local draft dictionary of messages
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>(() => {
    const drafts: Record<string, string> = {};
    MESSAGE_DEFINITIONS.forEach((def) => {
      drafts[def.key] = (config as any)[def.key] || def.defaultText;
    });
    return drafts;
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeDef = MESSAGE_DEFINITIONS.find((d) => d.key === selectedKey) || MESSAGE_DEFINITIONS[0];
  const currentText = messageDrafts[selectedKey] || activeDef.defaultText;

  // Insert tag at current cursor position in textarea
  const insertTagAtCursor = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMessageDrafts((prev) => ({
        ...prev,
        [selectedKey]: (prev[selectedKey] || '') + tag,
      }));
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = currentText;
    const nextVal = val.substring(0, start) + tag + val.substring(end);

    setMessageDrafts((prev) => ({
      ...prev,
      [selectedKey]: nextVal,
    }));

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 50);
  };

  const handleResetToDefault = () => {
    if (confirm(`คุณต้องการคืนค่าข้อความ "${activeDef.title}" เป็นข้อความมาตรฐานของระบบหรือไม่?`)) {
      setMessageDrafts((prev) => ({
        ...prev,
        [selectedKey]: activeDef.defaultText,
      }));
    }
  };

  const handleSaveCurrentMessage = async () => {
    setIsSaving(true);
    setSaveToast(null);

    try {
      const textToSave = messageDrafts[selectedKey] || '';
      const { error } = await supabase.from('condo_config').upsert(
        {
          key: selectedKey,
          value: textToSave,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );

      if (error) throw error;

      setSaveToast(`บันทึก "${activeDef.title}" เรียบร้อยแล้ว!`);
      onSaved();
      setTimeout(() => setSaveToast(null), 3000);
    } catch (err: any) {
      console.error('Save system message error:', err);
      alert('เกิดข้อผิดพลาดในการบันทึก: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Preview replacement with mock data
  const previewText = currentText
    .replace(/\{condo_name\}/g, condoName)
    .replace(/\{room_no\}/g, '645/64-65')
    .replace(/\{owner_name\}/g, 'สมศักดิ์ ชัยชนะ')
    .replace(/\{masked_phone\}/g, '089-xxx-6273')
    .replace(/\{admin_hours\}/g, '12.00 - 24.00 น.');

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <span>💬 จัดการข้อความในระบบ (System Message Studio)</span>
            <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-bold">
              ลากวาง &amp; ตัวอย่างเสมือนจริง
            </span>
          </h2>
          <p className="text-slate-500">
            ปรับแต่งข้อความต้อนรับ ข้อความขั้นตอนการลงทะเบียน และข้อความแจ้งเตือนต่างๆ พร้อมระบบลากวางตัวแปร
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saveToast && (
            <span className="text-emerald-700 font-bold bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-300 animate-fade-in">
              ✅ {saveToast}
            </span>
          )}
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveCurrentMessage}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition"
          >
            <span>💾</span>
            <span>{isSaving ? 'กำลังบันทึก...' : 'บันทึกข้อความนี้'}</span>
          </button>
        </div>
      </div>

      {/* Message Type Selector Pills */}
      <div className="flex flex-wrap gap-1.5 p-1.5 bg-slate-100 rounded-xl">
        {MESSAGE_DEFINITIONS.map((def) => {
          const isSelected = def.key === selectedKey;
          return (
            <button
              key={def.key}
              type="button"
              onClick={() => setSelectedKey(def.key)}
              className={`px-3 py-2 rounded-lg font-bold text-left transition flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-white text-blue-800 shadow-xs border border-blue-200'
                  : 'text-slate-600 hover:bg-white/60'
              }`}
            >
              <span>{def.badge}</span>
              <span className="truncate max-w-[160px] sm:max-w-none">{def.title.split('(')[0].trim()}</span>
            </button>
          );
        })}
      </div>

      {/* Editor & Live Phone Simulator Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-1">
        {/* Left Column: Editor & Drag/Click Chips (7 Cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
            <div className="font-bold text-slate-800 flex items-center gap-2">
              <span className="text-base">{activeDef.badge}</span>
              <span className="text-sm text-blue-900">{activeDef.title}</span>
            </div>
            <p className="text-slate-500 text-[11px]">{activeDef.description}</p>
          </div>

          {/* Draggable & Clickable Chips */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-slate-700">
                ✨ บล็อกตัวแปรอัจฉริยะ (คลิกเพื่อแทรก หรือ ลากไปวางในช่องข้อความ):
              </span>
              <button
                type="button"
                onClick={handleResetToDefault}
                className="text-slate-500 hover:text-rose-600 font-medium underline"
                title="ล้างข้อความและคืนค่าเป็นค่ามาตรฐานของระบบ"
              >
                🔄 คืนค่ามาตรฐาน
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {activeDef.allowedTags.map((tagItem) => (
                <div
                  key={tagItem.tag}
                  draggable={true}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', tagItem.tag);
                  }}
                  onClick={() => insertTagAtCursor(tagItem.tag)}
                  className="cursor-pointer select-none bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-800 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 font-bold shadow-2xs transition active:scale-95"
                  title={`คลิกหรือลากเพื่อแทรก ${tagItem.tag} (ตัวอย่าง: ${tagItem.desc})`}
                >
                  <span className="font-mono text-xs">{tagItem.tag}</span>
                  <span className="text-[10px] text-blue-600 font-normal">({tagItem.label})</span>
                </div>
              ))}
            </div>
          </div>

          {/* Message Textarea */}
          <div className="space-y-1">
            <label className="font-bold text-slate-700 block">เนื้อหาข้อความ (Message Content):</label>
            <textarea
              ref={textareaRef}
              rows={12}
              value={currentText}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const tag = e.dataTransfer.getData('text/plain');
                if (tag) insertTagAtCursor(tag);
              }}
              onChange={(e) =>
                setMessageDrafts((prev) => ({
                  ...prev,
                  [selectedKey]: e.target.value,
                }))
              }
              className="w-full border border-slate-300 rounded-xl p-3 bg-white font-mono text-xs leading-relaxed focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-2xs"
              placeholder="พิมพ์ข้อความที่นี่..."
            />
          </div>

          <div className="flex justify-between items-center text-[11px] text-slate-400">
            <span>ความยาว: {currentText.length} ตัวอักษร</span>
            <span>* รองรับ Emoji และการขึ้นบรรทัดใหม่ตามที่พิมพ์</span>
          </div>
        </div>

        {/* Right Column: Live Mobile LINE Simulator (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full max-w-[320px]">
            <div className="text-center font-bold text-slate-600 mb-2 flex items-center justify-center gap-1.5 text-xs">
              <span>📱</span>
              <span>ตัวอย่างแสดงผลใน LINE บนมือถือ (Live Preview)</span>
            </div>

            {/* Smartphone Mockup Frame */}
            <div className="w-full bg-slate-900 p-2.5 rounded-[36px] shadow-2xl border-4 border-slate-800">
              {/* Speaker & Camera notch */}
              <div className="flex justify-center mb-1.5">
                <div className="w-16 h-3.5 bg-black rounded-full" />
              </div>

              {/* Screen Area (LINE Chat Style) */}
              <div
                className="rounded-[26px] overflow-hidden flex flex-col h-[460px]"
                style={{ backgroundColor: '#7494C0' }} // Standard LINE Chat background
              >
                {/* LINE Header */}
                <div className="bg-[#2B3245] text-white px-3 py-2.5 flex items-center justify-between shrink-0 shadow-xs">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-xs">❮</span>
                    <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                      🏢
                    </div>
                    <span className="font-bold text-[11px] truncate">{condoName}</span>
                  </div>
                  <div className="text-[10px] text-slate-300">≡</div>
                </div>

                {/* LINE Chat Messages Area */}
                <div className="p-3 overflow-y-auto flex-1 space-y-3 flex flex-col justify-end">
                  {/* Date divider */}
                  <div className="flex justify-center">
                    <span className="bg-black/20 text-white text-[9px] px-2.5 py-0.5 rounded-full">
                      วันนี้
                    </span>
                  </div>

                  {/* Incoming Bot Message Bubble */}
                  <div className="flex items-start gap-1.5 max-w-[92%]">
                    <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs shrink-0 shadow">
                      🏢
                    </div>

                    <div className="flex flex-col items-start">
                      <span className="text-[9.5px] text-white/90 font-medium mb-0.5 pl-1">
                        {condoName}
                      </span>
                      <div className="bg-white text-slate-900 rounded-2xl rounded-tl-xs p-3 shadow-md text-[11px] leading-relaxed whitespace-pre-wrap break-words border border-slate-100">
                        {previewText || '(ยังไม่มีข้อความ)'}
                      </div>
                      <span className="text-[8.5px] text-white/80 mt-0.5 pl-1">
                        {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Home Indicator */}
              <div className="flex justify-center mt-2">
                <div className="w-24 h-1 bg-white/40 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
