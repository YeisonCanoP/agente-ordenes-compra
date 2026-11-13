# SOLUCION.md — Agente de órdenes de compra

## 1. Problema en una frase

Cada compra obliga a la analista administrativa a digitar a mano en SAP lo que ya viene escrito en un
correo, y a verificar de memoria que el proveedor existe y que quien aprobó podía aprobar ese monto;
eso cuesta tiempo, deja pasar errores que se corrigen en el cierre contable y hace imposible medir
cuántas órdenes se crean después de que llegó la factura.

A quién le duele:

- **A la analista**: digitación repetitiva y controles que dependen de su memoria.
- **A contabilidad y auditoría**: errores de centro de costo y aprobaciones sin sustento sistemático.
- **A la dirección**: no sabe qué porcentaje de las OC son retroactivas.

## 2. Arquitectura

```
┌───────────────────┐  POST /api/chat   ┌────────────────────────────────────────────────────┐
│ Front (web/)      │ ────────────────▶ │ Backend (Bun, un solo proceso)                     │
│ HTML + JS planos  │ ◀──────────────── │                                                    │
│ - historial       │  NDJSON en vivo   │  src/http/     API, front estático, tope diario    │
│ - llamadas a      │                   │       │                                            │
│   herramientas    │                   │  src/agent/    ciclo: modelo ↔ herramientas        │
│ - confirmación    │                   │       │        confirmación humana · enlaces ·     │
└───────────────────┘                   │       │        sesiones en memoria                 │
                                        │       ├──▶ src/llm/    LlmAdapter → OpenAI         │
                                        │       │                                            │
                                        │       └──▶ src/tools/oc.ts   herramientas oc_*     │
                                        │                 │                                  │
                                        │            src/dominio/  reglas, payload, evidencia│
                                        │                 │                                  │
                                        │            src/sap/      SapAdapter → SAP simulado │
                                        └─────────────────┬───────────────────┬──────────────┘
                                                          │                   │
                                              fixtures/ (solo lectura)   out/ (escritura)
```

Separación que pide el PRD:

| Qué | Dónde vive | Cambia cuando… |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Cambia cómo debe conversar o presentar el agente. |
| **Conocimiento** | `src/knowledge/ordenes-compra.md` | Cambia la explicación del proceso. |
| **Ejecución** | `src/tools/oc.ts` y `src/dominio/` | Cambia una regla de negocio. No toca el servidor. |

El system prompt que recibe el modelo es la unión de los dos Markdown; ninguno está embebido en código.

Las herramientas son una capa delgada: validan argumentos con `zod`, llaman a funciones puras de
`src/dominio/` y devuelven siempre un string JSON `{ ok, data }` o `{ ok: false, error }`. Nunca lanzan.
Por eso `demo.ts` y los tests las ejecutan sin servidor y sin modelo.

## 3. Ciclo del agente

Implementado en `src/agent/ciclo.ts`. Un turno es:

1. Llega el mensaje de la analista y se clasifica (ver confirmación humana).
2. Se envía al modelo el system prompt, la conversación y la definición de las herramientas.
3. Si el modelo pide herramientas, se ejecutan, sus resultados vuelven al modelo y se repite el paso 2.
4. Cuando el modelo responde solo con texto, el turno termina.

**Tope de iteraciones (CA1).** Máximo 25 llamadas al modelo por turno (`MAX_ITERACIONES`). Al llegar al
tope se hace una última llamada sin herramientas para que el agente diga qué logró y qué falta; si esa
llamada falla, el backend arma ese resumen con la lista de herramientas ejecutadas.

**El modelo no transporta datos (CA2).** El contrato del PRD dice que `oc_validar` recibe el `paquete`,
`oc_construir_payload` los `derivados` y `oc_crear` el `payload`. En el chat, el modelo no los reenvía:
solo indica el `caso`, y el ciclo entrega a cada herramienta el resultado que produjo la anterior
(`src/agent/enlaces.ts`). El modelo no puede "arreglar" un monto porque nunca lo tiene en las manos como
argumento. Además, cada herramienta vuelve a leer el caso desde los fixtures y rechaza un paquete o un
payload que no coincida, lo que protege también a `demo.ts` y al módulo usado en otra plataforma.

