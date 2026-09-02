export type QAAction =
  | { name: "navigate"; url: string }
  | { name: "click"; selector: string }
  | { name: "type"; selector: string; text: string }
  | { name: "press_key"; key: string }
  | { name: "read_page" }
  | { name: "take_screenshot" }
  | { name: "wait"; milliseconds: number }
  | { name: "go_back" }
  | { name: "reload" }

export const SUPPORTED_ACTION_NAMES = ["navigate", "click", "type", "press_key", "read_page", "take_screenshot", "wait", "go_back", "reload"] as const

export interface ClickCandidate {
  tag: string
  id?: string
  text: string
  ariaLabel?: string
  placeholder?: string
}

const allowedKeys = new Set(["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp"])

export function validateAction(value: unknown): QAAction {
  if (!value || typeof value !== "object" || !("name" in value)) {
    throw new Error("Action must be an object with a supported name")
  }

  const action = value as Record<string, unknown>
  if (typeof action.name !== "string") throw new Error("Action name must be a string")

  switch (action.name) {
    case "read_page":
    case "take_screenshot":
    case "go_back":
    case "reload":
      return { name: action.name }
    case "navigate":
      if (typeof action.url !== "string") throw new Error("navigate requires a URL")
      return { name: action.name, url: new URL(action.url).toString() }
    case "click":
      return selectorAction(action, "click")
    case "type":
      if (typeof action.selector !== "string" || typeof action.text !== "string") {
        throw new Error("type requires selector and text")
      }
      if (action.text.length > 2_000) throw new Error("type text exceeds 2,000 characters")
      return { name: action.name, selector: action.selector, text: action.text }
    case "press_key":
      if (typeof action.key !== "string" || !allowedKeys.has(action.key)) {
        throw new Error("press_key received an unsupported key")
      }
      return { name: action.name, key: action.key }
    case "wait":
      if (typeof action.milliseconds !== "number" || action.milliseconds < 0 || action.milliseconds > 10_000) {
        throw new Error("wait must be between 0 and 10,000 milliseconds")
      }
      return { name: action.name, milliseconds: action.milliseconds }
    default:
      throw new Error(`Unsupported action: ${action.name}`)
  }
}

function selectorAction(action: Record<string, unknown>, name: "click"): QAAction {
  if (typeof action.selector !== "string" || action.selector.length === 0 || action.selector.length > 500) {
    throw new Error(`${name} requires a valid selector`)
  }
  return { name, selector: action.selector }
}

export async function validateActionTarget(page: any, action: QAAction): Promise<void> {
  if (action.name !== "click") return
  const locator = page.locator(action.selector)
  const count = await locator.count()
  const candidates = count > 0 ? await locator.evaluateAll((nodes: any[]) => nodes.slice(0, 10).map((node) => ({ tag: node.tagName.toLowerCase(), id: node.id || undefined, text: (node.innerText || "").trim().slice(0, 120), ariaLabel: node.getAttribute("aria-label") || undefined, placeholder: node.getAttribute("placeholder") || undefined }))) : []
  const detail = candidates.map((candidate: ClickCandidate) => `${candidate.tag}${candidate.id ? `#${candidate.id}` : ""}${candidate.ariaLabel ? ` aria-label=${candidate.ariaLabel}` : ""}${candidate.text ? ` text=${candidate.text}` : ""}`).join("; ")
  if (count === 0) throw new Error(`Click selector "${action.selector}" matched no actionable elements; choose a selector from the current interactive elements`)
  if (count > 1) throw new Error(`Click selector "${action.selector}" is ambiguous: matched ${count} actionable elements${detail ? `; candidates: ${detail}` : ""}`)
  if (isBroadSelector(action.selector)) throw new Error(`Click selector "${action.selector}" is too broad; choose a unique selector or role/name target from the current interactive elements`)
}

function isBroadSelector(selector: string): boolean {
  const normalized = selector.trim().toLowerCase().replace(/\s+/g, "")
  return ["button", "input", "a", "*", "[role=button]", "[role=\"button\"]", "[role='button']"].includes(normalized)
}