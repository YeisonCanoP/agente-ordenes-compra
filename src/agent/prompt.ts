import { readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * System prompt = comportamiento (agent/prompt.md) + conocimiento del proceso (src/knowledge/).
 * Ambos viven en Markdown, fuera del código (PRD 6.1 y 6.5).
 */
export async function cargarPrompt(directory: string): Promise<string> {
  const [comportamiento, conocimiento] = await Promise.all([
    readFile(join(directory, "agent", "prompt.md"), "utf8"),
    readFile(join(directory, "src", "knowledge", "ordenes-compra.md"), "utf8"),
  ])
  return `${comportamiento.trim()}\n\n---\n\n${conocimiento.trim()}\n`
}
