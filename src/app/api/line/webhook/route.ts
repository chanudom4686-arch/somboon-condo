// LINE OA Webhook Handler with Multi-Room Comma-Separated 3-Step Registration (e.g. "001,002"),
// Multi-Room Bill/Receipt/Statement Support, Bilingual (TH/EN) Commands, Follow Event Welcome,
// and Admin Working Hours (12.00 - 24.00) — Text-only (No meter photo sent to residents)
// Version 2.17 - Auto-reply Master Switch, Smart Exact Matching, and Bilingual Multi-room Bill

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { formatRoomNo, calculateBill, resolveRoomNo } from '@/utils/billing';
import {
  parseConfigToBubbles,
  buildLineMessagesFromBubbles,
  DEFAULT_LINE_TEMPLATES,
} from '@/utils/lineTemplates';

function verifySignature(body: string, channelSecret: string, signature: string | null): boolean {
  if (!signature || !channelSecret) return true;
  const hash = crypto.createHmac('sha256', channelSecret).update(body).digest('base64');
  return hash === signature;
}

async function replyLineMessage(replyToken: string, messages: any[], accessToken: string) {
  if (!accessToken) {
    console.warn('LINE access token not configured');
    return;
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: messages.slice(0, 5), // LINE Messaging API allows max 5 bubbles per reply
      }),
    });
    if (!res.ok) {
      console.warn('LINE reply status:', res.status);
    }
  } catch (err) {
    console.error('Failed to send LINE reply:', err);
  }
}

async function syncLineUserProfile(
  lineUserId: string,
  accessToken: string,
  supabase: any,
  lastMsg = '',
  msgType = 'text'
) {
  try {
    let displayName = '';
    let pictureUrl = '';
    let statusMessage = '';

    if (accessToken) {
      try {
        const profRes = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (profRes.ok) {
          const prof = await profRes.json();
          displayName = prof.displayName || '';
          pictureUrl = prof.pictureUrl || '';
          statusMessage = prof.statusMessage || '';
        }
      } catch (err) {
        // ignore network error
      }
    }

    await supabase.from('line_recent_users').upsert(
      {
        line_user_id: lineUserId,
        display_name: displayName,
        picture_url: pictureUrl,
        status_message: statusMessage,
        last_message: lastMsg,
        message_type: msgType,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'line_user_id' }
    );
  } catch (err) {
    console.error('Failed to sync LINE user profile:', err);
  }
}

// Mask the last 4 digits of a phone number with XXXX (e.g. "081-234-6273" -> "081-234-XXXX")
// Supports multiple phone numbers separated by comma or slash
function maskSinglePhone(phoneStr: string): string {
  const digits = phoneStr.replace(/[^0-9]/g, '');
  if (digits.length < 4) return '';
  const prefix = digits.slice(0, digits.length - 4);
  if (prefix.length === 6) {
    return `${prefix.slice(0, 3)}-${prefix.slice(3, 6)}-XXXX`;
  }
  if (prefix.length > 3) {
    return `${prefix.slice(0, 3)}-${prefix.slice(3)}-XXXX`;
  }
  return `${prefix}XXXX`;
}

function maskPhoneLast4(phone?: string | null): string {
  if (!phone || !phone.trim()) return 'ไม่มีข้อมูลเบอร์โทร / No Phone';
  const parts = phone.split(/[,/]/).map((p: string) => p.trim()).filter(Boolean);
  const maskedParts = parts.map(maskSinglePhone).filter(Boolean);
  if (maskedParts.length === 0) return 'ไม่มีข้อมูลเบอร์โทร / No Phone';
  return maskedParts.join(', ');
}

// Extract clean numeric phone numbers (at least 4 digits) from a comma/slash separated string
function extractCleanPhones(phoneStr?: string | null): string[] {
  if (!phoneStr) return [];
  return String(phoneStr)
    .split(/[,/]/)
    .map((p: string) => p.replace(/[^0-9]/g, ''))
    .filter((p: string) => p.length >= 4);
}

