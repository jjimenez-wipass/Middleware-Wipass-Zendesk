const crypto = require("node:crypto");

function requestContextMiddleware(req, res, next) {
  req.requestId = req.get("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
}

module.exports = { requestContextMiddleware };
