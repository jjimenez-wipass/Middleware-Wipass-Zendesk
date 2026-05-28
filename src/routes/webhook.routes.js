const express = require("express");

const { createWebhookProviders } = require("../providers");

function registerWebhookRoutes(app, dependencies) {
  const router = express.Router();
  const providers = createWebhookProviders(dependencies);

  for (const provider of providers) {
    router.post(provider.path, ...(provider.authMiddleware || []), provider.handler);
  }

  app.use("/webhooks", router);
}

module.exports = { registerWebhookRoutes };
