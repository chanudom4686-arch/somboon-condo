// Helper utilities for LINE OA System Messages (Multi-bubble, Image, and PDF support)
// Version 2.21 - 18 System Message Studio Templates across Onboarding, Billing, and Resident Services

export type LineMessageBubbleType = 'text' | 'image' | 'pdf';

export type LineTemplateCategory = 'registration' | 'billing' | 'info';

export interface LineSystemBubble {
  id: string;
  type: LineMessageBubbleType;
  text?: string;
  url?: string;
  fileName?: string;
}

export interface LineTemplateDefinition {
  title: string;
  badge: string;
  category: LineTemplateCategory;
  description: string;
  defaultBubbles: LineSystemBubble[];
  allowedTags: Array<{ tag: string; label: string; desc: string }>;
}

// User-curated default messages preserved from Supabase condo_config
export const DEFAULT_LINE_TEMPLATES: Record<string, LineTemplateDefinition> = {
  // ==========================================
  // CATEGORY 1: REGISTRATION & ONBOARDING (10)
  // ==========================================
  LINE_WELCOME_NEW_FRIEND: {
    title: 'ข้อความต้อนรับผู้ใช้ใหม่เมื่อกดเพิ่มเพื่อน (Follow Event)',
    badge: '👋 แอดไลน์ครั้งแรก',
    category: 'registration',
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
  LINE_REG_PROMPT_ROOM: {
    title: 'ขั้นตอนลงทะเบียน (1): เมื่อกดปุ่ม "ลงทะเบียน" แล้วบอทถามหาเลขห้อง',
    badge: '📝 เริ่มต้นลงทะเบียน',
    category: 'registration',
    description: 'ส่งหาลูกบ้านทันทีที่กดปุ่ม "ลงทะเบียน" บนริชเมนู หรือพิมพ์คำว่า "ลงทะเบียน" เพื่อแนะนำให้พิมพ์เลขห้อง',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `📝 เริ่มต้นการลงทะเบียนผูกห้องชุด (ขั้นตอนที่ 1/2)\nRoom Registration (Step 1/2)\n\n👉 กรุณาพิมพ์ "เลขห้อง" ของท่านส่งมาในแชทนี้ครับ\n• กรณีห้องเดียว พิมพ์เช่น: 001 (หรือห้องคู่ 64-65)\n• กรณีมีหลายห้อง ให้พิมพ์คั่นด้วยลูกน้ำ (,) เช่น: 001,002,005\n\nPlease enter your Room Number:\n• Single room: e.g. 001 (or 64-65)\n• Multiple rooms (comma-separated): e.g. 001,002,005\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },
  LINE_REG_PROMPT_PHONE: {
    title: 'ขั้นตอนลงทะเบียน (2): เมื่อพิมพ์เลขห้องแล้วถามหาเบอร์ 4 ตัวท้าย',
    badge: '📱 ขอเบอร์ยืนยัน',
    category: 'registration',
    description: 'ส่งหาลูกบ้านเพื่อยืนยันตัวตนตามหลักความปลอดภัย PDPA เมื่อลูกบ้านพิมพ์เลขห้องเข้ามา',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🔍 พบข้อมูลห้องพัก \nห้อง: {room_no} \nชื่อ: คุณ {owner_name}\nเบอร์โทรศัพท์: {masked_phone}\n     🔒 ยืนยันตัวตน กรุณาพิมพ์ "เลข 4 ตัวท้ายของเบอร์โทรศัพท์" ที่แจ้งไว้กับนิติฯ ส่งมาในแชทนี้ครับ (เช่น 1234)\n\n──────────\n\n🔍 Room Information\nRoom: {room_no} \nName: {owner_name}\nPhone: {masked_phone}\n      🔒 Verification For security, please type the last 4 digits of your registered phone number in this chat (e.g., 1234).`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '674/64-65' },
      { tag: '{owner_name}', label: 'ชื่อเจ้าของ', desc: 'คุณสมศักดิ์' },
      { tag: '{masked_phone}', label: 'เบอร์โทรซ่อน 4 ตัวท้าย', desc: '081-403-XXXX' },
      { tag: '{phone}', label: 'เบอร์โทรศัพท์', desc: '081-403-XXXX' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
    ],
  },
  LINE_REG_SUCCESS: {
    title: 'ขั้นตอนลงทะเบียน (3): เมื่อยืนยันเบอร์ถูกต้องและผูกห้องสำเร็จ',
    badge: '🎉 ผูกห้องสำเร็จ',
    category: 'registration',
    description: 'ส่งแจ้งลูกบ้านทันทีที่ยืนยันเบอร์โทรศัพท์ 4 ตัวท้ายตรงกับข้อมูลในระบบ พร้อมแสดงเมนูคำสั่ง',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🎉 ลงทะเบียนผูกห้อง {room_no} สำเร็จแล้วครับ!\nRegistration Complete for Room(s): {room_no}!\n👤 ผู้รับข้อมูล / Resident: คุณ {owner_name}\n\n📌 คำสั่งตรวจสอบข้อมูลอัตโนมัติ (Thai / English Commands):\n• พิมพ์ "ดูบิล" หรือ "bill" — ดูใบแจ้งหนี้ทุกห้องที่ผูกไว้ / View current bill\n• พิมพ์ "ใบเสร็จ" หรือ "receipt" — ดูใบเสร็จรับเงิน / Payment receipt\n• พิมพ์ "สเตทเมนท์" หรือ "statement" — ประวัติชำระ 12 เดือน / 12-month history\n• พิมพ์ "เงินระดมทุน" หรือ "fund" — ยอดเงินระดมทุนซ่อมตึก / Maintenance fund\n• พิมพ์ "การเงิน" หรือ "finance" — สรุปรายรับ-รายจ่ายตึก / Building finance\n• พิมพ์ "เลขบัญชี" หรือ "bank" — ช่องทางโอนเงิน / Bank account\n• พิมพ์ "เมนู" หรือ "menu" — ดูคำสั่งทั้งหมด / All commands\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '674/64-65' },
      { tag: '{owner_name}', label: 'ชื่อเจ้าของ', desc: 'คุณสมศักดิ์' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
    ],
  },
  LINE_REG_PHONE_ERROR: {
    title: 'ขั้นตอนลงทะเบียน: เมื่อพิมพ์เลข 4 ตัวท้ายไม่ตรง (Phone Mismatch)',
    badge: '❌ เบอร์ไม่ตรง',
    category: 'registration',
    description: 'ส่งแจ้งเตือนเมื่อลูกบ้านกรอกเลข 4 ตัวท้ายไม่ตรงกับฐานข้อมูลของห้องชุดนั้นๆ',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `❌ ตัวเลข 4 ตัวท้ายที่พิมพ์มา ไม่ตรงกับเบอร์โทรศัพท์ที่ลงทะเบียนไว้ของห้อง {room_no} ({masked_phone})\nThe last 4 digits do not match our records.\n\n• กรุณาพิมพ์ตัวเลข 4 ตัวท้ายของเบอร์โทรศัพท์อีกครั้ง\n  Please enter the last 4 digits again.\n• หรือพิมพ์เลขห้องใหม่ (เช่น 001 หรือ 001,002) หากต้องการเปลี่ยนห้อง\n  Or type room number(s) again (e.g. 001 or 001,002).\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '674/64-65' },
      { tag: '{masked_phone}', label: 'เบอร์ซ่อนท้าย', desc: '089-xxx-6273' },
    ],
  },
  LINE_REG_ROOM_NOT_FOUND: {
    title: 'ขั้นตอนลงทะเบียน: เมื่อพิมพ์เลขห้องที่ไม่พบในระบบ (Room Not Found)',
    badge: '⚠️ ไม่พบเลขห้อง',
    category: 'registration',
    description: 'ส่งแจ้งเตือนเมื่อลูกบ้านพิมพ์เลขห้องที่ไม่มีอยู่ในฐานข้อมูลคอนโด หรือพิมพ์รูปแบบผิด',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `⚠️ ไม่พบข้อมูลห้อง {room_no} ในระบบคอนโดครับ\nRoom not found.\n\nกรุณาพิมพ์เลขห้อง 3 หลักอีกครั้ง (เช่น 001 หรือกรณีมีหลายห้อง 001,002)\nPlease enter valid room number(s) (e.g. 001 or 001,002).\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้องที่พิมพ์', desc: '999' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },
  LINE_REG_NO_PHONE_IN_ROOM: {
    title: 'ขั้นตอนลงทะเบียน: เมื่อพบห้องชุด แต่ห้องยังไม่มีเบอร์โทรในระบบ',
    badge: '📞 ห้องยังไม่มีเบอร์',
    category: 'registration',
    description: 'ส่งแจ้งลูกบ้านเมื่อพบข้อมูลห้องในระบบ แต่ห้องนั้นยังไม่เคยมีเบอร์โทรศัพท์บันทึกไว้ เพื่อให้ลูกบ้านทิ้งเบอร์ไว้ให้แอดมิน',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🏢 พบข้อมูลห้องชุด {room_no} ในระบบ\nRoom Info: {room_no}\n\n⚠️ ห้องชุดนี้ยังไม่มีเบอร์โทรศัพท์บันทึกไว้ในระบบนิติบุคคลครับ\nกรุณาพิมพ์ "ชื่อ-นามสกุล และ เบอร์โทรศัพท์" ของท่านทิ้งไว้ในแชทนี้ เพื่อให้เจ้าหน้าที่แอดมินบันทึกข้อมูลให้ครับ\n\nNo phone number is registered for this room yet. Please leave your name and phone number in this chat for our admin.\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '674/64-65' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },
  LINE_PDPA_WARNING: {
    title: 'แจ้งเตือนความปลอดภัย PDPA: ผู้ใช้ยังไม่ลงทะเบียนพยายามดูบิล',
    badge: '🔒 เตือนความปลอดภัย',
    category: 'registration',
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
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },
  LINE_UNLINK_SUCCESS: {
    title: 'ข้อความยืนยันเมื่อพิมพ์ "ยกเลิกผูกห้อง" (Unlink Complete)',
    badge: '🔓 ยกเลิกผูกห้อง',
    category: 'registration',
    description: 'ส่งแจ้งยืนยันเมื่อลูกบ้านพิมพ์คำว่า "ยกเลิกผูกห้อง", "ยกเลิกลงทะเบียน" หรือ "unlink" และทำการปลดล็อคสำเร็จ',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `✅ ยกเลิกการผูกห้องชุด {room_no} เรียบร้อยแล้วครับ\nRoom unlinked successfully.\n\nหากต้องการลงทะเบียนผูกห้องใหม่ สามารถพิมพ์ "ลงทะเบียน" หรือพิมพ์เลขห้องได้ตลอดเวลาครับ\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '674/64-65' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },
  LINE_UNLINK_NOT_LINKED: {
    title: 'ข้อความเมื่อพิมพ์ "ยกเลิกผูกห้อง" แต่ยังไม่เคยผูกห้องชุดใดๆ',
    badge: 'ℹ️ ยังไม่ได้ผูกห้อง',
    category: 'registration',
    description: 'ส่งแจ้งลูกบ้านเมื่อพิมพ์คำว่า "ยกเลิกผูกห้อง" แต่บัญชี LINE นั้นยังไม่เคยมีประวัติผูกกับห้องใดในระบบ',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `ℹ️ บัญชี LINE ของคุณยังไม่ได้ผูกกับห้องชุดใดในระบบครับ\nYour LINE account is not linked to any room yet.\n\n📌 หากต้องการผูกห้องชุด:\nกดปุ่ม "ลงทะเบียน" ที่ริชเมนูด้านล่าง หรือพิมพ์ "ลงทะเบียน" / "Register" ได้เลยครับ\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },

  // ==========================================
  // CATEGORY 2: BILLING, RECEIPTS & SLIPS (4)
  // ==========================================
  LINE_SLIP_RECEIVED: {
    title: 'ข้อความตอบรับเมื่อลูกบ้านส่งรูปสลิปโอนเงิน (Slip Acknowledgement)',
    badge: '📸 ยืนยันรับสลิป',
    category: 'billing',
    description: 'ส่งตอบกลับทันทีเมื่อลูกบ้านส่งรูปสลิปโอนเงินเข้ามาใน LINE OA เพื่อยืนยันว่าระบบได้รับหลักฐานแล้ว',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `📸 นิติบุคคลได้รับรูปสลิปการโอนเงินเรียบร้อยแล้วครับ ขอบพระคุณครับ 🙏\nWe have received your payment slip. Thank you!\n\nเจ้าหน้าที่กำลังดำเนินการตรวจสอบยอดเงิน และจะออกใบเสร็จรับเงินอย่างเป็นทางการส่งให้ในแชตนี้โดยเร็วครับ\nOur team is verifying your payment and will issue an official receipt in this chat shortly.\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: {admin_hours}`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },
  LINE_RECEIPT_CAPTION: {
    title: 'ข้อความแคปชันส่งพร้อมรูปใบเสร็จรับเงิน HD (Receipt Delivery Caption)',
    badge: '🧾 แคปชันใบเสร็จ',
    category: 'billing',
    description: 'ข้อความที่ส่งคู่กับรูปใบเสร็จรับเงินเมื่อแอดมินกดบันทึกการชำระเงิน หรือส่งใบเสร็จรับเงินเข้า LINE',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🧾 ใบเสร็จรับเงินค่าใช้จ่ายส่วนกลางและค่าน้ำประปา\nOfficial Receipt - {condo_name}\n\n🏠 ห้องชุด / Room: {room_no}\n📅 รอบบิล / Period: {period}\n🔢 เลขที่ใบเสร็จ / Receipt No: {receipt_no}\n💰 ยอดที่ชำระแล้ว / Amount Paid: {paid_amount} บาท (THB)\n📆 วันที่บันทึกชำระ / Date: {payment_date}\n\nขอบพระคุณที่ชำระค่าใช้จ่ายตรงเวลาครับ 🙏\nThank you for your prompt payment.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '674/001' },
      { tag: '{period}', label: 'รอบบิล', desc: '2026-11' },
      { tag: '{receipt_no}', label: 'เลขที่ใบเสร็จ', desc: '674/001-2026-11-R1' },
      { tag: '{paid_amount}', label: 'ยอดเงินที่ชำระ', desc: '380.00' },
      { tag: '{payment_date}', label: 'วันที่ชำระ', desc: '28/11/2026' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
    ],
  },
  LINE_BILL_OVERDUE_REMINDER: {
    title: 'ข้อความแจ้งเตือนค้างชำระ / เกินกำหนดชำระ (Overdue Payment Reminder)',
    badge: '⏳ เตือนค้างชำระ',
    category: 'billing',
    description: 'ใช้ส่งแจ้งเตือนห้องที่เลยกำหนดชำระ (หลังวันที่ 5 ของเดือน) เพื่อแจ้งยอดค้างและช่องทางโอนชำระอย่างสุภาพ',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `⏳ แจ้งเตือนยอดค้างชำระค่าใช้จ่ายประจำรอบ {period}\nPayment Reminder for Period {period}\n{condo_name}\n\n🏠 ห้องชุด / Room: {room_no}\n💰 ยอดค้างชำระที่ต้องชำระ / Amount Due: {total_due} บาท (THB)\n⚠️ เกินกำหนดชำระมาแล้ว / Overdue by: {days_late} วัน\n\n🏦 ช่องทางโอนชำระ / Payment Transfer:\n{bank_name} เลขบัญชี / A/C: {bank_account_no}\nชื่อบัญชี / A/C Name: {bank_account_name}\n\n📌 เมื่อโอนชำระแล้ว รบกวนส่งรูปสลิปในแชตนี้ได้เลยครับ 🙏\nPlease attach transfer slip in this chat after payment.`,
      },
    ],
    allowedTags: [
      { tag: '{room_no}', label: 'เลขห้อง', desc: '674/001' },
      { tag: '{period}', label: 'รอบบิล', desc: '2026-11' },
      { tag: '{total_due}', label: 'ยอดค้างชำระ', desc: '480.00' },
      { tag: '{days_late}', label: 'จำนวนวันที่เกิน', desc: '3' },
      { tag: '{bank_name}', label: 'ชื่อธนาคาร', desc: 'กสิกรไทย' },
      { tag: '{bank_account_no}', label: 'เลขบัญชี', desc: '098-8-82502-3' },
      { tag: '{bank_account_name}', label: 'ชื่อบัญชี', desc: 'นิติบุคคลอาคารชุด สมบูรณ์' },
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
    ],
  },
  LINE_CUSTOM_NOTICE_DEFAULT: {
    title: 'แม่แบบข้อความแจ้งเตือนหรือประกาศทั่วไป (General Broadcast / Notice Template)',
    badge: '🔔 แม่แบบประกาศด่วน',
    category: 'billing',
    description: 'ข้อความตั้งต้นเมื่อกดปุ่ม "🔔 ส่งข้อความแจ้งเตือนที่เลือก" ในแท็บออกบิล ช่วยให้แอดมินแก้ไขก่อนส่งได้สะดวก',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🔔 แจ้งเตือนจากนิติบุคคล {condo_name}\nNotice from Juristic Office - {condo_name}\n\n🏠 ห้อง / Room: {room_no}\nบิลรอบ {period} มียอดชำระสุทธิ {total_due} บาท (ครบกำหนด {due_date})\n\nหากท่านชำระเงินเรียบร้อยแล้ว รบกวนส่งรูปสลิปเข้ามาในแชตนี้ได้เลยครับ ขอบพระคุณครับ 🙏\nPlease attach transfer slip in this chat after payment. Thank you.`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{room_no}', label: 'เลขห้อง', desc: '674/001' },
      { tag: '{period}', label: 'รอบบิล', desc: '2026-11' },
      { tag: '{total_due}', label: 'ยอดสุทธิ', desc: '380.00' },
      { tag: '{due_date}', label: 'กำหนดชำระ', desc: '05/12/2026' },
    ],
  },

  // ==========================================
  // CATEGORY 3: INFO, COMMANDS & SERVICES (4)
  // ==========================================
  LINE_MENU_HELP: {
    title: 'ข้อความคู่มือคำสั่งอัตโนมัติทั้งหมด (System Commands & Menu Guide)',
    badge: '📖 เมนูคำสั่งระบบ',
    category: 'info',
    description: 'ส่งเมื่อลูกบ้านพิมพ์ "เมนู", "menu", "ช่วยเหลือ", "help" หรือแตะปุ่มเมนูบนริชเมนู',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `📌 เมนูคำสั่งตรวจสอบข้อมูลอัตโนมัติ (Automated Commands)\n{condo_name}\n\n• พิมพ์ "ดูบิล" หรือ "bill" — ดูใบแจ้งหนี้รอบปัจจุบัน\n• พิมพ์ "ใบเสร็จ" หรือ "receipt" — ดูใบเสร็จรับเงินล่าสุด\n• พิมพ์ "สเตทเมนท์" หรือ "statement" — ดูประวัติชำระ 12 เดือน\n• พิมพ์ "เงินระดมทุน" หรือ "fund" — ดูยอดเงินระดมทุนซ่อมตึก\n• พิมพ์ "การเงิน" หรือ "finance" — ดูสรุปรายรับ-รายจ่ายของตึก\n• พิมพ์ "เลขบัญชี" หรือ "bank" — ดูช่องทางโอนชำระเงิน\n• พิมพ์ "ติดต่อ" หรือ "contact" — ติดต่อเจ้าหน้าที่นิติบุคคล\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: {admin_hours}`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },
  LINE_BANK_INFO: {
    title: 'ข้อความแจ้งเลขบัญชีและช่องทางชำระเงิน (Bank Account & Payment Transfer Info)',
    badge: '🏦 บัญชีโอนเงิน',
    category: 'info',
    description: 'ส่งเมื่อลูกบ้านพิมพ์ "เลขบัญชี", "bank", "โอนเงิน", "qr" พร้อมข้อมูลบัญชีธนาคารสำหรับโอนเงิน',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🏦 ช่องทางโอนชำระเงิน นิติบุคคล {condo_name}\nBank Account for Payment Transfer\n\n• ธนาคาร / Bank: {bank_name}\n• เลขที่บัญชี / Account No.: {bank_account_no}\n• ชื่อบัญชี / Account Name: {bank_account_name}\n\n📌 โอนเงินแล้วรบกวนส่งสลิปเข้าในแชตนี้เท่านั้นนะครับ เพื่อให้ออกใบเสร็จรับเงินได้ถูกต้อง 🙏\nPlease send transfer slip in this chat only.`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{bank_name}', label: 'ชื่อธนาคาร', desc: 'กสิกรไทย' },
      { tag: '{bank_account_no}', label: 'เลขบัญชี', desc: '098-8-82502-3' },
      { tag: '{bank_account_name}', label: 'ชื่อบัญชี', desc: 'นิติบุคคลอาคารชุด สมบูรณ์' },
    ],
  },
  LINE_CONTACT_ADMIN: {
    title: 'ข้อความช่องทางติดต่อนิติบุคคล / เวลาทำการ (Contact Juristic Admin & Office Hours)',
    badge: '📞 ติดต่อแอดมิน',
    category: 'info',
    description: 'ส่งเมื่อลูกบ้านพิมพ์ "ติดต่อ", "contact", "แอดมิน", "admin", "เบอร์โทร", "นิติ"',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🏢 ข้อมูลติดต่อนิติบุคคล {condo_name}\nJuristic Office Contact Information\n\n🕒 เวลาทำการตอบแชต LINE / Chat Hours:\n{admin_hours} (ทุกวัน)\n\n📞 เบอร์โทรศัพท์ติดต่อ / Tel: 081-403-6273\n📍 สำนักงานนิติบุคคล: ชั้น 1 อาคารชุด สมบูรณ์ คอนโดทาวน์\n\nหากท่านมีข้อสงสัยหรือต้องการความช่วยเหลือเร่งด่วน สามารถพิมพ์ข้อความทิ้งไว้ในแชตนี้ได้เลยครับ เจ้าหน้าที่จะรีบตอบกลับโดยเร็วครับ 🙏`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
    ],
  },
  LINE_FUND_INFO: {
    title: 'ข้อความข้อมูลโครงการระดมทุนซ่อมแซมตึก (Maintenance Fund Project Info)',
    badge: '🏗️ เงินระดมทุน',
    category: 'info',
    description: 'ส่งเมื่อลูกบ้านพิมพ์ "เงินระดมทุน", "fund", "กองทุน" เพื่อแจ้งรายละเอียดโครงการระดมทุน',
    defaultBubbles: [
      {
        id: '1',
        type: 'text',
        text: `🏗️ โครงการเงินระดมทุนซ่อมแซมและปรับปรุงอาคาร\nBuilding Maintenance & Renovation Fund\n{condo_name}\n\nห้องชุดที่ร่วมสมทบเงินทุนซ่อมตึก จะได้รับสิทธิ์นำยอดเงินสมทบมาหักลดหย่อนค่าส่วนกลางรายเดือนได้ตามระเบียบที่นิติบุคคลกำหนดครับ\n\n📌 ตรวจสอบยอดเงินสมทบสะสมของห้องท่าน:\nพิมพ์คำว่า "ดูบิล" หรือ "bill" เพื่อดูยอดเงินสมทบสะสมที่สามารถนำมาลดหย่อนได้ครับ 🙏`,
      },
    ],
    allowedTags: [
      { tag: '{condo_name}', label: 'ชื่อคอนโด', desc: 'สมบูรณ์คอนโดทาวน์' },
      { tag: '{admin_hours}', label: 'เวลาทำการ', desc: '12.00 - 24.00 น.' },
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
