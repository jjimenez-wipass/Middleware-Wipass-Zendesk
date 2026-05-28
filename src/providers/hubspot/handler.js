const { AppError } = require("../../utils/app-error");

function createHubSpotHandler({ hubspotService, zendeskService }) {
  return async function hubSpotHandler(req, res, next) {
    const startedAt = Date.now();

    try {
      const normalizedEvent = await hubspotService.normalizeWebhook({
        body: req.body,
        requestId: req.requestId,
        receivedAt: new Date().toISOString()
      });

      if (!normalizedEvent) {
        req.log.info({
          requestId: req.requestId,
          eventType: "hubspot.onboarding.stage_changed",
          result: "ignored",
          durationMs: Date.now() - startedAt
        });

        return res.status(200).json({
          status: "ignored",
          requestId: req.requestId
        });
      }

      try {
        const result = await zendeskService.upsertOnboardingTicket(normalizedEvent);

        req.log.info({
          requestId: req.requestId,
          eventType: normalizedEvent.eventType,
          ticketId: result.ticketId,
          result: "ok",
          durationMs: Date.now() - startedAt
        });

        return res.status(200).json({
          status: "ok",
          requestId: req.requestId,
          ticketId: result.ticketId,
          action: result.action
        });
      } catch (error) {
        const isRetriableUpstreamFailure =
          error.isUpstreamFailure && (error.status === null || error.status === 429 || error.status >= 500);

        if (!isRetriableUpstreamFailure) {
          throw error;
        }

        req.log.error({
          requestId: req.requestId,
          eventType: normalizedEvent.eventType,
          ticketId: error.ticketId || null,
          result: "failed",
          durationMs: Date.now() - startedAt,
          err: error
        });

        return res.status(200).json({
          status: "accepted_with_error",
          requestId: req.requestId
        });
      }
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }

      return next(error);
    }
  };
}

module.exports = { createHubSpotHandler };
