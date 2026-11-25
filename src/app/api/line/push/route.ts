// LINE OA Push Notification API for Single Room or Selected Batch of Rooms
// Version 1.5 - Explicitly separates Water (35 THB/unit) and Wastewater (5 THB/unit) + Itemized Custom Items

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import { formatRoomNo, calculateBill } from '@/utils/billing';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomNos = [], period, mode = 'bill', customMessage = '' } = body;

    if (!Array.isArray(roomNos) || roomNos.length === 0) {
      return NextResponse.json({ error: 'กรุณาเลือกห้องที่ต้องการส่ง LINE อย่างน้อย 1 ห้อง' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data: configRows } = await supabase.from('condo_config').select('key, value');
    const config: Record<string, string> = {};
    if (configRows) {
      configRows.forEach((c) => {
        config[c.key] = c.value;
      });
    }

    const accessToken = config.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
    if (!accessToken) {
      return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า LINE Channel Access Token' }, { status: 400 });
    }

    const activePeriod = period || config.CURRENT_BILLING_PERIOD || '2026-11';
    const condoName = config.CONDO_NAME || 'สมบูรณ์คอนโดทาวน์ (645)';

    const { data: roomsData } = await supabase
      .from('rooms')
      .select('*')
      .in('room_no', roomNos);

    const { data: logsData } = await supabase
      .from('meter_logs')
      .select('*')
      .eq('period', activePeriod)
      .in('room_no', roomNos);

    const logMap: Record<string, any> = {};
    (logsData || []).forEach((l) => {
      logMap[l.room_no] = l;
    });

    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const room of roomsData || []) {
      if (!room.line_user_id) {
        skippedCount++;
        continue;
      }

      const log = logMap[room.room_no];
      const prevM = log ? Number(log.prev_meter) : Number(room.latest_meter) || 0;
      const currM = log ? Number(log.curr_meter) : prevM;

      const bill = calculateBill(
        room,
        currM,
        activePeriod,
        config,
        log ? Number(log.special_items) || 0 : 0,
        log?.special_items_note || log?.note || '',
        Number(room.outstanding_balance) || 0,
        prevM,
        log ? Number(log.late_fee) || 0 : 0
      );

      let messageText = '';
      if (mode === 'custom' && customMessage.trim() !== '') {
        messageText = customMessage
          .replace(/\{condo_name\}/g, condoName)
          .replace(/\{room_no\}/g, formatRoomNo(room.room_no))
          .replace(/\{owner_name\}/g, room.owner_name || room.tenant_name || 'ท่านเจ้าของร่วม')
          .replace(/\{period\}/g, activePeriod)
          .replace(/\{water_units\}/g, String(bill.units_used))
          .replace(/\{total_due\}/g, bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 }))
          .replace(/\{due_date\}/g, bill.due_date);
      } else {
        const extraLines: string[] = [];
        if (bill.special_items_note && bill.special_items_note.includes('|')) {
          bill.special_items_note.split('|').forEach((part) => {
            if (part.trim()) extraLines.push(`• ${part.trim()}`);
          });
        } else if (bill.special_items !== 0) {
          extraLines.push(
            `• ${bill.special_items < 0 ? 'ส่วนลดพิเศษ' : 'รายการเพิ่มเติม'} (${bill.special_items_note || '-'}): ${
              bill.special_items > 0 ? '+' : ''
            }${bill.special_items.toLocaleString()} บ.`
          );
        }
        if (bill.late_fee > 0) {
          extraLines.push(`• เบี้ยปรับล่าช้า: +${bill.late_fee.toLocaleString()} บ.`);
        }
        if (bill.contribution_deducted > 0) {
          extraLines.push(`• หักเครดิตสมทบทุนซ่อมตึก: -${bill.contribution_deducted.toLocaleString()} บ.`);
        }
        if (bill.prepaid_deducted > 0) {
          extraLines.push(`• หักเงินฝากล่วงหน้า: -${bill.prepaid_deducted.toLocaleString()} บ.`);
        }
        if (bill.outstanding_balance > 0) {
          extraLines.push(`• ยอดค้างชำระยกมา: +${bill.outstanding_balance.toLocaleString()} บ.`);
        }

        messageText =
          `🧾 แจ้งใบแจ้งหนี้ประจำรอบ ${activePeriod}\n` +
          `${condoName}\n` +
          `ห้อง: ${formatRoomNo(room.room_no)}\n` +
          `━━━━━━━━━━━━━━\n` +
          `• มิเตอร์น้ำ: ${bill.prev_meter} ➔ ${bill.curr_meter} (ใช้ ${bill.units_used} หน่วย)\n` +
          `1. ค่าน้ำประปา (${bill.units_used} × ${bill.water_rate} บ.): ${bill.water_amount.toLocaleString()} บ.\n` +
          `2. ค่าบำบัดน้ำเสีย (${bill.units_used} × ${bill.wastewater_rate} บ.): ${bill.wastewater_amount.toLocaleString()} บ.\n` +
          `3. ค่าส่วนกลาง: ${bill.common_fee.toLocaleString()} บ.\n` +
          (extraLines.length > 0 ? extraLines.join('\n') + '\n' : '') +
          `━━━━━━━━━━━━━━\n` +
          `💰 ยอดรวมที่ต้องชำระ: ${bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท\n` +
          `📅 กำหนดชำระภายในวันที่: ${bill.due_date}\n\n` +
          `🏦 ช่องทางโอนชำระ:\n` +
          `${config.BANK_NAME || 'กสิกรไทย'} เลขบัญชี: ${config.BANK_ACCOUNT_NO || '-'}\n` +
          `ชื่อบัญชี: ${config.BANK_ACCOUNT_NAME || condoName}\n` +
          `พร้อมเพย์: ${config.PROMPTPAY_NO || '-'}\n\n` +
          `เมื่อโอนชำระแล้ว รบกวนส่งรูปสลิปในแชตนี้ได้เลยครับ 🙏`;
      }

      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          to: room.line_user_id,
          messages: [{ type: 'text', text: messageText }],
        }),
      });

      if (res.ok) {
        sentCount++;
        const nowTime = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        await supabase
          .from('meter_logs')
          .upsert(
            {
              period: activePeriod,
              room_no: room.room_no,
              prev_meter: bill.prev_meter,
              curr_meter: bill.curr_meter,
              units_used: bill.units_used,
              water_amount: bill.water_amount,
              wastewater_amount: bill.wastewater_amount,
              common_fee_amount: bill.common_fee,
              late_fee: bill.late_fee,
              special_items: bill.special_items,
              special_items_note: bill.special_items_note || null,
              contribution_deducted: bill.contribution_deducted,
              prepaid_deducted: bill.prepaid_deducted,
              total_amount: bill.total_amount,
              line_push_status: `ส่งแล้ว (${nowTime})`,
              followup_status: mode === 'custom' ? 'line_notified' : (log?.followup_status || 'none'),
              recorded_at: log?.recorded_at || new Date().toISOString(),
            },
            { onConflict: 'period,room_no' }
          );
      } else {
        failedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      sentCount,
      skippedCount,
      failedCount,
    });
  } catch (err: any) {
    console.error('LINE Push error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
