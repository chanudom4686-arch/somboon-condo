// LINE OA Webhook Handler with Customizable Auto-Reply Rules, Meter Photo Image Attachment & Asia/Bangkok Timezone
// Version 2.0 - 7-Digit LINE Registration Code (3-digit room + 4-digit phone suffix)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { formatRoomNo, calculateBill, resolveRoomNo } from '@/utils/billing';

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
        messages,
      }),
    });
    if (!res.ok) {
      console.warn('LINE reply status:', res.status);
    }
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

    const { data: configRows } = await supabase.from('condo_config').select('key, value');
    const config: Record<string, string> = {};
    if (configRows) {
      configRows.forEach((c) => {
        config[c.key] = c.value;
      });
    }

    const channelSecret = config.LINE_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET || '';
    const accessToken = config.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
    const condoName = config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (645)';
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

    for (const event of events) {
      if (event.type === 'message' && event.message?.type === 'text') {
        const text = (event.message.text || '').trim();
        const lowerText = text.toLowerCase();
        const replyToken = event.replyToken;
        const lineUserId = event.source?.userId;

        if (!replyToken || !lineUserId) continue;

        // A. Handle Resident Self-Unlink
        if (text === 'ยกเลิกผูกห้อง' || text === 'ยกเลิกลงทะเบียน' || lowerText === 'unlink') {
          const { data: linkedRooms } = await supabase
            .from('rooms')
            .select('room_no')
            .eq('line_user_id', lineUserId);

          if (linkedRooms && linkedRooms.length > 0) {
            await supabase
              .from('rooms')
              .update({ line_user_id: '', updated_at: new Date().toISOString() })
              .eq('line_user_id', lineUserId);

            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `🔓 ยกเลิกการผูกบัญชี LINE กับห้อง ${linkedRooms.map((r) => formatRoomNo(r.room_no)).join(', ')} เรียบร้อยแล้วครับ`,
                },
              ],
              accessToken
            );
          } else {
            await replyLineMessage(
              replyToken,
              [{ type: 'text', text: 'บัญชี LINE ของคุณยังไม่ได้ผูกกับห้องชุดใดในระบบครับ' }],
              accessToken
            );
          }
          continue;
        }

        // B. Handle 7-Digit Room Registration Code (3-digit room + 4-digit phone suffix, e.g. "0056273" or paired "0646273")
        const cleanDigits = text.replace(/[^0-9]/g, '');
        if (cleanDigits.length === 7 && text.length <= 12) {
          const rawPrefix = cleanDigits.substring(0, 3);
          const roomPrefix = resolveRoomNo(rawPrefix);
          const phoneSuffix = cleanDigits.substring(3, 7);

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
                  text: `⚠️ ไม่พบข้อมูลห้องเลขที่ ${formatRoomNo(roomPrefix)}\nโปรดตรวจสอบเลขห้อง 3 หลักให้ถูกต้องครับ (เช่น ห้อง 005 เบอร์ลงท้าย 6273 ให้พิมพ์ 0056273)`,
                },
              ],
              accessToken
            );
            continue;
          }

          const cleanOwnerPhone = (roomData.owner_phone || '').replace(/[^0-9]/g, '');
          const cleanTenantPhone = (roomData.tenant_phone || '').replace(/[^0-9]/g, '');
          const ownerMatch = cleanOwnerPhone.length >= 4 && cleanOwnerPhone.endsWith(phoneSuffix);
          const tenantMatch = cleanTenantPhone.length >= 4 && cleanTenantPhone.endsWith(phoneSuffix);

          if (ownerMatch || tenantMatch) {
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
                  text: `🎉 ลงทะเบียนผูกห้อง ${formatRoomNo(roomPrefix)} สำเร็จแล้วครับ!\nผู้รับข้อมูล: คุณ ${personName || 'เจ้าของร่วม/ผู้พักอาศัย'}\n\n📌 พิมพ์คำสั่งเพื่อตรวจสอบข้อมูลได้ทันที:\n• พิมพ์ "ดูบิล" — ดูใบแจ้งหนี้และรูปถ่ายมิเตอร์รอบปัจจุบัน\n• พิมพ์ "ใบเสร็จ" — ดูใบเสร็จรับเงิน\n• พิมพ์ "สเตทเมนท์" — ดูประวัติชำระย้อนหลัง 12 เดือน\n• พิมพ์ "เงินระดมทุน" — ดูยอดเงินระดมทุนซ่อมตึก\n• พิมพ์ "การเงิน" — ดูสรุปรายรับ-รายจ่ายของตึก\n• พิมพ์ "เมนู" — ดูคำสั่งทั้งหมด`,
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
                  text: `⚠️ เบอร์โทรศัพท์ 4 ตัวท้าย (${phoneSuffix}) ไม่ตรงกับเบอร์ที่ลงทะเบียนไว้กับห้อง ${formatRoomNo(roomPrefix)}\n\nโปรดตรวจสอบเบอร์โทรศัพท์ที่แจ้งไว้กับนิติบุคคลครับ`,
                },
              ],
              accessToken
            );
          }
          continue;
        }

        // C. Match against Customizable Auto-Reply Rules
        const matchedRule = rules.find((rule: any) => {
          const keywords = (rule.keyword || '')
            .split(',')
            .map((k: string) => k.trim().toLowerCase())
            .filter(Boolean);
          if (rule.match_type === 'exact') {
            return keywords.includes(lowerText);
          }
          return keywords.some((k: string) => lowerText.includes(k));
        });

        const { data: linkedRooms } = await supabase
          .from('rooms')
          .select('*')
          .eq('line_user_id', lineUserId)
          .limit(1);
        const linkedRoom = linkedRooms && linkedRooms.length > 0 ? linkedRooms[0] : null;

        const bankInfoText = `ธนาคาร: ${config.BANK_NAME || 'กสิกรไทย'}\nเลขที่บัญชี: ${config.BANK_ACCOUNT_NO || '-'}\nชื่อบัญชี: ${config.BANK_ACCOUNT_NAME || condoName}\nพร้อมเพย์: ${config.PROMPTPAY_NO || '-'}`;

        if (matchedRule) {
          const mode = matchedRule.reply_mode || 'custom_text';
          const wantsMeterPhoto =
            mode === 'system_bill' || (matchedRule.reply_text || '').includes('{meter_photo}');

          if (
            (['system_bill', 'system_receipt', 'system_statement'].includes(mode) || wantsMeterPhoto) &&
            !linkedRoom
          ) {
            await replyLineMessage(
              replyToken,
              [
                {
                  type: 'text',
                  text: `🔒 ตามหลักคุ้มครองข้อมูลส่วนบุคคล (PDPA) กรุณาลงทะเบียนผูกห้องชุดก่อนดูข้อมูลบิล รูปมิเตอร์ และสเตทเมนท์ครับ\n\n📌 วิธีลงทะเบียน:\nพิมพ์เลขห้อง 3 หลัก ตามด้วยเบอร์โทรศัพท์ 4 ตัวท้าย\n(เช่น ห้อง 005 เบอร์ลงท้าย 6273 พิมพ์: 0056273)`,
                },
              ],
              accessToken
            );
            continue;
          }

          let roomNoFormatted = linkedRoom ? formatRoomNo(linkedRoom.room_no) : 'ยังไม่ผูกห้อง';
          let ownerName = linkedRoom ? (linkedRoom.owner_name || linkedRoom.tenant_name || 'เจ้าของห้อง') : '-';
          let prevMeter = linkedRoom ? Number(linkedRoom.latest_meter) || 0 : 0;
          let currMeter = prevMeter;
          let waterUnits = 0;
          let waterOnlyAmt = '0.00';
          let wastewaterOnlyAmt = '0.00';
          let waterTotal = '0.00';
          let commonFee = '0.00';
          let extraItems = '';
          let totalDue = '0.00';
          let paymentStatus = '⏳ รอชำระ';
          let meterPhotoUrl: string | null = null;

          if (linkedRoom) {
            const { data: logData } = await supabase
              .from('meter_logs')
              .select('*')
              .eq('room_no', linkedRoom.room_no)
              .eq('period', currentPeriod)
              .maybeSingle();

            meterPhotoUrl = logData?.meter_photo_url || null;
            const pMeter = logData ? Number(logData.prev_meter) : Number(linkedRoom.latest_meter) || 0;
            const cMeter = logData ? Number(logData.curr_meter) : pMeter;
            const bill = calculateBill(
              linkedRoom,
              cMeter,
              currentPeriod,
              config,
              logData ? Number(logData.special_items) || 0 : 0,
              logData?.special_items_note || logData?.note || '',
              Number(linkedRoom.outstanding_balance) || 0,
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
                `• ${bill.special_items < 0 ? 'ส่วนลดพิเศษ' : 'รายการเพิ่มเติม'} (${bill.special_items_note || '-'}): ${bill.special_items > 0 ? '+' : ''}${bill.special_items.toLocaleString()} บาท`
              );
            }
            if (bill.late_fee > 0) {
              extraLines.push(`• เบี้ยปรับล่าช้า: +${bill.late_fee.toLocaleString()} บาท`);
            }
            if (bill.contribution_deducted > 0) {
              extraLines.push(`• หักเครดิตสมทบทุนซ่อมตึก: -${bill.contribution_deducted.toLocaleString()} บาท`);
            }
            if (bill.prepaid_deducted > 0) {
              extraLines.push(`• หักเงินฝากล่วงหน้า: -${bill.prepaid_deducted.toLocaleString()} บาท`);
            }
            if (bill.outstanding_balance > 0) {
              extraLines.push(`• ยอดค้างชำระยกมา: +${bill.outstanding_balance.toLocaleString()} บาท`);
            }
            extraItems = extraLines.length > 0 ? extraLines.join('\n') + '\n' : '';
            totalDue = bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
            paymentStatus = logData?.is_paid
              ? `✅ ชำระแล้ว (${logData.paid_timestamp ? new Date(logData.paid_timestamp).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'เรียบร้อย'})`
              : `⏳ รอชำระ (ครบกำหนดวันที่ ${dueDay})`;
          }

          let statement12mText = 'ยังไม่มีประวัติการชำระเงิน';
          if (linkedRoom && (mode === 'system_statement' || matchedRule.reply_text.includes('{statement_12m}'))) {
            const { data: historyLogs } = await supabase
              .from('meter_logs')
              .select('*')
              .eq('room_no', linkedRoom.room_no)
              .order('period', { ascending: false })
              .limit(12);

            if (historyLogs && historyLogs.length > 0) {
              statement12mText = historyLogs
                .map((h: any) => {
                  const paidDate = h.paid_timestamp
                    ? new Date(h.paid_timestamp).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })
                    : '-';
                  return `• รอบ ${h.period}: ${Number(h.total_amount).toLocaleString()} บ. — ${
                    h.is_paid ? `✅ ชำระแล้ว (${paidDate})` : '⏳ ค้างชำระ'
                  }`;
                })
                .join('\n');
            }
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

            fundSummaryText = `• ยอดเงินระดมทุนสะสมทั้งหมด: ${totalFundIn.toLocaleString()} บาท\n• นำไปใช้ปรับปรุง/ซ่อมบำรุงแล้ว: ${totalFundOut.toLocaleString()} บาท\n• ยอดคงเหลือปัจจุบัน: ${(totalFundIn - totalFundOut).toLocaleString()} บาท\n\nรายการนำไปใช้ล่าสุด:\n${expenseItems || '  - ยังไม่มีรายการเบิกจ่าย'}`;
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

            buildingFinanceText = `• รายรับรวมของอาคาร: +${totalIn.toLocaleString()} บาท\n• รายจ่ายรวมของอาคาร: -${totalOut.toLocaleString()} บาท\n• สถานะดุลการเงินปัจจุบัน: ${netBal >= 0 ? `✅ คงเหลือสุทธิ +${netBal.toLocaleString()} บาท` : `⚠️ ติดลบ ${netBal.toLocaleString()} บาท`}`;
          }

          const finalReply = (matchedRule.reply_text || '')
            .replace(/\{meter_photo\}/g, '')
            .replace(/ค่าน้ำ\+บำบัด:/g, 'ค่าน้ำประปา:')
            .replace(/\{condo_name\}/g, condoName)
            .replace(/\{room_no\}/g, roomNoFormatted)
            .replace(/\{owner_name\}/g, ownerName)
            .replace(/\{period\}/g, currentPeriod)
            .replace(/\{prev_meter\}/g, String(prevMeter))
            .replace(/\{curr_meter\}/g, String(currMeter))
            .replace(/\{water_units\}/g, String(waterUnits))
            .replace(/\{water_amount\}/g, waterOnlyAmt)
            .replace(/\{wastewater_amount\}/g, wastewaterOnlyAmt)
            .replace(/\{water_total\}/g, waterTotal)
            .replace(/\{common_fee\}/g, commonFee)
            .replace(/\{extra_items\}/g, extraItems)
            .replace(/\{total_due\}/g, totalDue)
            .replace(/\{payment_status\}/g, paymentStatus)
            .replace(/\{due_date\}/g, dueDay)
            .replace(/\{bank_info\}/g, bankInfoText)
            .replace(/\{statement_12m\}/g, statement12mText)
            .replace(/\{fund_summary\}/g, fundSummaryText)
            .replace(/\{building_finance\}/g, buildingFinanceText)
            .trim();

          const replyBubbles: any[] = [{ type: 'text', text: finalReply || 'ข้อมูลรูปถ่ายมิเตอร์น้ำ' }];
          if (wantsMeterPhoto && meterPhotoUrl && meterPhotoUrl.startsWith('https://')) {
            replyBubbles.push({
              type: 'image',
              originalContentUrl: meterPhotoUrl,
              previewImageUrl: meterPhotoUrl,
            });
          }

          await replyLineMessage(replyToken, replyBubbles, accessToken);
          continue;
        }

        const defaultGreeting = (
          config.LINE_GREETING_MESSAGE ||
          `สวัสดีครับ ยินดีต้อนรับสู่ LINE OA {condo_name}\n\n📌 หากยังไม่ได้ผูกห้องชุด:\nโปรดพิมพ์ เลขห้อง 3 หลัก ตามด้วยเบอร์โทร 4 ตัวท้าย (เช่น 0056273)\n\n📌 หากผูกห้องแล้ว พิมพ์คำว่า "เมนู" หรือ "ดูบิล" ได้เลยครับ`
        ).replace(/\{condo_name\}/g, condoName);

        await replyLineMessage(
          replyToken,
          [{ type: 'text', text: defaultGreeting }],
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