// Parse a single room token (e.g. "001", "1", "674/001", "64-65", "064-065")
function parseSingleRoomToken(rawToken: string): string | null {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed
    .replace(/^ห้อง\s*/i, '')
    .replace(/^room\s*/i, '')
    .replace(/^(674|645)\//, '')
    .trim();

  // Check paired room patterns (e.g., 64-65, 064-065, 144-145, 164-165, 186-187)
  if (/^(0?64-0?65|144-145|164-165|186-187)$/.test(withoutPrefix)) {
    return resolveRoomNo(withoutPrefix);
  }

  // Check 1 to 3 digit room numbers (001 - 195)
  if (/^\d{1,3}$/.test(withoutPrefix)) {
    const num = parseInt(withoutPrefix, 10);
    if (num >= 1 && num <= 195) {
      return resolveRoomNo(withoutPrefix);
    }
  }

  return null;
}

// Parse single or comma-separated room numbers (e.g. "001" or "001,002" or "001, 002, 64-65")
function parseRoomNumbersList(rawText: string): string[] | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const parts = trimmed
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const resolvedList: string[] = [];
  for (const part of parts) {
    const resolved = parseSingleRoomToken(part);
    if (!resolved) {
      return null; // Not a valid room number list
    }
    if (!resolvedList.includes(resolved)) {
      resolvedList.push(resolved);
    }
  }

  return resolvedList.length > 0 ? resolvedList : null;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-line-signature');

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data: configRows } = await supabase.from('condo_config').select('key, value');
    const config: Record<string, string> = {};
    if (configRows) {
      configRows.forEach((c) => {
        config[c.key] = c.value;
      });
    }

    const channelSecret = config.LINE_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET || '';
    const accessToken = config.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
    const condoName = config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (674)';
    const currentPeriod = config.CURRENT_BILLING_PERIOD || '2026-11';
    const dueDay = config.BILL_DUE_DAY || '5';

    if (channelSecret && signature) {
      const isValid = verifySignature(rawBody, channelSecret, signature);
      if (!isValid) {
        console.warn('Invalid LINE signature');
        return NextResponse.json({ message: 'Invalid signature' }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    const events = payload.events || [];

    const { data: rulesData } = await supabase
      .from('line_auto_replies')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    const rules = rulesData || [];

    const welcomeAndRegisterGuide = `สวัสดีครับ ยินดีต้อนรับสู่ LINE OA ${condoName} 🏢
Welcome to ${condoName} Official LINE!

📌 วิธีลงทะเบียนผูกห้องชุด / How to Register:
กรุณากดปุ่ม "ลงทะเบียน" ที่ริชเมนูด้านล่าง (หรือพิมพ์คำว่า "ลงทะเบียน" / "Register") เพื่อผูกห้องชุดรับบิลค่าน้ำและค่าส่วนกลาง
Please tap "ลงทะเบียน (Register)" on the Rich Menu below (or type "ลงทะเบียน" / "Register") to link your room.

🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours:
12.00 - 24.00 น. (12:00 PM - 12:00 AM) ทุกวัน / Daily`;

    for (const event of events) {
      const replyToken = event.replyToken;
      const lineUserId = event.source?.userId;
      if (!replyToken || !lineUserId) continue;

      // 0. Handle New Friend Added ("follow" event)
      if (event.type === 'follow') {
        syncLineUserProfile(lineUserId, accessToken, supabase, 'เพิ่มเพื่อน (Follow)', 'follow');
        const welcomeBubbles = parseConfigToBubbles(
          config.LINE_WELCOME_NEW_FRIEND,
          DEFAULT_LINE_TEMPLATES.LINE_WELCOME_NEW_FRIEND.defaultBubbles
        );
        const welcomeMessages = buildLineMessagesFromBubbles(welcomeBubbles, {
          condo_name: condoName,
          admin_hours: '12.00 - 24.00 น.',
        });
        await replyLineMessage(
          replyToken,
          welcomeMessages.length > 0 ? welcomeMessages : [{ type: 'text', text: welcomeAndRegisterGuide }],
          accessToken
        );
        continue;
      }

      // Handle Image / Payment Slip Upload
      if (event.type === 'message' && event.message?.type === 'image') {
        syncLineUserProfile(lineUserId, accessToken, supabase, '[ส่งรูปภาพ/สลิปโอนเงิน]', 'image');

        const slipBubbles = parseConfigToBubbles(
          config.LINE_SLIP_RECEIVED,
          DEFAULT_LINE_TEMPLATES.LINE_SLIP_RECEIVED.defaultBubbles
        );
        const slipMessages = buildLineMessagesFromBubbles(slipBubbles, {
          condo_name: condoName,
          admin_hours: '12.00 - 24.00 น.',
        });

        await replyLineMessage(
          replyToken,
          slipMessages.length > 0
            ? slipMessages
            : [
                {
                  type: 'text',
                  text: `📸 นิติบุคคลได้รับรูปสลิปการโอนเงินเรียบร้อยแล้วครับ ขอบพระคุณครับ 🙏\nWe have received your payment slip.\n\nเจ้าหน้าที่จะดำเนินการตรวจสอบยอดเงินและออกใบเสร็จรับเงินให้อย่างเป็นทางการครับ\n🕒 เวลาทำการแอดมินตอบแชท: 12.00 - 24.00 น.`,
                },
              ],
          accessToken
        );
        continue;
      }

      // Handle Sticker
      if (event.type === 'message' && event.message?.type === 'sticker') {
        syncLineUserProfile(lineUserId, accessToken, supabase, '[สติ๊กเกอร์ LINE]', 'sticker');
        continue;
      }

      if (event.type === 'message' && event.message?.type === 'text') {
        const text = (event.message.text || '').trim();
        syncLineUserProfile(lineUserId, accessToken, supabase, text, 'text');
        const lowerText = text.toLowerCase();
        const stateKey = `LINE_REG_STATE_${lineUserId}`;
        const pendingState = config[stateKey] || '';

        // A. Handle Resident Self-Unlink (Thai & English)
        if (
          text === 'ยกเลิกผูกห้อง' ||
          text === 'ยกเลิกลงทะเบียน' ||
          lowerText === 'unlink' ||
          lowerText === 'unregister'
        ) {
          const { data: linkedRooms } = await supabase
            .from('rooms')
            .select('room_no')
            .eq('line_user_id', lineUserId);

          await supabase
            .from('condo_config')
            .upsert({ key: stateKey, value: '', updated_at: new Date().toISOString() }, { onConflict: 'key' });

          if (linkedRooms && linkedRooms.length > 0) {
            await supabase
              .from('rooms')
              .update({ line_user_id: '', updated_at: new Date().toISOString() })
              .eq('line_user_id', lineUserId);

            const roomListStr = linkedRooms.map((r) => formatRoomNo(r.room_no)).join(', ');
            const unlinkBubbles = parseConfigToBubbles(
              config.LINE_UNLINK_SUCCESS,
              DEFAULT_LINE_TEMPLATES.LINE_UNLINK_SUCCESS.defaultBubbles
            );
            const unlinkMessages = buildLineMessagesFromBubbles(unlinkBubbles, {
              room_no: roomListStr,
              condo_name: condoName,
              admin_hours: '12.00 - 24.00 น.',
            });

            await replyLineMessage(
              replyToken,
              unlinkMessages.length > 0
                ? unlinkMessages
                : [
                    {
                      type: 'text',
                      text: `🔓 ยกเลิกการผูกบัญชี LINE กับห้อง ${roomListStr} เรียบร้อยแล้วครับ\nUnlinked LINE account from Room ${roomListStr} successfully.\n\nหากต้องการลงทะเบียนใหม่ กดริชเมนูหรือพิมพ์ "ลงทะเบียน" / "Register" ได้เลยครับ\n🕒 เวลาทำการแอดมิน / Admin Hours: 12.00 - 24.00 น.`,
                    },
                  ],
              accessToken
            );
          } else {
            const notLinkedBubbles = parseConfigToBubbles(
              config.LINE_UNLINK_NOT_LINKED,
              DEFAULT_LINE_TEMPLATES.LINE_UNLINK_NOT_LINKED.defaultBubbles
            );
            const notLinkedMessages = buildLineMessagesFromBubbles(notLinkedBubbles, {
              condo_name: condoName,
              admin_hours: '12.00 - 24.00 น.',
            });
            await replyLineMessage(
              replyToken,
              notLinkedMessages.length > 0
                ? notLinkedMessages
                : [
                    {
                      type: 'text',
                      text: `บัญชี LINE ของคุณยังไม่ได้ผูกกับห้องชุดใดในระบบครับ (Your LINE account is not linked to any room yet.)\n\nพิมพ์ "ลงทะเบียน" หรือ "Register" เพื่อเริ่มต้นผูกห้องชุดได้เลยครับ\n🕒 เวลาทำการแอดมิน / Admin Hours: 12.00 - 24.00 น.`,
                    },
                  ],
              accessToken
            );
          }
          continue;
        }

        // B. Interactive Registration STEP 1: Resident taps Rich Menu or types "ลงทะเบียน" / "register"
        if (
          text === 'ลงทะเบียน' ||
          text === 'ผูกห้อง' ||
          text === 'ลงทะเบียนผูกห้อง' ||
          lowerText === 'register' ||
          lowerText === 'link'
        ) {
          await supabase
            .from('condo_config')
            .upsert(
              { key: stateKey, value: 'AWAITING_ROOM', updated_at: new Date().toISOString() },
              { onConflict: 'key' }
            );

          const promptRoomBubbles = parseConfigToBubbles(
            config.LINE_REG_PROMPT_ROOM,
            DEFAULT_LINE_TEMPLATES.LINE_REG_PROMPT_ROOM.defaultBubbles
          );
          const promptRoomMessages = buildLineMessagesFromBubbles(promptRoomBubbles, {
            condo_name: condoName,
            admin_hours: '12.00 - 24.00 น.',
          });

          await replyLineMessage(
            replyToken,
            promptRoomMessages.length > 0
              ? promptRoomMessages
              : [
                  {
                    type: 'text',
                    text: `📝 เริ่มต้นการลงทะเบียนผูกห้องชุด (ขั้นตอนที่ 1/2)\nRoom Registration (Step 1/2)\n\n👉 กรุณาพิมพ์ "เลขห้อง" ของท่านส่งมาในแชทนี้ครับ\n• กรณีห้องเดียว พิมพ์เช่น: 001 (หรือห้องคู่ 64-65)\n• กรณีมีหลายห้อง ให้พิมพ์คั่นด้วยลูกน้ำ (,) ไปเรื่อยๆ เช่น: 001,002,005\n\nPlease enter your Room Number:\n• Single room: e.g. 001 (or 64-65)\n• Multiple rooms (comma-separated): e.g. 001,002,005\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
                  },
                ],
            accessToken
          );
          continue;
        }

        // C. Interactive Registration STEP 2: Resident enters Single or Multiple Room Numbers (e.g. "001" or "001,002,005")
        const parsedRoomNos = parseRoomNumbersList(text);
        if (parsedRoomNos && parsedRoomNos.length > 0) {
          const { data: foundRoomsData, error: roomErr } = await supabase
            .from('rooms')
            .select('*')
            .in('room_no', parsedRoomNos)
            .neq('status', 'รวมห้องคู่')
            .order('room_no', { ascending: true });

          const foundRooms = foundRoomsData || [];

          if (foundRooms.length === 0 || roomErr) {
            const notFoundBubbles = parseConfigToBubbles(
              config.LINE_REG_ROOM_NOT_FOUND,
              DEFAULT_LINE_TEMPLATES.LINE_REG_ROOM_NOT_FOUND.defaultBubbles
            );
            const notFoundMessages = buildLineMessagesFromBubbles(notFoundBubbles, {
              room_no: parsedRoomNos.map((r) => formatRoomNo(r)).join(', '),
              condo_name: condoName,
              admin_hours: '12.00 - 24.00 น.',
            });

            await replyLineMessage(
              replyToken,
              notFoundMessages.length > 0
                ? notFoundMessages
                : [
                    {
                      type: 'text',
                      text: `⚠️ ไม่พบข้อมูลห้อง ${parsedRoomNos.map((r) => formatRoomNo(r)).join(', ')} ในระบบ\nRoom not found.\n\nกรุณาพิมพ์เลขห้อง 3 หลักอีกครั้ง (เช่น 001 หรือหลายห้อง 001,002)\nPlease enter valid room numbers (e.g. 001 or 001,002).\n🕒 เวลาทำการแอดมิน / Admin Hours: 12.00 - 24.00 น.`,
                    },
                  ],
              accessToken
            );
            continue;
          }

          const roomsWithPhone = foundRooms.filter((r) => {
            const oPhones = extractCleanPhones(r.owner_phone);
            const tPhones = extractCleanPhones(r.tenant_phone);
            return oPhones.length > 0 || tPhones.length > 0;
          });

          const roomsWithoutPhone = foundRooms.filter((r) => {
            const oPhones = extractCleanPhones(r.owner_phone);
            const tPhones = extractCleanPhones(r.tenant_phone);
            return oPhones.length === 0 && tPhones.length === 0;
          });

          if (roomsWithPhone.length === 0) {
            await supabase
              .from('condo_config')
              .upsert({ key: stateKey, value: '', updated_at: new Date().toISOString() }, { onConflict: 'key' });

            const noPhoneDetails = roomsWithoutPhone
              .map((r) => `• ห้อง ${formatRoomNo(r.room_no)} (${r.owner_name || r.tenant_name || 'เจ้าของห้อง'})`)
              .join('\n');

            const noPhoneBubbles = parseConfigToBubbles(
              config.LINE_REG_NO_PHONE_IN_ROOM,
              DEFAULT_LINE_TEMPLATES.LINE_REG_NO_PHONE_IN_ROOM.defaultBubbles
            );
            const noPhoneMessages = buildLineMessagesFromBubbles(noPhoneBubbles, {
              room_no: roomsWithoutPhone.map((r) => formatRoomNo(r.room_no)).join(', '),
              condo_name: condoName,
              admin_hours: '12.00 - 24.00 น.',
            });

            await replyLineMessage(
              replyToken,
              noPhoneMessages.length > 0
                ? noPhoneMessages
                : [
                    {
                      type: 'text',
                      text: `🏢 ข้อมูลห้องชุด / Room Info:\n${noPhoneDetails}\n\n⚠️ ห้องข้างต้นยังไม่มีเบอร์โทรศัพท์บันทึกในระบบ กรุณาพิมพ์ชื่อและเบอร์โทรศัพท์ของท่านทิ้งไว้ในแชทนี้ เพื่อให้แอดมินบันทึกข้อมูลให้ครับ\nNo phone number is registered for the room(s) above yet. Please leave your name and phone number in this chat for our admin.\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
                    },
                  ],
              accessToken
            );
            continue;
          }

          // Save comma-separated list of roomsWithPhone to pending state for Step 3 verification
          const pendingValue = roomsWithPhone.map((r) => r.room_no).join(',');
          await supabase
            .from('condo_config')
            .upsert(
              { key: stateKey, value: pendingValue, updated_at: new Date().toISOString() },
              { onConflict: 'key' }
            );

          const roomSummaryLines: string[] = [];
          roomsWithPhone.forEach((r, idx) => {
            const oPhones = extractCleanPhones(r.owner_phone);
            const tPhones = extractCleanPhones(r.tenant_phone);
            const hasOwnerPhone = oPhones.length > 0;
            const hasTenantPhone = tPhones.length > 0;

            if (roomsWithPhone.length === 1) {
              roomSummaryLines.push(`🏢 ห้องชุด / Room: ${formatRoomNo(r.room_no)}`);
              if (r.owner_name || hasOwnerPhone) {
                roomSummaryLines.push(`👤 ชื่อ-นามสกุล / Name: คุณ ${r.owner_name || 'เจ้าของห้อง (Owner)'}`);
                if (hasOwnerPhone) {
                  roomSummaryLines.push(`📞 เบอร์โทรศัพท์ / Phone: ${maskPhoneLast4(r.owner_phone)}`);
                }
              }
              if (r.tenant_name || hasTenantPhone) {
                roomSummaryLines.push(`👤 ผู้เช่า / Tenant: คุณ ${r.tenant_name || 'ผู้เช่า (Tenant)'}`);
                if (hasTenantPhone) {
                  roomSummaryLines.push(`📞 เบอร์โทรผู้เช่า / Tenant Phone: ${maskPhoneLast4(r.tenant_phone)}`);
                }
              }
            } else {
              const displayName = r.owner_name || r.tenant_name || 'เจ้าของห้อง';
              const displayMaskedPhone = hasOwnerPhone
                ? maskPhoneLast4(r.owner_phone)
                : maskPhoneLast4(r.tenant_phone);
              roomSummaryLines.push(
                `${idx + 1}) ห้อง ${formatRoomNo(r.room_no)} — คุณ ${displayName} (📞 ${displayMaskedPhone})`
              );
            }
          });

          if (roomsWithoutPhone.length > 0) {
            roomSummaryLines.push(
              `\n*(หมายเหตุ: ห้อง ${roomsWithoutPhone.map((r) => formatRoomNo(r.room_no)).join(', ')} ยังไม่มีเบอร์โทรในระบบ โปรดแจ้งเบอร์โทรกับแอดมินเพิ่มเติม)*`
            );
          }

          const promptBubbles = parseConfigToBubbles(
            config.LINE_REG_PROMPT_PHONE,
            DEFAULT_LINE_TEMPLATES.LINE_REG_PROMPT_PHONE.defaultBubbles
          );
          const maskedPhoneStr = roomsWithPhone
            .map((r) => maskPhoneLast4(r.owner_phone || r.tenant_phone))
            .filter(Boolean)
            .join(', ');
          const promptMessages = buildLineMessagesFromBubbles(promptBubbles, {
            room_no: roomsWithPhone.map((r) => formatRoomNo(r.room_no)).join(', '),
            owner_name: roomsWithPhone.map((r) => r.owner_name || r.tenant_name || '').filter(Boolean).join(', '),
            masked_phone: maskedPhoneStr,
            phone: maskedPhoneStr,
            condo_name: condoName,
            admin_hours: '12.00 - 24.00 น.',
          });

          await replyLineMessage(
            replyToken,
            promptMessages.length > 0
              ? promptMessages
              : [
                  {
                    type: 'text',
                    text: `🏢 พบข้อมูลห้องชุด (${roomsWithPhone.length} ห้อง) — ขั้นตอนที่ 2/2\nRooms Found (${roomsWithPhone.length}) — Step 2/2\n\n${roomSummaryLines.join('\n')}\n\n🔑 กรุณาพิมพ์ "ตัวเลข 4 ตัวท้ายของเบอร์โทรศัพท์" (แทนที่ XXXX) ส่งมาในแชทนี้เพื่อยืนยันการลงทะเบียนครับ\nPlease reply with the "last 4 digits of your phone number" (replacing XXXX) to complete registration.\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
                  },
                ],
            accessToken
          );
          continue;
        }

        const cleanDigits = text.replace(/[^0-9]/g, '');

        // D. Interactive Registration STEP 3: Resident enters 4-digit Phone Suffix (e.g. "6273")
        if (cleanDigits.length === 4 && /^\d{4}$/.test(text)) {
          if (!pendingState || pendingState === 'AWAITING_ROOM') {
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `⚠️ กรุณาพิมพ์ "เลขห้อง" ของท่านก่อนครับ (เช่น 001 หรือหลายห้อง 001,002) แล้วจึงกรอกเบอร์โทรศัพท์ 4 ตัวท้าย\nPlease enter your "Room Number(s)" first (e.g. 001 or 001,002) before entering the last 4 digits of your phone number.\n\n🕒 เวลาทำการแอดมิน / Admin Hours: 12.00 - 24.00 น.`,
                },
              ],
              accessToken
            );
            continue;
          }

          const pendingRoomNos = pendingState
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

          const { data: pendingRoomsData } = await supabase
            .from('rooms')
            .select('*')
            .in('room_no', pendingRoomNos)
            .order('room_no', { ascending: true });

          const pendingRooms = pendingRoomsData || [];

          if (pendingRooms.length === 0) {
            await supabase
              .from('condo_config')
              .upsert(
                { key: stateKey, value: 'AWAITING_ROOM', updated_at: new Date().toISOString() },
                { onConflict: 'key' }
              );
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `⚠️ กรุณาพิมพ์เลขห้องของท่านใหม่อีกครั้งครับ (เช่น 001 หรือหลายห้อง 001,002)\nPlease enter your room number(s) again (e.g. 001 or 001,002).`,
                },
              ],
              accessToken
            );
            continue;
          }

          const matchedRooms = pendingRooms.filter((r) => {
            const oPhones = extractCleanPhones(r.owner_phone);
            const tPhones = extractCleanPhones(r.tenant_phone);
            return (
              oPhones.some((p: string) => p.endsWith(cleanDigits)) ||
              tPhones.some((p: string) => p.endsWith(cleanDigits))
            );
          });

          const remainingRooms = pendingRooms.filter((r) => !matchedRooms.some((m) => m.room_no === r.room_no));

          if (matchedRooms.length > 0) {
            const matchedRoomNos = matchedRooms.map((r) => r.room_no);
            await supabase
              .from('rooms')
              .update({
                line_user_id: lineUserId,
                updated_at: new Date().toISOString(),
              })
              .in('room_no', matchedRoomNos);

            if (remainingRooms.length > 0) {
              // Some rooms matched this phone number, while remaining rooms have a different phone number
              const nextPendingValue = remainingRooms.map((r) => r.room_no).join(',');
              await supabase
                .from('condo_config')
                .upsert(
                  { key: stateKey, value: nextPendingValue, updated_at: new Date().toISOString() },
                  { onConflict: 'key' }
                );

              const remainingListText = remainingRooms
                .map(
                  (r) =>
                    `• ห้อง ${formatRoomNo(r.room_no)} — คุณ ${r.owner_name || r.tenant_name || '-'} (📞 ${maskPhoneLast4(
                      r.owner_phone || r.tenant_phone
                    )})`
                )
                .join('\n');

              await replyLineMessage(
                replyToken,
                [
                  {
                    type: 'text',
                    text: `✅ ลงทะเบียนผูกห้อง ${matchedRooms.map((r) => formatRoomNo(r.room_no)).join(', ')} สำเร็จแล้วครับ!\n\n📌 ยังเหลือห้องที่ใช้เบอร์โทรศัพท์อื่นอีก ${remainingRooms.length} ห้อง:\n${remainingListText}\n\n🔑 กรุณาพิมพ์ตัวเลข 4 ตัวท้ายของเบอร์โทรศัพท์ห้องที่เหลือต่อได้เลยครับ\nPlease enter the last 4 digits of the phone number for the remaining room(s).`,
                  },
                ],
                accessToken
              );
              continue;
            }

            // All requested rooms matched! Clear pending state
            await supabase
              .from('condo_config')
              .upsert({ key: stateKey, value: '', updated_at: new Date().toISOString() }, { onConflict: 'key' });

            // Fetch all rooms currently linked to this user to display complete list
            const { data: allUserRooms } = await supabase
              .from('rooms')
              .select('room_no, owner_name, tenant_name')
              .eq('line_user_id', lineUserId)
              .neq('status', 'รวมห้องคู่')
              .order('room_no', { ascending: true });

            const linkedRoomLabels = (allUserRooms || matchedRooms)
              .map((r) => formatRoomNo(r.room_no))
              .join(', ');
            const firstMatched = matchedRooms[0];
            const personName =
              firstMatched.owner_name || firstMatched.tenant_name || 'เจ้าของร่วม/ผู้พักอาศัย';

            const successBubbles = parseConfigToBubbles(
              config.LINE_REG_SUCCESS,
              DEFAULT_LINE_TEMPLATES.LINE_REG_SUCCESS.defaultBubbles
            );
            const successMessages = buildLineMessagesFromBubbles(successBubbles, {
              room_no: linkedRoomLabels,
              owner_name: personName,
              condo_name: condoName,
              admin_hours: '12.00 - 24.00 น.',
            });

            await replyLineMessage(
              replyToken,
              successMessages.length > 0
                ? successMessages
                : [
                    {
                      type: 'text',
                      text: `🎉 ลงทะเบียนผูกห้อง ${linkedRoomLabels} สำเร็จแล้วครับ!\nRegistration Complete for Room(s): ${linkedRoomLabels}!\n👤 ผู้รับข้อมูล / Resident: คุณ ${personName}\n\n📌 คำสั่งตรวจสอบข้อมูลอัตโนมัติ (Thai / English Commands):\n• พิมพ์ "ดูบิล" หรือ "bill" — ดูใบแจ้งหนี้ทุกห้องที่ผูกไว้ / View current bill\n• พิมพ์ "ใบเสร็จ" หรือ "receipt" — ดูใบเสร็จรับเงิน / Payment receipt\n• พิมพ์ "สเตทเมนท์" หรือ "statement" — ประวัติชำระ 12 เดือน / 12-month history\n• พิมพ์ "เงินระดมทุน" หรือ "fund" — ยอดเงินระดมทุนซ่อมตึก / Maintenance fund\n• พิมพ์ "การเงิน" หรือ "finance" — สรุปรายรับ-รายจ่ายตึก / Building finance\n• พิมพ์ "เลขบัญชี" หรือ "bank" — ช่องทางโอนเงิน / Bank account\n• พิมพ์ "เมนู" หรือ "menu" — ดูคำสั่งทั้งหมด / All commands\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
                    },
                  ],
              accessToken
            );
          } else {
            const maskedSummary = pendingRooms
              .map((r) => `${formatRoomNo(r.room_no)} (${maskPhoneLast4(r.owner_phone || r.tenant_phone)})`)
              .join(', ');

            const errBubbles = parseConfigToBubbles(
              config.LINE_REG_PHONE_ERROR,
              DEFAULT_LINE_TEMPLATES.LINE_REG_PHONE_ERROR.defaultBubbles
            );
            const errMessages = buildLineMessagesFromBubbles(errBubbles, {
              room_no: maskedSummary,
              masked_phone: cleanDigits,
              condo_name: condoName,
              admin_hours: '12.00 - 24.00 น.',
            });

            await replyLineMessage(
              replyToken,
              errMessages.length > 0
                ? errMessages
                : [
                    {
                      type: 'text',
                      text: `❌ ตัวเลข 4 ตัวท้าย (${cleanDigits}) ไม่ตรงกับเบอร์โทรศัพท์ที่ลงทะเบียนไว้ของห้อง ${maskedSummary}\nThe last 4 digits (${cleanDigits}) do not match our records.\n\n• กรุณาพิมพ์ตัวเลข 4 ตัวท้ายของเบอร์โทรศัพท์อีกครั้ง\n  Please enter the last 4 digits again.\n• หรือพิมพ์เลขห้องใหม่ (เช่น 001 หรือ 001,002) หากต้องการเปลี่ยนห้อง\n  Or type room number(s) again (e.g. 001 or 001,002).\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
                    },
                  ],
              accessToken
            );
          }
          continue;
        }

        // E. Direct 7-Digit Shortcut Registration Code (e.g. "0056273" or paired "0646273")
        if (cleanDigits.length === 7 && text.length <= 12) {
          const rawPrefix = cleanDigits.substring(0, 3);
          const roomPrefix = resolveRoomNo(rawPrefix);
          const phoneSuffix = cleanDigits.substring(3, 7);

          const { data: roomData, error: roomErr } = await supabase
            .from('rooms')
            .select('*')
            .eq('room_no', roomPrefix)
            .maybeSingle();

          if (!roomData || roomErr) {
            const notFoundBubbles = parseConfigToBubbles(
              config.LINE_REG_ROOM_NOT_FOUND,
              DEFAULT_LINE_TEMPLATES.LINE_REG_ROOM_NOT_FOUND.defaultBubbles
            );
            const notFoundMessages = buildLineMessagesFromBubbles(notFoundBubbles, {
              room_no: formatRoomNo(roomPrefix),
              condo_name: condoName,
              admin_hours: '12.00 - 24.00 น.',
            });

            await replyLineMessage(
              replyToken,
              notFoundMessages.length > 0
                ? notFoundMessages
                : [
                    {
                      type: 'text',
                      text: `⚠️ ไม่พบข้อมูลห้องเลขที่ ${formatRoomNo(roomPrefix)}\nโปรดพิมพ์คำว่า "ลงทะเบียน" หรือ "Register" เพื่อเริ่มต้นลงทะเบียนทีละขั้นตอนครับ\n🕒 เวลาทำการแอดมิน / Admin Hours: 12.00 - 24.00 น.`,
                    },
                  ],
              accessToken
            );
            continue;
          }

          const ownerPhones = extractCleanPhones(roomData.owner_phone);
          const tenantPhones = extractCleanPhones(roomData.tenant_phone);
          const ownerMatch = ownerPhones.some((p: string) => p.endsWith(phoneSuffix));
          const tenantMatch = tenantPhones.some((p: string) => p.endsWith(phoneSuffix));

          if (ownerMatch || tenantMatch) {
            await supabase
              .from('rooms')
              .update({
                line_user_id: lineUserId,
                updated_at: new Date().toISOString(),
              })
              .eq('room_no', roomPrefix);

            await supabase
              .from('condo_config')
              .upsert({ key: stateKey, value: '', updated_at: new Date().toISOString() }, { onConflict: 'key' });

            const personName = ownerMatch ? roomData.owner_name : roomData.tenant_name;

            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `🎉 ลงทะเบียนผูกห้อง ${formatRoomNo(roomPrefix)} สำเร็จแล้วครับ!\nRegistration Complete for Room ${formatRoomNo(roomPrefix)}!\n👤 ผู้รับข้อมูล / Resident: คุณ ${personName || 'เจ้าของร่วม/ผู้พักอาศัย'}\n\n📌 พิมพ์คำสั่งเพื่อตรวจสอบข้อมูลได้ทันที (Thai / English):\n• "ดูบิล" หรือ "bill" — ดูใบแจ้งหนี้รอบปัจจุบัน\n• "ใบเสร็จ" หรือ "receipt" — ดูใบเสร็จรับเงิน\n• "สเตทเมนท์" หรือ "statement" — ดูประวัติชำระย้อนหลัง 12 เดือน\n• "เงินระดมทุน" หรือ "fund" — ดูยอดเงินระดมทุนซ่อมตึก\n• "การเงิน" หรือ "finance" — ดูสรุปรายรับ-รายจ่ายของตึก\n• "เมนู" หรือ "menu" — ดูคำสั่งทั้งหมด\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
                },
              ],
              accessToken
            );
          } else {
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `⚠️ เบอร์โทรศัพท์ 4 ตัวท้าย (${phoneSuffix}) ไม่ตรงกับเบอร์ที่ลงทะเบียนไว้กับห้อง ${formatRoomNo(roomPrefix)} (${maskPhoneLast4(roomData.owner_phone || roomData.tenant_phone)})\n\nกรุณาพิมพ์เลขห้อง (เช่น ${rawPrefix} หรือหลายห้อง 001,002) หรือพิมพ์ "ลงทะเบียน" / "Register" เพื่อตรวจสอบข้อมูลห้องครับ\n🕒 เวลาทำการแอดมิน / Admin Hours: 12.00 - 24.00 น.`,
                },
              ],
              accessToken
            );
          }
          continue;
        }

        // F. Auto-Reply Master Switch Check
        const autoReplyMasterEnabled = config.LINE_BOT_AUTO_REPLY_ENABLED !== 'false';
        if (!autoReplyMasterEnabled) {
          // Master switch is OFF: Bot will not reply to any keywords, allowing human admin to chat freely
          continue;
        }

        // F2. Match against Customizable Auto-Reply Rules (Supports Both Thai & English Keywords & Multi-Room Owners!)
        // Clean text for exact matching (trim, remove common polite particles: ครับ/ค่ะ/คะ/นะ/คับ/ค้าบ/จ้า/จ้ะ/krub/ka)
        const cleanLowerText = lowerText.trim();
        const baseLowerText = cleanLowerText.replace(/\s*(ครับ|ค่ะ|คะ|นะ|คับ|ค้าบ|จ้า|จ้ะ|krub|ka)\s*$/i, '').trim();

        const matchedRule = rules.find((rule: any) => {
          if (!rule.is_active) return false;
          const keywords = (rule.keyword || '')
            .split(',')
            .map((k: string) => k.trim().toLowerCase())
            .filter(Boolean);
          if (rule.match_type === 'exact') {
            return keywords.includes(cleanLowerText) || keywords.includes(baseLowerText);
          }
          return keywords.some((k: string) => lowerText.includes(k));
        });

        const { data: linkedRoomsData } = await supabase
          .from('rooms')
          .select('*')
          .eq('line_user_id', lineUserId)
          .neq('status', 'รวมห้องคู่')
          .order('room_no', { ascending: true });
        const linkedRoomsList = linkedRoomsData || [];

        const bankInfoText = `ธนาคาร (Bank): ${config.BANK_NAME || 'กสิกรไทย'}\nเลขที่บัญชี (Account No.): ${config.BANK_ACCOUNT_NO || '-'}\nชื่อบัญชี (Account Name): ${config.BANK_ACCOUNT_NAME || condoName}`;

        if (matchedRule) {
          const mode = matchedRule.reply_mode || 'custom_text';
          const wantsMeterPhoto =
            mode === 'system_bill' || (matchedRule.reply_text || '').includes('{meter_photo}');
          const isPerRoomMode =
            ['system_bill', 'system_receipt', 'system_statement'].includes(mode) || wantsMeterPhoto;

          if (isPerRoomMode && linkedRoomsList.length === 0) {
            const pdpaBubbles = parseConfigToBubbles(
              config.LINE_PDPA_WARNING,
              DEFAULT_LINE_TEMPLATES.LINE_PDPA_WARNING.defaultBubbles
            );
            const pdpaMessages = buildLineMessagesFromBubbles(pdpaBubbles, {
              condo_name: condoName,
              admin_hours: '12.00 - 24.00 น.',
            });

            await replyLineMessage(
              replyToken,
              pdpaMessages.length > 0
                ? pdpaMessages
                : [
                    {
                      type: 'text',
                      text: `🔒 ตามหลักคุ้มครองข้อมูลส่วนบุคคล (PDPA) กรุณาลงทะเบียนผูกห้องชุดก่อนดูข้อมูลบิล รูปมิเตอร์ และสเตทเมนท์ครับ\nPlease register your room before viewing bills, meter photos, or statements.\n\n📌 วิธีลงทะเบียน / How to Register:\nกดปุ่ม "ลงทะเบียน" ที่ริชเมนูด้านล่าง หรือพิมพ์คำว่า "ลงทะเบียน" / "Register" (หรือพิมพ์เลขห้อง เช่น 001 หรือหลายห้อง 001,002)\n\n🕒 เวลาทำการแอดมินตอบแชท / Admin Working Hours: 12.00 - 24.00 น.`,
                    },
                  ],
              accessToken
            );
            continue;
          }

          let fundSummaryText = '';
          if (mode === 'system_fund' || matchedRule.reply_text.includes('{fund_summary}')) {
            const { data: fundTxs } = await supabase
              .from('transactions')
              .select('*')
              .eq('fund_type', 'maintenance_fund')
              .order('tx_date', { ascending: false });

            const totalFundIn = (fundTxs || [])
              .filter((t: any) => t.type === 'รายรับ' || t.type === 'income')
              .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
            const totalFundOut = (fundTxs || [])
              .filter((t: any) => t.type === 'รายจ่าย' || t.type === 'expense')
              .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
            const expenseItems = (fundTxs || [])
              .filter((t: any) => t.type === 'รายจ่าย' || t.type === 'expense')
              .slice(0, 5)
              .map((t: any) => `  - ${t.tx_date}: ${t.category} (${Number(t.amount).toLocaleString()} บ.)`)
              .join('\n');

            fundSummaryText = `• ยอดเงินระดมทุนสะสมทั้งหมด (Total Fund): ${totalFundIn.toLocaleString()} บาท\n• นำไปใช้ปรับปรุง/ซ่อมบำรุงแล้ว (Used): ${totalFundOut.toLocaleString()} บาท\n• ยอดคงเหลือปัจจุบัน (Remaining): ${(totalFundIn - totalFundOut).toLocaleString()} บาท\n\nรายการนำไปใช้ล่าสุด (Recent Expenses):\n${expenseItems || '  - ยังไม่มีรายการเบิกจ่าย / None'}`;
          }

          let buildingFinanceText = '';
          if (mode === 'system_finance' || matchedRule.reply_text.includes('{building_finance}')) {
            const { data: allTxs } = await supabase
              .from('transactions')
              .select('*')
              .order('tx_date', { ascending: false })
              .limit(100);

            const totalIn = (allTxs || [])
              .filter((t: any) => t.type === 'รายรับ' || t.type === 'income')
              .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
            const totalOut = (allTxs || [])
              .filter((t: any) => t.type === 'รายจ่าย' || t.type === 'expense')
              .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
            const netBal = totalIn - totalOut;

            buildingFinanceText = `• รายรับรวมของอาคาร (Total Income): +${totalIn.toLocaleString()} บาท\n• รายจ่ายรวมของอาคาร (Total Expense): -${totalOut.toLocaleString()} บาท\n• สถานะดุลการเงินปัจจุบัน (Net Balance): ${netBal >= 0 ? `✅ คงเหลือสุทธิ +${netBal.toLocaleString()} บาท` : `⚠️ ติดลบ ${netBal.toLocaleString()} บาท`}`;
          }

          // Pre-fetch and calculate bill details for each target room
          const targetRooms = linkedRoomsList.length > 0 ? linkedRoomsList : [null];
          const roomCalculations: Array<{
            targetRoom: any;
            roomNoFormatted: string;
            ownerName: string;
            prevMeter: number;
            currMeter: number;
            waterUnits: number;
            waterOnlyAmt: string;
            wastewaterOnlyAmt: string;
            waterTotal: string;
            commonFee: string;
            extraItems: string;
            totalDue: string;
            totalDueNum: number;
            paymentStatus: string;
            statement12mText: string;
          }> = [];

          const photoUrls: string[] = [];
          let consolidatedTotalAmount = 0;
          const multiRoomList: Array<{ roomNo: string; amount: number; isPaid: boolean }> = [];
          const consolidatedOwnerName =
            linkedRoomsList[0]?.owner_name || linkedRoomsList[0]?.tenant_name || 'ท่านเจ้าของร่วม';

          for (const targetRoom of targetRooms) {
            let roomNoFormatted = targetRoom ? formatRoomNo(targetRoom.room_no) : 'ยังไม่ผูกห้อง (Not Linked)';
            let ownerName = targetRoom ? targetRoom.owner_name || targetRoom.tenant_name || 'เจ้าของห้อง' : '-';
            let prevMeter = targetRoom ? Number(targetRoom.latest_meter) || 0 : 0;
            let currMeter = prevMeter;
            let waterUnits = 0;
            let waterOnlyAmt = '0.00';
            let wastewaterOnlyAmt = '0.00';
            let waterTotal = '0.00';
            let commonFee = '0.00';
            let extraItems = '';
            let totalDue = '0.00';
            let totalDueNum = 0;
            let paymentStatus = '⏳ รอชำระ / Pending';

            if (targetRoom) {
              const { data: logData } = await supabase
                .from('meter_logs')
                .select('*')
                .eq('room_no', targetRoom.room_no)
                .eq('period', currentPeriod)
                .maybeSingle();

              if (logData?.meter_photo_url && logData.meter_photo_url.startsWith('https://')) {
                photoUrls.push(logData.meter_photo_url);
              }

              const pMeter = logData ? Number(logData.prev_meter) : Number(targetRoom.latest_meter) || 0;
              const cMeter = logData ? Number(logData.curr_meter) : pMeter;
              const bill = calculateBill(
                targetRoom,
                cMeter,
                currentPeriod,
                config,
                logData ? Number(logData.special_items) || 0 : 0,
                logData?.special_items_note || logData?.note || '',
                Number(targetRoom.outstanding_balance) || 0,
                pMeter,
                logData ? Number(logData.late_fee) || 0 : 0
              );

              prevMeter = bill.prev_meter;
              currMeter = bill.curr_meter;
              waterUnits = bill.units_used;
              waterOnlyAmt = bill.water_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
              wastewaterOnlyAmt = bill.wastewater_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
              waterTotal = `${waterOnlyAmt} บาท (35 บ./หน่วย)\n• ค่าบำบัดน้ำเสีย: ${wastewaterOnlyAmt}`;
              commonFee = bill.common_fee.toLocaleString('th-TH', { minimumFractionDigits: 2 });

              const extraLines: string[] = [];
              if (bill.special_items_note && bill.special_items_note.includes('|')) {
                bill.special_items_note.split('|').forEach((part) => {
                  if (part.trim()) extraLines.push(`• ${part.trim()}`);
                });
              } else if (bill.special_items !== 0) {
                extraLines.push(
                  `• ${bill.special_items < 0 ? 'ส่วนลดพิเศษ' : 'รายการเพิ่มเติม'} (${bill.special_items_note || '-'}): ${
                    bill.special_items > 0 ? '+' : ''
                  }${bill.special_items.toLocaleString()} บาท`
                );
              }
              if (bill.late_fee > 0) {
                extraLines.push(`• เบี้ยปรับล่าช้า (Late Fee): +${bill.late_fee.toLocaleString()} บาท`);
              }
              if (bill.contribution_deducted > 0) {
                extraLines.push(
                  `• หักเครดิตสมทบทุนซ่อมตึก (Fund Credit): -${bill.contribution_deducted.toLocaleString()} บาท`
                );
              }
              if (bill.prepaid_deducted > 0) {
                extraLines.push(`• หักเงินฝากล่วงหน้า (Prepaid): -${bill.prepaid_deducted.toLocaleString()} บาท`);
              }
              if (bill.outstanding_balance > 0) {
                extraLines.push(`• ยอดค้างชำระยกมา (Arrears): +${bill.outstanding_balance.toLocaleString()} บาท`);
              }
              extraItems = extraLines.length > 0 ? extraLines.join('\n') + '\n' : '';
              totalDue = bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
              totalDueNum = bill.total_amount;
              consolidatedTotalAmount += bill.total_amount;

              paymentStatus = logData?.is_paid
                ? `✅ ชำระแล้ว / Paid (${
                    logData.paid_timestamp
                      ? new Date(logData.paid_timestamp).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })
                      : 'เรียบร้อย'
                  })`
                : `⏳ รอชำระ / Unpaid (ครบกำหนดวันที่ / Due: ${dueDay})`;

              multiRoomList.push({
                roomNo: formatRoomNo(targetRoom.room_no),
                amount: bill.total_amount,
                isPaid: !!logData?.is_paid,
              });
            }

            let statement12mText = 'ยังไม่มีประวัติการชำระเงิน / No payment history yet';
            if (targetRoom && (mode === 'system_statement' || matchedRule.reply_text.includes('{statement_12m}'))) {
              const { data: historyLogs } = await supabase
                .from('meter_logs')
                .select('*')
                .eq('room_no', targetRoom.room_no)
                .order('period', { ascending: false })
                .limit(12);

              if (historyLogs && historyLogs.length > 0) {
                statement12mText = historyLogs
                  .map((h: any) => {
                    const paidDate = h.paid_timestamp
                      ? new Date(h.paid_timestamp).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })
                      : '-';
                    return `• รอบ ${h.period}: ${Number(h.total_amount).toLocaleString()} บ. — ${
                      h.is_paid ? `✅ ชำระแล้ว/Paid (${paidDate})` : '⏳ ค้างชำระ/Unpaid'
                    }`;
                  })
                  .join('\n');
              }
            }

            roomCalculations.push({
              targetRoom,
              roomNoFormatted,
              ownerName,
              prevMeter,
              currMeter,
              waterUnits,
              waterOnlyAmt,
              wastewaterOnlyAmt,
              waterTotal,
              commonFee,
              extraItems,
              totalDue,
              totalDueNum,
              paymentStatus,
              statement12mText,
            });
          }

          const renderSingleTemplate = (template: string, calc: (typeof roomCalculations)[0]) => {
            return (template || '')
              .replace(/\{meter_photo\}/g, '')
              .replace(/ค่าน้ำ\+บำบัด:/g, 'ค่าน้ำประปา:')
              .replace(/\{condo_name\}/g, condoName)
              .replace(/\{room_no\}/g, calc.roomNoFormatted)
              .replace(/\{owner_name\}/g, calc.ownerName)
              .replace(/\{period\}/g, currentPeriod)
              .replace(/\{prev_meter\}/g, String(calc.prevMeter))
              .replace(/\{curr_meter\}/g, String(calc.currMeter))
              .replace(/\{water_units\}/g, String(calc.waterUnits))
              .replace(/\{water_amount\}/g, calc.waterOnlyAmt)
              .replace(/\{wastewater_amount\}/g, calc.wastewaterOnlyAmt)
              .replace(/\{water_total\}/g, calc.waterTotal)
              .replace(/\{common_fee\}/g, calc.commonFee)
              .replace(/\{extra_items\}/g, calc.extraItems)
              .replace(/\{total_due\}/g, calc.totalDue)
              .replace(
                /\{total_all_rooms\}/g,
                consolidatedTotalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })
              )
              .replace(
                /\{consolidated_total\}/g,
                consolidatedTotalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })
              )
              .replace(/\{payment_status\}/g, calc.paymentStatus)
              .replace(/\{due_date\}/g, dueDay)
              .replace(/\{bank_info\}/g, bankInfoText)
              .replace(/\{statement_12m\}/g, calc.statement12mText)
              .replace(/\{fund_summary\}/g, fundSummaryText)
              .replace(/\{building_finance\}/g, buildingFinanceText)
              .trim();
          };

          const ruleBubblesRaw: string[] =
            Array.isArray(matchedRule.reply_bubbles) && matchedRule.reply_bubbles.length > 0
              ? matchedRule.reply_bubbles
              : [matchedRule.reply_text || ''];

          const renderedTexts: string[] = [];

          if (!isPerRoomMode) {
            // General rules (custom_text, system_fund, system_finance)
            // Send each bubble as its own separate message balloon!
            for (const b of ruleBubblesRaw) {
              const rendered = renderSingleTemplate(b, roomCalculations[0]);
              if (rendered) renderedTexts.push(rendered);
            }
          } else if (roomCalculations.length <= 1) {
            // Single room mode (or not registered yet)
            // Send each bubble as its own separate message balloon! (No combining with join)
            for (const b of ruleBubblesRaw) {
              const rendered = renderSingleTemplate(b, roomCalculations[0]);
              if (rendered) renderedTexts.push(rendered);
            }
          } else {
            // Multiple linked rooms (e.g. 2 or more rooms)
            // Use the exact unified format that admin sends (User requested: "ผมชอบชุดที่แอดมินส่งไปให้ครับ")
            if (mode === 'system_bill' || matchedRule.keyword.includes('บิล') || matchedRule.keyword.includes('bill')) {
              const roomBlocks: string[] = [];

              for (const calc of roomCalculations) {
                const lines = [
                  `🏠 ห้อง / Room: ${calc.roomNoFormatted}`,
                  `• ค่าน้ำประปา / Water: ${Number(calc.waterOnlyAmt.replace(/,/g, '')).toLocaleString()} บ. (${calc.waterUnits} Units [${calc.prevMeter}➔${calc.currMeter}])`,
                  `• ค่าบำบัดน้ำเสีย / Wastewater: ${Number(calc.wastewaterOnlyAmt.replace(/,/g, '')).toLocaleString()} บ.`,
                  `• ค่าส่วนกลาง / Common Fee: ${Number(calc.commonFee.replace(/,/g, '')).toLocaleString()} บ.`,
                ];
                if (calc.extraItems) {
                  calc.extraItems.trim().split('\n').forEach((l) => lines.push(l));
                }
                lines.push(`➔ รวมห้องนี้ / Subtotal: ${calc.totalDue} บ. (THB)`);
                roomBlocks.push(lines.join('\n'));
              }

              const multiRoomUnifiedBill =
                `🧾 แจ้งใบแจ้งหนี้รวม ${roomCalculations.length} ห้องชุด ประจำรอบ ${currentPeriod}\n` +
                `Consolidated Invoice for ${roomCalculations.length} Rooms - Period ${currentPeriod}\n` +
                `${condoName}\n` +
                `ผู้รับ / Resident: ${consolidatedOwnerName}\n` +
                `━━━━━━━━━━━━━━\n` +
                roomBlocks.join('\n\n') + '\n' +
                `━━━━━━━━━━━━━━\n` +
                `💰 ยอดรวมทุกห้องที่ต้องชำระ / Total Amount Due: ${consolidatedTotalAmount.toLocaleString('th-TH', {
                  minimumFractionDigits: 2,
                })} บาท / THB\n` +
                `📅 กำหนดชำระภายในวันที่ / Due Date: ${dueDay}\n\n` +
                `🏦 ช่องทางโอนชำระ / Payment Transfer:\n` +
                `${bankInfoText}\n\n` +
                `เมื่อโอนชำระแล้ว รบกวนส่งรูปสลิปในแชตนี้ได้เลยครับ 🙏\nPlease attach transfer slip in this chat after payment.`;

              renderedTexts.push(multiRoomUnifiedBill);

              // If rule has Bubble 2 (e.g. late payment policy / terms), send it as the 2nd balloon!
              if (ruleBubblesRaw.length > 1) {
                for (let i = 1; i < ruleBubblesRaw.length; i++) {
                  const b2 = renderSingleTemplate(ruleBubblesRaw[i], roomCalculations[0]);
                  if (b2) renderedTexts.push(b2);
                }
              }
            } else {
              // Non-bill per-room queries (e.g. statement or receipt)
              for (const calc of roomCalculations) {
                const roomBlock = ruleBubblesRaw
                  .map((b) => renderSingleTemplate(b, calc))
                  .filter(Boolean)
                  .join('\n\n');
                if (roomBlock) renderedTexts.push(roomBlock);
              }
            }
          }

          const replyBubbles: any[] = [];

          // 1. Meter dial photo(s) are attached ONLY if user explicitly asked for meter photo
          // NOTE: Never attach meter photo when viewing bills ("ดูบิล" / "bill")
          if (wantsMeterPhoto) {
            for (const pUrl of photoUrls) {
              if (pUrl && pUrl.startsWith('https://')) {
                replyBubbles.push({
                  type: 'image',
                  originalContentUrl: pUrl,
                  previewImageUrl: pUrl,
                });
              }
            }
          }

          // 2. If querying receipt, check if any room has an uploaded receipt image
          if (mode === 'system_receipt' || text.includes('ใบเสร็จ') || text.toLowerCase().includes('receipt')) {
            for (const r of linkedRoomsList) {
              const { data: paidLog } = await supabase
                .from('meter_logs')
                .select('*')
                .eq('room_no', r.room_no)
                .eq('is_paid', true)
                .order('period', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (paidLog?.slip_url && (paidLog.slip_url.includes('receipt') || paidLog.slip_url.startsWith('https://'))) {
                replyBubbles.push({
                  type: 'image',
                  originalContentUrl: paidLog.slip_url,
                  previewImageUrl: paidLog.slip_url,
                });
              }
            }
          }

          // Append text messages as separate message balloons up to LINE's 5-message limit
          // If total messages (images + rendered text balloons) <= 5:
          // Send each text balloon as its own separate message object!
          if (replyBubbles.length + renderedTexts.length <= 5) {
            for (const txt of renderedTexts) {
              if (txt && txt.trim()) {
                replyBubbles.push({ type: 'text', text: txt });
              }
            }
          } else {
            // Need to compact to fit within LINE's strict 5-message quota
            const availableSlots = Math.max(1, 5 - replyBubbles.length);
            if (availableSlots === 1) {
              const compacted = renderedTexts.filter(Boolean).join('\n\n━━━━━━━━━━━━━━\n\n');
              replyBubbles.push({ type: 'text', text: compacted || 'ข้อมูลใบแจ้งหนี้ / ใบเสร็จ' });
            } else {
              // Reserve the last slot for the summary bubble, compact the earlier bubbles
              const lastItem = renderedTexts[renderedTexts.length - 1];
              const headItems = renderedTexts.slice(0, renderedTexts.length - 1);
              const compactedHead = headItems.filter(Boolean).join('\n\n━━━━━━━━━━━━━━\n\n');
              replyBubbles.push({ type: 'text', text: compactedHead });
              if (lastItem && lastItem.trim()) {
                replyBubbles.push({ type: 'text', text: lastItem });
              }
            }
          }

          await replyLineMessage(replyToken, replyBubbles, accessToken);
          continue;
        }

        // Unmatched message: remain silent so human admin can chat with resident without bot interference
        continue;
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
