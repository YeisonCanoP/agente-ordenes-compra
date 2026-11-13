# Agente de órdenes de compra

Agente conversacional que prepara y crea órdenes de compra (OC) en un SAP simulado. Lee el paquete de
una solicitud (correo, solicitud, cotización, aprobación y factura), lo valida contra los maestros,
arma la OC, genera la evidencia de aprobación y la crea. Si algo requiere una decisión, pregunta antes
de crear y solo procede con una confirmación explícita de la analista.

Reto técnico 03 · Periferia IT Group. El planteamiento completo está en [SOLUCION.md](SOLUCION.md).

## Link de prueba

**<http://100.51.72.179>** (EC2 en AWS con IP elástica, HTTP en el puerto 80).

El chat está protegido: al enviar el primer mensaje pide una clave de acceso.

Clave de acceso: **`pruebaPeriferia`**

Además de la clave, el gasto está acotado por topes de tokens
(ver [Variables de entorno](#variables-de-entorno)).

## Levantar en local

Requisitos: [Bun](https://bun.sh) 1.2 o superior y una clave de OpenAI.

```bash
cp .env.example .env        # y completa OPENAI_API_KEY
bun install && bun run dev
```

Abre <http://localhost:3000>. Un solo proceso sirve la API y el front.

Con Docker, también en un comando:

```bash
docker compose up -d --build
```

## Verificar sin modelo

`demo.ts` procesa los 6 casos llamando directamente a las herramientas. No necesita clave de ningún
proveedor y limpia `out/` al empezar.

```bash
bun install && bun run demo.ts
```

Resultado esperado:

| Caso | Resultado |
|---|---|
| sol-001 | OC creada `4500000001`; la segunda ejecución devuelve la misma (`idempotente: true`) |
| sol-002 | Bloqueada por RC1: el proveedor no existe en el maestro |
| sol-003 | Bloqueada por RC2: quien aprueba no es aprobador del centro de costo |
| sol-004 | Pendiente por RC5 (cotización 6 % mayor); tras la confirmación explícita, OC `4500000002` |
| sol-005 | Pendiente por RC8: OC retroactiva, marcada `retroactiva = true` en el control |
| sol-006 | Pendiente por RC6; NIT, IVA y condiciones de pago completados desde el maestro |

Otros comandos:

| Comando | Qué hace |
|---|---|
| `bun test` | 62 pruebas: casos, ciclo del agente, API, sesiones y módulo. Sin clave. |
| `bun run typecheck` | TypeScript en modo estricto, sin `any`. |
| `bun run chat` | Chat de terminal contra el modelo real (necesita la clave). |
| `bun run build:modulo` | Regenera `modulo/` desde los archivos de la aplicación. |

## Variables de entorno

Se leen de `.env` (Bun lo carga solo). La clave del modelo vive únicamente en el backend: no aparece en
el front, en los logs ni en las respuestas de la API.

| Variable | Por defecto | Para qué |
|---|---|---|
| `OPENAI_API_KEY` | — | **Obligatoria para el chat.** `demo.ts` y los tests no la usan. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Modelo de OpenAI. |
| `LLM_TIMEOUT_MS` | `60000` | Tiempo máximo de espera por respuesta del modelo. |
| `MAX_TOKENS_RESPUESTA` | `4000` | Tope de tokens de salida por respuesta. |
| `MAX_ITERACIONES` | `25` | Tope de iteraciones herramienta → modelo por turno (CA1). |
| `MAX_TOKENS_SESION` | `300000` | Tope de tokens por sesión de chat. |
| `MAX_TOKENS_DIA` | `500000` | Tope global de tokens por día, sumando todas las sesiones. |
| `MAX_TURNOS_SIMULTANEOS` | `3` | Conversaciones que pueden esperar al modelo a la vez. |
| `MAX_SESIONES` | `50` | Sesiones que el servidor conserva en memoria. |
| `ACCESS_KEY` | — | Opcional. Si se define, el chat pide esa clave antes de conversar. |
| `PORT` | `3000` | Puerto del servidor HTTP. |

## API

| Método | Ruta | Cuerpo → respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message, stream? }` → `{ reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | → `{ sessionId, historial[], tokens, needsConfirmation }` |
| `GET` | `/api/health` | → `{ ok: true, provider, model, protegido }` (sin claves) |

- `sessionId`: 8 a 64 caracteres (letras, números, `-` o `_`). Lo genera el front.
- `message`: hasta 4000 caracteres.
- Con `stream: true` la respuesta es NDJSON: una línea `{"tipo":"herramienta","llamada":{…}}` por cada
  llamada a herramienta y una final `{"tipo":"final","reply":…,"toolCalls":[…],"needsConfirmation":…}`.
- Cada elemento de `toolCalls` trae `nombre`, `argumentos`, `ok`, `resumen` y `resultado`.
- Si `ACCESS_KEY` está definida, `/api/chat` y `/api/sessions/:id` exigen la cabecera `x-clave-acceso`.
- Errores: `400` cuerpo inválido · `401` falta la clave de acceso · `404` sesión o ruta inexistente ·
  `409` la sesión ya procesa un mensaje · `429` tope diario agotado · `503` máximo de turnos simultáneos.
  Siempre con `{ "error": "mensaje claro" }`.

Ejemplo:

```bash
curl -s localhost:3000/api/chat -H 'Content-Type: application/json' \
  -d '{"sessionId":"prueba-0001","message":"Procesa la solicitud \"sol-004\""}'
```

## Estructura

```
agent/prompt.md                  comportamiento: system prompt del agente
src/knowledge/ordenes-compra.md  conocimiento: el proceso y las reglas en lenguaje natural
src/tools/oc.ts                  ejecución: las herramientas oc_* (zod), importables sin el servidor
src/dominio/                     lógica pura: esquemas, lectura del paquete, reglas RC1–RC10, payload,
                                 evidencia y log de control
src/sap/                         interfaz SapAdapter y SAP simulado sobre out/sap/
src/llm/                         interfaz LlmAdapter y la implementación de OpenAI
src/agent/                       ciclo del agente, confirmación humana, enlace de resultados, sesiones
src/http/                        API del chat, archivos del front y tope diario
src/server.ts                    arranque del servidor
web/                             front de chat (HTML, CSS y JS planos, sin build)
modulo/                          agente empaquetado para otras plataformas (generado)
fixtures/                        casos y maestros entregados por Periferia (solo lectura)
demo.ts                          verificación sin modelo
tests/                           pruebas con bun test
out/                             se genera al ejecutar; no se versiona
```

Lo que el agente escribe en `out/`:

| Archivo | Contenido |
|---|---|
| `out/sap/ordenes.jsonl` | Órdenes creadas en el SAP simulado, numeradas desde `4500000001`. |
| `out/control.csv` | Una fila por intento: creada, existente, pendiente o bloqueada, con la marca `retroactiva`. |
| `out/log.jsonl` | Cada llamada a herramienta y cada confirmación explícita de la analista. |
| `out/<caso>/trazabilidad.json` | Fuente de cada valor de la OC. |
| `out/<caso>/aprobacion.txt` | Evidencia de aprobación con su sha256. |
| `out/<caso>/orden.json` | Recibo de la OC creada. |

## Despliegue en un servidor

La imagen se construye en local y se envía al servidor, que solo necesita Docker:

```bash
docker build -t agente-oc .
docker save agente-oc | gzip | ssh ec2-user@<servidor> 'gunzip | docker load'
```

En el servidor, con un archivo `.env` que contenga `OPENAI_API_KEY`:

```bash
docker run -d --name agente-oc --restart unless-stopped -p 80:3000 \
  --env-file .env -v agente-oc-datos:/app/out agente-oc
```

El volumen conserva las órdenes, las evidencias y los logs entre despliegues. Las conversaciones viven
en memoria y se pierden al reiniciar el proceso.

## Módulo reutilizable

`modulo/` contiene el agente empaquetado para integrarlo en otra plataforma de agentes, sin este
servidor:

| Archivo | Origen |
|---|---|
| `modulo/agent.md` | `agent/prompt.md` más el frontmatter (`mode: primary`, sin permiso de edición ni de shell) |
| `modulo/tools/oc.ts` | `src/tools/oc.ts` y sus dependencias en un solo archivo (requiere `zod` v4) |
| `modulo/skill/ordenes-compra/SKILL.md` | `src/knowledge/ordenes-compra.md` más el frontmatter |

Los tres se generan con `bun run build:modulo`, y `tests/modulo.test.ts` falla si alguno queda
desactualizado respecto de la aplicación.
