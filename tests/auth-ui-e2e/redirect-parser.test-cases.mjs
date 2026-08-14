import assert from "node:assert/strict"
import test from "node:test"
import { pathToFileURL } from "node:url"

const redirectModuleUrl = pathToFileURL(`${process.cwd()}/lib/auth/redirect.ts`).href

test("safe next redirect parser accepts only raw allow-listed query values", async () => {
  const {
    AUTH_REDIRECT_PATHS,
    decodedNextQueryValue,
    rawNextQueryValue,
    resolveSafeNextPath,
    resolveSafeNextPathFromUrl,
  } = await import(redirectModuleUrl)

  assert.deepEqual(AUTH_REDIRECT_PATHS, [
    "/",
    "/lessons",
    "/mypage",
    "/mypage/favorites",
    "/mypage/reservations",
    "/onboarding/profile",
    "/auth/update-password",
  ])

  for (const allowedPath of AUTH_REDIRECT_PATHS) {
    assert.equal(resolveSafeNextPath(rawNextQueryValue(allowedPath), "/"), allowedPath)
    assert.equal(
      resolveSafeNextPathFromUrl(`https://spolink.test/auth/login?next=${allowedPath}`, "/"),
      allowedPath,
    )
    assert.equal(resolveSafeNextPath(decodedNextQueryValue(allowedPath), "/lessons"), "/lessons")
  }

  const dynamicAllowedPaths = [
    "/lessons/tennis-gangnam/booking",
    "/lessons/tennis-gangnam/booking?scheduleId=tennis-gangnam-today",
    "/mypage/reservations/00000000-0000-4000-8000-000000000499",
    "/reservations/00000000-0000-4000-8000-000000000499/payment",
  ]

  for (const allowedPath of dynamicAllowedPaths) {
    assert.equal(resolveSafeNextPath(rawNextQueryValue(allowedPath), "/"), allowedPath)
    assert.equal(
      resolveSafeNextPathFromUrl(`https://spolink.test/auth/login?next=${allowedPath}`, "/"),
      allowedPath,
    )
  }
})

test("safe next redirect parser rejects single and double encoded attacks on every caller path", async () => {
  const {
    decodedNextQueryValue,
    rawNextQueryValue,
    resolveSafeNextPath,
    resolveSafeNextPathFromUrl,
  } = await import(redirectModuleUrl)

  const attacks = [
    "https://evil.example",
    "http://evil.example",
    "//evil.example",
    "/\\evil",
    "/lessons\\..\\admin",
    "/lessons/../auth/update-password",
    "/lessons?redirect=https://evil.example",
    "/lessons/../booking",
    "/lessons/tennis-gangnam/booking?next=/auth/update-password",
    "/lessons/tennis-gangnam/booking?scheduleId=../admin",
    "/mypage/reservations/not-a-uuid",
    "/mypage/reservations/00000000-0000-4000-8000-000000000499?next=/admin",
    "/mypage/reservations/00000000-0000-4000-8000-000000000499/payment",
    "/reservations/not-a-uuid/payment",
    "/auth/update-password%23frag",
    "%2Flessons",
    "%252Flessons",
    "https%253A%252F%252Fevil.example",
    "/%2F%2Fevil.example",
    "/%252F%252Fevil.example",
    "/%5Cevil",
    "/lessons%3Fnext%3D%2Fauth%2Fupdate-password",
    "/lessons\u0000",
  ]

  for (const attack of attacks) {
    assert.equal(resolveSafeNextPath(rawNextQueryValue(attack), "/lessons"), "/lessons", attack)
    assert.equal(
      resolveSafeNextPathFromUrl(`https://spolink.test/auth/login?next=${attack}`, "/lessons"),
      "/lessons",
      attack,
    )
  }

  const decodedSingleEncodedAttack = new URL(
    "https://spolink.test/auth/login?next=%2Flessons",
  ).searchParams.get("next")
  const decodedDoubleEncodedAttack = new URL(
    "https://spolink.test/auth/login?next=%252Flessons",
  ).searchParams.get("next")

  assert.equal(decodedSingleEncodedAttack, "/lessons")
  assert.equal(resolveSafeNextPath(decodedNextQueryValue(decodedSingleEncodedAttack), "/"), "/")
  assert.equal(decodedDoubleEncodedAttack, "%2Flessons")
  assert.equal(resolveSafeNextPath(decodedNextQueryValue(decodedDoubleEncodedAttack), "/"), "/")
})

test("safe next redirect parser rejects raw next values with embedded equals", async () => {
  const { resolveSafeNextPathFromUrl } = await import(redirectModuleUrl)

  const malformedValues = [
    ["/lessons=evil", "/auth/update-password"],
    ["/auth/update-password=evil", "/lessons"],
    ["/onboarding/profile=evil", "/"],
    ["/=evil", "/lessons"],
  ]

  for (const [rawValue, fixedFallback] of malformedValues) {
    assert.equal(
      resolveSafeNextPathFromUrl(`https://spolink.test/auth/login?next=${rawValue}`, fixedFallback),
      fixedFallback,
      rawValue,
    )
  }
})
