const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const pino = require("pino");
const pinoHttp = require("pino-http");

const { buildEnv } = require("./config/env");
const { errorHandler, notFoundHandler } = require("./middlewares/error-handler");
const { requestContextMiddleware } = require("./middlewares/request-context");
const { registerRoutes } = require("./routes");
const { HubSpotService } = require("./services/hubspot.service");
const { RingoverService } = require("./services/ringover.service");
const { WhatsAppService } = require("./services/whatsapp.service");
const { ZendeskService } = require("./services/zendesk.service");

function createApp(options = {}) {
  const env = buildEnv(options.env);
  const logger =
    options.logger ||
    pino({
      level: env.logLevel
    });

  const hubspotService =
    options.hubspotService || new HubSpotService({ env, logger, fetchImpl: options.fetchImpl });
  const whatsappService =
    options.whatsappService || new WhatsAppService({ env, logger, fetchImpl: options.fetchImpl });
  const ringoverService =
    options.ringoverService || new RingoverService({ env, logger, fetchImpl: options.fetchImpl });
  const zendeskService =
    options.zendeskService || new ZendeskService({ env, logger, fetchImpl: options.fetchImpl });

  const app = express();

  app.set("trust proxy", true);

  app.use(helmet());
  app.use(cors());
  app.use(requestContextMiddleware);
  app.use(
    pinoHttp({
      logger,
      quietReqLogger: true,
      customProps: (req) => ({
        requestId: req.requestId || null
      })
    })
  );
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, res, buffer, encoding) => {
        req.rawBody = buffer.toString(encoding || "utf8");
      }
    })
  );

  registerRoutes(app, {
    env,
    logger,
    services: {
      hubspotService,
      whatsappService,
      ringoverService,
      zendeskService
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    env,
    logger,
    services: {
      hubspotService,
      whatsappService,
      ringoverService,
      zendeskService
    }
  };
}

module.exports = { createApp };
