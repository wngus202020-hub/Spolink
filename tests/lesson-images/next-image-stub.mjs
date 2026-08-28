import { createElement } from "react"

export default function Image({ alt, src }) {
  return createElement("img", { alt, src: String(src) })
}
