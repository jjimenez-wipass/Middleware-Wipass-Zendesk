# Middleware Zendesk - Ticketing

## ¿Qué es esto?

Este proyecto es un **intermediario** (middleware) que conecta diferentes herramientas que usamos en Wipass: Zendesk (soporte), HubSpot (CRM), WhatsApp, Ringover (teléfono) y otros sistemas internos.

Su función es sencilla: **cuando algo pasa en una herramienta, este sistema se entera y avisa o actualiza las demás de forma automática**. Por ejemplo, si un cliente manda un WhatsApp, el middleware crea o actualiza el ticket en Zendesk sin que nadie tenga que hacerlo manualmente.

No guarda datos propios ni toma decisiones de negocio — solo escucha, transforma y reenvía la información entre sistemas.

---

## ¿Quién debería leer esto?

- **Equipo de Producto**: para entender qué integraciones existen y cuáles están planificadas.
- **Equipo de Soporte**: para saber qué ocurre automáticamente y qué sigue siendo manual.
- **Equipo técnico**: para desarrollar, mantener y ampliar las integraciones.

---

## ¿Cómo se pone en marcha? (para el equipo técnico)

> Necesitas tener instalado [Node.js](https://nodejs.org) en tu máquina.

1. **Instalar dependencias** (solo la primera vez):
   ```bash
   npm install
   ```
2. **Ejecutar en modo desarrollo** (con recarga automática al guardar cambios):
   ```bash
   npm run dev
   ```
3. **Ejecutar en producción**:
   ```bash
   npm start
   ```
4. **Ejecutar tests automáticos**:
   ```bash
   npm test
   ```

> Las credenciales y configuraciones de cada sistema van en un fichero `.env` (basado en `.env.example`). Nunca se sube al repositorio.

---

## Hoja de ruta del proyecto

### Fase 1 — Definición y diseño

> En esta fase se define **qué** vamos a construir, **por qué** y **cómo** antes de escribir código.

- [x] **1.1 Definir objetivos y alcance del middleware**

  **¿Para qué sirve este middleware?** Resuelve 3 problemas concretos:

  1. **WhatsApp + contactos** — Cuando un cliente escribe por WhatsApp, el sistema lo identifica automáticamente en HubSpot y Zendesk. Evita duplicados y errores manuales.
  2. **Llamadas telefónicas con Ringover** — Cuando un agente atiende una llamada, la información de esa llamada se registra automáticamente en el ticket de Zendesk correspondiente.
  3. **Onboarding automático** — Cuando un cliente avanza en su proceso de alta en HubSpot, se crean o actualizan tickets en Zendesk de forma automática según la fase en que se encuentre.

  **¿Qué NO hace este sistema?**
  - No recupera datos históricos del pasado (solo actúa sobre eventos que ocurren a partir de ahora).
  - No contiene lógica de negocio propia (las reglas viven en cada herramienta; este sistema solo mueve la información).

  **¿Quién está involucrado?**
  - Producto, Soporte

  **Herramientas conectadas:**
  - **Zendesk** — Sistema central de tickets y atención al cliente
  - **Wipass** — Sistema interno de Wipass
  - **WhatsApp** — Canal de mensajería de clientes
  - **Email** — Canal de comunicación por correo
  - **Ringover** — Canal telefónico
  - **HubSpot** — CRM: base de datos de contactos y seguimiento de clientes

- [x] **1.2 Análisis de eventos e integraciones**

  Un "evento" es cualquier cosa que ocurre en una herramienta y que este sistema debe detectar y procesar. Aquí están todos los que vamos a cubrir:

  **Lo que se construye primero (MVP):**
  - [x] Un cliente escribe por WhatsApp → el sistema identifica quién es (HubSpot/Zendesk) y crea o vincula su ticket
  - [x] Una llamada de Ringover termina → se añade una nota automática al ticket en Zendesk
  - [x] Se crea o actualiza un ticket en Zendesk → Wipass recibe la notificación

  **Lo que vendrá después (fases futuras):**
  - [ ] Un cliente cambia de etapa en su onboarding en HubSpot → se crea automáticamente un ticket en Zendesk
  - [ ] Sincronización de contactos en ambos sentidos entre HubSpot y Zendesk
  - [ ] Los emails entrantes se procesan también como eventos independientes

  **¿De dónde viene cada evento y a dónde va?**

  | ¿Qué ocurre? | Viene de | Va hacia |
  |---|---|---|
  | Mensaje de WhatsApp entrante | WhatsApp | Zendesk + HubSpot |
  | Llamada telefónica completada | Ringover | Zendesk |
  | Ticket creado o actualizado | Zendesk | Wipass |
  | Cambio de etapa de onboarding (futuro) | HubSpot | Zendesk |

  **Requisitos técnicos por herramienta** *(para el equipo de desarrollo)*:
  - **Zendesk**: autenticación por token — hasta ~700 llamadas por minuto — se identifica cada ticket por su `ticket_id`
  - **WhatsApp**: validación de firma del webhook — sin límite propio (depende del proveedor)
  - **Ringover**: clave de API — pendiente de confirmar con el equipo
  - **HubSpot**: OAuth2 o clave de API (pendiente de definir) — hasta ~100 llamadas cada 10 segundos
  - **Wipass**: método de autenticación pendiente de definir con el equipo
  - **Política común ante fallos**: si una llamada a un sistema falla, se reintenta hasta 3 veces con espera progresiva entre intentos (0.5s → 1s → 2s)

- [x] **1.3 Diseño del flujo de datos de extremo a extremo**

  Todo evento sigue el mismo recorrido interno:

  ```
  Sistema externo → Webhook (POST) → Validación → Handler → Servicio → Sistema destino
  ```

  **Detalle por integración:**

  | Evento | Entrada | Pasos | Salida |
  |---|---|---|---|
  | Mensaje WhatsApp | Webhook WhatsApp | Validar firma → buscar contacto en HubSpot → buscar o crear ticket | Zendesk + HubSpot |
  | Llamada Ringover completada | Webhook Ringover | Validar clave → buscar ticket activo → añadir nota | Zendesk |
  | Ticket creado/actualizado | Webhook Zendesk | Validar token → transformar payload | Wipass |

  **Gestión de errores:**
  - Si la validación de entrada falla → respuesta `400` inmediata, sin procesar.
  - Si el sistema de destino no está disponible → reintentos automáticos (hasta 3 veces: 0.5 s → 1 s → 2 s).
  - Si los reintentos se agotan → se registra el error con todos los detalles y se responde `200` al origen (para evitar reenvíos en bucle desde el sistema externo).

- [x] **1.4 Definición de los datos que se intercambian**

  **Mensajes entrantes (webhooks)**

  Cada sistema externo envía su propio formato. El middleware lo recibe tal cual y lo normaliza internamente antes de procesarlo. Los webhooks llegan siempre como `POST` con `Content-Type: application/json` y un tamaño máximo de 1 MB.

  **Modelo de datos interno**

  Dentro del middleware, cualquier evento se representa con esta estructura mínima:

  ```json
  {
    "eventType": "whatsapp.message | ringover.call | zendesk.ticket",
    "source":    "whatsapp | ringover | zendesk",
    "requestId": "<uuid propagado desde la cabecera x-request-id>",
    "timestamp": "<ISO 8601>",
    "payload":   { }
  }
  ```

  El campo `payload` contiene los datos originales ya normalizados (p. ej. `ticketId`, `contactPhone`, `callDuration`).

  **Mensajes salientes**

  El middleware llama a las APIs de destino usando el formato que cada una requiere (REST/JSON). No define un formato propio de salida; sigue el contrato de cada API.

- [x] **1.5 Decisiones técnicas**

  **¿Por qué Node.js + Express?**
  - El trabajo es casi exclusivamente de entrada/salida (llamadas HTTP entre APIs): Node.js es óptimo para eso.
  - El equipo ya conoce el stack; reduce la curva de aprendizaje y el tiempo de entrega.
  - Express es ligero y suficiente para un middleware sin interfaz de usuario.

  **¿Dónde se despliega y cómo se protege?**
  - Se expone un único endpoint público por tipo de evento (`/webhooks/whatsapp`, `/webhooks/ringover`, etc.).
  - Cada petición entrante se valida con el mecanismo propio del sistema remitente (firma HMAC para WhatsApp, token para Zendesk, clave de API para Ringover).
  - Las cabeceras HTTP de seguridad las gestiona `helmet` automáticamente.
  - Todos los secretos (tokens, claves) van en variables de entorno (`.env`), nunca en el código.

  **¿Guarda datos el sistema?**
  - No tiene base de datos propia. No persiste información entre peticiones.
  - Si en el futuro fuera necesaria una cola de reintentos persistente, se añadiría como una dependencia externa explícita (p. ej. Redis o una cola de mensajes).

- [x] **1.6 Seguimiento y alertas**

  **Registro de operaciones**

  Cada petición genera un log estructurado en JSON (via `pino` + `pino-http`) con los campos mínimos:

  ```json
  {
    "level":     "info | warn | error",
    "requestId": "<valor de la cabecera x-request-id>",
    "eventType": "whatsapp.message | ...",
    "ticketId":  "<id si aplica>",
    "result":    "ok | retry | failed",
    "durationMs": 120
  }
  ```

  El nivel de log se controla con la variable de entorno `LOG_LEVEL` (por defecto `info`).

  **Clasificación de errores**

  | Nivel | Cuándo se usa |
  |---|---|
  | `info` | Evento procesado correctamente |
  | `warn` | Reintento en curso; dato esperado no encontrado |
  | `error` | Fallo definitivo tras agotar reintentos; excepción no controlada |

  **Alertas mínimas**
  - Cualquier log de nivel `error` debe generar una notificación al equipo técnico (canal a definir: email, Slack, etc.).
  - No se implementan métricas de rendimiento en esta fase; se revisan los logs ante incidencias concretas.

### Fase 2 — Base común del middleware

> Esta fase construye la infraestructura compartida sobre la que se apoyan **los 3 objetivos del proyecto**: onboarding, WhatsApp y Ringover.

- [x] **2.1 Arquitectura transversal**

  **Qué deja resuelto**
  - Patrón común `route -> auth/validation -> handler -> service`
  - Generación o propagación de `requestId`
  - Captura de `rawBody` para validar firmas
  - Configuración centralizada por variables de entorno
  - Logging estructurado con `pino` + `pino-http`
  - Cliente HTTP compartido con reintentos (`0.5 s -> 1 s -> 2 s`)
  - Gestión homogénea de errores de entrada y de servicios externos

- [x] **2.2 Estructura preparada para varios proveedores**

  **Objetivo de esta fase**
  - La base no está pensada solo para onboarding.
  - Debe servir para conectar después `HubSpot`, `WhatsApp` y `Ringover` sin reorganizar la aplicación.

  **Estado actual**
  - Endpoint activo: `GET /health`
  - Endpoint activo: `POST /webhooks/hubspot`
  - Endpoint placeholder: `POST /webhooks/whatsapp` -> responde `501 not_implemented`
  - Endpoint placeholder: `POST /webhooks/ringover` -> responde `501 not_implemented`
  - Registro central de proveedores para montar `HubSpot`, `WhatsApp` y `Ringover` sobre la misma infraestructura

- [x] **2.3 Seguridad y observabilidad comunes**

  **Criterios compartidos**
  - Validación por firma o token según el proveedor
  - Respuesta `400` para payloads inválidos
  - Reintentos automáticos en fallos transitorios
  - Logs con `requestId`, `eventType`, `ticketId`, `result` y `durationMs`

- [x] **2.4 Validación técnica mínima**

  **Cobertura automática ya implementada**
  - `GET /health`
  - Firma inválida de HubSpot -> `401`
  - Webhook placeholder de WhatsApp -> `501`
  - Webhook placeholder de Ringover -> `501`
  - Payload incompleto -> `400`
  - Evento no relevante -> `200` con resultado `ignored`
  - Reintentos agotados hacia Zendesk -> `200` al origen y log `error`

### Fase 3 — Automatización de onboarding (HubSpot -> Zendesk)

> Esta es la **primera capacidad de negocio ya implementada** sobre la base común del middleware.

- [x] **3.1 Flujo operativo de onboarding**

  **Qué hace hoy**
  - HubSpot actúa como sistema origen
  - Zendesk actúa como sistema destino por API
  - El middleware crea o actualiza un único ticket de onboarding por cliente usando el email como clave principal

- [x] **3.2 Hitos soportados**

  - `inicio` -> crea o actualiza el ticket y lo deja en `open`
  - `bloqueado` -> añade nota interna y mantiene el ticket en `open`
  - `completado` -> añade nota interna final y deja el ticket en `solved`

- [x] **3.3 Configuración de integración**

  **Variables activas**
  - `HUBSPOT_WEBHOOK_SECRET`
  - `HUBSPOT_ACCESS_TOKEN`
  - `HUBSPOT_ONBOARDING_PIPELINE_ID`
  - `HUBSPOT_STAGE_ID_START`
  - `HUBSPOT_STAGE_ID_BLOCKED`
  - `HUBSPOT_STAGE_ID_COMPLETED`
  - `ZENDESK_SUBDOMAIN`
  - `ZENDESK_EMAIL`
  - `ZENDESK_API_TOKEN`
  - `ZENDESK_ONBOARDING_TICKET_TAG`

- [x] **3.4 Contrato interno del evento**

  ```json
  {
    "eventType": "hubspot.onboarding.stage_changed",
    "source": "hubspot",
    "requestId": "<uuid>",
    "timestamp": "<ISO 8601>",
    "payload": {
      "contactEmail": "...",
      "contactName": "...",
      "pipelineId": "...",
      "stageId": "...",
      "stageType": "start | blocked | completed",
      "hubspotObjectId": "..."
    }
  }
  ```

### Fase 4 — WhatsApp + contactos + Zendesk

> Esta fase atacará el primer objetivo de negocio: identificar correctamente al cliente que escribe por WhatsApp y vincularlo con los contactos ya existentes.

**Estado actual**
- La ruta pública `POST /webhooks/whatsapp` ya existe como placeholder sobre la base común del middleware.

- [ ] **4.1 Webhook de WhatsApp**
  - Recibir mensajes entrantes
  - Validar firma del proveedor
  - Normalizar teléfono, texto, adjuntos y metadatos del canal

- [ ] **4.2 Identificación de cliente**
  - Buscar coincidencia contra contactos ya existentes
  - Priorizar contactos ya presentes en Zendesk
  - Resolver duplicidades con apoyo de HubSpot si aplica

- [ ] **4.3 Gestión de ticket en Zendesk**
  - Crear ticket si no existe uno activo
  - Vincular el mensaje al ticket correcto si ya existe
  - Evitar tickets duplicados por el mismo cliente/canal

### Fase 5 — Ringover + Zendesk

> Esta fase cubrirá el canal telefónico y la actualización de incidencias a partir de llamadas.

**Estado actual**
- La ruta pública `POST /webhooks/ringover` ya existe como placeholder sobre la base común del middleware.

- [ ] **5.1 Webhook o evento de Ringover**
  - Recibir la notificación de llamada
  - Validar autenticación de Ringover
  - Normalizar número, agente, duración y resultado

- [ ] **5.2 Vinculación con incidencias**
  - Localizar ticket o contacto asociado
  - Añadir nota o contexto al ticket correcto
  - Permitir actualizar incidencias existentes desde la actividad telefónica

- [ ] **5.3 Automatización del canal telefónico**
  - Reducir trabajo manual del equipo de soporte
  - Dejar trazabilidad de las llamadas dentro de Zendesk

### Fase 6 — Testing, estabilidad e iteración

> Cuando los 3 flujos estén montados sobre la base común, esta fase endurece el sistema de cara a operación real.

- [ ] **6.1 Testing end-to-end**
  - Validar flujos completos por canal
  - Revisar mappings, tiempos y trazabilidad

- [ ] **6.2 Estabilidad**
  - Reforzar logs, retries e idempotencia
  - Mejorar manejo de errores y timeouts
  - Revisar seguridad y sanitización de inputs

- [ ] **6.3 Iteración y mejoras**
  - Añadir nuevos eventos útiles
  - Ajustar arquitectura si aparecen cuellos de botella
  - Optimizar rendimiento y operativa
