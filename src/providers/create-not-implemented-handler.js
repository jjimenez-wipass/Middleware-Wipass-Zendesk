function createNotImplementedHandler({ provider }) {
  return function notImplementedHandler(req, res) {
    const durationMs = 0;

    req.log.info({
      requestId: req.requestId,
      eventType: `${provider}.webhook`,
      result: "not_implemented",
      durationMs
    });

    return res.status(501).json({
      status: "not_implemented",
      provider,
      requestId: req.requestId
    });
  };
}

module.exports = { createNotImplementedHandler };
