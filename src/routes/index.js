const { registerHealthRoutes } = require("./health.routes");
const { registerWebhookRoutes } = require("./webhook.routes");

function registerRoutes(app, services) {
  registerHealthRoutes(app);
  registerWebhookRoutes(app, services);
}

module.exports = { registerRoutes };
