class UpstreamServiceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "UpstreamServiceError";
    this.status = options.status || null;
    this.body = options.body;
    this.isUpstreamFailure = true;
  }
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function isRetryableError(error) {
  if (error instanceof UpstreamServiceError) {
    return error.status === 429 || error.status >= 500 || error.status === null;
  }

  return false;
}

async function requestJson({
  fetchImpl,
  logger,
  retryDelaysMs,
  url,
  method = "GET",
  headers = {},
  body,
  operationName,
  context = {}
}) {
  const client = fetchImpl || fetch;
  let attempt = 0;

  while (true) {
    try {
      const response = await client(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers
        },
        body: body ? JSON.stringify(body) : undefined
      });

      const text = await response.text();
      const parsedBody = text ? safeParseJson(text) : null;

      if (!response.ok) {
        throw new UpstreamServiceError(`${operationName} failed with status ${response.status}`, {
          status: response.status,
          body: parsedBody
        });
      }

      return parsedBody;
    } catch (error) {
      const wrappedError =
        error instanceof UpstreamServiceError
          ? error
          : new UpstreamServiceError(`${operationName} failed due to a network error`, {
              status: null,
              body: error.message
            });

      if (attempt >= retryDelaysMs.length || !isRetryableError(wrappedError)) {
        throw wrappedError;
      }

      const delayMs = retryDelaysMs[attempt];

      logger?.warn({
        ...context,
        operationName,
        attempt: attempt + 1,
        delayMs,
        err: wrappedError
      });

      await sleep(delayMs);
      attempt += 1;
    }
  }
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

module.exports = { UpstreamServiceError, requestJson };
