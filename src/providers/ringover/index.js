const { createNotImplementedHandler } = require("../create-not-implemented-handler");

function createRingoverProvider() {
  return {
    name: "ringover",
    path: "/ringover",
    status: "planned",
    authMiddleware: [],
    handler: createNotImplementedHandler({ provider: "ringover" })
  };
}

module.exports = { createRingoverProvider };