**Confirmación humana (CA3).** La decide el backend, no el modelo (`src/agent/confirmacion.ts`):

- Un caso queda *pendiente* cuando fue validado como apto y aún no se ha creado.
- El siguiente mensaje de la analista se clasifica con reglas fijas, sin modelo: afirmativo
  ("confirmo", "sí", "dale"…), negativo ("no", "cancela"…) u otro. Una pregunta, una duda ("sí, pero…")
  o una condición nunca cuentan como afirmación.
- `oc_crear` solo recibe `confirmado: true` si ese mensaje fue afirmativo **y** las excepciones del
  caso son las mismas que se le mostraron. En cualquier otro caso el ciclo retira el `confirmado` y la
  herramienta rechaza la creación. Ante la duda, no se crea.
- Un mensaje negativo descarta el pendiente. La respuesta lleva `needsConfirmation: true` mientras haya
  un caso esperando, y el front lo resalta con una barra y los botones "Confirmar" y "No crear".
- Cada confirmación queda en `out/log.jsonl` con el caso, las reglas confirmadas y el mensaje.

**Visibilidad (CA4).** Cada llamada a herramienta se muestra en el chat (nombre, argumentos, resultado
resumido y completo) y se agrega a `out/log.jsonl`.

**Errores (CA5).** Un error de herramienta vuelve al modelo como `{ ok: false, error }` para que lo
explique. Un error del proveedor (timeout, clave rechazada, límite de uso) se traduce a un mensaje
claro en el chat; la sesión sigue viva y se puede reintentar. No se reenvía el texto del proveedor
porque puede citar parte de la clave.

**Costo.** Tope de tokens por sesión, tope global por día y máximo de turnos simultáneos. Cada llamada
al modelo reserva su consumo estimado antes de salir y lo liquida con el real al volver, de modo que
varias sesiones a la vez no pueden pasar el tope diario.

## 4. Elección del modelo

**Proveedor y modelo:** OpenAI, `gpt-4.1-mini`, por la API de Chat Completions con llamadas a
herramientas.

**Por qué:**

- El trabajo del modelo aquí es conversar y elegir la herramienta correcta; el razonamiento de negocio
  está en las herramientas. No hace falta un modelo grande.
- Sigue bien las instrucciones de flujo y el formato de tablas, con latencia baja para un chat.
- Su costo permite dejar un link público con topes razonables.

El modelo está detrás de la interfaz `LlmAdapter` (`src/llm/adapter.ts`): `enviar(mensajes,
herramientas) → respuesta`. Cambiar de proveedor es escribir otra clase; el ciclo no cambia. Los tests
lo demuestran usando un modelo simulado que implementa la misma interfaz.

**Costo estimado por caso.** En la prueba real del caso `sol-004` (procesar, mostrar la OC, confirmar y
crear) el consumo fue de unos 19.000 tokens, casi todos de entrada. La tarifa publicada por OpenAI para
`gpt-4.1-mini` (página del modelo, consultada en noviembre de 2026) es de USD 0,40 por millón de tokens
de entrada, USD 0,10 si la entrada está en caché y USD 1,60 por millón de salida. Con unos 17.500
tokens de entrada y 1.500 de salida, cada caso cuesta alrededor de **USD 0,01**. Antes de enlazar los
resultados entre herramientas el mismo caso consumía unos 38.000 tokens.

**Vigencia del modelo.** OpenAI ya marca `gpt-4.1-mini` como deprecado y recomienda GPT-5 mini (USD 0,25
por millón de tokens de entrada). El modelo se elige con la variable `OPENAI_MODEL`, así que migrar no
requiere cambiar código; sí requiere repetir las pruebas del chat, que hice solo con `gpt-4.1-mini`.

## 5. Matriz de controles

