import { z } from "zod"
import { describirIssues } from "../dominio/archivos.ts"
import type { DefinicionHerramienta } from "../llm/adapter.ts"
import * as oc from "../tools/oc.ts"
import type { Ctx } from "../tools/oc.ts"
import { fallo } from "../tools/resultado.ts"

type Registrada = {
  definicion: DefinicionHerramienta
  ejecutar(argumentos: unknown, ctx: Ctx): Promise<string>
}

type Herramienta<S extends z.ZodRawShape> = {
  description: string
  args: S
  execute(args: z.infer<z.ZodObject<S>>, ctx: Ctx): Promise<string>
}

/** Expone una herramienta al modelo: JSON Schema para describirla y validación zod antes de ejecutarla. */
function adaptar<S extends z.ZodRawShape>(nombre: string, herramienta: Herramienta<S>): Registrada {
  const esquema = z.object(herramienta.args)
  const { $schema: _dialecto, ...parametros } = z.toJSONSchema(esquema)
  return {
    definicion: { nombre, descripcion: herramienta.description, parametros },
    async ejecutar(argumentos, ctx) {
      const resultado = esquema.safeParse(argumentos)
      if (!resultado.success) {
        return fallo(`Argumentos inválidos para ${nombre} → ${describirIssues(resultado.error)}. Corrige y vuelve a llamar.`)
      }
      return herramienta.execute(resultado.data, ctx)
    },
  }
}

/** El nombre que ve el modelo es <archivo>_<export> (PRD 6.2). */
const REGISTRO: Registrada[] = [
  adaptar("oc_leer_paquete", oc.leer_paquete),
  adaptar("oc_validar", oc.validar),
  adaptar("oc_construir_payload", oc.construir_payload),
  adaptar("oc_generar_evidencia", oc.generar_evidencia),
  adaptar("oc_crear", oc.crear),
]

export const definiciones: DefinicionHerramienta[] = REGISTRO.map((r) => r.definicion)

/** Ejecuta una herramienta por nombre. Nunca lanza: un nombre desconocido también es { ok: false }. */
export async function ejecutarHerramienta(nombre: string, argumentos: unknown, ctx: Ctx): Promise<string> {
  const registrada = REGISTRO.find((r) => r.definicion.nombre === nombre)
  if (!registrada) {
    const disponibles = definiciones.map((d) => d.nombre).join(", ")
    return fallo(`La herramienta "${nombre}" no existe. Disponibles: ${disponibles}.`)
  }
  return registrada.ejecutar(argumentos, ctx)
}
