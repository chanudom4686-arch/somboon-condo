'use client';

// LINE OA System Messages Editor with Multi-Bubble, Image & PDF Document Support
// Version 2.21 - 18 System Messages with Category Filters (Registration, Billing, Services)

import React, { useState, useRef, useMemo } from 'react';
import { CondoConfig } from '@/types/condo';
import { createClient } from '@/utils/supabase/client';
import {
  LineSystemBubble,
  LineMessageBubbleType,
  LineTemplateCategory,
  DEFAULT_LINE_TEMPLATES,
  parseConfigToBubbles,
} from '@/utils/lineTemplates';

interface LineSystemMessageEditorProps {
  config: Partial<CondoConfig>;
  onSaved: () => void;
}

export const LineSystemMessageEditor: React.FC<LineSystemMessageEditorProps> = ({ config, onSaved }) => {
  const supabase = createClient();
  const condoName = config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (674)';

  const templateKeys = Object.keys(DEFAULT_LINE_TEMPLATES);

  // Active selected template key
  const [selectedKey, setSelectedKey] = useState<string>(templateKeys[0]);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'registration' | 'billing' | 'info'>('all');
  const [templateSearch, setTemplateSearch] = useState('');

  const filteredTemplateKeys = useMemo(() => {
    return templateKeys.filter((key) => {
      const def = DEFAULT_LINE_TEMPLATES[key];
      if (!def) return false;
      const matchesCat = categoryFilter === 'all' || def.category === categoryFilter;
      const q = templateSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        def.title.toLowerCase().includes(q) ||
        def.badge.toLowerCase().includes(q) ||
        def.description.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [templateKeys, categoryFilter, templateSearch]);

  // Master drafts: map of key -> LineSystemBubble[]
  const [draftsMap, setDraftsMap] = useState<Record<string, LineSystemBubble[]>>(() => {
    const map: Record<string, LineSystemBubble[]> = {};
    for (const [key, tpl] of Object.entries(DEFAULT_LINE_TEMPLATES)) {
      map[key] = parseConfigToBubbles((config as any)[key], tpl.defaultBubbles);
    }
    return map;
  });

  // Track which bubble is currently focused for chip insertion
  const [activeBubbleIndex, setActiveBubbleIndex] = useState<number>(0);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const activeTemplate = DEFAULT_LINE_TEMPLATES[selectedKey] || DEFAULT_LINE_TEMPLATES.LINE_WELCOME_NEW_FRIEND;
  const currentBubbles = draftsMap[selectedKey] || activeTemplate.defaultBubbles;

  // Textarea references for cursor positioning
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});

  // Update specific bubble
  const updateBubble = (index: number, partial: Partial<LineSystemBubble>) => {
    setDraftsMap((prev) => {
      const list = [...(prev[selectedKey] || activeTemplate.defaultBubbles)];
      if (list[index]) {
        list[index] = { ...list[index], ...partial };
      }
      return { ...prev, [selectedKey]: list };
    });
  };

  // Add new bubble
  const addBubble = (type: LineMessageBubbleType) => {
    if (currentBubbles.length >= 5) {
      alert('สามารถเพิ่มช่องข้อความ/ไฟล์ได้สูงสุด 5 บอลลูนต่อ 1 เหตุการณ์ครับ');
      return;
    }
    const newBubble: LineSystemBubble = {
      id: String(Date.now()),
      type,
      text: type === 'text' ? '' : undefined,
      url: type !== 'text' ? '' : undefined,
      fileName: type === 'pdf' ? 'ระเบียบอาคารชุด.pdf' : undefined,
    };

    setDraftsMap((prev) => {
      const list = [...(prev[selectedKey] || activeTemplate.defaultBubbles), newBubble];
      return { ...prev, [selectedKey]: list };
    });

    setActiveBubbleIndex(currentBubbles.length);
  };

  // Remove bubble
  const removeBubble = (index: number) => {
    if (currentBubbles.length <= 1) {
      alert('ต้องมีอย่างน้อย 1 ช่องข้อความครับ');
      return;
    }
    setDraftsMap((prev) => {
      const list = (prev[selectedKey] || activeTemplate.defaultBubbles).filter((_, i) => i !== index);
      return { ...prev, [selectedKey]: list };
    });
    setActiveBubbleIndex(Math.max(0, index - 1));
  };

  // Move bubble up/down
  const moveBubble = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentBubbles.length) return;

    setDraftsMap((prev) => {
      const list = [...(prev[selectedKey] || activeTemplate.defaultBubbles)];
      const temp = list[index];
      list[index] = list[targetIndex];
      list[targetIndex] = temp;
      return { ...prev, [selectedKey]: list };
    });
    setActiveBubbleIndex(targetIndex);
  };

  // Insert tag at cursor position for the active text bubble
  const insertTagAtCursor = (tag: string) => {
    const idx = activeBubbleIndex >= 0 && activeBubbleIndex < currentBubbles.length ? activeBubbleIndex : 0;
    const bubble = currentBubbles[idx];
    if (!bubble || bubble.type !== 'text') {
      // Find the first text bubble
      const firstTextIdx = currentBubbles.findIndex((b) => b.type === 'text');
      if (firstTextIdx !== -1) {
        updateBubble(firstTextIdx, { text: (currentBubbles[firstTextIdx].text || '') + tag });
      }
      return;
    }

    const textarea = textareaRefs.current[idx];
    if (!textarea) {
      updateBubble(idx, { text: (bubble.text || '') + tag });
      return;
    }

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const currentText = bubble.text || '';
    const newText = currentText.substring(0, start) + tag + currentText.substring(end);

    updateBubble(idx, { text: newText });

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  // Upload file (Image or PDF) to Supabase Storage
  const handleFileUpload = async (file: File, bubbleIndex: number, type: LineMessageBubbleType) => {
    setUploadingIndex(bubbleIndex);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `line_media/${Date.now()}_${safeName}`;

      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('slips')
        .upload(storagePath, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('slips').getPublicUrl(uploadData.path);
      const publicUrl = urlData.publicUrl;

      updateBubble(bubbleIndex, {
        url: publicUrl,
        fileName: file.name,
      });

      alert(`✅ อัปโหลด${type === 'image' ? 'รูปภาพ' : 'ไฟล์ PDF'} เรียบร้อยแล้ว!`);
    } catch (err: any) {
      console.error('File upload error:', err);
      alert('อัปโหลดไฟล์ไม่สำเร็จ: ' + err.message);
    } finally {
      setUploadingIndex(null);
    }
  };

  // Save current message template to Supabase
  const handleSaveCurrentMessage = async () => {
    setIsSaving(true);
    try {
      // Clean up bubbles: trim texts, ensure valid URLs
      const cleaned = currentBubbles.map((b, idx) => ({
        id: String(idx + 1),
        type: b.type,
        text: b.text?.trim() || '',
        url: b.url?.trim() || '',
        fileName: b.fileName?.trim() || '',
      }));

      // Store as JSON string array
      const jsonValue = JSON.stringify(cleaned);

      const { error } = await supabase.from('condo_config').upsert(
        {
          key: selectedKey,
          value: jsonValue,
          description: activeTemplate.title,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );

      if (error) throw error;

      setSaveToast('บันทึกสำเร็จเรียบร้อยแล้ว!');
      setTimeout(() => setSaveToast(null), 3500);
      onSaved();
    } catch (err: any) {
      console.error('Error saving template:', err);
      alert('บันทึกข้อความไม่สำเร็จ: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Reset current template to default
  const handleResetToDefault = () => {
    if (!window.confirm(`ยืนยันการคืนค่าเริ่มต้นของ "${activeTemplate.title}" หรือไม่?`)) return;

    setDraftsMap((prev) => ({
      ...prev,
      [selectedKey]: activeTemplate.defaultBubbles,
    }));
    setActiveBubbleIndex(0);
  };

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <span>💬 จัดการข้อความในระบบ (System Message Studio)</span>
            <span className="text-[10px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full font-bold">
              Multi-Bubble • รูปภาพ • ไฟล์ PDF
            </span>
          </h2>
          <p className="text-slate-500">
            ปรับแต่งข้อความต้อนรับ ขั้นตอนลงทะเบียน พร้อมแนบรูปภาพและเอกสาร PDF ได้สูงสุด 3-5 บอลลูนต่อเหตุการณ์
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

      {/* Main Workspace Layout: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Selector & Editor (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Step 1: Select Message Type with Category Tabs & Search */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="font-bold text-slate-800 text-xs">
                1. เลือกข้อความระบบที่ต้องการแก้ไข ({filteredTemplateKeys.length}/{templateKeys.length} รายการ):
              </label>
              <input
                type="text"
                placeholder="🔍 ค้นหาชื่อข้อความ..."
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                className="text-xs px-2.5 py-1 bg-white border border-slate-300 rounded-lg w-44 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>

            {/* Category Filter Tabs */}
            <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold text-slate-600">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  categoryFilter === 'all'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'hover:bg-slate-200/70 text-slate-600'
                }`}
              >
                ทั้งหมด ({templateKeys.length})
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('registration')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  categoryFilter === 'registration'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'hover:bg-slate-200/70 text-slate-600'
                }`}
              >
                📝 ลงทะเบียน (10)
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('billing')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  categoryFilter === 'billing'
                    ? 'bg-white text-purple-700 shadow-xs'
                    : 'hover:bg-slate-200/70 text-slate-600'
                }`}
              >
                🧾 บิล & สลิปโอน (4)
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('info')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  categoryFilter === 'info'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'hover:bg-slate-200/70 text-slate-600'
                }`}
              >
                ℹ️ บริการ & ข้อมูล (4)
              </button>
            </div>

            {/* Template Buttons Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[360px] overflow-y-auto p-0.5">
              {filteredTemplateKeys.length === 0 ? (
                <div className="sm:col-span-2 text-center p-6 text-slate-400 text-xs bg-slate-50 rounded-xl">
                  ไม่พบข้อความที่ตรงกับการค้นหา
                </div>
              ) : (
                filteredTemplateKeys.map((key) => {
                  const def = DEFAULT_LINE_TEMPLATES[key];
                  const isSelected = selectedKey === key;
                  const bubbleCount = (draftsMap[key] || def.defaultBubbles).length;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectedKey(key);
                        setActiveBubbleIndex(0);
                      }}
                      className={`text-left p-2.5 rounded-xl border transition-all flex flex-col justify-between gap-1.5 cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/90 border-blue-500 shadow-xs ring-1 ring-blue-400'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-[11px] text-slate-800">{def.badge}</span>
                        <div className="flex items-center gap-1">
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                              def.category === 'billing'
                                ? 'bg-purple-100 text-purple-800'
                                : def.category === 'info'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {def.category === 'billing'
                              ? 'บิล/สลิป'
                              : def.category === 'info'
                              ? 'ข้อมูล'
                              : 'ลงทะเบียน'}
                          </span>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md font-mono">
                            {bubbleCount} บอลลูน
                          </span>
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-600 font-medium line-clamp-1">
                        {def.title}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Active Template Description Box */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <span>📌 {activeTemplate.title}</span>
              </span>
              <button
                type="button"
                onClick={handleResetToDefault}
                className="text-[10px] text-slate-500 hover:text-red-600 underline"
              >
                คืนค่าเริ่มต้นเฉพาะข้อความนี้
              </button>
            </div>
            <p className="text-slate-500 text-[11px]">{activeTemplate.description}</p>

            {/* Smart Variable Chips */}
            <div className="pt-2 border-t border-slate-200">
              <span className="font-bold text-slate-600 text-[11px] block mb-1.5">
                🏷️ ตัวแปรอัจฉริยะ (คลิกหรือลากวางลงในช่องข้อความ):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {activeTemplate.allowedTags.map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', t.tag)}
                    onClick={() => insertTagAtCursor(t.tag)}
                    className="px-2.5 py-1 bg-white hover:bg-blue-50 border border-slate-300 hover:border-blue-400 rounded-lg text-slate-700 font-mono text-[11px] flex items-center gap-1.5 cursor-grab active:cursor-grabbing transition"
                    title={`คลิกเพื่อแทรก หรือลากไปปล่อย: ${t.desc}`}
                  >
                    <span className="font-bold text-blue-600">{t.tag}</span>
                    <span className="text-[10px] text-slate-500">({t.label})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Step 2: Message Bubbles Editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-700">
                2. ช่องข้อความและไฟล์แนบ ({currentBubbles.length} / 5 บอลลูน):
              </label>
              <span className="text-[11px] text-slate-500">
                LINE รองรับส่งตอบกลับพร้อมกันได้สูงสุด 5 บอลลูน (แนะนำ 1-3 ช่อง)
              </span>
            </div>

            {/* Bubbles List */}
            <div className="space-y-3">
              {currentBubbles.map((bubble, idx) => {
                const isFocused = activeBubbleIndex === idx;

                return (
                  <div
                    key={bubble.id || idx}
                    className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                      isFocused
                        ? 'bg-white border-blue-400 ring-2 ring-blue-100 shadow-sm'
                        : 'bg-white border-slate-200'
                    }`}
                    onClick={() => setActiveBubbleIndex(idx)}
                  >
                    {/* Bubble Card Top Bar */}
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-[10px]">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-slate-700">
                          {bubble.type === 'text' && '📝 บอลลูนข้อความ (Text Bubble)'}
                          {bubble.type === 'image' && '🖼️ บอลลูนรูปภาพ (Image Bubble)'}
                          {bubble.type === 'pdf' && '📄 การ์ดเอกสาร PDF (Flex Document Card)'}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                            bubble.type === 'text'
                              ? 'bg-emerald-100 text-emerald-800'
                              : bubble.type === 'image'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {bubble.type.toUpperCase()}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBubble(idx, 'up');
                          }}
                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-30 rounded text-slate-700 font-bold"
                          title="เลื่อนขึ้น"
                        >
                          ⬆️
                        </button>
                        <button
                          type="button"
                          disabled={idx === currentBubbles.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBubble(idx, 'down');
                          }}
                          className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-30 rounded text-slate-700 font-bold"
                          title="เลื่อนลง"
                        >
                          ⬇️
                        </button>
                        {currentBubbles.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeBubble(idx);
                            }}
                            className="px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-600 rounded font-bold text-[10px]"
                            title="ลบช่องนี้"
                          >
                            🗑️ ลบช่อง
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bubble Content Body */}
                    {bubble.type === 'text' && (
                      <div className="space-y-1.5">
                        <textarea
                          ref={(el) => {
                            textareaRefs.current[idx] = el;
                          }}
                          rows={4}
                          value={bubble.text || ''}
                          onChange={(e) => updateBubble(idx, { text: e.target.value })}
                          onFocus={() => setActiveBubbleIndex(idx)}
                          onDrop={(e) => {
                            e.preventDefault();
                            const tag = e.dataTransfer.getData('text/plain');
                            if (tag) {
                              const textarea = textareaRefs.current[idx];
                              if (textarea) {
                                const pos = textarea.selectionStart || 0;
                                const txt = bubble.text || '';
                                const updated = txt.slice(0, pos) + tag + txt.slice(pos);
                                updateBubble(idx, { text: updated });
                              }
                            }
                          }}
                          placeholder="พิมพ์ข้อความที่ต้องการ... หรือลากวางตัวแปรอัจฉริยะ"
                          className="w-full border border-slate-300 rounded-xl p-2.5 font-sans leading-relaxed focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs"
                        />
                        <div className="flex justify-between items-center text-[10px] text-slate-400">
                          <span>💡 สามารถกดแทรกตัวแปร เช่น &#123;room_no&#125; หรือ &#123;condo_name&#125; ได้</span>
                          <span>{(bubble.text || '').length} ตัวอักษร</span>
                        </div>
                      </div>
                    )}

                    {bubble.type === 'image' && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold cursor-pointer flex items-center gap-1.5 text-[11px]">
                            <span>📁</span>
                            <span>{uploadingIndex === idx ? 'กำลังอัปโหลด...' : 'อัปโหลดรูปภาพใหม่'}</span>
                            <input
                              type="file"
                              accept="image/png, image/jpeg, image/jpg"
                              disabled={uploadingIndex === idx}
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(file, idx, 'image');
                              }}
                            />
                          </label>
                          <span className="text-slate-400 text-[10px]">หรือใส่ URL รูปภาพโดยตรง (HTTPS):</span>
                        </div>

                        <input
                          type="url"
                          value={bubble.url || ''}
                          onChange={(e) => updateBubble(idx, { url: e.target.value })}
                          placeholder="https://.../photo.jpg"
                          className="w-full border border-slate-300 rounded-xl p-2 font-mono text-[11px]"
                        />

                        {bubble.url && (
                          <div className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={bubble.url}
                              alt="preview"
                              className="w-16 h-16 object-cover rounded-lg border border-slate-200 shadow-xs"
                            />
                            <div className="text-[11px] text-slate-600 space-y-0.5">
                              <div className="font-bold text-slate-800">✅ รูปภาพพร้อมส่ง</div>
                              <div className="text-[10px] text-slate-400 break-all line-clamp-1">{bubble.url}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {bubble.type === 'pdf' && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold cursor-pointer flex items-center gap-1.5 text-[11px]">
                            <span>📎</span>
                            <span>{uploadingIndex === idx ? 'กำลังอัปโหลด...' : 'อัปโหลดไฟล์ PDF ใหม่'}</span>
                            <input
                              type="file"
                              accept="application/pdf"
                              disabled={uploadingIndex === idx}
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(file, idx, 'pdf');
                              }}
                            />
                          </label>
                          <span className="text-slate-400 text-[10px]">
                            ระบบจะส่งเป็นการ์ดเอกสารพร้อมปุ่มดาวน์โหลดใน LINE
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-bold text-slate-600 block mb-0.5">ชื่อเอกสาร PDF:</label>
                            <input
                              type="text"
                              value={bubble.fileName || ''}
                              onChange={(e) => updateBubble(idx, { fileName: e.target.value })}
                              placeholder="เช่น ระเบียบอาคารชุด.pdf"
                              className="w-full border border-slate-300 rounded-xl p-2 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-600 block mb-0.5">
                              คำอธิบายเพิ่มเติม (ใต้ชื่อไฟล์):
                            </label>
                            <input
                              type="text"
                              value={bubble.text || ''}
                              onChange={(e) => updateBubble(idx, { text: e.target.value })}
                              placeholder="เช่น แตะปุ่มด้านล่างเพื่อเปิดอ่าน"
                              className="w-full border border-slate-300 rounded-xl p-2 text-xs"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-slate-600 block mb-0.5">URL ไฟล์ PDF (HTTPS):</label>
                          <input
                            type="url"
                            value={bubble.url || ''}
                            onChange={(e) => updateBubble(idx, { url: e.target.value })}
                            placeholder="https://.../document.pdf"
                            className="w-full border border-slate-300 rounded-xl p-2 font-mono text-[11px]"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add More Bubbles Bar */}
            {currentBubbles.length < 5 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => addBubble('text')}
                  className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl font-bold flex items-center gap-1.5 transition text-xs"
                >
                  <span>＋ เพิ่มช่องข้อความ (Text)</span>
                </button>
                <button
                  type="button"
                  onClick={() => addBubble('image')}
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl font-bold flex items-center gap-1.5 transition text-xs"
                >
                  <span>🖼️ แนบรูปภาพ (Image)</span>
                </button>
                <button
                  type="button"
                  onClick={() => addBubble('pdf')}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-bold flex items-center gap-1.5 transition text-xs"
                >
                  <span>📄 แนบไฟล์ PDF</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Mobile LINE Simulator (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="sticky top-20 w-full max-w-sm">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="font-bold text-slate-700 text-xs flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                <span>จำลองหน้าจอมือถือลูกบ้าน (Live LINE Simulator)</span>
              </span>
              <span className="text-[10px] text-slate-400">ขนาดสัดส่วนจริง</span>
            </div>

            {/* Smartphone Mockup */}
            <div className="w-full bg-slate-900 rounded-[36px] p-3 shadow-2xl border-4 border-slate-700">
              {/* Speaker & Camera Notch */}
              <div className="w-28 h-4 bg-slate-800 rounded-full mx-auto mb-2 flex items-center justify-center gap-2">
                <div className="w-2 h-2 rounded-full bg-slate-950"></div>
                <div className="w-8 h-1 rounded-full bg-slate-900"></div>
              </div>

              {/* Mobile Screen */}
              <div className="bg-[#7494C0] rounded-[24px] overflow-hidden flex flex-col h-[520px] shadow-inner text-xs">
                {/* Chat Header Bar */}
                <div className="bg-slate-900/90 backdrop-blur-xs text-white px-3.5 py-2.5 flex items-center justify-between border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">‹</span>
                    <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-white text-[11px] shadow">
                      674
                    </div>
                    <div>
                      <div className="font-bold text-[11px] leading-tight text-white line-clamp-1">{condoName}</div>
                      <div className="text-[9px] text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span>ตอบกลับอัตโนมัติ (Bot)</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-slate-400 text-xs">⋮</span>
                </div>

                {/* Chat Scrollable Area */}
                <div className="flex-1 p-3 overflow-y-auto space-y-3">
                  <div className="text-center">
                    <span className="bg-black/20 text-white/90 text-[9px] px-2.5 py-0.5 rounded-full backdrop-blur-xs">
                      วันนี้ 12:00 น.
                    </span>
                  </div>

                  {/* Incoming Simulated Bubbles from Bot */}
                  <div className="space-y-2">
                    {currentBubbles.map((b, bIdx) => {
                      if (b.type === 'text') {
                        // Replace tags with sample mock values
                        const rendered = (b.text || '')
                          .replace(/\{condo_name\}/g, condoName)
                          .replace(/\{room_no\}/g, '674/64-65')
                          .replace(/\{owner_name\}/g, 'สมศักดิ์ ชัยชนะ')
                          .replace(/\{masked_phone\}/g, '089-xxx-6273')
                          .replace(/\{admin_hours\}/g, '12.00 - 24.00 น.');

                        if (!rendered.trim()) {
                          return (
                            <div
                              key={b.id || bIdx}
                              className="bg-white/80 p-2 rounded-xl text-slate-400 italic text-[11px]"
                            >
                              (ยังไม่มีข้อความในช่องที่ {bIdx + 1})
                            </div>
                          );
                        }

                        return (
                          <div key={b.id || bIdx} className="flex items-start gap-1.5 max-w-[90%]">
                            <div className="bg-white text-slate-800 p-3 rounded-2xl rounded-tl-xs shadow-xs text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                              {rendered}
                            </div>
                          </div>
                        );
                      }

                      if (b.type === 'image') {
                        return (
                          <div key={b.id || bIdx} className="max-w-[85%]">
                            {b.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={b.url}
                                alt="line image bubble"
                                className="w-full rounded-2xl shadow-sm border border-black/10 object-cover max-h-48"
                              />
                            ) : (
                              <div className="bg-white/90 p-4 rounded-2xl border border-dashed border-slate-300 text-center text-slate-400 text-[10px]">
                                🖼️ รูปภาพยังไม่ได้อัปโหลด
                              </div>
                            )}
                          </div>
                        );
                      }

                      if (b.type === 'pdf') {
                        return (
                          <div key={b.id || bIdx} className="max-w-[90%]">
                            <div className="bg-white rounded-2xl overflow-hidden shadow-md border border-slate-200">
                              {/* PDF Flex Header */}
                              <div className="bg-slate-900 text-white p-3 space-y-1">
                                <div className="text-[10px] text-sky-400 font-bold flex items-center gap-1">
                                  <span>📄</span>
                                  <span>เอกสารแนบจากนิติบุคคล (PDF)</span>
                                </div>
                                <div className="font-bold text-xs text-white line-clamp-2">
                                  {b.fileName || 'เอกสารคอนโด.pdf'}
                                </div>
                              </div>
                              {/* PDF Flex Body */}
                              <div className="p-2.5 text-[10px] text-slate-600">
                                {b.text || 'แตะปุ่มด้านล่างเพื่อเปิดอ่านหรือดาวน์โหลดเอกสาร PDF บนมือถือ'}
                              </div>
                              {/* PDF Flex Button */}
                              <div className="p-2 pt-0">
                                <button
                                  type="button"
                                  className="w-full py-1.5 bg-blue-600 text-white font-bold rounded-xl text-[11px] shadow-xs flex items-center justify-center gap-1 pointer-events-none"
                                >
                                  <span>📥 เปิดอ่าน / ดาวน์โหลด PDF</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                </div>

                {/* Chat Fake Input Bar at Bottom */}
                <div className="bg-slate-100 p-2 border-t border-slate-300 flex items-center gap-2 text-slate-400 text-[11px]">
                  <span className="text-base leading-none">＋</span>
                  <div className="flex-1 bg-white rounded-full px-3 py-1 text-slate-300 border border-slate-200">
                    พิมพ์ข้อความ...
                  </div>
                  <span className="text-slate-400">🎤</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
