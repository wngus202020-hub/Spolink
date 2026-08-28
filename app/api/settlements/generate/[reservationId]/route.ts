import { generateSettlement } from "@/lib/money/routes"

export async function POST(
  request: Request,
  context: { params: Promise<{ reservationId: string }> },
) {
  return generateSettlement(request, (await context.params).reservationId)
}
