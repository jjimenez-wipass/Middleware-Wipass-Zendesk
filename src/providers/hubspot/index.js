const { createHubSpotHandler } = require("./handler");
const { createHubSpotAuthMiddleware } = require("./auth");

function createHubSpotProvider({ env, services }) {
  return {
    name: "hubspot",
    path: "/hubspot",
    status: "active",
    authMiddleware: [createHubSpotAuthMiddleware({ env })],
    handler: createHubSpotHandler({
      hubspotService: services.hubspotService,
      zendeskService: services.zendeskService
    })
  };
}

module.exports = { createHubSpotProvider };