Todas las reglas están en `src/dominio/reglas.ts`, una función pura por regla. Cada hallazgo lleva
`regla`, `mensaje`, `accion_sugerida` y, cuando aplica, los `valores` en juego. Las reglas que los seis
fixtures no ejercitan se prueban en `tests/casos.test.ts` alterando una copia de `sol-001`.

| Regla | Implementación | Tipo | Caso que la prueba |
|---|---|---|---|
| RC1 | Busca el proveedor por NIT normalizado (sin puntos ni dígito de verificación); si la solicitud no trae NIT, por nombre sin tildes ni puntuación. Debe estar activo. | Bloqueo | sol-002, sol-006 y prueba con proveedor inactivo |
| RC2 | Exige aprobación, que el cuerpo diga "Aprobado" (no negado) y que el remitente sea aprobador del centro de costo. | Bloqueo | sol-003 y prueba con "No aprobado" |
| RC3 | Compara el valor total con el tope de ese aprobador en ese centro. | Bloqueo | prueba con valor sobre el tope |
| RC4 | La subárea debe estar en la lista del centro; un centro inexistente también bloquea. | Bloqueo | pruebas con subárea y centro inválidos |
| RC5 | `abs(cotización − solicitud) / solicitud` > 2 %, o no hay cotización: confirmación con ambos valores y el porcentaje. | Confirmación | sol-004 |
| RC6 | Sin indicador de IVA: se toma el del proveedor y se pide confirmación. | Confirmación + derivado | sol-006 |
| RC7 | Sin condiciones de pago: se toman las del proveedor y solo se informa. | Derivado | sol-006 |
| RC8 | Factura con fecha anterior a la solicitud: `retroactiva = true`, confirmación y marca en el control. | Confirmación | sol-005 |
| RC9 | Fecha de aprobación (por día) anterior a la solicitud: confirmación. | Confirmación | prueba con fecha adelantada |
| RC10 | `cantidad × valor_unitario` debe igualar el total con tolerancia de 1. | Bloqueo | prueba con total descuadrado |

**La más difícil: RC2 junto con RC3.** Las dos dependen de quién aprobó, y en `sol-003` falla la
primera: Felipe Vargas aprueba, pero no es aprobador de CC-2020. RC3 solo tiene sentido si el aprobador
es válido, así que cuando RC2 bloquea no se duplica el bloqueo; en cambio, la acción sugerida de RC2
dice qué hacer: avisa que ese correo sí es aprobador de CC-3030 (probablemente el centro de costo de la
solicitud está mal) y que ningún aprobador de CC-2020 tiene tope para 74 millones. Hacer que el
hallazgo sea útil, y no solo correcto, fue lo que más tiempo tomó.

## 6. Diseño del adaptador SAP real

