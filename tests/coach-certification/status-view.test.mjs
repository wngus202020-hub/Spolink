import assert from "node:assert/strict"
import test from "node:test"

test("Given every coach state, when status copy is selected, then each has a safe next action", async () => {
  const { readCoachStatusView } = await import("../../lib/coach-certification/status-view.ts")
  const expected = {
    approved: ["승인 완료", "/mypage"],
    draft: ["작성 중", "/coach/apply"],
    rejected: ["보완 필요", "/coach/apply"],
    submitted: ["심사 중", "/lessons"],
    suspended: ["이용 제한", "/auth/restricted?reason=account-suspended"],
  }

  for (const [status, [label, actionHref]] of Object.entries(expected)) {
    const view = readCoachStatusView(status)
    assert.equal(view.label, label)
    assert.equal(view.actionHref, actionHref)
    assert.equal(view.description.length > 0, true)
  }
})
