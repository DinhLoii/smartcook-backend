import "dotenv/config";

interface EnvConfig {
  PORT: number;
  NODE_ENV: "development" | "production" | "test";
  MONGODB_URI: string;
  CORS_ORIGIN: string;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  JWT_REFRESH_SECRET: string;
  JWT_REFRESH_EXPIRES_IN: string;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  GEMINI_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  REDIS_URL: string;
}

const getEnv = (): EnvConfig => {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  const NODE_ENV = (process.env.NODE_ENV as "development" | "production" | "test") || "development";
  let rawMongoUri = (process.env.MONGODB_URI || "").trim();
  if (
    (rawMongoUri.startsWith('"') && rawMongoUri.endsWith('"')) ||
    (rawMongoUri.startsWith("'") && rawMongoUri.endsWith("'"))
  ) {
    rawMongoUri = rawMongoUri.slice(1, -1).trim();
  }
  const MONGODB_URI = rawMongoUri || "mongodb://127.0.0.1:27017/smartcook_db";
  const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
  const RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS
    ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
    : 15 * 60 * 1000;
  const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX
    ? parseInt(process.env.RATE_LIMIT_MAX, 10)
    : 100;

  const JWT_SECRET =
    process.env.JWT_SECRET || "smartcook_default_jwt_secret_change_in_production";
  const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";
  const JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET || "smartcook_default_refresh_secret_change_in_production";
  const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";

  const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
  const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
  const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
  let rawGoogleClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  if (
    (rawGoogleClientId.startsWith('"') && rawGoogleClientId.endsWith('"')) ||
    (rawGoogleClientId.startsWith("'") && rawGoogleClientId.endsWith("'"))
  ) {
    rawGoogleClientId = rawGoogleClientId.slice(1, -1).trim();
  }
  const GOOGLE_CLIENT_ID = rawGoogleClientId;

  const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
  const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const SMTP_USER = process.env.SMTP_USER || "";
  const SMTP_PASS = process.env.SMTP_PASS || "";
  const SMTP_FROM = process.env.SMTP_FROM || "SmartCook <no-reply@smartcook.vn>";

  const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

  // Validate critical security secrets in production
  if (NODE_ENV === "production") {
    const isDefaultOrEmpty = (secret?: string): boolean => {
      if (!secret || secret.trim() === "") return true;
      const lower = secret.toLowerCase();
      return lower.includes("smartcook_default") || lower.includes("change_in_production");
    };

    if (isDefaultOrEmpty(process.env.JWT_SECRET) || isDefaultOrEmpty(process.env.JWT_REFRESH_SECRET)) {
      throw new Error(
        "🚨 [FATAL SECURITY ERROR] Biến môi trường JWT_SECRET và JWT_REFRESH_SECRET hợp lệ là BẮT BUỘC khi chạy ở chế độ production! Không được để trống hoặc sử dụng chuỗi bí mật mặc định."
      );
    }
  }

  return {
    PORT,
    NODE_ENV,
    MONGODB_URI,
    CORS_ORIGIN,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    JWT_REFRESH_SECRET,
    JWT_REFRESH_EXPIRES_IN,
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
    GEMINI_API_KEY,
    GOOGLE_CLIENT_ID,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
    REDIS_URL,
  };
};

export const env = getEnv();
export default env;