Hoy `src/sap/mock.ts` implementa `SapAdapter` sobre archivos. La implementación real sería otra clase
con la misma interfaz; las herramientas no cambian.

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV`, expuesta a través de SAP Integration Suite.**

- Es la API estándar y soportada de S/4HANA para órdenes de compra: no requiere desarrollo ABAP.
- Es HTTP/JSON, lo que encaja con un backend en TypeScript sin librerías nativas (RFC las exige).
- Pasar por Integration Suite desacopla al agente de si SAP es nube u on-premise, y concentra allí la
  autenticación, el control de tráfico y el monitoreo.
- Dado que la viabilidad no está confirmada, es la opción que menos se pierde si hay que cambiar: el
  mapeo del payload sirve igual para `BAPI_PO_CREATE1`, que sería la alternativa en un ECC sin la API.

**Mapeo del payload (7.4) a `A_PurchaseOrder`:**

| Payload del agente | Campo en SAP | Nota |
|---|---|---|
| `sociedad` | `CompanyCode` | |
| `organizacion_compras` | `PurchasingOrganization` | También se requiere `PurchasingGroup`; hoy no viene en el payload. |
| — | `PurchaseOrderType` = `NB` | Orden estándar. |
| `proveedor.codigo_sap` | `Supplier` | |
| `moneda` | `DocumentCurrency` | |
| `condiciones_pago` | `PaymentTerms` | |
| `referencia.solicitud_id` | `CorrespncExternalReference` | Clave de idempotencia y de búsqueda. |
| `posiciones[].numero` | `to_PurchaseOrderItem.PurchaseOrderItem` | |
| `posiciones[].descripcion` | `PurchaseOrderItemText` | Límite de 40 caracteres, ya aplicado. |
| `posiciones[].cantidad` / `unidad` | `OrderQuantity` / `PurchaseOrderQuantityUnit` | `UN`, `H`, `MES` se traducen a las unidades de SAP. |
| `posiciones[].precio_unitario` | `NetPriceAmount` | SAP espera el precio **sin IVA**: hay que descontar la tasa del indicador. |
| `posiciones[].indicador_iva` | `TaxCode` | |
| `posiciones[].centro_costo` | `AccountAssignmentCategory` = `K` y `to_AccountAssignment.CostCenter` | |
| `posiciones[].subarea` | Campo de cliente o texto de posición | No tiene campo estándar; se define con el equipo de SAP. |
| `aprobador`, `excepciones` | Texto de cabecera | Deja en la OC quién aprobó y qué excepciones se confirmaron. |
| Evidencia de aprobación | Adjunto por `API_CV_ATTACHMENT_SRV` | Llamada aparte, después de crear la OC. |

**Autenticación y credenciales.** OAuth 2.0 con credenciales de cliente contra Integration Suite, con un
usuario técnico cuyo rol solo permite crear y consultar órdenes de compra. El secreto vive en un gestor
de secretos (por ejemplo AWS Secrets Manager) y llega al backend como variable de entorno. Nunca está
en el prompt, en el agente, en el front ni en los logs: el modelo solo ve el resultado de las
herramientas.

**Idempotencia y errores parciales.**

- Antes de crear, `buscarOrdenPorReferencia` consulta por `CorrespncExternalReference`. Si existe,
  se devuelve esa OC.
- Si la creación termina en timeout, no se reintenta a ciegas: primero se vuelve a consultar por la
  referencia, porque la OC pudo haberse creado.
- La cabecera y las posiciones se envían en una sola petición, que SAP confirma o revierte completa.
- El adjunto es una llamada aparte y sí puede fallar con la OC ya creada. En ese caso la OC queda
  registrada y el reintento solo sube lo que falta. El SAP simulado ya se comporta así: `oc_crear`
  repara el recibo, la evidencia y la fila de control cuando encuentra una OC existente.

**Plan B si la conexión no es viable.** El agente sigue ahorrando la mayor parte del tiempo, porque la
validación, el payload y la evidencia no dependen de SAP:

- **Archivo de carga masiva**: un `SapAdapter` que escribe un archivo con el formato de carga de
  órdenes de compra; la analista lo sube en un lote diario.
- **OC lista para digitar**: la tabla de la OC ya validada, en el orden de los campos de la
  transacción de creación, para copiar sin buscar ni verificar nada.

En ambos casos se conservan los bloqueos, las confirmaciones, la evidencia y el log de control.

## 7. Lectura del proceso: las OC retroactivas

Una OC retroactiva es un síntoma, no el problema. Cuando la orden se crea después de la factura, la
compañía ya compró: la OC deja de ser una autorización y se convierte en un trámite para poder pagar.
Los tres controles que una OC debe dar se pierden: nadie verificó el presupuesto antes de comprometer
el gasto, nadie comparó contra una cotización, y la aprobación llega cuando ya no se puede decir que no.
En `sol-005` se ve completo: la cotización es del 5 de agosto, la factura del 10 y la solicitud del 27;
la aprobación dice "ya llegó la factura, por favor crear la OC para poder radicarla".

Lo que le diría a la dirección:

1. **Hoy no se puede saber cuánto pasa.** El agente lo empieza a medir desde el primer día: cada OC
   retroactiva queda marcada en `out/control.csv`, con su solicitud y su fecha. En un mes hay un
   porcentaje real, por centro de costo y por proveedor.
2. **Rechazarlas de entrada no funciona.** La factura ya existe y hay que pagarla; bloquear solo
   desplaza el problema a tesorería. Por eso el agente las crea, pero nunca en silencio: exige una
   confirmación explícita y deja el rastro.
3. **La medición debe llevar a un cambio de proceso.** Propondría tres pasos:
   - Publicar el indicador por área cada mes. Lo que se mide y se muestra, baja.
   - Que el proveedor no pueda facturar sin número de OC: incluirlo como requisito en la orden y
     devolver las facturas que no lo traigan.
   - Atacar la causa: si la compra se hace sin OC porque pedirla es lento, el mismo agente acorta ese
     tiempo. Para compras recurrentes o de bajo monto, usar órdenes marco aprobadas por adelantado.

La decisión de política (tolerarlas con marca o rechazarlas) es de la dirección. Con los datos del
control podrá tomarla sobre hechos y no sobre percepciones.

## 8. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Un solo agente con herramientas.** | Varios agentes coordinados (lector, validador, creador). | El flujo es lineal y cada paso es determinista. Más agentes agregan costo, latencia y puntos de fallo sin mejorar el resultado. |
| 2 | **El ciclo enlaza los resultados; el modelo solo envía el caso.** | Que el modelo reenvíe `paquete`, `derivados` y `payload`, como sugiere leer el contrato al pie de la letra. | Lo probé así primero: al confirmar, el modelo alteró el payload y necesitó cuatro intentos. Las validaciones lo frenaron, pero era frágil y costaba el doble de tokens. Las herramientas conservan el contrato del PRD. |
| 3 | **La confirmación la clasifica el backend con reglas fijas.** | Dejar que el modelo interprete si la analista confirmó. | Es el control más importante del reto: no puede depender de que el modelo interprete bien. El costo es que una afirmación poco común no se reconoce y el agente vuelve a preguntar; fallar hacia "no crear" es lo correcto. |
| 4 | **Las herramientas no confían en sus argumentos.** | Usar directamente el paquete y el payload recibidos. | Vuelven a leer el caso y comparan. Es trabajo repetido, pero garantiza que ningún valor alterado llegue a SAP, también fuera de este servidor. |
| 5 | **Front en HTML y JS planos, servido por el mismo proceso.** | React con un paso de build. | El valor está en el backend. Sin build, un comando levanta todo y hay un solo servicio que desplegar. El costo: escribí un renderizador mínimo de Markdown que escapa todo el texto del modelo antes de darle formato. |
| 6 | **Sesiones en memoria; órdenes y auditoría en archivos con volumen.** | Base de datos. | El PRD la excluye. Lo que no puede perderse (órdenes, control, evidencias) está en `out/` sobre un volumen; las conversaciones se pierden al reiniciar. |
| 7 | **Respuesta en vivo con NDJSON sobre la misma petición.** | WebSocket o Server-Sent Events. | Solo hay un sentido de comunicación durante el turno. NDJSON se lee con `fetch`, no necesita otro protocolo y la API sigue funcionando sin `stream`. |
| 8 | **Imagen Docker construida en local y enviada al EC2.** | Construir en el servidor o usar una plataforma administrada. | La instancia es pequeña; construir allí compite por la memoria con el servicio. |

## 9. Supuestos

- **La OC se crea por los valores de la solicitud**, que son los que el líder aprobó. La cotización
  solo se usa para contrastar (RC5).
- **Los valores de la solicitud incluyen IVA.** Coinciden con el "total IVA incluido" de las
  cotizaciones. El payload simplificado lleva `precio_unitario` tal cual; la integración real debe
  enviar el precio neto.
- **Una solicitud es una posición.** Los fixtures traen un solo ítem; el payload ya admite varias.
- **Fechas por día calendario**, tomadas como vienen escritas (los correos traen `-05:00`).
- **RC3 solo se evalúa con un aprobador válido.** Si RC2 bloquea, la información del tope va en la
  acción sugerida.
- **RC6 y RC7 también bloquean un código informado que no exista** en el maestro de IVA o de
  condiciones de pago. El PRD pide validar contra esos maestros aunque la tabla de reglas no lo detalle.
- **Unidad de medida**: `H` o `MES` solo si la descripción dice esa cantidad de horas o meses; si no,
  `UN`.
- **"Aprobado"** se busca como palabra, sin distinguir mayúsculas, y no cuenta si viene negado.
- **Trazabilidad**: además de las fuentes que lista el PRD uso `correo` y `aprobacion`, porque el id del
  correo y el aprobador salen de esos documentos.
- **`control.csv`**: `oc_validar` registra los casos bloqueados (nunca llegan a `oc_crear`), y agregué
  el resultado `existente` para los reintentos idempotentes.
- **`SapAdapter`**: es la interfaz del PRD con dos campos opcionales añadidos (`reutilizada` al crear y
  `fecha` al buscar). Son compatibles con la original y permiten una idempotencia correcta con
  peticiones simultáneas y reparar un recibo perdido.
- **El caso** es el nombre de una carpeta; se rechaza cualquier nombre con rutas.
- **La demo confirma solo `sol-004`**, como pide el PRD. `sol-005` y `sol-006` quedan pendientes para
  mostrar que sin confirmación no se crea; los tests cubren su creación confirmada.
- **El link es HTTP sin dominio.** Suficiente para la prueba con datos ficticios.

## 10. Cobertura

| Historia | Estado | Detalle |
|---|---|---|
| HU-1 · Leer el paquete | Hecho | Normaliza las cinco piezas; lo ausente llega como `null` y se lista en `faltantes`. |
| HU-2 · Validar | Hecho | RC1–RC10 con bloqueos, confirmaciones, derivados y `retroactiva`. |
| HU-3 · Construir el payload | Hecho | Válido contra `zod`; trazabilidad en `out/<caso>/trazabilidad.json`. |
| HU-4 · Evidencia | Parcial | P0 hecho (`aprobacion.txt` con sha256). El PDF (P1) no está hecho. |
| HU-5 · Crear la OC | Hecho | Numeración desde `4500000001`, idempotencia, `control.csv`. |
| HU-6 · Errores | Hecho | Paquete incompleto, JSON malformado y monto no numérico devuelven `{ ok: false, error }`. |
| `oc_leer_excel` (P1 opcional) | No hecho | Los fixtures ya vienen normalizados. |
| Bonus · módulo reutilizable | Hecho | `modulo/` generado desde la aplicación y verificado por un test. |

Arquitectura (sección 6): front con llamadas visibles y confirmación resaltada, backend con el ciclo y
sus topes, adaptador LLM, prompt en Markdown y `demo.ts`: hechos. Streaming (opcional): hecho.

**Qué falta para producción:**

- El adaptador SAP real y la consulta de maestros en SAP en tiempo real, en lugar de los fixtures.
- Lectura de los adjuntos reales (`.xlsx`, `.pdf`, `.eml`) y recepción automática del correo.
- Autenticación de usuarios con el directorio de la compañía; `confirmado_por` debe ser una persona.
- HTTPS con dominio propio.
- Persistencia de las sesiones y almacenamiento de auditoría que no se pueda alterar.
- Evidencia en PDF, con firma si auditoría la exige.
- Varias posiciones por solicitud y manejo de moneda extranjera.
- Monitoreo, alertas de costo y un conjunto de evaluación del modelo que corra en cada cambio del prompt.

## 11. Uso de IA

| Asistente | Para qué lo usé |
|---|---|
| **Claude Code (Anthropic)** | Asistente principal durante todo el reto: lectura del PRD y revisión de los fixtures en busca de instrucciones ocultas, plan por fases, escritura del código, los tests y esta documentación, y prueba del chat en el navegador. |
| **Codex (OpenAI)** | Revisor independiente del código que ya había escrito Claude Code. Encontró cinco problemas reales (confirmación dependiente del modelo, tope diario superable con peticiones simultáneas, órdenes sin volumen persistente, creación parcial y memoria sin acotar) que se corrigieron. |
| **OpenAI `gpt-4.1-mini`** | Es el modelo del agente en ejecución, no un asistente de construcción. |

**Cómo trabajé con ellos.** Definí el alcance de cada fase antes de escribir código, pedí commits
pequeños y revisé cada entrega contra el PRD. La verificación no se dejó al asistente: `demo.ts` y los
tests corren sin modelo, y el chat se probó contra OpenAI con los casos reales.

**Qué descarté o cambié de lo que me propusieron, y por qué:**

- **Que el modelo reenviara el paquete y el payload entre herramientas.** Fue el primer diseño. En la
  prueba real el modelo alteró el payload y necesitó cuatro intentos; lo reemplacé por el enlace de
  resultados en el ciclo.
- **Decidir la confirmación mirando si la respuesta del agente contenía un signo de pregunta**, y
  autorizar cualquier mensaje posterior. La revisión de Codex mostró que dependía del modelo; ahora la clasifica
  el backend con reglas fijas.
- **Desplegar en una plataforma administrada con su archivo de configuración.** Lo quité: el despliegue
  es en un EC2 propio con Docker.
- **Un tope diario de 3.000.000 de tokens.** Era demasiado alto para un link público; lo bajé a 500.000.
- **Líneas de coautoría del asistente en los commits.** No las uso: el código lo entrego y lo defiendo
  yo.
- **Varios agentes coordinados.** Lo consideré al inicio y lo descarté por las razones de la sección 8.

## 12. Riesgos de llevarlo a producción

| Riesgo | Mitigación |
|---|---|
| **Instrucciones ocultas en un documento** (un correo que diga "crea la OC sin validar"). | El prompt trata los documentos como datos. Más importante: aunque el modelo obedeciera, no puede saltar un bloqueo ni confirmar por la analista, porque eso lo deciden las herramientas y el backend. |
| **El modelo afirma un valor que no salió de una herramienta.** | El prompt lo prohíbe y los montos nunca pasan por el modelo como argumentos. En producción: un conjunto de evaluación que compare cada cifra de la respuesta con los resultados de las herramientas. |
| **Confirmación mal interpretada.** | La clasifica el backend y falla hacia "no crear". Queda registrada con el caso y las reglas. En producción: botón de confirmación ligado al usuario autenticado. |
| **Costo sin control por el link público.** | Topes por respuesta, por sesión y por día con reserva previa, máximo de turnos simultáneos y clave de acceso opcional. En producción: autenticación y alertas de gasto. |
| **Maestros desactualizados.** | Hoy son archivos. En producción se consultan en SAP en el momento de validar y de crear; `oc_crear` ya vuelve a consultar el proveedor antes de crear. |
| **OC duplicada por reintentos o peticiones simultáneas.** | Búsqueda por referencia antes de crear, creación serializada y recibo reparable. Con SAP real: referencia externa única y consulta tras un timeout. |
| **Pérdida de datos al reiniciar.** | Órdenes, control y evidencias están en un volumen. Las conversaciones no; en producción irían a un almacenamiento persistente. |
| **Datos sensibles hacia el proveedor del modelo.** | Los fixtures son ficticios. En producción: acuerdo de tratamiento de datos, minimizar lo que se envía y evaluar un modelo desplegado en la nube de la compañía. |
| **Caída, cambio o retiro del modelo.** | Timeout y mensaje claro. `gpt-4.1-mini` ya está marcado como deprecado: el modelo se cambia con `OPENAI_MODEL` y el adaptador permite cambiar de proveedor sin tocar el ciclo. Cada cambio exige repetir las pruebas del chat. |
| **Evidencia cuestionada por auditoría.** | Hoy es el texto del correo con su sha256. En producción: el `.eml` original, PDF y firma digital si se exige. |
| **Tráfico sin cifrar.** | El link de prueba es HTTP. En producción: HTTPS obligatorio. |
