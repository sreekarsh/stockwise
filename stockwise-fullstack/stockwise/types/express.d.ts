import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    username?: string;
    role?: string;
    csrfToken?: string;
  }
}

declare module "express" {
  interface Request {
    session: import("express-session").Session & Partial<import("express-session").SessionData>;
  }
}
