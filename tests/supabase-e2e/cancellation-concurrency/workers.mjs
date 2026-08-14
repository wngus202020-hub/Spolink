import { createClient } from "@supabase/supabase-js"

import { providerEvidence } from "./slots.mjs"

export function createCancellationWorker({ baseUrl, cookieJar, reason, reservationId }) {
  const controller = new AbortController()
  const start = captureStart()
  const promise = timed("cancel", start, async () => {
    const response = await fetch(`${baseUrl}/api/reservations/${reservationId}/cancel`, {
      body: JSON.stringify({ reason }),
      headers: {
        "content-type": "application/json",
        cookie: cookieJar.cookieHeader(),
        origin: new URL(baseUrl).origin,
      },
      method: "POST",
      signal: controller.signal,
    })
    const body = await response.json()
    return { body, kind: "cancel", status: response.status }
  })
  return { abort: () => controller.abort(), promise, ...start }
}

export function createPaymentWorkers(status) {
  const client = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return {
    confirm: (slot) => rpcWorker(client, "confirm_paid_reservation", confirmArgs(slot)),
    reconcile: (slot) =>
      rpcWorker(client, "mark_payment_confirmation_reconciliation_required", reconcileArgs(slot)),
  }
}

function rpcWorker(client, rpcName, args) {
  const controller = new AbortController()
  const start = captureStart()
  const promise = timed(rpcName, start, async () => {
    const { data, error } = await client.rpc(rpcName, args).abortSignal(controller.signal)
    return {
      data,
      errorCode: error?.code ?? null,
      kind: rpcName,
      status: error ? "error" : "ok",
    }
  })
  return { abort: () => controller.abort(), promise, ...start }
}

function confirmArgs(slot) {
  const raw = providerEvidence(slot)
  return {
    checked_amount: 10001,
    checked_provider_order_id: raw.orderId,
    checked_provider_payment_key: raw.paymentKey,
    checked_raw_payload: raw,
    checked_reservation_id: slot.reservationId,
  }
}

function reconcileArgs(slot) {
  const raw = providerEvidence(slot)
  return {
    checked_failure_code: "RESERVATION_CANCELLED_AFTER_PROVIDER_APPROVAL",
    checked_provider_order_id: raw.orderId,
    checked_provider_payment_key: raw.paymentKey,
    checked_raw_payload: raw,
    checked_reservation_id: slot.reservationId,
  }
}

async function timed(kind, start, run) {
  try {
    const value = await run()
    return { ...value, finishedAt: Date.now(), kind, startedAt: start.startedAtWallMs }
  } catch (error) {
    return {
      errorCode: error?.code ?? error?.name ?? "ERROR",
      kind,
      message: error instanceof Error ? error.message : String(error),
      status: "thrown",
      finishedAt: Date.now(),
      startedAt: start.startedAtWallMs,
    }
  }
}

function captureStart() {
  return {
    startedAtHrtimeNs: process.hrtime.bigint().toString(),
    startedAtWallMs: Date.now(),
  }
}
