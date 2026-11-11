import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || "";

if (!apiKey) {
  console.warn("⚠️ [Gemini Config] GEMINI_API_KEY is not defined in environment variables. AI features may use heuristic fallback.");
}

export const geminiClient = new GoogleGenAI({ apiKey });

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
export const GEMINI_SHORT_RESPONSE_OPTIONS = /^gemini-3(?:\.\d+)?(?:-\d+b)?-flash\b/.test(GEMINI_MODEL)
  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {};

// Danh sách các model theo thứ tự ưu tiên (Tự động chuyển model nếu quá tải hoặc bảo trì)
export const GEMINI_CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3-flash-preview",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.1-pro-preview",
];
