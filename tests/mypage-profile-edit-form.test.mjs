import assert from "node:assert/strict"
import test from "node:test"
import {
  changeCheckbox,
  changeText,
  createHarness,
  findButtonByText,
  findByTypeAndName,
  findByTypeAndPlaceholder,
  findSubmitButton,
  initialProfile,
  pressEnter,
  runtime,
  submit,
  textIncludes,
} from "./mypage-profile-edit-form-harness.mjs"

test("Given the initial model, the form renders exact editable fields and disables unchanged save", async () => {
  const { render } = createHarness(async () => ({ status: "no_changes" }))

  const tree = await render()

  assert.equal(findSubmitButton(tree).props.disabled, true)
  assert.equal(findByTypeAndName(tree, "input", "displayName").props.value, "러너")
  assert.equal(findByTypeAndName(tree, "input", "realName").props.value, "홍길동")
  assert.equal(findByTypeAndName(tree, "input", "phone").props.value, "010-1234-5678")
  assert.equal(findByTypeAndName(tree, "input", "locationAgreed").props.checked, true)
  assert.equal(findByTypeAndName(tree, "input", "marketingAgreed").props.checked, false)
  for (const text of [
    "활동 이름 (필수)",
    "실명 (필수)",
    "휴대폰 번호 (필수)",
    "기본 활동 지역 (필수)",
    "다른 이용자에게 공개되는 이름이에요.",
    "예: 010-1234-5678",
    "내 주변 레슨 안내를 위한 위치 이용에 동의해요.",
    "혜택과 새로운 레슨 소식 수신에 동의해요.",
  ]) {
    assert.equal(textIncludes(tree, text), true, `${text} should render`)
  }
})

test("Given invalid changed input, submit focuses the first validation error and sends no request", async () => {
  const calls = []
  const { render } = createHarness(async (patch) => {
    calls.push(patch)
    return { status: "no_changes" }
  })
  let tree = await render()

  changeText(findByTypeAndName(tree, "input", "displayName"), "A")
  tree = await render()
  assert.equal(findSubmitButton(tree).props.disabled, true)

  await pressEnter(findByTypeAndName(tree, "input", "displayName"), tree)
  tree = await render()

  assert.deepEqual(calls, [])
  assert.equal(runtime.focusedId, "profile-edit-display-name")
  assert.equal(textIncludes(tree, "활동 이름은 2자 이상 입력해요."), true)

  changeText(findByTypeAndName(tree, "input", "displayName"), "새 러너")
  tree = await render()
  assert.equal(textIncludes(tree, "활동 이름은 2자 이상 입력해요."), false)
  assert.equal(findSubmitButton(tree).props.disabled, false)
})

test("Given a missing region, submit focuses the described invalid search control until selection", async () => {
  const calls = []
  const { render } = createHarness(
    async (patch) => {
      calls.push(patch)
      return {
        baseline: { ...initialProfile, defaultRegion: "서울특별시 서초구" },
        status: "success",
      }
    },
    { ...initialProfile, defaultRegion: null },
  )
  let tree = await render()

  assert.equal(findSubmitButton(tree).props.disabled, true)
  await submit(tree)
  tree = await render()

  const search = findByTypeAndPlaceholder(tree, "input", "강남구, 수원시")
  assert.deepEqual(calls, [])
  assert.equal(runtime.focusedId, search.props.id)
  assert.equal(search.props["aria-invalid"], true)
  assert.match(search.props["aria-describedby"], /profile-edit-region-error/u)
  assert.equal(textIncludes(tree, "목록에서 기본 활동 지역을 선택해요."), true)

  const regionButton = findButtonByText(tree, "서울특별시 · 서초구")
  regionButton.props.onClick()
  tree = await render()
  assert.equal(findSubmitButton(tree).props.disabled, false)

  await submit(tree)

  assert.deepEqual(calls, [{ defaultRegion: "서울특별시 서초구" }])
})

