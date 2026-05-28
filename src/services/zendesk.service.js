const { AppError } = require("../utils/app-error");
const { UpstreamServiceError, requestJson } = require("../utils/http-client");

class ZendeskService {
  constructor({ env, logger, fetchImpl }) {
    this.env = env;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
  }

  async upsertOnboardingTicket(normalizedEvent) {
    this.ensureConfiguration();

    const existingTicket = await this.findOpenOnboardingTicketByEmail(normalizedEvent.payload.contactEmail);

    if (!existingTicket) {
      const createdTicket = await this.createOnboardingTicket(normalizedEvent);
      return {
        action: "created",
        ticketId: createdTicket.id
      };
    }

    const updatedTicket = await this.updateOnboardingTicket(existingTicket.id, normalizedEvent);

    return {
      action: "updated",
      ticketId: updatedTicket.id
    };
  }

  ensureConfiguration() {
    const missing = [];

    if (!this.env.zendeskApiBaseUrl) {
      missing.push("ZENDESK_SUBDOMAIN");
    }

    if (!this.env.zendeskEmail) {
      missing.push("ZENDESK_EMAIL");
    }

    if (!this.env.zendeskApiToken) {
      missing.push("ZENDESK_API_TOKEN");
    }

    if (missing.length > 0) {
      throw new AppError(500, `Zendesk configuration is incomplete: ${missing.join(", ")}`);
    }
  }

  async findOpenOnboardingTicketByEmail(email) {
    const query = [
      "type:ticket",
      `requester:${email}`,
      `tags:${this.env.zendeskOnboardingTicketTag}`,
      "-status:solved",
      "-status:closed"
    ].join(" ");

    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      retryDelaysMs: this.env.retryDelaysMs,
      url: `${this.env.zendeskApiBaseUrl}/api/v2/search.json?query=${encodeURIComponent(query)}`,
      headers: this.buildAuthHeaders(),
      operationName: "zendesk.search_tickets",
      context: {
        email
      }
    });

    const results = Array.isArray(response.results) ? response.results : [];

    if (results.length === 0) {
      return null;
    }

    return results
      .filter((ticket) => ticket && typeof ticket === "object" && ticket.id)
      .sort((left, right) => new Date(right.updated_at || 0) - new Date(left.updated_at || 0))[0];
  }

  async createOnboardingTicket(normalizedEvent) {
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      retryDelaysMs: this.env.retryDelaysMs,
      url: `${this.env.zendeskApiBaseUrl}/api/v2/tickets.json`,
      method: "POST",
      headers: this.buildAuthHeaders(),
      body: {
        ticket: {
          subject: this.buildSubject(normalizedEvent),
          requester: {
            name: normalizedEvent.payload.contactName || normalizedEvent.payload.contactEmail,
            email: normalizedEvent.payload.contactEmail
          },
          comment: {
            body: this.buildInternalNote(normalizedEvent),
            public: false
          },
          status: this.resolveTicketStatus(normalizedEvent.payload.stageType),
          tags: [this.env.zendeskOnboardingTicketTag]
        }
      },
      operationName: "zendesk.create_ticket",
      context: {
        email: normalizedEvent.payload.contactEmail
      }
    });

    return response.ticket;
  }

  async updateOnboardingTicket(ticketId, normalizedEvent) {
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      retryDelaysMs: this.env.retryDelaysMs,
      url: `${this.env.zendeskApiBaseUrl}/api/v2/tickets/${ticketId}.json`,
      method: "PUT",
      headers: this.buildAuthHeaders(),
      body: {
        ticket: {
          comment: {
            body: this.buildInternalNote(normalizedEvent),
            public: false
          },
          status: this.resolveTicketStatus(normalizedEvent.payload.stageType)
        }
      },
      operationName: "zendesk.update_ticket",
      context: {
        ticketId
      }
    });

    await this.addOnboardingTag(ticketId);

    return response.ticket;
  }

  async addOnboardingTag(ticketId) {
    try {
      await requestJson({
        fetchImpl: this.fetchImpl,
        logger: this.logger,
        retryDelaysMs: this.env.retryDelaysMs,
        url: `${this.env.zendeskApiBaseUrl}/api/v2/tickets/${ticketId}/tags.json`,
        method: "PUT",
        headers: this.buildAuthHeaders(),
        body: {
          tags: [this.env.zendeskOnboardingTicketTag]
        },
        operationName: "zendesk.add_ticket_tag",
        context: {
          ticketId
        }
      });
    } catch (error) {
      if (error instanceof UpstreamServiceError) {
        error.ticketId = ticketId;
      }

      throw error;
    }
  }

  buildAuthHeaders() {
    const credentials = Buffer.from(`${this.env.zendeskEmail}/token:${this.env.zendeskApiToken}`).toString("base64");

    return {
      Authorization: `Basic ${credentials}`
    };
  }

  buildSubject(normalizedEvent) {
    return `Onboarding ${normalizedEvent.payload.contactName || normalizedEvent.payload.contactEmail}`;
  }

  resolveTicketStatus(stageType) {
    return stageType === "completed" ? "solved" : "open";
  }

  buildInternalNote(normalizedEvent) {
    const { contactEmail, contactName, pipelineId, stageId, stageType, hubspotObjectId } = normalizedEvent.payload;
    const actor = contactName ? `${contactName} <${contactEmail}>` : contactEmail;

    if (stageType === "start") {
      return [
        `Onboarding iniciado en HubSpot para ${actor}.`,
        `Pipeline: ${pipelineId || "n/a"}.`,
        `Stage ID: ${stageId}.`,
        `HubSpot Object ID: ${hubspotObjectId || "n/a"}.`
      ].join(" ");
    }

    if (stageType === "blocked") {
      return [
        `Onboarding bloqueado en HubSpot para ${actor}.`,
        `Pipeline: ${pipelineId || "n/a"}.`,
        `Stage ID: ${stageId}.`,
        `HubSpot Object ID: ${hubspotObjectId || "n/a"}.`
      ].join(" ");
    }

    return [
      `Onboarding completado en HubSpot para ${actor}.`,
      `Pipeline: ${pipelineId || "n/a"}.`,
      `Stage ID: ${stageId}.`,
      `HubSpot Object ID: ${hubspotObjectId || "n/a"}.`
    ].join(" ");
  }
}

module.exports = { ZendeskService };
