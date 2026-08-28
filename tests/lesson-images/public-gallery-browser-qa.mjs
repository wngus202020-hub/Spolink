import { runPublicGalleryBrowserQa } from "./public-gallery-browser/runner.mjs"

process.exitCode = await runPublicGalleryBrowserQa()
