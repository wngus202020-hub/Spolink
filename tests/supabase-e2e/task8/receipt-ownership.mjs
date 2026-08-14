import {
  readRuntimeReceipt,
  writeRuntimeReceipt,
} from "../../../scripts/supabase-local/receipt.mjs"

export async function restoreRecordedNextOwnership(recordedNext, repoRoot = process.cwd()) {
  if (recordedNext.length === 0) return
  const receiptPath = `${repoRoot}/.omo/evidence/runtime-receipt-supabase-auth-rls-e2e.json`
  const receipt = await readRuntimeReceipt(receiptPath)
  await writeRuntimeReceipt(receiptPath, {
    ...receipt,
    ownedPids: uniqueNumbers([...receipt.ownedPids, ...recordedNext.map((item) => item.pid)]),
    selectedNextPorts: uniqueNumbers([
      ...receipt.selectedNextPorts,
      ...recordedNext.map((item) => item.port),
    ]),
  })
}

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))].sort(
    (left, right) => left - right,
  )
}
