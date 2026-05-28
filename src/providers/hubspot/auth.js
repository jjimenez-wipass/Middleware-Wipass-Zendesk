const crypto = require("node:crypto");

const { AppError } = require("../../utils/app-error");

const URI_DECODE_MAP = new Map([
  ["%3A", ":"],
  ["%2F", "/"],
  ["%3F", "?"],
  ["%40", "@"],
  ["%21", "!"],
  ["%24", "$"],
  ["%27", "'"],
  ["%28", "("],
  ["%29", ")"],
  ["%2A", "*"],
  ["%2C", ","],
  ["%3B", ";"]
]);

function decodeHubSpotUri(value) {
  let decoded = value;

  for (const [encoded, replacement] of URI_DECODE_MAP.entries()) {
    decoded = decoded.replace(new RegExp(encoded, "gi"), replacement);
  }

  return decoded;
}

function buildRequestUri(req) {
  const protocol = req.protocol;
  const host = req.get("host");
  return decodeHubSpotUri(`${protocol}://${host}${req.originalUrl}`);
}

function timingSafeEquals(left, right) {
  const leftBuffer = Buffer.from(left || "", "utf8");
  const rightBuffer = Buffer.from(right || "", "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createHubSpotAuthMiddleware({ env }) {
  return function hubspotAuthMiddleware(req, res, next) {
    if (!env.hubspotWebhookSecret) {
      return next(new AppError(500, "HubSpot webhook secret is not configured"));
    }

    const signature = req.get("x-hubspot-signature-v3");
    const timestampHeader = req.get("x-hubspot-request-timestamp");

    if (!signature || !timestampHeader) {
      return next(new AppError(401, "HubSpot webhook signature is missing"));
    }

    const timestamp = Number(timestampHeader);

    if (!Number.isFinite(timestamp)) {
      return next(new AppError(401, "HubSpot webhook timestamp is invalid"));
    }

    const currentTime = Date.now();

    if (Math.abs(currentTime - timestamp) > env.hubspotSignatureMaxAgeMs) {
      return next(new AppError(401, "HubSpot webhook signature has expired"));
    }

    const source = `${req.method}${buildRequestUri(req)}${req.rawBody || ""}${timestampHeader}`;
    const expectedSignature = crypto
      .createHmac("sha256", env.hubspotWebhookSecret)
      .update(source, "utf8")
      .digest("base64");

    if (!timingSafeEquals(expectedSignature, signature)) {
      return next(new AppError(401, "HubSpot webhook signature is invalid"));
    }

    return next();
  };
}

module.exports = { createHubSpotAuthMiddleware };
