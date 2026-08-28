"use client"

import { Ban, Flag } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import type { BlockData, ReportData, ReportTargetType } from "@/lib/trust-safety/types"

type TrustSafetyPanelProps = Readonly<{
  initialBlocks: readonly BlockData[]
  initialReports: readonly ReportData[]
}>

const targetOptions: readonly Readonly<{ label: string; value: ReportTargetType }>[] = [
  { label: "레슨", value: "lesson" },
  { label: "지도자", value: "coach" },
  { label: "예약", value: "reservation" },
  { label: "리뷰", value: "review" },
  { label: "사용자", value: "user" },
]

export function TrustSafetyPanel({ initialBlocks, initialReports }: TrustSafetyPanelProps) {
  const [blocks, setBlocks] = useState(initialBlocks)
  const [reports, setReports] = useState(initialReports)
  const [pending, setPending] = useState<"block" | "report" | null>(null)
  const [message, setMessage] = useState<Readonly<{
    kind: "error" | "success"
    text: string
  }> | null>(null)
  const messageRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (message?.kind === "error") messageRef.current?.focus()
  }, [message])

  async function submitReport(form: HTMLFormElement) {
    const values = new FormData(form)
    setPending("report")
    setMessage(null)
    const result = await send<ReportData>("/api/reports", {
      detail: readText(values.get("detail")) || null,
      reason: readText(values.get("reason")),
      targetId: readText(values.get("targetId")),
      targetType: readText(values.get("targetType")),
    })
    setPending(null)
    if (result.status === "failure") {
      setMessage({ kind: "error", text: result.message })
      return
    }
    setReports((current) => [result.data, ...current])
    form.reset()
    setMessage({
      kind: "success",
      text: "신고를 접수했어요. 처리 상태는 이 화면에서 확인할 수 있어요.",
    })
  }

  async function submitBlock(form: HTMLFormElement) {
    const values = new FormData(form)
    setPending("block")
    setMessage(null)
    const result = await send<BlockData & { idempotent: boolean }>("/api/blocks", {
      blockedId: readText(values.get("blockedId")),
      reason: readText(values.get("blockReason")) || null,
    })
    setPending(null)
    if (result.status === "failure") {
      setMessage({ kind: "error", text: result.message })
      return
    }
    setBlocks((current) => [result.data, ...current.filter((item) => item.id !== result.data.id)])
    form.reset()
    setMessage({
      kind: "success",
      text: result.data.idempotent ? "이미 차단된 대상이에요." : "차단했어요.",
    })
  }

  return (
    <div className="grid gap-8">
      {message ? (
        <p
          aria-live={message.kind === "error" ? "assertive" : "polite"}
          className="m-0 rounded-[var(--radius-md)] bg-inset p-4 text-sm text-primary"
          ref={messageRef}
          role={message.kind === "error" ? "alert" : "status"}
          tabIndex={message.kind === "error" ? -1 : undefined}
        >
          {message.text}
        </p>
      ) : null}
      <section className="grid gap-4" aria-labelledby="report-heading">
        <div className="flex items-center gap-2">
          <Flag aria-hidden="true" className="size-5 text-accent" />
          <h2 className="m-0 text-xl font-bold text-primary" id="report-heading">
            신고 접수
          </h2>
        </div>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submitReport(event.currentTarget)
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-bold text-primary">
              대상 유형
              <select className={inputClassName} defaultValue="lesson" name="targetType" required>
                {targetOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="대상 ID"
              name="targetId"
              placeholder="대상 식별자를 입력하세요"
              required
            />
          </div>
          <Field label="신고 사유" name="reason" placeholder="사유를 입력하세요" required />
          <label className="grid gap-2 text-sm font-bold text-primary">
            상세 내용
            <textarea className={`${inputClassName} min-h-28`} maxLength={1000} name="detail" />
          </label>
          <Button className="w-fit" disabled={pending !== null} type="submit">
            {pending === "report" ? "접수 중…" : "신고 접수"}
          </Button>
        </form>
      </section>

      <section className="grid gap-4 border-t border-line pt-8" aria-labelledby="block-heading">
        <div className="flex items-center gap-2">
          <Ban aria-hidden="true" className="size-5 text-accent" />
          <h2 className="m-0 text-xl font-bold text-primary" id="block-heading">
            차단 관리
          </h2>
        </div>
        <form
          className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            void submitBlock(event.currentTarget)
          }}
        >
          <Field label="차단할 사용자 ID" name="blockedId" required />
          <Field label="차단 사유" name="blockReason" />
          <Button disabled={pending !== null} type="submit" variant="outline">
            {pending === "block" ? "처리 중…" : "차단"}
          </Button>
        </form>
        <div className="grid gap-3">
          <h3 className="m-0 text-base font-bold text-primary">차단 목록</h3>
          {blocks.length === 0 ? (
            <p className="m-0 rounded-[var(--radius-md)] bg-subtle p-4 text-sm text-secondary">
              차단한 대상이 없어요.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {blocks.map((block) => (
                <li
                  className="rounded-[var(--radius-md)] border border-line p-4 text-sm text-secondary"
                  key={block.id}
                >
                  차단된 사용자: {block.blockedId}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section
        className="grid gap-3 border-t border-line pt-8"
        aria-labelledby="my-reports-heading"
      >
        <h2 className="m-0 text-xl font-bold text-primary" id="my-reports-heading">
          내 신고
        </h2>
        {reports.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-md)] bg-subtle p-4 text-sm text-secondary">
            접수한 신고가 없어요.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {reports.map((report) => (
              <li
                className="grid gap-1 rounded-[var(--radius-md)] border border-line p-4"
                key={report.id}
              >
                <strong className="text-primary">{report.reason}</strong>
                <span className="text-sm text-secondary">
                  {report.status === "submitted"
                    ? "접수됨"
                    : report.status === "reviewing"
                      ? "검토 중"
                      : report.status === "resolved"
                        ? "처리 완료"
                        : "기각"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Field({
  label,
  name,
  placeholder,
  required = false,
}: Readonly<{ label: string; name: string; placeholder?: string; required?: boolean }>) {
  return (
    <label className="grid gap-2 text-sm font-bold text-primary">
      {label}
      <input className={inputClassName} name={name} placeholder={placeholder} required={required} />
    </label>
  )
}

const inputClassName =
  "min-h-11 rounded-[var(--radius-md)] border border-line bg-canvas px-3 text-sm text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"

function readText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : ""
}

type SendResult<T> = Readonly<
  | { readonly data: T; readonly status: "success" }
  | { readonly message: string; readonly status: "failure" }
>

async function send<T>(path: string, body: object): Promise<SendResult<T>> {
  try {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Origin: window.location.origin },
      method: "POST",
    })
    const payload = (await response.json()) as {
      data?: ReportData | (BlockData & { idempotent: boolean })
      error?: { message?: string }
    }
    if (!response.ok || !payload.data)
      return { status: "failure", message: payload.error?.message ?? "요청을 처리하지 못했어요." }
    return { data: payload.data as T, status: "success" }
  } catch {
    return { message: "연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.", status: "failure" }
  }
}
