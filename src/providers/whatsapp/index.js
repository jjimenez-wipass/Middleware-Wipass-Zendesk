const { createNotImplementedHandler } = require("../create-not-implemented-handler");

function createWhatsAppProvider() {
  return {
    name: "whatsapp",
    path: "/whatsapp",
    status: "planned",
    authMiddleware: [],
    handler: createNotImplementedHandler({ provider: "whatsapp" })
  };
}

module.exports = { createWhatsAppProvider };
