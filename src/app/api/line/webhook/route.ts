import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { formatRoomNo } from '@/utils/billing';

// Verify LINE Signature
function verifySignature(body: string, channelSecret: string, signature: string | null): boolean {
  if (!signature || !channelSecret) return true; // allow testing if not configured
  const hash = crypto.createHmac('sha256', channelSecret).update(body).digest('base64');
  return hash === signature;
}

// Reply message to LINE user
async function replyLineMessage(replyToken: string, messages: any[], accessToken: string) {
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages,
      }),
    });
  } catch (err) {
    console.error('Failed to send LINE reply:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-line-signature');

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Load LINE Config from condo_config
    const { data: configRows } = await supabase.from('condo_config').select('key, value');
    const config: Record<string, string> = {};
    if (configRows) {
      configRows.forEach((c) => {
        config[c.key] = c.value;
      });
    }

    const channelSecret = config.LINE_CHANNEL_SECRET || '';
    const accessToken = config.LINE_CHANNEL_ACCESS_TOKEN || '';

    // Verify webhook signature if secret exists
    if (channelSecret && signature) {
      const isValid = verifySignature(rawBody, channelSecret, signature);
      if (!isValid) {
        console.warn('Invalid LINE signature');
        return NextResponse.json({ message: 'Invalid signature' }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    const events = payload.events || [];

    for (const event of events) {
      if (event.type === 'message' && event.message?.type === 'text') {
        const text = (event.message.text || '').trim();
        const replyToken = event.replyToken;
        const lineUserId = event.source?.userId;

        if (!replyToken || !lineUserId) continue;

        // Pattern: 6 digits (e.g. 005273) or room number 3 digits + 3 digits phone
        // Regex: 3 digits room + 3 digits phone
        const cleanText = text.replace(/[^0-9]/g, '');

        if (cleanText.length === 6) {
          const roomPrefix = cleanText.substring(0, 3); // "005"
          const phoneSuffix = cleanText.substring(3, 6); // "273"

          // Query room
          const { data: roomData, error: roomErr } = await supabase
            .from('rooms')
            .select('*')
            .eq('room_no', roomPrefix)
            .single();

          if (!roomData || roomErr) {
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `⚠️ ไม่พบข้อมูลห้องเลขที่ ${formatRoomNo(roomPrefix)}\nโปรดตรวจสอบเลขห้องให้ถูกต้องครับ (เช่น ห้อง 005 ให้พิมพ์เลข 005 ตามด้วยเบอร์โทร 3 ตัวท้าย)`,
                },
              ],
              accessToken
            );
            continue;
          }

          // Check if phone matches owner_phone or tenant_phone
          const cleanOwnerPhone = (roomData.owner_phone || '').replace(/[^0-9]/g, '');
          const cleanTenantPhone = (roomData.tenant_phone || '').replace(/[^0-9]/g, '');

          const ownerMatch = cleanOwnerPhone.endsWith(phoneSuffix);
          const tenantMatch = cleanTenantPhone.endsWith(phoneSuffix);

          if (ownerMatch || tenantMatch) {
            // Update line_user_id in room
            await supabase
              .from('rooms')
              .update({
                line_user_id: lineUserId,
                updated_at: new Date().toISOString(),
              })
              .eq('room_no', roomPrefix);

            const personName = ownerMatch ? roomData.owner_name : roomData.tenant_name;

            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `🎉 ผูกบัญชีห้อง ${formatRoomNo(roomPrefix)} สำเร็จเรียบร้อยแล้วครับ!\n\nผู้ลงทะเบียน: คุณ ${personName || 'เจ้าของห้อง'}\n\nคุณจะได้รับการแจ้งเตือนบิลค่าน้ำและค่าส่วนกลางประจำเดือนผ่านทาง LINE นี้อัตโนมัติในทุกวันที่ 1 ของเดือนครับ 😊\n\n(คุณสามารถพิมพ์คำว่า "ดูบิล" ได้ตลอดเวลาเพื่อตรวจเช็คยอดบิลล่าสุด)`,
                },
              ],
              accessToken
            );
          } else {
            // Phone mismatch
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `⚠️ เบอร์โทรศัพท์ 3 ตัวท้าย (${phoneSuffix}) ไม่ตรงกับเบอร์ที่ลงทะเบียนไว้กับห้อง ${formatRoomNo(roomPrefix)}\n\nโปรดตรวจสอบเบอร์โทรศัพท์ที่แจ้งไว้กับนิติบุคคล หรือติดต่อนิติเพื่ออัปเดตเบอร์โทรศัพท์ครับ`,
                },
              ],
              accessToken
            );
          }
          continue;
        }

        // Keywords: ดูบิล / บิล / ค่าน้ำ
        if (text.includes('บิล') || text.includes('ค่าน้ำ') || text.toLowerCase().includes('bill')) {
          // Find room linked to this lineUserId
          const { data: linkedRoom } = await supabase
            .from('rooms')
            .select('*')
            .eq('line_user_id', lineUserId)
            .single();

          if (!linkedRoom) {
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `คุณยังไม่ได้ลงทะเบียนผูกห้องชุดครับ\n\n📌 วิธีลงทะเบียน:\nพิมพ์เลขห้อง 3 หลัก ตามด้วยเบอร์โทรศัพท์ 3 ตัวท้าย\nเช่น ห้อง 005 เบอร์ลงท้าย 273 ให้พิมพ์: 005273`,
                },
              ],
              accessToken
            );
            continue;
          }

          // Fetch latest meter log for linked room
          const currentP = config.CURRENT_BILLING_PERIOD || '2026-11';
          const { data: latestLog } = await supabase
            .from('meter_logs')
            .select('*')
            .eq('room_no', linkedRoom.room_no)
            .eq('period', currentP)
            .single();

          if (latestLog) {
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `📋 ข้อมูลบิลประจำรอบ ${currentP}\nห้อง: ${formatRoomNo(linkedRoom.room_no)}\n\n• ใช้น้ำ: ${latestLog.units_used} หน่วย\n• ค่าน้ำ+บำบัด: ${(Number(latestLog.water_amount) + Number(latestLog.wastewater_amount)).toLocaleString()} บาท\n• ค่าส่วนกลาง: ${Number(latestLog.common_fee_amount).toLocaleString()} บาท\n\n💰 ยอดที่ต้องชำระ: ${Number(latestLog.total_amount).toLocaleString()} บาท\nสถานะ: ${latestLog.is_paid ? '✅ ชำระแล้ว' : '⏳ รอชำระ (ครบกำหนดวันที่ ' + (config.BILL_DUE_DAY || '5') + ')'}`,
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
                  text: `ห้อง ${formatRoomNo(linkedRoom.room_no)}\nขณะนี้นิติกำลังอยู่ระหว่างการจดมิเตอร์และจัดทำบิลรอบ ${currentP} ครับ เมื่อบิลพร้อม ระบบจะแจ้งเตือนให้ทราบทันทีครับ`,
                },
              ],
              accessToken
            );
          }
          continue;
        }

        // Default greeting / help
        await replyLineMessage(
          replyToken,
          [
            {
              type: 'text',
              text: `สวัสดีครับ ยินดีต้อนรับสู่นิติบุคคล ${config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์'}\n\n📌 สำหรับลูกบ้านที่ต้องการลงทะเบียนรับบิล:\nโปรดพิมพ์เลขห้อง 3 หลัก ตามด้วยเบอร์โทร 3 ตัวท้าย\n(เช่น ห้อง 005 เบอร์ลงท้าย 273 ให้พิมพ์: 005273)`,
            },
          ],
          accessToken
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
