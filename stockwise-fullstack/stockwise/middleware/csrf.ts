import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

function initCsrfToken(req: Request, res: Response, next: NextFunction) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  next();
}

function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }
  const csrfExemptPaths = [
    "/api/login",
    "/api/register",
    "/api/forgot-password",
    "/api/reset-password",
    "/api/webhooks/tradingview",
    "/api/demo/coach",
    "/api/demo/academy/complete",
  ];
  if (csrfExemptPaths.some(p => req.path === p || req.path.startsWith(p + "/"))) {
    return next();
  }
  if (!req.session || !req.session.csrfToken) {
    return res
      .status(403)
      .json({ error: "Forbidden: No CSRF token in session" });
  }
  const token = req.headers["x-csrf-token"];
  if (!token || typeof token !== "string" || typeof req.session.csrfToken !== "string") {
    return res
      .status(403)
      .json({ error: "Forbidden: Invalid or missing CSRF token" });
  }
  const tokenBuf = Buffer.from(token);
  const sessionBuf = Buffer.from(req.session.csrfToken);
  if (tokenBuf.length !== sessionBuf.length || !crypto.timingSafeEqual(tokenBuf, sessionBuf)) {
    return res
      .status(403)
      .json({ error: "Forbidden: Invalid or missing CSRF token" });
  }
  next();
}

export { initCsrfToken, csrfProtection };
