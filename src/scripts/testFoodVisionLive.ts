import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { foodVisionService } from "../services/food-vision.service";
import { geminiClient } from "../config/gemini";

async function main() {
  let selectedModel: string | undefined;
  const original = geminiClient.models.generateContent.bind(geminiClient.models);
  geminiClient.models.generateContent = async (params) => {
    try { const response = await original(params); selectedModel = params.model; return response; } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown provider error";
      const safeMessage = process.env.GEMINI_API_KEY ? message.split(process.env.GEMINI_API_KEY).join("[redacted]") : message;
      console.log(safeMessage.slice(0, 1000));
      throw error;
    }
  };
  const image = readFileSync(process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, "../../../smartcook-mobile/assets/images/hero-teriyaki-bowl.jpg"));
  const result = await foodVisionService.analyze(image, process.argv[2]?.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  assert.equal(result.isFood, true);
  assert.ok(result.dishes.length > 0);
  assert.ok(result.ingredients.length > 0);
  assert.ok(result.ingredients.every((item) => item.source === "visible"));
  assert.ok(result.ingredients.every((item) => item.dishNames.length > 0 && item.dishNames.every((name) => result.dishes.some((dish) => dish.name === name))), "Every recognized ingredient must belong to a recognized dish");
  assert.ok(result.ingredients.every((item) => Boolean(item.evidence?.trim())), "Provide a visible clue for each ingredient");
  assert.ok(result.pins.length > 0, "Recognized food must have positioned labels in this live photo check");
  assert.ok(result.pins.every((pin) => Number.isFinite(pin.top) && pin.top >= 0 && pin.top <= 100 && Number.isFinite(pin.left) && pin.left >= 0 && pin.left <= 100));
  console.log(JSON.stringify({ model: selectedModel, title: result.title, dishes: result.dishes, ingredients: result.ingredients, pins: result.pins }, null, 2));
  console.log("PASS: real Gemini returned a valid analysis of the supplied photograph (no database writes). Dish identity still requires human verification.");
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Live vision check failed; no sample results substituted."); process.exitCode = 1; });
