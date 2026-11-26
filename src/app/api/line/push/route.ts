// LINE OA Push Notification API for Single Room or Selected Batch of Rooms
// Version 2.5 - Supports Receipt Image Push, Consolidated Multi-Room Push, Removed Tax ID, and Asia/Bangkok timezone

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import { formatRoomNo, calculateBill } from '@/utils/billing';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomNos = [], period, mode = 'bill', customMessage = '', roomNo, imageUrl, receiptText = '' } = body;

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

    // ==========================================
    // MODE 1: Push Receipt Image to Resident
    // ==========================================
    if (mode === 'receipt_image') {
      const targetRoomNo = roomNo || (Array.isArray(roomNos) && roomNos[0]);
      if (!targetRoomNo || !imageUrl) {
        return NextResponse.json({ error: 'ข้อมูลไม่ครบถ้วน (ต้องการ roomNo และ imageUrl)' }, { status: 400 });
      }

      const { data: roomData } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_no', targetRoomNo)
        .maybeSingle();

      if (!roomData || !roomData.line_user_id) {
        return NextResponse.json({ error: `ห้อง ${formatRoomNo(targetRoomNo)} ยังไม่ได้ลงทะเบียน LINE หรือไม่มี LINE User ID` }, { status: 400 });
      }

      const captionText =
        receiptText ||
        `🧾 ใบเสร็จรับเงิน ห้อง ${formatRoomNo(targetRoomNo)} ประจำรอบ ${activePeriod}\n${condoName}\nขอบพระคุณที่ชำระเงินตรงเวลาครับ 🙏`;

      const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          to: roomData.line_user_id,
          messages: [
            {
              type: 'image',
              originalContentUrl: imageUrl,
              previewImageUrl: imageUrl,
            },
            {
              type: 'text',
              text: captionText,
            },
          ],
        }),
      });

      if (!lineRes.ok) {
        const errText = await lineRes.text();
        return NextResponse.json({ error: `ส่ง LINE ไม่สำเร็จ: ${errText}` }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `ส่งรูปใบเสร็จไปที่ LINE ห้อง ${formatRoomNo(targetRoomNo)} เรียบร้อยแล้ว`,
      });
    }

    // ==========================================
    // MODE 2: Push Bill Notifications (Single or Multi-Room Batch)
    // ==========================================
    if (!Array.isArray(roomNos) || roomNos.length === 0) {
      return NextResponse.json({ error: 'กรุณาเลือกห้องที่ต้องการส่ง LINE อย่างน้อย 1 ห้อง' }, { status: 400 });
    }

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

    // Group selected rooms by line_user_id to support Consolidated Push for Multi-Room Owners
    const roomsByLineUser: Record<string, any[]> = {};
    const unlinkedRooms: any[] = [];

    for (const room of roomsData || []) {
      if (!room.line_user_id) {
        skippedCount++;
        unlinkedRooms.push(room);
        continue;
      }
      if (!roomsByLineUser[room.line_user_id]) {
        roomsByLineUser[room.line_user_id] = [];
      }
      roomsByLineUser[room.line_user_id].push(room);
    }

    // Lock to Thailand Timezone (Asia/Bangkok, GMT+7)
    const nowTime = new Date().toLocaleTimeString('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    for (const [lineUserId, ownerRooms] of Object.entries(roomsByLineUser)) {
      if (ownerRooms.length === 0) continue;

      let messageText = '';

      if (ownerRooms.length > 1 && mode !== 'custom') {
        // Consolidated Multi-Room Bill Push (Feature A)
        let consolidatedTotal = 0;
        const roomBlocks: string[] = [];
        let commonDueDate = '';

        for (const room of ownerRooms) {
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

          consolidatedTotal += bill.total_amount;
          commonDueDate = bill.due_date;

          roomBlocks.push(
            `🏠 ห้อง: ${formatRoomNo(room.room_no)}\n` +
            `• ค่าน้ำ: ${bill.water_amount.toLocaleString()} บ. (${bill.units_used} หน่วย [${bill.prev_meter}➔${bill.curr_meter}])\n` +
            `• ค่าบำบัดน้ำเสีย: ${bill.wastewater_amount.toLocaleString()} บ.\n` +
            `• ค่าส่วนกลาง: ${bill.common_fee.toLocaleString()} บ.` +
            (bill.late_fee > 0 ? `\n• เบี้ยปรับ: +${bill.late_fee.toLocaleString()} บ.` : '') +
            (bill.outstanding_balance > 0 ? `\n• ยอดค้างยกมา: +${bill.outstanding_balance.toLocaleString()} บ.` : '') +
            (bill.special_items !== 0 ? `\n• รายการพิเศษ: ${bill.special_items > 0 ? '+' : ''}${bill.special_items.toLocaleString()} บ.` : '') +
            `\n➔ รวมห้องนี้: ${bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บ.`
          );
        }

        const ownerName = ownerRooms[0]?.owner_name || ownerRooms[0]?.tenant_name || 'ท่านเจ้าของร่วม';

        messageText =
          `🧾 แจ้งใบแจ้งหนี้รวม ${ownerRooms.length} ห้องชุด ประจำรอบ ${activePeriod}\n` +
          `${condoName}\n` +
          `ผู้รับ: ${ownerName}\n` +
          `━━━━━━━━━━━━━━\n` +
          roomBlocks.join('\n\n') + '\n' +
          `━━━━━━━━━━━━━━\n` +
          `💰 ยอดรวมทุกห้องที่ต้องชำระ: ${consolidatedTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท\n` +
          `📅 กำหนดชำระภายในวันที่: ${commonDueDate}\n\n` +
          `🏦 ช่องทางโอนชำระ:\n` +
          `${config.BANK_NAME || 'กสิกรไทย'} เลขบัญชี: ${config.BANK_ACCOUNT_NO || '-'}\n` +
          `ชื่อบัญชี: ${config.BANK_ACCOUNT_NAME || condoName}\n\n` +
          `เมื่อโอนชำระแล้ว รบกวนส่งรูปสลิปในแชตนี้ได้เลยครับ 🙏`;

      } else {
        // Single Room Bill Push
        const room = ownerRooms[0];
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

        if (mode === 'custom' && customMessage.trim() !== '') {
          messageText = customMessage
            .replace(/\{meter_photo\}/g, '')
            .replace(/\{condo_name\}/g, condoName)
            .replace(/\{room_no\}/g, formatRoomNo(room.room_no))
            .replace(/\{owner_name\}/g, room.owner_name || room.tenant_name || 'ท่านเจ้าของร่วม')
            .replace(/\{period\}/g, activePeriod)
            .replace(/\{water_units\}/g, String(bill.units_used))
            .replace(/\{water_amount\}/g, bill.water_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 }))
            .replace(/\{wastewater_amount\}/g, bill.wastewater_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 }))
            .replace(/\{common_fee\}/g, bill.common_fee.toLocaleString('th-TH', { minimumFractionDigits: 2 }))
            .replace(/\{total_due\}/g, bill.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 }))
            .replace(/\{due_date\}/g, bill.due_date)
            .trim();
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
            `ชื่อบัญชี: ${config.BANK_ACCOUNT_NAME || condoName}\n\n` +
            `เมื่อโอนชำระแล้ว รบกวนส่งรูปสลิปในแชตนี้ได้เลยครับ 🙏`;
        }
      }

      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          to: lineUserId,
          messages: [{ type: 'text', text: messageText }],
        }),
      });

      if (res.ok) {
        sentCount += ownerRooms.length;

        // Upsert logs for all rooms in this batch
        for (const r of ownerRooms) {
          const log = logMap[r.room_no];
          const prevM = log ? Number(log.prev_meter) : Number(r.latest_meter) || 0;
          const currM = log ? Number(log.curr_meter) : prevM;
          const bill = calculateBill(
            r,
            currM,
            activePeriod,
            config,
            log ? Number(log.special_items) || 0 : 0,
            log?.special_items_note || log?.note || '',
            Number(r.outstanding_balance) || 0,
            prevM,
            log ? Number(log.late_fee) || 0 : 0
          );

          await supabase
            .from('meter_logs')
            .upsert(
              {
                period: activePeriod,
                room_no: r.room_no,
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
                line_push_status: `ส่งแล้ว (${nowTime} น.)`,
                followup_status: mode === 'custom' ? 'line_notified' : (log?.followup_status || 'none'),
                recorded_at: log?.recorded_at || new Date().toISOString(),
              },
              { onConflict: 'period,room_no' }
            );
        }
      } else {
        failedCount += ownerRooms.length;
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