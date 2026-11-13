// Front del chat: historial, llamadas a herramientas visibles y confirmación humana resaltada (PRD 6.1).

const CLAVE_SESION = "agente-oc.sesion"
const CLAVE_ACCESO = "agente-oc.clave"

const conversacion = document.getElementById("conversacion")
const bienvenida = document.getElementById("bienvenida")
const formulario = document.getElementById("formulario")
const entrada = document.getElementById("entrada")
const botonEnviar = document.getElementById("enviar")
const estadoModelo = document.getElementById("estado-modelo")

let sessionId = localStorage.getItem(CLAVE_SESION) ?? estrenarSesion()
let ocupado = false

// ---------- Utilidades del DOM ----------

function crear(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta)
  if (clase) nodo.className = clase
  if (texto !== undefined) nodo.textContent = texto
  return nodo
}

function bajarAlFinal() {
  conversacion.scrollTop = conversacion.scrollHeight
}

function estrenarSesion() {
  const id = crypto.randomUUID()
  localStorage.setItem(CLAVE_SESION, id)
  return id
}

function cabeceras() {
  const clave = sessionStorage.getItem(CLAVE_ACCESO)
  return { "Content-Type": "application/json", ...(clave ? { "x-clave-acceso": clave } : {}) }
}

/** Pide la clave de acceso cuando el servidor responde 401. Devuelve false si la analista cancela. */
function pedirClave() {
  const clave = window.prompt("Este chat está protegido. Ingresa la clave de acceso:")
  if (!clave) return false
  sessionStorage.setItem(CLAVE_ACCESO, clave.trim())
  return true
}

// ---------- Markdown mínimo y seguro ----------
// Todo el texto se escapa antes de aplicar formato: lo que diga el modelo nunca se inserta como HTML.

const escapar = (texto) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const enLinea = (texto) =>
  escapar(texto)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")

const esFila = (linea) => /^\s*\|.*\|\s*$/.test(linea ?? "")
const esSeparador = (linea) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(linea ?? "") && (linea ?? "").includes("-")
const esItem = (linea) => /^\s*([-*•]|\d+[.)])\s+/.test(linea ?? "")
const esTitulo = (linea) => /^#{1,6}\s+/.test(linea ?? "")
const celdas = (linea) => linea.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((celda) => celda.trim())

function tabla(filas) {
  const [cabecera, , ...cuerpo] = filas
  const th = celdas(cabecera).map((celda) => `<th>${enLinea(celda)}</th>`).join("")
  const tr = cuerpo.map((fila) => `<tr>${celdas(fila).map((celda) => `<td>${enLinea(celda)}</td>`).join("")}</tr>`)
  return `<div class="tabla"><table><thead><tr>${th}</tr></thead><tbody>${tr.join("")}</tbody></table></div>`
}

function lista(items) {
  const ordenada = /^\s*\d+[.)]\s+/.test(items[0])
  const li = items.map((item) => `<li>${enLinea(item.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>`).join("")
  return ordenada ? `<ol>${li}</ol>` : `<ul>${li}</ul>`
}

function markdown(texto) {
  const lineas = texto.replace(/\r/g, "").split("\n")
  const bloques = []
  let i = 0
  const tomarMientras = (condicion) => {
    const inicio = i
    while (i < lineas.length && condicion(lineas[i])) i++
    return lineas.slice(inicio, i)
  }
  while (i < lineas.length) {
    const linea = lineas[i]
    if (linea.trim() === "") {
      i++
    } else if (esFila(linea) && esSeparador(lineas[i + 1])) {
      bloques.push(tabla(tomarMientras(esFila)))
    } else if (esTitulo(linea)) {
      bloques.push(`<h3>${enLinea(linea.replace(/^#{1,6}\s+/, ""))}</h3>`)
      i++
    } else if (esItem(linea)) {
      bloques.push(lista(tomarMientras(esItem)))
    } else {
      const parrafo = tomarMientras((l) => l.trim() !== "" && !esItem(l) && !esTitulo(l) && !esFila(l))
      if (parrafo.length === 0) parrafo.push(lineas[i++])
      bloques.push(`<p>${parrafo.map(enLinea).join("<br>")}</p>`)
    }
  }
  return bloques.join("")
}

