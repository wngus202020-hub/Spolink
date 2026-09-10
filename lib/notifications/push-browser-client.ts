"use client"

import ky from "ky"

import { pushSubscriptionSchema } from "./push-contract"

export type BrowserPushState = "denied" | "disabled" | "enabled" | "unsupported"
export type BrowserPushMutationResult = Readonly<
  { status: "denied" | "disabled" | "enabled" | "unsupported" } | { status: "failure" }
>

const serviceWorkerPath = "/spolink-sw.js"

export async function readBrowserPushState(): Promise<BrowserPushState> {
  if (!supportsWebPush()) return "unsupported"
  if (Notification.permission === "denied") return "denied"

  const registration = await navigator.serviceWorker.register(serviceWorkerPath, { scope: "/" })
  const subscription = await registration.pushManager.getSubscription()
  return subscription ? "enabled" : "disabled"
}

export async function enableBrowserPush(publicKey: string): Promise<BrowserPushMutationResult> {
  if (!supportsWebPush()) return { status: "unsupported" }
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission
  if (permission !== "granted") return { status: "denied" }

  let created = false
  let subscription: PushSubscription | null = null
  try {
    const registration = await navigator.serviceWorker.register(serviceWorkerPath, { scope: "/" })
    subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        applicationServerKey: decodeVapidPublicKey(publicKey),
        userVisibleOnly: true,
      })
      created = true
    }
    const parsed = pushSubscriptionSchema.safeParse(subscription.toJSON())
    if (!parsed.success) {
      if (created) await subscription.unsubscribe()
      return { status: "failure" }
    }
    await ky.post("/api/notifications/push-subscriptions", {
      json: parsed.data,
      retry: 0,
      timeout: 10_000,
    })
    return { status: "enabled" }
  } catch (error) {
    if (created && subscription) await subscription.unsubscribe()
    if (error instanceof Error) return { status: "failure" }
    throw error
  }
}

export async function disableBrowserPush(): Promise<BrowserPushMutationResult> {
  if (!supportsWebPush()) return { status: "unsupported" }
  try {
    const registration = await navigator.serviceWorker.register(serviceWorkerPath, { scope: "/" })
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return { status: "disabled" }
    await ky.delete("/api/notifications/push-subscriptions", {
      json: { endpoint: subscription.endpoint },
      retry: 0,
      timeout: 10_000,
    })
    return (await subscription.unsubscribe()) ? { status: "disabled" } : { status: "failure" }
  } catch (error) {
    if (error instanceof Error) return { status: "failure" }
    throw error
  }
}

function supportsWebPush(): boolean {
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    window.isSecureContext
  )
}

function decodeVapidPublicKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const binary = window.atob(`${value}${padding}`.replaceAll("-", "+").replaceAll("_", "/"))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
