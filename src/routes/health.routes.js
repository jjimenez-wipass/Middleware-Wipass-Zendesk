function registerHealthRoutes(app) {
  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", service: "middleware-zendesk" });
  });
}

module.exports = { registerHealthRoutes };