// ---------- Mensajes ----------

function agregarUsuario(texto) {
  bienvenida.hidden = true
  const mensaje = crear("div", "mensaje usuario")
  mensaje.append(crear("div", "burbuja", texto))
  conversacion.append(mensaje)
  bajarAlFinal()
}

/** Crea la tarjeta del agente con el indicador de "pensando". */
function agregarAsistente() {
  bienvenida.hidden = true
  const raiz = crear("article", "mensaje asistente")
  const llamadas = crear("div", "llamadas")
  const pensando = crear("div", "pensando")
  const puntos = crear("span", "puntos")
  puntos.append(crear("i"), crear("i"), crear("i"))
  pensando.append(puntos, crear("span", "", "Pensando…"))
  const texto = crear("div", "texto")
  raiz.append(llamadas, pensando, texto)
  conversacion.append(raiz)
  bajarAlFinal()
  return { raiz, llamadas, pensando, texto }
}

/** Una llamada a herramienta: nombre, resultado resumido y, al desplegar, argumentos y resultado. */
function pintarLlamada(contenedor, llamada) {
  const detalle = crear("details", `llamada${llamada.ok ? "" : " fallida"}`)
  const resumen = crear("summary")
  resumen.append(
    crear("span", "estado", llamada.ok ? "✓" : "✕"),
    crear("code", "", llamada.nombre),
    crear("span", "resumen", llamada.resumen),
  )
  const cuerpo = crear("div", "detalle")
  cuerpo.append(
    crear("h4", "", "Argumentos"),
    crear("pre", "", JSON.stringify(llamada.argumentos, null, 2)),
    crear("h4", "", "Resultado"),
    crear("pre", "", JSON.stringify(llamada.resultado, null, 2)),
  )
  detalle.append(resumen, cuerpo)
  contenedor.append(detalle)
  bajarAlFinal()
}

function pintarRespuesta(tarjeta, respuesta, activa) {
  tarjeta.pensando.remove()
  tarjeta.texto.innerHTML = markdown(respuesta.reply)
  if (respuesta.needsConfirmation) tarjeta.raiz.append(barraConfirmacion(activa))
  bajarAlFinal()
}

function pintarError(tarjeta, mensaje) {
  tarjeta.pensando.remove()
  tarjeta.raiz.classList.add("con-error")
  tarjeta.texto.append(crear("p", "error-texto", mensaje))
  bajarAlFinal()
}

/** CA3: resalta que el agente espera una decisión y ofrece responder con un clic. */
function barraConfirmacion(activa) {
  const barra = crear("div", `confirmacion${activa ? "" : " atendida"}`)
  barra.setAttribute("role", "alert")
  const aviso = crear("div")
  aviso.append(
    crear("strong", "", "El agente espera tu confirmación"),
    crear("span", "", "No se creará nada en SAP hasta que respondas."),
  )
  const acciones = crear("div", "acciones")
  const confirmar = crear("button", "boton primario", "Confirmar")
  const rechazar = crear("button", "boton secundario", "No crear")
  confirmar.type = rechazar.type = "button"
  confirmar.addEventListener("click", () => enviar("Confirmo"))
  rechazar.addEventListener("click", () => enviar("No, no la crees."))
  acciones.append(confirmar, rechazar)
  barra.append(aviso, acciones)
  return barra
}

function atenderConfirmaciones() {
  for (const barra of conversacion.querySelectorAll(".confirmacion")) barra.classList.add("atendida")
}

// ---------- Comunicación con la API ----------

function bloquear(valor) {
  ocupado = valor
  botonEnviar.disabled = valor
  for (const boton of conversacion.querySelectorAll("button")) boton.disabled = valor
}

