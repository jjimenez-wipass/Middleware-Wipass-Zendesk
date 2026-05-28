require("dotenv").config();

const { createApp } = require("./app");

const { app, env, logger } = createApp();

app.listen(env.port, () => {
  logger.info({ port: env.port }, "Middleware running");
});
