// Helper utilities for LINE OA System Messages (Multi-bubble, Image, and PDF support)
// Version 2.9 - Somboon Condo Town 645

export type LineMessageBubbleType = 'text' | 'image' | 'pdf';

export interface LineSystemBubble {
  id: string;
  type: LineMessageBubbleType;
  text?: string;
  url?: string;
  fileName?: string;
}

// User-curated default messages preserved from Supabase condo_config
export const DEFAULT_LINE_TEMPLATES: Record<
  string,
  {
    title: string;
    badge: string;
    description: string;
    defaultBubbles: LineSystemBubble[];
    allowedTags: Array<{ tag: string; label: string; desc: string }>;
  }
> = {
  LINE_WELCOME_NEW_FRIEND: {
    title: 'ข้อความต้อนรับผู้ใช้ใหม่เมื่อกดเพิ่มเพื่อน (Follow Event)',
    badge: '👋 แอดไลน์ครั้งแรก',
    description: 'ข้อความแรกที่จะเด้งเข้าแชททันทีเมื่อมีคนกด Add Friend เข้ามาใน LINE OA คอนโด',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `สวัสดีครับ ยินดีต้อนรับสู่ {condo_name} 🏢\n\n📲 เริ่มต้นรับบิลค่าน้ำ-ค่าส่วนกลางผ่าน LINE: \n- กดปุ่ม "ลงทะเบียน" ที่เมนูด้านล่าง \n- หรือพิมพ์คำว่า "ลงทะเบียน" ส่งมาในแชทนี้ได้เลย\n\n──────────\n\nWelcome to {condo_name} 🏢\n\n📲 Get your utility & common fee bills via LINE:\n- Tap "ลงทะเบียน (Register)" on the bottom menu \n- Or type "Register" in this chat to link your room.`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },
  LINE_REG_PROMPT_PHONE: {
    title: 'ขั้นตอนลงทะเบียน (1): เมื่อพิมพ์เลขห้องแล้วถามหาเบอร์ 4 ตัวท้าย',
    badge: '📱 ขอเบอร์ยืนยัน',
    description: 'ส่งหาลูกบ้านเพื่อยืนยันตัวตนตามหลักความปลอดภัย PDPA เมื่อลูกบ้านพิมพ์เลขห้องเข้ามา',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🔍 พบข้อมูลห้องพัก \nห้อง: {room_no} \nชื่อ: คุณ {owner_name}\n     🔒 ยืนยันตัวตน กรุณาพิมพ์ "เลข 4 ตัวท้ายของเบอร์โทรศัพท์" ที่แจ้งไว้กับนิติฯ ส่งมาในแชทนี้ครับ (เช่น 1234)\n\n──────────\n\n🔍 Room Information\nRoom: {room_no} \nName: {owner_name}\n      🔒 Verification For security, please type the last 4 digits of your registered phone number in this chat (e.g., 1234).`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '645/64-65' },
      { tag: '{owner_name}', label: 'ชื่อเจ้าของ', desc: 'คุณสมศักดิ์' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
    ],
  },
  LINE_REG_SUCCESS: {
    title: 'ขั้นตอนลงทะเบียน (2): เมื่อยืนยันเบอร์ถูกต้องและผูกห้องสำเร็จ',
    badge: '🎉 ผูกห้องสำเร็จ',
    description: 'ส่งแจ้งลูกบ้านทันทีที่ยืนยันเบอร์โทรศัพท์ 4 ตัวท้ายตรงกับข้อมูลในระบบ พร้อมแสดงเมนูคำสั่ง',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🎉 ลงทะเบียนผูกห้อง {room_no} สำเร็จแล้วครับ!\nRegistration Complete for Room(s): {room_no}!\n👤 ผู้รับข้อมูล / Resident: คุณ {owner_name}\n\n📌 คำสั่งตรวจสอบข้อมูลอัตโนมัติ (Thai / English Commands):\n• พิมพ์ "ดูบิล" หรือ "bill" — ดูใบแจ้งหนี้ทุกห้องที่ผูกไว้ / View current bill\n• พิมพ์ "ใบเสร็จ" หรือ "receipt" — ดูใบเสร็จรับเงิน / Payment receipt\n• พิมพ์ "สเตทเมนท์" หรือ "statement" — ประวัติชำระ 12 เดือน / 12-month history\n• พิมพ์ "เงินระดมทุน" หรือ "fund" — ยอดเงินระดมทุนซ่อมตึก / Maintenance fund\n• พิมพ์ "การเงิน" หรือ "finance" — สรุปรายรับ-รายจ่ายตึก / Building finance\n• พิมพ์ "เลขบัญชี" หรือ "bank" — ช่องทางโอนเงิน / Bank account\n• พิมพ์ "เมนู" หรือ "menu" — ดูคำสั่งทั้งหมด / All commands\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '645/64-65' },
      { tag: '{owner_name}', label: 'ชื่อเจ้าของ', desc: 'คุณสมศักดิ์' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
    ],
  },
  LINE_REG_PHONE_ERROR: {
    title: 'ขั้นตอนลงทะเบียน (3): เมื่อพิมพ์เลข 4 ตัวท้ายไม่ตรง',
    badge: '❌ เบอร์ไม่ตรง',
    description: 'ส่งแจ้งเตือนเมื่อลูกบ้านกรอกเลข 4 ตัวท้ายไม่ตรงกับฐานข้อมูลของห้องชุดนั้นๆ',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `❌ ตัวเลข 4 ตัวท้ายที่พิมพ์มา ไม่ตรงกับเบอร์โทรศัพท์ที่ลงทะเบียนไว้ของห้อง {room_no} ({masked_phone})\nThe last 4 digits do not match our records.\n\n• กรุณาพิมพ์ตัวเลข 4 ตัวท้ายของเบอร์โทรศัพท์อีกครั้ง\n  Please enter the last 4 digits again.\n• หรือพิมพ์เลขห้องใหม่ (เช่น 001 หรือ 001,002) หากต้องการเปลี่ยนห้อง\n  Or type room number(s) again (e.g. 001 or 001,002).\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '645/64-65' },
      { tag: '{masked_phone}', label: 'เบอร์ซ่อนท้าย', desc: '089-xxx-6273' },
    ],
  },
  LINE_PDPA_WARNING: {
    title: 'แจ้งเตือนความปลอดภัย PDPA: ผู้ใช้ยังไม่ลงทะเบียนพยายามดูบิล',
    badge: '🔒 เตือนความปลอดภัย',
    description: 'ส่งแจ้งเตือนเมื่อมีคนพิมพ์ "ดูบิล", "ใบเสร็จ" หรือ "สเตทเมนท์" โดยที่บัญชี LINE ยังไม่ได้ผูกห้องชุด',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🔒 ตามหลักคุ้มครองข้อมูลส่วนบุคคล (PDPA) กรุณาลงทะเบียนผูกห้องชุดก่อนดูข้อมูลบิล รูปมิเตอร์ และสเตทเมนท์ครับ\nPlease register your room before viewing bills, meter photos, or statements.\n\n📌 วิธีลงทะเบียน / How to Register:\nกดปุ่ม "ลงทะเบียน" ที่ริชเมนูด้านล่าง หรือพิมพ์คำว่า "ลงทะเบียน" / "Register" (หรือพิมพ์เลขห้อง เช่น 001 หรือหลายห้อง 001,002)\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
    ],
  },
  LINE_UNLINK_SUCCESS: {
    title: 'ข้อความยืนยันเมื่อพิมพ์ "ยกเลิกผูกห้อง" (Unlink Complete)',
    badge: '🔓 ยกเลิกผูกห้อง',
    description: 'ส่งแจ้งยืนยันเมื่อลูกบ้านพิมพ์คำว่า "ยกเลิกผูกห้อง", "ยกเลิกลงทะเบียน" หรือ "unlink"',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `✅ ยกเลิกการผูกห้องชุด {room_no} เรียบร้อยแล้วครับ\nRoom unlinked successfully.\n\nหากต้องการลงทะเบียนผูกห้องใหม่ สามารถพิมพ์ "ลงทะเบียน" หรือพิมพ์เลขห้องได้ตลอดเวลาครับ\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '645/64-65' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
    ],
  },
};

/**
 * Parse a raw string from condo_config into an array of LineSystemBubble
 * Handles:
 * 1) JSON stringified array of LineSystemBubble objects
 * 2) JSON stringified array of plain strings
 * 3) Plain text string (legacy/single text bubble)
 */
export function parseConfigToBubbles(
  raw: string | undefined,
  defaultBubblesOrText?: LineSystemBubble[] | string
): LineSystemBubble[] {
  let content = raw;
  if (!content) {
    if (Array.isArray(defaultBubblesOrText)) {
      return defaultBubblesOrText;
    }
    content = defaultBubblesOrText;
  }

  if (!content) {
    return [{ id: '1', type: 'text', text: '' }];
  }

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item, idx) => {
        if (typeof item === 'string') {
          return { id: String(idx + 1), type: 'text', text: item };
        }
        return {
          id: item.id || String(idx + 1),
          type: (item.type as LineMessageBubbleType) || 'text',
          text: item.text || '',
          url: item.url || '',
          fileName: item.fileName || '',
        };
      });
    }
  } catch {
    // Plain string format
  }

  return [{ id: '1', type: 'text', text: content }];
}

/**
 * Build LINE Messaging API payload array from an array of LineSystemBubble
 * Supports up to 5 bubbles (Text, Image, PDF Flex Card)
 */
export function buildLineMessagesFromBubbles(
  bubbles: LineSystemBubble[],
  context: {
    condo_name?: string;
    room_no?: string;
    owner_name?: string;
    masked_phone?: string;
    admin_hours?: string;
    [key: string]: string | undefined;
  }
): any[] {
  const messages: any[] = [];

  for (const b of bubbles) {
    if (b.type === 'text') {
      let t = b.text || '';
      for (const [k, v] of Object.entries(context)) {
        if (v !== undefined) {
          t = t.split(`{${k}}`).join(v);
        }
      }
      t = t.trim();
      if (t) {
        messages.push({ type: 'text', text: t });
      }
    } else if (b.type === 'image' && b.url && b.url.startsWith('https://')) {
      messages.push({
        type: 'image',
        originalContentUrl: b.url,
        previewImageUrl: b.url,
      });
    } else if (b.type === 'pdf' && b.url && b.url.startsWith('https://')) {
      messages.push({
        type: 'flex',
        altText: `📄 เอกสาร PDF: ${b.fileName || 'เปิดอ่านเอกสาร'}`,
        contents: {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#0F172A',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: '📄 เอกสารแนบจากนิติบุคคล (PDF)',
                color: '#38BDF8',
                size: 'xs',
                weight: 'bold',
              },
              {
                type: 'text',
                text: b.fileName || 'เอกสารคอนโด.pdf',
                color: '#FFFFFF',
                size: 'md',
                weight: 'bold',
                wrap: true,
                margin: 'sm',
              },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '14px',
            contents: [
              {
                type: 'text',
                text: b.text || 'แตะปุ่มด้านล่างเพื่อเปิดอ่านหรือดาวน์โหลดเอกสาร PDF บนมือถือ',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#2563EB',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: '📥 เปิดอ่าน / ดาวน์โหลด PDF',
                  uri: b.url,
                },
              },
            ],
          },
        },
      });
    }

    if (messages.length >= 5) break; // Enforce LINE max 5 messages per reply
  }

  return messages;
}
