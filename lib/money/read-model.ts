import type { SupabaseAppClient } from "../supabase/server"

export const settlementFilterStatuses = ["pending", "hold", "approved", "all"] as const

export type SettlementFilterStatus = (typeof settlementFilterStatuses)[number]

export function parseSettlementFilterStatus(value: unknown): SettlementFilterStatus | null {
  switch (value) {
    case undefined:
    case null:
    case "all":
      return "all"
    case "pending":
    case "hold":
    case "approved":
      return value
    default:
      return null
  }
}

export async function listSettlements(
  client: SupabaseAppClient,
  status: SettlementFilterStatus | string | null,
) {
  const parsedStatus = parseSettlementFilterStatus(status)
  if (!parsedStatus) throw new InvalidSettlementFilterError()

  let query = client.from("settlements").select("*").order("created_at", { ascending: false })
  if (parsedStatus !== "all") query = query.eq("status", parsedStatus)
  return query
}

class InvalidSettlementFilterError extends Error {
  readonly name = "InvalidSettlementFilterError"
}
