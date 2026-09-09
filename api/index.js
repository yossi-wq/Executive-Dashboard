// Vercel serverless entry point. Every request under /api/* is routed here
// (see the rewrite in vercel.json) and handled by the same Express app used
// for local dev — Vercel's Node runtime accepts an Express app directly as
// a (req, res) handler.
//
// Note: /api/stream (SSE) won't hold a persistent connection on serverless
// — each invocation is short-lived. The dashboard falls back to polling
// when it can't get a lasting SSE connection, so the UI still stays fresh,
// just not instantaneously push-based, when deployed here.
export { app as default } from "../server/src/app.js";
