import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"

const EstadoSchema = z.object({ dia: z.string(), usados: z.number().nonnegative() })

const hoy = (): string => new Date().toISOString().slice(0, 10)

/**
 * Tope global de tokens por día (PRD 8, costo): nadie puede gastar la clave del modelo sin límite.
 * Cada llamada al modelo reserva su consumo estimado antes de salir y lo liquida con el consumo real,
 * así que varias conversaciones simultáneas no pueden pasar el tope a la vez.
 * El consumo del día se guarda en un archivo para que sobreviva a un reinicio del proceso.
 */
export class Presupuesto {
  private readonly limiteDiario: number
  private readonly archivo: string | undefined
  private dia = hoy()
  private usados = 0
  private reservados = 0

  constructor(limiteDiario: number, archivo?: string) {
    this.limiteDiario = limiteDiario
    this.archivo = archivo
  }

  /** Crea el presupuesto recuperando lo consumido hoy, si el archivo existe. */
  static async abrir(limiteDiario: number, archivo: string): Promise<Presupuesto> {
    const presupuesto = new Presupuesto(limiteDiario, archivo)
    try {
      const estado = EstadoSchema.parse(JSON.parse(await readFile(archivo, "utf8")))
      if (estado.dia === presupuesto.dia) presupuesto.usados = estado.usados
    } catch {
      // Sin archivo o con formato inesperado: el día empieza en cero.
    }
    return presupuesto
  }

  agotado(): boolean {
    this.reiniciarSiCambioElDia()
    return this.usados + this.reservados >= this.limiteDiario
  }

  /** Aparta tokens antes de llamar al modelo. Devuelve false si ya no caben en el día. */
  reservar(tokens: number): boolean {
    this.reiniciarSiCambioElDia()
    if (this.usados + this.reservados + tokens > this.limiteDiario) return false
    this.reservados += tokens
    return true
  }

  /** Cambia la reserva por el consumo real de la respuesta (0 si la llamada falló). */
  liquidar(reservados: number, reales: number): void {
    this.reservados = Math.max(0, this.reservados - reservados)
    this.usados += reales
    void this.guardar()
  }

  private reiniciarSiCambioElDia(): void {
    if (this.dia === hoy()) return
    this.dia = hoy()
    this.usados = 0
  }

  private async guardar(): Promise<void> {
    if (!this.archivo) return
    try {
      await mkdir(dirname(this.archivo), { recursive: true })
      await writeFile(this.archivo, JSON.stringify({ dia: this.dia, usados: this.usados }), "utf8")
    } catch (error) {
      console.error("No se pudo guardar el presupuesto diario:", error instanceof Error ? error.message : error)
    }
  }
}
