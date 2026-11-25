// Supabase Auto Keep-Alive Endpoint (called daily by Vercel Cron)
// Version 2.4 - Prevents Supabase Free Plan from pausing after 7 days of inactivity

import { NextRequest, NextResponse, connection } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';

export async function GET(req: NextRequest) {
  // Force dynamic execution at request time (never prerender at build time)
  await connection();
  // Optional protection: if CRON_SECRET is set in Vercel env, only Vercel Cron can call this endpoint
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // 1. Read query (real database activity)
    const { count, error: readErr } = await supabase
      .from('rooms')
      .select('room_no', { count: 'exact', head: true });
    if (readErr) throw readErr;

    // 2. Write query: record last keep-alive time (Asia/Bangkok)
    const nowBkk = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const { error: writeErr } = await supabase
      .from('condo_config')
      .upsert(
        { key: 'LAST_KEEP_ALIVE', value: nowBkk, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    if (writeErr) throw writeErr;

    console.log(`[keep-alive] Supabase pinged OK at ${nowBkk} (rooms: ${count})`);
    return NextResponse.json({ success: true, pingedAt: nowBkk, rooms: count });
  } catch (err: any) {
    console.error('[keep-alive] Failed to ping Supabase:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
