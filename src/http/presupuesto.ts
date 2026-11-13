const hoy = (): string => new Date().toISOString().slice(0, 10)

/** Tope global de tokens por día (PRD 8, costo): nadie puede gastar la clave del modelo sin límite. */
export class Presupuesto {
  private readonly limiteDiario: number
  private dia = hoy()
  private usados = 0

  constructor(limiteDiario: number) {
    this.limiteDiario = limiteDiario
  }

  agotado(): boolean {
    this.reiniciarSiCambioElDia()
    return this.usados >= this.limiteDiario
  }

  sumar(tokens: number): void {
    this.reiniciarSiCambioElDia()
    this.usados += tokens
  }

  private reiniciarSiCambioElDia(): void {
    if (this.dia === hoy()) return
    this.dia = hoy()
    this.usados = 0
  }
}
