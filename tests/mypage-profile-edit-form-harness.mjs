import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import typescript from "typescript"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href
const runtimeKey = Symbol.for("spolink.profile-edit-form-runtime")

export const runtime = {
  effects: [],
  focusedId: null,
  idIndex: 0,
  refs: [],
  router: {
    refreshCalls: 0,
    replaceCalls: [],
  },
  stateIndex: 0,
  states: [],
}

globalThis[runtimeKey] = runtime

const reactStub = `
const runtime = globalThis[Symbol.for("spolink.profile-edit-form-runtime")]
export function forwardRef(render) {
  return function ForwardRef(props) {
    return render(props, props.ref ?? null)
  }
}
export function useEffect(effect) { runtime.effects.push(effect) }
export function useId() {
  const value = \`profile-form-test-\${runtime.idIndex}\`
  runtime.idIndex += 1
  return value
}
export function useRef(initialValue) {
  const index = runtime.refs.length
  if (!runtime.refs[index]) runtime.refs[index] = { current: initialValue }
  return runtime.refs[index]
}
export function useState(initialValue) {
  const index = runtime.stateIndex
  runtime.stateIndex += 1
  if (runtime.states[index] === undefined) {
    runtime.states[index] = typeof initialValue === "function" ? initialValue() : initialValue
  }
  return [
    runtime.states[index],
    (nextValue) => {
      runtime.states[index] =
        typeof nextValue === "function" ? nextValue(runtime.states[index]) : nextValue
    },
  ]
}`

const jsxRuntimeStub = `
const runtime = globalThis[Symbol.for("spolink.profile-edit-form-runtime")]
export const Fragment = Symbol.for("react.fragment")
export function jsx(type, props, key) { return createElement(type, props, key) }
export function jsxs(type, props, key) { return createElement(type, props, key) }
function createElement(type, props = {}, key = null) {
  if (type === Fragment) return props.children ?? null
  if (typeof type === "function") return type(props)
  if (props.ref && typeof props.ref === "object") {
    props.ref.current = {
      id: props.id ?? null,
      focus() { runtime.focusedId = props.id ?? props.role ?? type },
    }
  }
  return { key, props, type }
}`

const navigationStub = `
const runtime = globalThis[Symbol.for("spolink.profile-edit-form-runtime")]
export function useRouter() {
  return {
    refresh() { runtime.router.refreshCalls += 1 },
    replace(destination) { runtime.router.replaceCalls.push(destination) },
  }
}`

const lucideStub = `
import { jsx } from "react/jsx-runtime"
function Icon(props) { return jsx("svg", { ...props, "aria-hidden": props["aria-hidden"] ?? true }) }
export const Check = Icon
export const MapPin = Icon
export const Save = Icon
export const Search = Icon
export const X = Icon`

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const loaded = nextLoad(url, { ...context, format: "module" })
      const source = typeof loaded.source === "string" ? loaded.source : loaded.source.toString()
      const result = typescript.transpileModule(source, {
        compilerOptions: {
          jsx: typescript.JsxEmit.ReactJSX,
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ES2022,
        },
        fileName: fileURLToPath(url),
      })
      return { format: "module", shortCircuit: true, source: result.outputText }
    }

    return nextLoad(url, context)
  },
  resolve(specifier, context, nextResolve) {
    const stubSource = new Map([
      ["lucide-react", lucideStub],
      ["next/navigation", navigationStub],
      ["react", reactStub],
      ["react/jsx-runtime", jsxRuntimeStub],
    ]).get(specifier)
    if (stubSource) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(stubSource)}`,
      }
    }

    const baseUrl = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), workspaceUrl)
      : context.parentURL && specifier.startsWith(".")
        ? new URL(specifier, context.parentURL)
        : null

    if (baseUrl) {
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(`${baseUrl.href}${extension}`)
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

const { ProfileEditForm } = await import("../components/profile/profile-edit-form.tsx")

export const initialProfile = {
  defaultRegion: "서울특별시 강남구",
  displayName: "러너",
  locationAgreed: true,
  marketingAgreed: false,
  phone: "010-1234-5678",
  realName: "홍길동",
}

export function createHarness(submitProfileEdit, initial = initialProfile) {
  runtime.states = []
  runtime.refs = []
  runtime.router = { refreshCalls: 0, replaceCalls: [] }
  runtime.focusedId = null

  async function render() {
    runtime.effects = []
    runtime.stateIndex = 0
    runtime.idIndex = 0
    const tree = ProfileEditForm({ initialProfile: initial, submitProfileEdit })
    for (const effect of runtime.effects) effect()
    return tree
  }

  return { render }
}

export function walk(node, visit) {
  if (node === null || node === undefined || typeof node === "boolean") return
  if (typeof node === "string" || typeof node === "number") return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }

  visit(node)
  walk(node.props?.children, visit)
}

export function textContent(node) {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textContent).join("")
  return textContent(node.props?.children)
}

export function findByTypeAndName(tree, type, name) {
  let match = null
  walk(tree, (node) => {
    if (match === null && node.type === type && node.props?.name === name) match = node
  })
  assert.notEqual(match, null, `${type} ${name} should exist`)
  return match
}

export function findByTypeAndPlaceholder(tree, type, placeholder) {
  let match = null
  walk(tree, (node) => {
    if (match === null && node.type === type && node.props?.placeholder === placeholder) {
      match = node
    }
  })
  assert.notEqual(match, null, `${type} ${placeholder} should exist`)
  return match
}

export function findSubmitButton(tree) {
  let match = null
  walk(tree, (node) => {
    if (match === null && node.type === "button" && node.props?.type === "submit") match = node
  })
  assert.notEqual(match, null, "submit button should exist")
  return match
}

export function textIncludes(tree, expected) {
  return textContent(tree).includes(expected)
}

export function changeText(input, value) {
  input.props.onChange({ target: { name: input.props.name, value } })
}

export function changeCheckbox(input, checked) {
  input.props.onChange({ target: { checked, name: input.props.name, type: "checkbox" } })
}

export async function submit(tree) {
  let match = null
  walk(tree, (node) => {
    if (match === null && node.type === "form") match = node
  })
  assert.notEqual(match, null, "form should exist")
  await match.props.onSubmit({ preventDefault() {} })
}

export async function pressEnter(input, tree) {
  let requested = false
  input.props.onKeyDown({
    altKey: false,
    ctrlKey: false,
    currentTarget: {
      form: {
        requestSubmit() {
          requested = true
        },
      },
    },
    key: "Enter",
    metaKey: false,
    nativeEvent: { isComposing: false },
    preventDefault() {},
    shiftKey: false,
  })
  assert.equal(requested, true)
  await submit(tree)
}

export function findButtonByText(tree, expectedText) {
  let match = null
  walk(tree, (node) => {
    if (match === null && node.type === "button" && textContent(node).includes(expectedText)) {
      match = node
    }
  })
  assert.notEqual(match, null, `button ${expectedText} should exist`)
  return match
}

export async function proveInvalidSubmitFocusesWithoutPatch() {
  const calls = []
  const { render } = createHarness(async (patch) => {
    calls.push(patch)
    return { status: "no_changes" }
  })
  let tree = await render()
  changeText(findByTypeAndName(tree, "input", "displayName"), "A")
  tree = await render()
  await submit(tree)
  tree = await render()
  return {
    callCount: calls.length,
    focusedId: runtime.focusedId,
    hasValidationText: textIncludes(tree, "활동 이름은 2자 이상 입력해요."),
  }
}
