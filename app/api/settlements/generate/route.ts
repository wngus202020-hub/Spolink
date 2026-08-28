import { generateSettlementFromBody } from "@/lib/money/routes"

export async function POST(request: Request) {
  return generateSettlementFromBody(request)
}
