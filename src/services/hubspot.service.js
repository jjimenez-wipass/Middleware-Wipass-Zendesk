const { AppError } = require("../utils/app-error");
const { requestJson } = require("../utils/http-client");

class HubSpotService {
  constructor({ env, logger, fetchImpl }) {
    this.env = env;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
  }

  async normalizeWebhook({ body, requestId, receivedAt }) {
    const sourceEvent = this.pickRelevantEvent(body);

    if (!sourceEvent) {
      return null;
    }

    const stageId = this.extractStageId(sourceEvent);
    const stageType = this.resolveStageType(stageId);

    if (!stageId || !stageType) {
      return null;
    }

    const contact = await this.resolveContact(sourceEvent);

    if (!contact.email) {
      throw new AppError(400, "HubSpot onboarding event is missing the contact email");
    }

    return {
      eventType: "hubspot.onboarding.stage_changed",
      source: "hubspot",
      requestId,
      timestamp: receivedAt,
      payload: {
        contactEmail: contact.email,
        contactName: contact.name,
        pipelineId: this.extractPipelineId(sourceEvent),
        stageId,
        stageType,
        hubspotObjectId: this.extractObjectId(sourceEvent)
      }
    };
  }

  pickRelevantEvent(body) {
    if (Array.isArray(body)) {
      const matchingEvent = body.find((candidate) => this.resolveStageType(this.extractStageId(candidate)));
      return matchingEvent || null;
    }

    if (body && typeof body === "object") {
      if (body.payload && typeof body.payload === "object") {
        const stageId = this.extractStageId(body.payload);
        const hasResolvableContact = Boolean(
          body.payload.contactEmail || body.payload.email || body.payload.hubspotObjectId || body.payload.objectId
        );

        if (!stageId || !hasResolvableContact) {
          throw new AppError(400, "HubSpot onboarding payload is missing required fields");
        }

        return body;
      }

      if ("objectId" in body || "propertyValue" in body || "stageId" in body) {
        return body;
      }
    }

    throw new AppError(400, "HubSpot webhook payload format is not supported");
  }

  extractStageId(sourceEvent) {
    if (!sourceEvent || typeof sourceEvent !== "object") {
      return "";
    }

    if (sourceEvent.payload && sourceEvent.payload.stageId) {
      return String(sourceEvent.payload.stageId);
    }

    if (sourceEvent.stageId) {
      return String(sourceEvent.stageId);
    }

    if (sourceEvent.propertyValue) {
      return String(sourceEvent.propertyValue);
    }

    return "";
  }

  extractPipelineId(sourceEvent) {
    const explicitPipelineId =
      sourceEvent?.payload?.pipelineId || sourceEvent?.pipelineId || this.env.hubspotOnboardingPipelineId;

    return explicitPipelineId ? String(explicitPipelineId) : "";
  }

  extractObjectId(sourceEvent) {
    const objectId = sourceEvent?.payload?.hubspotObjectId || sourceEvent?.hubspotObjectId || sourceEvent?.objectId;
    return objectId ? String(objectId) : "";
  }

  resolveStageType(stageId) {
    const stage = String(stageId || "");

    if (!stage) {
      return "";
    }

    const { start, blocked, completed } = this.env.hubspotStageIds;

    if (stage === start) {
      return "start";
    }

    if (stage === blocked) {
      return "blocked";
    }

    if (stage === completed) {
      return "completed";
    }

    return "";
  }

  async resolveContact(sourceEvent) {
    const payload = sourceEvent.payload || sourceEvent;
    const directEmail = payload.contactEmail || payload.email;

    if (directEmail) {
      return {
        email: String(directEmail).trim(),
        name: this.resolveContactName(payload)
      };
    }

    const objectId = this.extractObjectId(sourceEvent);

    if (!objectId) {
      throw new AppError(400, "HubSpot onboarding event is missing the contact identifier");
    }

    if (!this.env.hubspotAccessToken) {
      throw new AppError(
        500,
        "HubSpot access token is required to hydrate contacts from webhook events that do not include email"
      );
    }

    const contact = await requestJson({
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      retryDelaysMs: this.env.retryDelaysMs,
      url: `${this.env.hubspotApiBaseUrl}/crm/v3/objects/contacts/${encodeURIComponent(objectId)}?properties=email,firstname,lastname`,
      headers: {
        Authorization: `Bearer ${this.env.hubspotAccessToken}`
      },
      operationName: "hubspot.get_contact",
      context: {
        objectId
      }
    });

    const properties = contact.properties || {};
    const email = properties.email ? String(properties.email).trim() : "";

    return {
      email,
      name: this.resolveContactName({
        firstName: properties.firstname,
        lastname: properties.lastname,
        email
      })
    };
  }

  resolveContactName(payload) {
    if (payload.contactName) {
      return String(payload.contactName).trim();
    }

    const parts = [payload.firstName || payload.firstname, payload.lastName || payload.lastname]
      .map((part) => String(part || "").trim())
      .filter(Boolean);

    return parts.join(" ").trim();
  }
}

module.exports = { HubSpotService };
