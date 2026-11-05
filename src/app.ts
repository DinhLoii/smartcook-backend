import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import swaggerSpec from "./config/swagger";
import { apiLimiter } from "./middlewares/rateLimit";
import { mongoSanitize, hppProtection } from "./middlewares/security";
import apiRoutes from "./routes";
import errorHandler from "./middlewares/errorHandler";

import { logger, morganStream } from "./config/logger";

const app: Application = express();

// Trust reverse proxy (Render, AWS, Heroku, Cloudflare) for accurate client IP & rate limiting
app.set("trust proxy", 1);

// Security HTTP Headers (disable CSP so Swagger UI can render assets properly)
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// Gzip compression
app.use(compression());

// HTTP Request Logging with Winston
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev", { stream: morganStream }));

// CORS Configuration supporting multiple domains, Vercel SPA, and credentials
const corsOriginHandler = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean | string) => void
) => {
  // Allow mobile apps, curl, postman with no origin
  if (!origin) return callback(null, true);

  // If set to wildcard "*", reflect any origin dynamically with credentials
  if (env.CORS_ORIGIN === "*") {
    return callback(null, true);
  }

  const allowedOrigins = env.CORS_ORIGIN.split(",").map((s) => s.trim().replace(/\/$/, ""));
  const normalizedOrigin = origin.replace(/\/$/, "");

  if (
    allowedOrigins.includes(normalizedOrigin) ||
    allowedOrigins.includes("*") ||
    normalizedOrigin.endsWith(".vercel.app")
  ) {
    return callback(null, true);
  }

  callback(null, false);
};

app.use(
  cors({
    origin: corsOriginHandler,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  })
);

// Body Parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// NoSQL Injection Sanitization & HTTP Parameter Pollution (HPP) Protection
app.use(mongoSanitize);
app.use(hppProtection());

// Swagger UI Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Root route
app.get("/", (req: Request, res: Response) => {
  res.json({
    name: "SmartCook Backend API",
    version: "1.0.0",
    docs: "/api-docs",
    health: "/api/v1/health",
  });
});

// Apply Rate Limiting to all /api routes
app.use("/api", apiLimiter);

// API Routes
app.use("/api/v1", apiRoutes);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global Error Handler
app.use(errorHandler);

export default app;
