const { AppError } = require("../utils/app-error");

function notFoundHandler(req, res) {
  res.status(404).json({ error: "Not Found" });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof SyntaxError && error.type === "entity.parse.failed") {
    req.log?.warn({ requestId: req.requestId, err: error }, "Invalid JSON payload");
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      req.log?.error({ requestId: req.requestId, err: error }, error.message);
    } else {
      req.log?.warn({ requestId: req.requestId, err: error }, error.message);
    }

    return res.status(error.statusCode).json({ error: error.message });
  }

  req.log?.error({ requestId: req.requestId, err: error }, "Unexpected error");

  return res.status(500).json({ error: "Internal Server Error" });
}

module.exports = { errorHandler, notFoundHandler };
