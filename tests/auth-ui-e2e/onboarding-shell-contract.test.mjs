import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"
import { pathToFileURL } from "node:url"

const repoUrl = pathToFileURL(`${process.cwd()}/`).href

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) return nextResolve("${repoUrl}" + specifier.slice(2) + ".ts", context);
      if (specifier.startsWith("./") && !specifier.match(/\\.[cm]?[jt]s$/)) {
        return nextResolve(specifier + ".ts", context);
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
)

const { SignupOnboardingObservationError, createOnboardingScreenshotPrivacyReceipt } = await import(
  "./signup-onboarding-login-helpers.ts"
)

test("onboarding screenshot receipt accepts selected-region evidence with identity masks", () => {
  const receipt = createOnboardingScreenshotPrivacyReceipt({
    maskedIdentityEvidence: ["phone", "display-name", "real-name"],
    maskedRegionEvidence: [],
    visibleRegionEvidence: ["selection", "search"],
  })

  assert.deepEqual(receipt, {
    kind: "screenshot-privacy",
    maskedIdentityEvidence: ["display-name", "phone", "real-name"],
    visibleRegionEvidence: ["search", "selection"],
    verdict: "APPROVE",
  })
})

test("onboarding screenshot receipt accepts validation evidence without source-copy input", () => {
  const receipt = createOnboardingScreenshotPrivacyReceipt({
    maskedIdentityEvidence: ["real-name", "phone", "display-name"],
    maskedRegionEvidence: [],
    visibleRegionEvidence: ["validation", "search"],
  })

  assert.equal(receipt.verdict, "APPROVE")
})

test("onboarding screenshot receipt rejects missing identity masks or masked region evidence", () => {
  for (const observation of [
    {
      maskedIdentityEvidence: ["display-name", "phone"],
      maskedRegionEvidence: [],
      visibleRegionEvidence: ["search", "selection"],
    },
    {
      maskedIdentityEvidence: ["display-name", "phone", "real-name"],
      maskedRegionEvidence: ["selection"],
      visibleRegionEvidence: ["search", "selection"],
    },
  ]) {
    assert.throws(
      () => createOnboardingScreenshotPrivacyReceipt(observation),
      SignupOnboardingObservationError,
    )
  }
})