test("Given one text edit and one consent edit, success sends changed keys and refreshes in place", async () => {
  const calls = []
  const successBaseline = { ...initialProfile, displayName: "서버 러너", marketingAgreed: true }
  const { render } = createHarness(async (patch) => {
    calls.push(patch)
    return { baseline: successBaseline, status: "success" }
  })
  let tree = await render()

  changeText(findByTypeAndName(tree, "input", "displayName"), "  새 러너  ")
  changeCheckbox(findByTypeAndName(tree, "input", "marketingAgreed"), true)
  tree = await render()
  assert.equal(findSubmitButton(tree).props.disabled, false)

  await submit(tree)
  tree = await render()

  assert.deepEqual(calls, [{ displayName: "새 러너", marketingAgreed: true }])
  assert.equal(findByTypeAndName(tree, "input", "displayName").props.value, "서버 러너")
  assert.equal(findSubmitButton(tree).props.disabled, true)
  assert.equal(textIncludes(tree, "프로필 정보를 저장했어요."), true)
  assert.equal(runtime.router.refreshCalls, 1)
  assert.deepEqual(runtime.router.replaceCalls, [])
})

test("Given validation then network failure, edits are retained, alert is focused, and retry is single", async () => {
  const calls = []
  const results = [
    { category: "validation", retainInput: true, status: "failure" },
    { category: "retry", reason: "network", status: "failure" },
  ]
  const { render } = createHarness(async (patch) => {
    calls.push(patch)
    return results.shift()
  })
  let tree = await render()

  changeText(findByTypeAndName(tree, "input", "phone"), "010-9999-0000")
  tree = await render()
  await submit(tree)
  tree = await render()

  assert.deepEqual(calls, [{ phone: "010-9999-0000" }])
  assert.equal(findByTypeAndName(tree, "input", "phone").props.value, "010-9999-0000")
  assert.equal(runtime.focusedId, "alert")
  assert.equal(textIncludes(tree, "입력 내용을 다시 확인해요."), true)

  runtime.focusedId = null
  await submit(tree)
  tree = await render()

  assert.deepEqual(calls, [{ phone: "010-9999-0000" }, { phone: "010-9999-0000" }])
  assert.equal(findByTypeAndName(tree, "input", "phone").props.value, "010-9999-0000")
  assert.equal(runtime.focusedId, "alert")
  assert.equal(textIncludes(tree, "연결이 원활하지 않아요. 잠시 후 다시 시도해요."), true)
})

test("Given account-state failures, the form follows exact safe redirects", async (t) => {
  const scenarios = [
    [
      "login",
      {
        category: "login",
        destination: "/auth/login?next=/mypage/profile",
        status: "failure",
      },
      "/auth/login?next=/mypage/profile",
    ],
    [
      "onboarding",
      { category: "onboarding", destination: "/onboarding/profile", status: "failure" },
      "/onboarding/profile",
    ],
    [
      "suspended",
      {
        category: "restricted",
        destination: "/auth/restricted?reason=account-suspended",
        status: "failure",
      },
      "/auth/restricted?reason=account-suspended",
    ],
  ]

  for (const [name, result, destination] of scenarios) {
    await t.test(name, async () => {
      const { render } = createHarness(async () => result)
      let tree = await render()

      changeText(findByTypeAndName(tree, "input", "displayName"), "새 러너")
      tree = await render()
      await submit(tree)

      assert.deepEqual(runtime.router.replaceCalls, [destination])
      assert.equal(runtime.router.refreshCalls, 0)
    })
  }
})

test("Given a double submit and malformed success, duplicate requests are blocked without optimistic success", async () => {
  const calls = []
  let resolveFirst
  const firstResult = new Promise((resolve) => {
    resolveFirst = resolve
  })
  const results = [
    firstResult,
    Promise.resolve({ category: "retry", reason: "malformed_response", status: "failure" }),
  ]
  const { render } = createHarness(async (patch) => {
    calls.push(patch)
    return await results.shift()
  })
  let tree = await render()

  changeText(findByTypeAndName(tree, "input", "realName"), "김테스트")
  tree = await render()
  const firstSubmit = submit(tree)
  const duplicateSubmit = submit(tree)

  assert.deepEqual(calls, [{ realName: "김테스트" }])
  resolveFirst({ category: "retry", reason: "malformed_response", status: "failure" })
  await Promise.all([firstSubmit, duplicateSubmit])
  tree = await render()

  assert.deepEqual(calls, [{ realName: "김테스트" }])
  assert.equal(textIncludes(tree, "프로필 저장 응답을 확인하지 못했어요. 다시 시도해요."), true)
  assert.equal(textIncludes(tree, "프로필 정보를 저장했어요."), false)
  assert.equal(runtime.router.refreshCalls, 0)
})
