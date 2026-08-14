import { NextResponse } from "next/server"

import { getSupabaseConfigStatus } from "@/lib/supabase/env"

export function GET() {
  return NextResponse.json(getSupabaseConfigStatus())
}
