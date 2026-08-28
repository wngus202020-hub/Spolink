import { changeSettlementStatus } from "@/lib/money/routes"

export async function POST(
  request: Request,
  context: { params: Promise<{ settlementId: string }> },
) {
  return changeSettlementStatus(request, (await context.params).settlementId, "hold")
}
