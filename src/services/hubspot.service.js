const { AppError } = require("../utils/app-error");
const { requestJson } = require("../utils/http-client");

class HubSpotService {
  constructor({ env, logger, fetchImpl }) {
    this.env = env;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
  }

  async normalizeWebhook({ body, requestId, receivedAt }) {
    const sourceEvents = this.extractSourceEvents(body);

    for (const sourceEvent of sourceEvents) {
      const normalizedEvent = await this.normalizeSourceEvent({
        sourceEvent,
        requestId,
        receivedAt
      });

      if (normalizedEvent) {
        return normalizedEvent;
      }
    }

    return null;
  }

  extractSourceEvents(body) {
    if (Array.isArray(body)) {
      return body;
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

        return [body];
      }

      if ("objectId" in body || "propertyValue" in body || "stageId" in body) {
        return [body];
      }
    }

    throw new AppError(400, "HubSpot webhook payload format is not supported");
  }

  async normalizeSourceEvent({ sourceEvent, requestId, receivedAt }) {
    const stageId = this.extractStageId(sourceEvent);
    const stageType = this.resolveStageType(stageId);

    if (!stageId || !stageType) {
      return null;
    }

    const eventContext = await this.resolveEventContext(sourceEvent);

    if (!eventContext) {
      return null;
    }

    const contact = await this.resolveContact(sourceEvent, eventContext);

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
        pipelineId: eventContext.pipelineId,
        stageId,
        stageType,
        hubspotObjectId: eventContext.hubspotObjectId
      }
    };
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

  async resolveEventContext(sourceEvent) {
    const payload = sourceEvent.payload || sourceEvent;
    const explicitPipelineId = this.extractPipelineId(sourceEvent);
    const hubspotObjectId = this.extractObjectId(sourceEvent);
    const isDirectPayload = Boolean(payload.contactEmail || payload.email);
    const isDealStageChangeEvent = this.isDealStageChangeEvent(sourceEvent);

    if (isDirectPayload && !isDealStageChangeEvent) {
      return {
        pipelineId: explicitPipelineId,
        hubspotObjectId
      };
    }

    if (!hubspotObjectId) {
      return {
        pipelineId: explicitPipelineId,
        hubspotObjectId: ""
      };
    }

    const deal = await this.fetchDeal(hubspotObjectId);
    const pipelineId = String(deal.properties?.pipeline || explicitPipelineId || "");

    if (!pipelineId) {
      throw new AppError(400, "HubSpot deal event is missing the pipeline identifier");
    }

    if (this.env.hubspotOnboardingPipelineId && pipelineId !== this.env.hubspotOnboardingPipelineId) {
      return null;
    }

    const contactIds = this.extractAssociatedContactIds(deal);
    const primaryContactId = await this.resolvePrimaryContactIdForDeal(hubspotObjectId, contactIds);

    return {
      pipelineId,
      hubspotObjectId: String(deal.id || hubspotObjectId),
      primaryContactId
    };
  }

  isDealStageChangeEvent(sourceEvent) {
    const payload = sourceEvent?.payload || sourceEvent;
    return payload?.propertyName === "dealstage";
  }

  async resolveContact(sourceEvent, eventContext = {}) {
    const payload = sourceEvent.payload || sourceEvent;
    const directEmail = payload.contactEmail || payload.email;

    if (directEmail) {
      return {
        email: String(directEmail).trim(),
        name: this.resolveContactName(payload)
      };
    }

    const objectId = eventContext.primaryContactId || this.extractObjectId(sourceEvent);

    if (!objectId) {
      throw new AppError(400, "HubSpot onboarding event is missing the contact identifier");
    }

    if (!this.env.hubspotAccessToken) {
      throw new AppError(
        500,
        "HubSpot access token is required to hydrate contacts from webhook events that do not include email"
      );
    }

    const contact = await this.fetchContact(objectId);

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

  async fetchDeal(objectId) {
    return requestJson({
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      retryDelaysMs: this.env.retryDelaysMs,
      url:
        `${this.env.hubspotApiBaseUrl}/crm/v3/objects/deals/${encodeURIComponent(objectId)}` +
        "?properties=dealname,dealstage,pipeline&associations=contacts",
      headers: {
        Authorization: `Bearer ${this.env.hubspotAccessToken}`
      },
      operationName: "hubspot.get_deal",
      context: {
        objectId
      }
    });
  }

  async fetchContact(objectId) {
    return requestJson({
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      retryDelaysMs: this.env.retryDelaysMs,
      url:
        `${this.env.hubspotApiBaseUrl}/crm/v3/objects/contacts/${encodeURIComponent(objectId)}` +
        "?properties=email,firstname,lastname",
      headers: {
        Authorization: `Bearer ${this.env.hubspotAccessToken}`
      },
      operationName: "hubspot.get_contact",
      context: {
        objectId
      }
    });
  }

  extractAssociatedContactIds(deal) {
    const results = deal?.associations?.contacts?.results;

    if (!Array.isArray(results)) {
      return [];
    }

    return results
      .map((contact) => String(contact?.id || "").trim())
      .filter(Boolean);
  }

  async resolvePrimaryContactIdForDeal(dealId, fallbackContactIds = []) {
    if (fallbackContactIds.length === 1) {
      return fallbackContactIds[0];
    }

    const associations = await requestJson({
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      retryDelaysMs: this.env.retryDelaysMs,
      url: `${this.env.hubspotApiBaseUrl}/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/contacts`,
      headers: {
        Authorization: `Bearer ${this.env.hubspotAccessToken}`
      },
      operationName: "hubspot.get_deal_contact_associations",
      context: {
        dealId
      }
    });

    const results = Array.isArray(associations?.results) ? associations.results : [];
    const primaryAssociation = results.find((association) =>
      Array.isArray(association?.associationTypes) &&
      association.associationTypes.some((type) => String(type?.label || "").toLowerCase() === "primary")
    );

    const resolvedId = primaryAssociation?.toObjectId || results[0]?.toObjectId || fallbackContactIds[0];

    if (!resolvedId) {
      throw new AppError(400, "HubSpot onboarding deal does not have an associated contact");
    }

    return String(resolvedId);
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
