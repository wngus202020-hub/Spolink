"use client"

import ky from "ky"
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useRef, useState } from "react"

import { Button, buttonClassName } from "@/components/ui/button"
import { ACCOUNT_WITHDRAWAL_CONFIRMATION } from "@/lib/account/withdrawal"

export function AccountDeletionPanel() {
  const alertRef = useRef<HTMLDivElement>(null)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    if (errorMessage) alertRef.current?.focus()
  }, [errorMessage])

  function openDialog() {
    setConfirmation("")
    setErrorMessage("")
    dialogRef.current?.showModal()
    confirmationInputRef.current?.focus()
  }

  function closeDialog() {
    if (!busy) dialogRef.current?.close()
  }

  async function confirmWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || confirmation !== ACCOUNT_WITHDRAWAL_CONFIRMATION) return

    setBusy(true)
    setErrorMessage("")
    try {
      const response = await ky.delete("/api/account", {
        credentials: "same-origin",
        json: { confirmation },
        retry: 0,
        throwHttpErrors: false,
        timeout: 10_000,
      })

      if (response.status === 401) {
        window.location.assign("/auth/login?next=/mypage/settings")
        return
      }
      if (!response.ok) {
        setBusy(false)
        setErrorMessage("회원 탈퇴를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.")
        return
      }

      window.location.assign("/?account=deleted")
    } catch (error) {
      if (error instanceof Error) {
        setBusy(false)
        setErrorMessage("서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.")
        return
      }
      throw error
    }
  }

  return (
    <section
      aria-labelledby="account-delete-heading"
      className="grid gap-4 border-t border-line pt-8"
    >
      <div className="grid gap-2">
        <span className="inline-flex size-11 items-center justify-center rounded-[var(--radius-lg)] bg-inset text-[var(--status-error)]">
          <AlertTriangle aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </span>
        <h2 className="m-0 text-xl font-bold text-primary" id="account-delete-heading">
          회원 탈퇴
        </h2>
        <p className="m-0 max-w-[62ch] text-sm leading-[1.65] text-secondary">
          탈퇴하면 로그인이 종료되고 레슨 예약과 지도자 활동을 더 이상 이용할 수 없어요. 법령과 분쟁
          대응에 필요한 예약·결제 기록은 정해진 기간 동안 보관돼요.
        </p>
      </div>

      <button
        className={buttonClassName(
          "outline",
          "w-fit border-[var(--status-error)] text-[var(--status-error)]",
        )}
        onClick={openDialog}
        ref={deleteButtonRef}
        type="button"
      >
        <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
        회원 탈퇴
      </button>

      <dialog
        aria-describedby="account-delete-description"
        aria-labelledby="account-delete-dialog-title"
        className="m-auto w-[min(92vw,480px)] rounded-[var(--radius-xl)] border border-line bg-canvas p-0 text-primary [box-shadow:var(--shadow-panel)] backdrop:bg-[var(--overlay-scrim)]"
        onCancel={(event) => {
          if (busy) event.preventDefault()
        }}
        onClose={() => deleteButtonRef.current?.focus()}
        ref={dialogRef}
      >
        <form className="grid gap-5 p-5 md:p-6" onSubmit={confirmWithdrawal}>
          <div className="grid gap-2">
            <h2 className="m-0 text-xl font-bold" id="account-delete-dialog-title">
              정말 회원 탈퇴할까요?
            </h2>
            <p
              className="m-0 text-sm leading-[1.65] text-secondary"
              id="account-delete-description"
            >
              프로필 정보와 알림 설정이 삭제되며 이 작업은 되돌릴 수 없어요. 계속하려면 아래에
              <strong className="mx-1 text-primary">탈퇴하기</strong>를 입력해 주세요.
            </p>
          </div>

          <label
            className="grid gap-2 text-sm font-bold text-primary"
            htmlFor="withdrawal-confirmation"
          >
            확인 문구
            <input
              autoComplete="off"
              className="min-h-12 w-full rounded-[var(--radius-sm)] border border-line bg-inset px-4 py-3 text-base font-normal text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              disabled={busy}
              id="withdrawal-confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              ref={confirmationInputRef}
              value={confirmation}
            />
          </label>

          {errorMessage ? (
            <div
              className="rounded-[var(--radius-md)] border border-[var(--status-error)] bg-inset px-4 py-3 text-sm font-bold text-primary"
              ref={alertRef}
              role="alert"
              tabIndex={-1}
            >
              {errorMessage}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={busy} onClick={closeDialog} variant="outline">
              취소
            </Button>
            <Button
              className="bg-[var(--status-error)] text-canvas hover:opacity-90"
              disabled={busy || confirmation !== ACCOUNT_WITHDRAWAL_CONFIRMATION}
              type="submit"
            >
              {busy ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
              )}
              {busy ? "탈퇴 처리 중" : "탈퇴 확정"}
            </Button>
          </div>
        </form>
      </dialog>
    </section>
  )
}
