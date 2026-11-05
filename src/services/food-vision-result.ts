import Joi from "joi";
import { AppError } from "../utils/errors";

export const FOOD_ICONS = ["silverware-fork-knife", "food-drumstick", "fruit-cherries", "food-apple", "fish", "leaf", "food-steak", "seed", "shaker", "bottle-tonic", "fruit-citrus", "egg"];
const confidence = Joi.string().pattern(/^(100|\d{1,2})%$/).required();
const detection = Joi.object({
  name: Joi.string().trim().max(120).required(), confidence,
  icon: Joi.string().valid(...FOOD_ICONS).required(),
});
const resultSchema = Joi.object({
  isFood: Joi.boolean().required(), title: Joi.string().trim().max(180).required(),
  accuracy: Joi.number().min(0).max(100).required(),
  dishes: Joi.array().items(detection).max(10).required(),
  ingredients: Joi.array().items(detection.append({ source: Joi.string().valid("visible", "inferred").required(), dishNames: Joi.array().items(Joi.string().trim().max(120)).max(10).unique().default([]), evidence: Joi.string().trim().max(300).optional() })).max(30).required(),
  suggestedRecipe: Joi.object({
    title: Joi.string().max(160).required(), desc: Joi.string().max(800).required(),
    calories: Joi.number().min(0).max(10000).required(),
    durationMinutes: Joi.number().min(0).max(1440).required(),
    matchPercent: Joi.number().min(0).max(100).required(),
  }).required(),
}).required();

export interface FoodDetection { name: string; confidence: string; icon: string }
export interface FoodPhotoAnalysis {
  isFood: boolean; title: string; accuracy: number;
  dishes: FoodDetection[];
  ingredients: (FoodDetection & { source: "visible" | "inferred"; dishNames: string[]; evidence?: string })[];
  pins: { text: string; top: number; left: number; icon: string; confidence: string }[];
  suggestedRecipe: { title: string; desc: string; calories: number; durationMinutes: number; matchPercent: number };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function icon(value: unknown): string {
  // An invalid decorative icon must never discard or change a recognized food name.
  return typeof value === "string" && FOOD_ICONS.includes(value) ? value : "silverware-fork-knife";
}

function normalizeDetections(value: unknown): unknown {
  return Array.isArray(value) ? value.map((item: unknown) => {
    const entry = record(item);
    return entry ? { ...entry, icon: icon(entry.icon) } : item;
  }) : value;
}

function coordinate(value: unknown): number | undefined {
  // Only lossless number/percentage parsing; never invent or clamp an object's location.
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?%?$/.test(value.trim()) ? Number(value.trim().replace(/%$/, "")) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : undefined;
}

const key = (name: string) => name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");

export function parseFoodVisionResult(raw: unknown): FoodPhotoAnalysis {
  const data = record(raw);
  if (data?.isFood === false) throw new AppError("Chưa nhận diện được thực phẩm. Hãy chụp rõ món ăn hoặc nguyên liệu, đủ sáng và gần hơn.", 422);
  const parsed = resultSchema.validate(data ? {
    ...data, dishes: normalizeDetections(data.dishes), ingredients: normalizeDetections(data.ingredients),
  } : raw, { stripUnknown: true, convert: false });
  if (parsed.error) {
    console.warn("[FoodVision] Invalid recognition fields", { fields: parsed.error.details.map((detail) => detail.path.join(".")) });
    throw new AppError("AI trả dữ liệu nhận diện chưa đúng định dạng. Vui lòng thử quét lại.", 502);
  }
  const result = parsed.value as FoodPhotoAnalysis;
  result.ingredients = result.ingredients.filter((item) => item.source === "visible");
  if (!result.isFood || (!result.ingredients.length && !result.dishes.length)) {
    throw new AppError("Chưa thấy rõ món ăn hoặc nguyên liệu trong ảnh. Vui lòng chụp gần hơn, đủ sáng.", 422);
  }
  const dishNames = new Map(result.dishes.map((dish) => [key(dish.name), dish.name]));
  for (const ingredient of result.ingredients) {
    if (result.dishes.length && !ingredient.dishNames.length) {
      throw new AppError("AI chưa xác định nguyên liệu thuộc món nào. Vui lòng quét lại ảnh.", 502);
    }
    ingredient.dishNames = ingredient.dishNames.map((name) => {
      const dishName = dishNames.get(key(name));
      if (!dishName) throw new AppError("AI liên kết nguyên liệu với món chưa được nhận diện. Vui lòng quét lại ảnh.", 502);
      return dishName;
    });
  }
  const targets = new Map([...result.ingredients, ...result.dishes].map((item) => [key(item.name), item]));
  const used = new Set<string>();
  result.pins = [];
  for (const item of Array.isArray(data?.pins) ? data.pins.slice(0, 40) : []) {
    const pin = record(item);
    if (!pin || typeof pin.text !== "string") continue;
    const target = targets.get(key(pin.text));
    const top = coordinate(pin.top), left = coordinate(pin.left);
    if (!target || top === undefined || left === undefined || used.has(key(target.name))) continue;
    used.add(key(target.name));
    result.pins.push({ text: target.name, top, left, icon: target.icon, confidence: target.confidence });
    if (result.pins.length >= 10) break;
  }
  return result;
}

const nameProperty = { type: "string" };
const confidenceProperty = { type: "string", description: "Estimated confidence from 0% to 100%, formatted as a whole-number percentage string" };
const iconProperty = { type: "string", enum: FOOD_ICONS };
const detectionProperties = { name: nameProperty, confidence: confidenceProperty, icon: iconProperty };
const percent = { type: "number", description: "Number from 0 to 100 inclusive" };

/** Keep the provider grammar compact; Joi enforces bounds locally to avoid Gemini 400 schema-complexity errors. */
export const FOOD_VISION_JSON_SCHEMA = {
  type: "object", required: ["isFood", "title", "accuracy", "dishes", "ingredients", "pins", "suggestedRecipe"],
  properties: {
    isFood: { type: "boolean" }, title: { type: "string" }, accuracy: percent,
    dishes: { type: "array", items: { type: "object", required: ["name", "confidence", "icon"], properties: detectionProperties } },
    ingredients: { type: "array", items: { type: "object", required: ["name", "confidence", "icon", "source", "dishNames", "evidence"], properties: { ...detectionProperties, source: { type: "string", enum: ["visible"] }, dishNames: { type: "array", items: { type: "string" }, description: "Exact names from dishes where this ingredient is visually observed. For raw food with no dishes, use an empty array." }, evidence: { type: "string", description: "Short Vietnamese description of the ingredient actually visible within those dishes; do not infer hidden seasonings from recipe names." } } } },
    pins: { type: "array", items: { type: "object", required: ["text", "top", "left"], properties: { text: { ...nameProperty, description: "Exact name of a dish or visible ingredient from this result" }, top: { ...percent, description: "Vertical position from the top of the whole image, percent 0–100" }, left: { ...percent, description: "Horizontal position from the left of the whole image, percent 0–100" } } } },
    suggestedRecipe: { type: "object", required: ["title", "desc", "calories", "durationMinutes", "matchPercent"], properties: {
      title: { type: "string" }, desc: { type: "string" },
      calories: { type: "number" }, durationMinutes: { type: "number" }, matchPercent: percent,
    } },
  },
};
