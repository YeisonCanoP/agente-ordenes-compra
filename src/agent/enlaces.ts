import { z } from "zod"

/**
 * Enlace de resultados entre herramientas (CA2: "el diseño lo hace innecesario").
 * Las herramientas reciben `paquete`, `derivados` y `payload` (contrato del PRD 6.2), pero el modelo
 * no los transporta: el ciclo guarda cada resultado y lo entrega a la herramienta siguiente.
 * Así el modelo no puede alterar un valor entre un paso y otro, y no gasta tokens reenviándolo.
 */

type Enlace = { argumento: string; herramienta: string; campo?: string }

const ENLACES: Record<string, Enlace[]> = {
  oc_validar: [{ argumento: "paquete", herramienta: "oc_leer_paquete" }],
  oc_construir_payload: [
    { argumento: "paquete", herramienta: "oc_leer_paquete" },
    { argumento: "derivados", herramienta: "oc_validar", campo: "derivados" },
  ],
  oc_crear: [{ argumento: "payload", herramienta: "oc_construir_payload", campo: "payload" }],
}

/** Último resultado exitoso de cada herramienta por caso: "oc_validar:sol-004" → data. */
export type Resultados = Map<string, Record<string, unknown>>

const ConCaso = z.looseObject({ caso: z.string() })
const Exito = z.looseObject({ ok: z.literal(true), data: z.record(z.string(), z.unknown()) })

const clave = (herramienta: string, caso: string): string => `${herramienta}:${caso}`

/** Argumentos que el modelo no ve ni envía, porque los completa el ciclo. */
export function argumentosEnlazados(herramienta: string): string[] {
  return (ENLACES[herramienta] ?? []).map((enlace) => enlace.argumento)
}

/** Completa los argumentos enlazados. Devuelve `falta` si aún no se ejecutó el paso previo. */
export function enlazar(
  herramienta: string,
  argumentos: unknown,
  resultados: Resultados,
): { argumentos: unknown } | { falta: string } {
  const enlaces = ENLACES[herramienta]
  const conCaso = ConCaso.safeParse(argumentos)
  if (!enlaces || !conCaso.success) return { argumentos }

  const completos: Record<string, unknown> = { ...conCaso.data }
  for (const enlace of enlaces) {
    const previo = resultados.get(clave(enlace.herramienta, conCaso.data.caso))
    if (!previo) {
      return {
        falta: `Antes de ${herramienta} debes llamar ${enlace.herramienta} para el caso "${conCaso.data.caso}" en esta conversación.`,
      }
    }
    completos[enlace.argumento] = enlace.campo ? previo[enlace.campo] : previo
  }
  return { argumentos: completos }
}

/** Guarda el resultado exitoso de una herramienta para enlazarlo con las siguientes. */
export function recordar(resultados: Resultados, herramienta: string, argumentos: unknown, resultado: unknown): void {
  const conCaso = ConCaso.safeParse(argumentos)
  const exito = Exito.safeParse(resultado)
  if (conCaso.success && exito.success) resultados.set(clave(herramienta, conCaso.data.caso), exito.data.data)
}