/** Lee la respuesta NDJSON: un evento por línea ("herramienta", "final" o "error"). */
async function leerEventos(respuesta, alEvento) {
  const lector = respuesta.body.getReader()
  const decodificador = new TextDecoder()
  let pendiente = ""
  while (true) {
    const { done, value } = await lector.read()
    pendiente += decodificador.decode(value ?? new Uint8Array(), { stream: !done })
    const lineas = pendiente.split("\n")
    pendiente = lineas.pop() ?? ""
    for (const linea of lineas) if (linea.trim()) alEvento(JSON.parse(linea))
    if (done) break
  }
  if (pendiente.trim()) alEvento(JSON.parse(pendiente))
}

async function pedirTurno(texto) {
  const peticion = () =>
    fetch("/api/chat", {
      method: "POST",
      headers: cabeceras(),
      body: JSON.stringify({ sessionId, message: texto, stream: true }),
    })
  const respuesta = await peticion()
  return respuesta.status === 401 && pedirClave() ? peticion() : respuesta
}

async function enviar(texto) {
  if (ocupado || !texto.trim()) return
  atenderConfirmaciones()
  agregarUsuario(texto.trim())
  const tarjeta = agregarAsistente()
  bloquear(true)
  try {
    const respuesta = await pedirTurno(texto.trim())
    if (!respuesta.ok) {
      const cuerpo = await respuesta.json().catch(() => ({}))
      pintarError(tarjeta, cuerpo.error ?? `El servidor respondió con un error (${respuesta.status}).`)
      return
    }
    let recibioFinal = false
    await leerEventos(respuesta, (evento) => {
      if (evento.tipo === "herramienta") pintarLlamada(tarjeta.llamadas, evento.llamada)
      if (evento.tipo === "error") pintarError(tarjeta, evento.error)
      if (evento.tipo === "final") pintarRespuesta(tarjeta, evento, true)
      recibioFinal ||= evento.tipo !== "herramienta"
    })
    if (!recibioFinal) pintarError(tarjeta, "La respuesta se interrumpió. Vuelve a intentarlo.")
  } catch {
    pintarError(tarjeta, "No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.")
  } finally {
    bloquear(false)
    entrada.focus()
  }
}

async function cargarEstado() {
  try {
    const salud = await (await fetch("/api/health")).json()
    estadoModelo.textContent = `${salud.provider} · ${salud.model}${salud.protegido ? " · acceso con clave" : ""}`
  } catch {
    estadoModelo.textContent = "Sin conexión con el servidor"
  }
}

/** Recupera el historial de la sesión guardada en este navegador, si el servidor aún la tiene. */
async function restaurarHistorial() {
  const respuesta = await fetch(`/api/sessions/${sessionId}`, { headers: cabeceras() }).catch(() => null)
  if (!respuesta?.ok) return
  const { historial } = await respuesta.json()
  historial.forEach((entrada, indice) => {
    if (entrada.rol === "usuario") return agregarUsuario(entrada.contenido)
    const tarjeta = agregarAsistente()
    for (const llamada of entrada.toolCalls) pintarLlamada(tarjeta.llamadas, llamada)
    pintarRespuesta(tarjeta, { reply: entrada.contenido, needsConfirmation: entrada.needsConfirmation }, indice === historial.length - 1)
  })
}

// ---------- Eventos de la página ----------

formulario.addEventListener("submit", (evento) => {
  evento.preventDefault()
  const texto = entrada.value
  entrada.value = ""
  entrada.style.height = "auto"
  enviar(texto)
})

entrada.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault()
    formulario.requestSubmit()
  }
})

entrada.addEventListener("input", () => {
  entrada.style.height = "auto"
  entrada.style.height = `${entrada.scrollHeight}px`
})

for (const sugerencia of document.querySelectorAll(".sugerencia")) {
  sugerencia.addEventListener("click", () => enviar(sugerencia.dataset.mensaje ?? ""))
}

document.getElementById("nueva-sesion").addEventListener("click", () => {
  if (ocupado) return
  sessionId = estrenarSesion()
  for (const mensaje of conversacion.querySelectorAll(".mensaje")) mensaje.remove()
  bienvenida.hidden = false
  entrada.focus()
})

cargarEstado()
restaurarHistorial()
