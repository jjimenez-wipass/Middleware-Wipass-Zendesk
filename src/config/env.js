function stripTrailingSlash(value) {
  return value ? value.replace(/\/+$/, "") : "";
}

function parsePort(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

function parseRetryDelays(value) {
  if (!value) {
    return [500, 1000, 2000];
  }

  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part) && part >= 0);
}

function buildZendeskApiBaseUrl(source) {
  if (source.ZENDESK_API_BASE_URL) {
    return stripTrailingSlash(source.ZENDESK_API_BASE_URL);
  }

  if (!source.ZENDESK_SUBDOMAIN) {
    return "";
  }

  return `https://${source.ZENDESK_SUBDOMAIN}.zendesk.com`;
}

function buildEnv(overrides = {}) {
  const source = { ...process.env, ...overrides };

  return {
    nodeEnv: source.NODE_ENV || "development",
    port: parsePort(source.PORT),
    logLevel: source.LOG_LEVEL || "info",
    retryDelaysMs: parseRetryDelays(source.HTTP_RETRY_DELAYS_MS),
    hubspotWebhookSecret: source.HUBSPOT_WEBHOOK_SECRET || "",
    hubspotAccessToken: source.HUBSPOT_ACCESS_TOKEN || "",
    hubspotApiBaseUrl: stripTrailingSlash(source.HUBSPOT_API_BASE_URL || "https://api.hubapi.com"),
    hubspotOnboardingPipelineId: source.HUBSPOT_ONBOARDING_PIPELINE_ID || "",
    hubspotStageIds: {
      start: source.HUBSPOT_STAGE_ID_START || "",
      blocked: source.HUBSPOT_STAGE_ID_BLOCKED || "",
      completed: source.HUBSPOT_STAGE_ID_COMPLETED || ""
    },
    hubspotSignatureMaxAgeMs: Number(source.HUBSPOT_SIGNATURE_MAX_AGE_MS) || 300000,
    zendeskSubdomain: source.ZENDESK_SUBDOMAIN || "",
    zendeskEmail: source.ZENDESK_EMAIL || "",
    zendeskApiToken: source.ZENDESK_API_TOKEN || "",
    zendeskApiBaseUrl: buildZendeskApiBaseUrl(source),
    zendeskOnboardingTicketTag: source.ZENDESK_ONBOARDING_TICKET_TAG || "hubspot_onboarding"
  };
}

module.exports = { buildEnv };
