import test from "node:test"

import { registerTask3EvidenceEnvironmentTests } from "./task3-evidence-environment-tests.mjs"
import { registerTask3EvidenceFinalizerTests } from "./task3-evidence-finalizer-tests.mjs"
import { cleanupTask3Fixtures, prepareTask3Fixtures } from "./task3-evidence-fixtures.mjs"

test.before(prepareTask3Fixtures)
test.after(cleanupTask3Fixtures)

registerTask3EvidenceEnvironmentTests()
registerTask3EvidenceFinalizerTests()
