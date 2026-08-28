import { processRefund } from "@/lib/money/routes"

export async function POST(request: Request, context: { params: Promise<{ refundId: string }> }) {
  return processRefund(request, (await context.params).refundId)
}
