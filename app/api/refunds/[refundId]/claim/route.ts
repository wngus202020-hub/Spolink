import { claimRefund } from "@/lib/money/routes"

export async function POST(request: Request, context: { params: Promise<{ refundId: string }> }) {
  return claimRefund(request, (await context.params).refundId)
}
