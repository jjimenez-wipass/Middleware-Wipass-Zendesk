const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const http = require("node:http");
const test = require("node:test");

const pino = require("pino");

const { createApp } = require("../src/app");

const DEFAULT_ENV = {
  LOG_LEVEL: "silent",
  HUBSPOT_WEBHOOK_SECRET: "hubspot-secret",
  HUBSPOT_ACCESS_TOKEN: "hubspot-access-token",
  HUBSPOT_ONBOARDING_PIPELINE_ID: "pipeline-1",
  HUBSPOT_STAGE_ID_START: "stage-start",
  HUBSPOT_STAGE_ID_BLOCKED: "stage-blocked",
  HUBSPOT_STAGE_ID_COMPLETED: "stage-completed",
  ZENDESK_SUBDOMAIN: "wipass-test",
  ZENDESK_EMAIL: "agent@wipass.test",
  ZENDESK_API_TOKEN: "zendesk-api-token",
  ZENDESK_ONBOARDING_TICKET_TAG: "hubspot_onboarding",
  HTTP_RETRY_DELAYS_MS: "1,1,1"
};

test("GET /health returns service status", async (t) => {
  const harness = await createHarness(t);
  const response = await fetch(`${harness.appUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "middleware-zendesk"
  });
});

test("POST /webhooks/hubspot rejects invalid signatures", async (t) => {
  const harness = await createHarness(t);
  const response = await postHubSpotWebhook(harness.appUrl, DEFAULT_ENV.HUBSPOT_WEBHOOK_SECRET, {
    payload: {
      contactEmail: "ana@wipass.test",
      stageId: DEFAULT_ENV.HUBSPOT_STAGE_ID_START
    }
  }, {
    "x-hubspot-signature-v3": "invalid-signature"
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "HubSpot webhook signature is invalid");
});

test("POST /webhooks/whatsapp returns a provider placeholder response", async (t) => {
  const harness = await createHarness(t);
  const response = await postWebhook(`${harness.appUrl}/webhooks/whatsapp`, {
    message: "hola"
  });

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    status: "not_implemented",
    provider: "whatsapp",
    requestId: response.headers.get("x-request-id")
  });
});

test("POST /webhooks/ringover returns a provider placeholder response", async (t) => {
  const harness = await createHarness(t);
  const response = await postWebhook(`${harness.appUrl}/webhooks/ringover`, {
    callId: "call-1"
  });

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    status: "not_implemented",
    provider: "ringover",
    requestId: response.headers.get("x-request-id")
  });
});

test("POST /webhooks/hubspot returns 400 for incomplete normalized payloads", async (t) => {
  const harness = await createHarness(t);
  const response = await postHubSpotWebhook(harness.appUrl, DEFAULT_ENV.HUBSPOT_WEBHOOK_SECRET, {
    payload: {
      contactEmail: "ana@wipass.test"
    }
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "HubSpot onboarding payload is missing required fields");
});

test("POST /webhooks/hubspot ignores non-configured onboarding stages", async (t) => {
  const harness = await createHarness(t);
  const response = await postHubSpotWebhook(harness.appUrl, DEFAULT_ENV.HUBSPOT_WEBHOOK_SECRET, [
    {
      objectId: "123",
      propertyValue: "stage-other"
    }
  ]);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ignored",
    requestId: response.headers.get("x-request-id")
  });
  assert.equal(harness.platform.state.tickets.length, 0);
});

test("POST /webhooks/hubspot creates and updates a single onboarding ticket across milestones", async (t) => {
  const harness = await createHarness(t);

  const started = await postHubSpotWebhook(harness.appUrl, DEFAULT_ENV.HUBSPOT_WEBHOOK_SECRET, [
    {
      objectId: "123",
      propertyValue: DEFAULT_ENV.HUBSPOT_STAGE_ID_START
    }
  ]);

  assert.equal(started.status, 200);
  const createdPayload = await started.json();
  assert.equal(createdPayload.status, "ok");
  assert.equal(createdPayload.action, "created");
  assert.ok(started.headers.get("x-request-id"));

  const blocked = await postHubSpotWebhook(harness.appUrl, DEFAULT_ENV.HUBSPOT_WEBHOOK_SECRET, [
    {
      objectId: "123",
      propertyValue: DEFAULT_ENV.HUBSPOT_STAGE_ID_BLOCKED
    }
  ]);

  assert.equal(blocked.status, 200);
  assert.equal((await blocked.json()).action, "updated");

  const completed = await postHubSpotWebhook(harness.appUrl, DEFAULT_ENV.HUBSPOT_WEBHOOK_SECRET, [
    {
      objectId: "123",
      propertyValue: DEFAULT_ENV.HUBSPOT_STAGE_ID_COMPLETED
    }
  ]);

  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).action, "updated");

  assert.equal(harness.platform.state.tickets.length, 1);

  const [ticket] = harness.platform.state.tickets;
  assert.equal(ticket.requester.email, "ana@wipass.test");
  assert.equal(ticket.status, "solved");
  assert.equal(ticket.comments.length, 3);
  assert.deepEqual(ticket.tags, ["hubspot_onboarding"]);
});

test("POST /webhooks/hubspot responds 200 after exhausting Zendesk retries", async (t) => {
  const harness = await createHarness(t);
  harness.platform.failures.set("POST /api/v2/tickets.json", {
    remaining: 4,
    status: 500
  });

  const response = await postHubSpotWebhook(harness.appUrl, DEFAULT_ENV.HUBSPOT_WEBHOOK_SECRET, [
    {
      objectId: "123",
      propertyValue: DEFAULT_ENV.HUBSPOT_STAGE_ID_START
    }
  ]);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "accepted_with_error",
    requestId: response.headers.get("x-request-id")
  });
  assert.equal(harness.platform.callCounts.get("POST /api/v2/tickets.json"), 4);
});

async function createHarness(t, envOverrides = {}) {
  const platform = await createPlatformMock();
  const logger = pino({ level: "silent" });
  const env = {
    ...DEFAULT_ENV,
    HUBSPOT_API_BASE_URL: platform.baseUrl,
    ZENDESK_API_BASE_URL: platform.baseUrl,
    ...envOverrides
  };

  const { app } = createApp({ env, logger });
  const server = http.createServer(app);
  await startServer(server);

  const appPort = server.address().port;
  const appUrl = `http://127.0.0.1:${appPort}`;

  t.after(async () => {
    await closeServer(server);
    await platform.close();
  });

  return { appUrl, platform };
}

async function createPlatformMock() {
  const state = {
    contacts: new Map([
      [
        "123",
        {
          email: "ana@wipass.test",
          firstname: "Ana",
          lastname: "Cliente"
        }
      ]
    ]),
    tickets: [],
    nextTicketId: 1
  };
  const failures = new Map();
  const callCounts = new Map();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const routeKey = `${req.method} ${url.pathname}`;

    callCounts.set(routeKey, (callCounts.get(routeKey) || 0) + 1);

    const configuredFailure = failures.get(routeKey);

    if (configuredFailure && configuredFailure.remaining > 0) {
      configuredFailure.remaining -= 1;
      writeJson(res, configuredFailure.status, { error: "mock failure" });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/crm/v3/objects/contacts/")) {
      const contactId = url.pathname.split("/").pop();
      const contact = state.contacts.get(contactId);

      if (!contact) {
        writeJson(res, 404, { message: "Not found" });
        return;
      }

      writeJson(res, 200, {
        id: contactId,
        properties: contact
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v2/search.json") {
      const query = url.searchParams.get("query") || "";
      const requesterMatch = query.match(/requester:([^\s]+)/);
      const tagMatch = query.match(/tags:([^\s]+)/);

      const requesterEmail = requesterMatch ? requesterMatch[1] : "";
      const ticketTag = tagMatch ? tagMatch[1] : "";

      const results = state.tickets.filter((ticket) => {
        const activeStatus = ticket.status !== "solved" && ticket.status !== "closed";
        return ticket.requester.email === requesterEmail && ticket.tags.includes(ticketTag) && activeStatus;
      });

      writeJson(res, 200, { results });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v2/tickets.json") {
      const payload = await readJson(req);
      const createdAt = new Date().toISOString();
      const ticket = {
        id: state.nextTicketId,
        subject: payload.ticket.subject,
        requester: payload.ticket.requester,
        status: payload.ticket.status,
        tags: [...(payload.ticket.tags || [])],
        comments: [payload.ticket.comment],
        updated_at: createdAt
      };

      state.nextTicketId += 1;
      state.tickets.push(ticket);

      writeJson(res, 201, { ticket });
      return;
    }

    if (req.method === "PUT" && /^\/api\/v2\/tickets\/\d+\.json$/.test(url.pathname)) {
      const ticketId = Number(url.pathname.match(/\/tickets\/(\d+)\.json$/)[1]);
      const ticket = state.tickets.find((candidate) => candidate.id === ticketId);

      if (!ticket) {
        writeJson(res, 404, { message: "Not found" });
        return;
      }

      const payload = await readJson(req);

      ticket.status = payload.ticket.status;
      ticket.comments.push(payload.ticket.comment);
      ticket.updated_at = new Date().toISOString();

      writeJson(res, 200, { ticket });
      return;
    }

    if (req.method === "PUT" && /^\/api\/v2\/tickets\/\d+\/tags\.json$/.test(url.pathname)) {
      const ticketId = Number(url.pathname.match(/\/tickets\/(\d+)\/tags\.json$/)[1]);
      const ticket = state.tickets.find((candidate) => candidate.id === ticketId);

      if (!ticket) {
        writeJson(res, 404, { message: "Not found" });
        return;
      }

      const payload = await readJson(req);
      ticket.tags = [...new Set([...(ticket.tags || []), ...(payload.tags || [])])];
      ticket.updated_at = new Date().toISOString();

      writeJson(res, 200, { tags: ticket.tags });
      return;
    }

    writeJson(res, 404, { message: "Not found" });
  });

  await startServer(server);

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    state,
    failures,
    callCounts,
    close: () => closeServer(server)
  };
}

async function postHubSpotWebhook(appUrl, secret, body, headerOverrides = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = Date.now().toString();
  const url = `${appUrl}/webhooks/hubspot`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`POST${url}${rawBody}${timestamp}`, "utf8")
    .digest("base64");

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hubspot-request-timestamp": timestamp,
      "x-hubspot-signature-v3": signature,
      ...headerOverrides
    },
    body: rawBody
  });
}

function postWebhook(url, body, headerOverrides = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headerOverrides
    },
    body: JSON.stringify(body)
  });
}

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function startServer(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
