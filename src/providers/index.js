const { createHubSpotProvider } = require("./hubspot");
const { createRingoverProvider } = require("./ringover");
const { createWhatsAppProvider } = require("./whatsapp");

function createWebhookProviders({ env, logger, services }) {
  return [
    createHubSpotProvider({ env, logger, services }),
    createWhatsAppProvider({ env, logger, services }),
    createRingoverProvider({ env, logger, services })
  ];
}

module.exports = { createWebhookProviders };
