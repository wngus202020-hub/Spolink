"use client"

import { LoaderCircle } from "lucide-react"
import Link from "next/link"
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  readCoachApplication,
  saveCoachApplication,
  submitCoachApplication,
} from "@/lib/coach-certification/applicant-client"
import type { ApplicantApplicationData } from "@/lib/coach-certification/applicant-types"
import { isCoachCertificationEditable } from "@/lib/coach-certification/contract"
import { CoachApplicationFields, type CoachFormState } from "./coach-application-fields"
import { CoachCertificatePanel } from "./coach-certificate-panel"

const emptyForm: CoachFormState = {
  bankAccountLast4: "",
  bankName: "",
  bio: "",
  careerYears: "0",
  headline: "",
  payoutHolderName: "",
  primarySportId: "",
  serviceRegion: "",
}

export function CoachApplicationForm({
  sports,
}: Readonly<{ sports: readonly Readonly<{ id: string; name: string }>[] }>) {
  const alertRef = useRef<HTMLDivElement>(null)
  const [application, setApplication] = useState<ApplicantApplicationData | null>(null)
  const [form, setForm] = useState<CoachFormState>(emptyForm)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void readCoachApplication().then((result) => {
      if (!active) return
      if (result.status === "failure") setMessage(result.message)
      else if (result.data) applyApplication(result.data, setApplication, setForm)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (message) alertRef.current?.focus()
  }, [message])

  const editable = application ? isCoachCertificationEditable(application.status) : true

  function change(event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !editable) return
    setBusy(true)
    setMessage("")
    const result = await saveCoachApplication({
      bankAccountLast4: form.bankAccountLast4,
      bankName: form.bankName.trim(),
      bio: form.bio.trim(),
      careerYears: Number(form.careerYears),
      headline: form.headline.trim(),
      payoutHolderName: form.payoutHolderName.trim(),
      primarySportId: form.primarySportId,
      serviceRegion: form.serviceRegion.trim(),
    })
    if (result.status === "failure") setMessage(result.message)
    else if (result.data) {
      applyApplication(result.data, setApplication, setForm)
      setMessage("임시 저장했어요.")
    }
    setBusy(false)
  }

  async function submit() {
    if (busy || !editable || !application) return
    setBusy(true)
    setMessage("")
    const result = await submitCoachApplication()
    if (result.status === "failure") {
      setMessage(result.message)
      setBusy(false)
      return
    }
    window.location.assign("/coach/apply/status")
  }

  if (loading)
    return (
      <div
        aria-live="polite"
        className="flex min-h-32 items-center gap-3 text-sm text-secondary"
        role="status"
      >
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" /> 신청서를 불러오고
        있어요.
      </div>
    )
  const tone =
    application?.status === "rejected"
      ? "error"
      : application?.status === "submitted"
        ? "warning"
        : application?.status === "approved"
          ? "success"
          : "neutral"
  return (
    <form aria-busy={busy} className="grid gap-8" noValidate onSubmit={save}>
      <div
        aria-atomic="true"
        className={
          message
            ? "rounded-[var(--radius-lg)] border border-line bg-subtle p-4 text-sm text-primary focus:outline-2 focus:outline-offset-2 focus:outline-primary"
            : "sr-only"
        }
        ref={alertRef}
        role="alert"
        tabIndex={-1}
      >
        {message}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge tone={tone}>
          {application ? applicationStatusLabel(application.status) : "작성 가능"}
        </StatusBadge>
        {application && !editable ? (
          <Link
            className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] border border-line px-4 py-2 text-sm font-bold text-primary hover:bg-inset"
            href="/coach/apply/status"
          >
            심사 상태 확인
          </Link>
        ) : null}
      </div>
      {application?.status === "rejected" && application.rejectionReason ? (
        <div
          className="grid gap-1 border-l-4 border-[var(--status-error)] bg-subtle px-4 py-3"
          role="note"
        >
          <strong className="text-sm text-primary">보완이 필요한 내용</strong>
          <p className="m-0 whitespace-pre-wrap text-sm leading-[1.6] text-secondary">
            {application.rejectionReason}
          </p>
        </div>
      ) : null}
      {application && !editable ? (
        <p className="m-0 text-sm leading-[1.6] text-secondary">
          심사 결과가 반영된 신청서는 여기에서 변경할 수 없어요.
        </p>
      ) : null}
      <CoachApplicationFields editable={editable} onChange={change} sports={sports} value={form} />
      <CoachCertificatePanel
        application={application}
        editable={editable}
        onApplication={setApplication}
        onMessage={setMessage}
      />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button className="w-full sm:w-auto sm:min-w-32" disabled={busy || !editable} type="submit">
          {busy ? "처리 중" : "임시 저장"}
        </Button>
        <Button
          aria-describedby={application ? undefined : "submit-prerequisite"}
          className="w-full sm:w-auto sm:min-w-32"
          disabled={busy || !editable || !application}
          onClick={() => void submit()}
          type="button"
          variant="outline"
        >
          {busy ? "처리 중" : "심사 제출"}
        </Button>
      </div>
      {!application ? (
        <p className="m-0 text-right text-sm text-secondary" id="submit-prerequisite">
          임시 저장과 자격증 등록을 마친 뒤 심사에 제출할 수 있어요.
        </p>
      ) : null}
    </form>
  )
}

function applicationStatusLabel(status: ApplicantApplicationData["status"]) {
  switch (status) {
    case "approved":
      return "승인 완료"
    case "draft":
      return "작성 중"
    case "rejected":
      return "보완 필요"
    case "submitted":
      return "심사 중"
    case "suspended":
      return "이용 제한"
    default:
      return assertNever(status)
  }
}

function applyApplication(
  data: ApplicantApplicationData,
  setApplication: (data: ApplicantApplicationData) => void,
  setForm: (data: CoachFormState) => void,
) {
  setApplication(data)
  setForm({
    bankAccountLast4: data.bankAccountLast4 ?? "",
    bankName: data.bankName ?? "",
    bio: data.bio ?? "",
    careerYears: String(data.careerYears),
    headline: data.headline ?? "",
    payoutHolderName: data.payoutHolderName ?? "",
    primarySportId: data.primarySportId ?? "",
    serviceRegion: data.serviceRegion,
  })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected coach certification status: ${value}`)
}
