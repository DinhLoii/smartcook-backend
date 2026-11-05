import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AddressInfo } from "node:net";
import { Types } from "mongoose";
import { PassThrough } from "node:stream";
import { v2 as cloudinary } from "cloudinary";
import express, { ErrorRequestHandler } from "express";
import aiRouter from "../routes/ai.routes";
import { JwtHelper } from "../utils/jwt";
import { userRepository } from "../repositories/user.repository";
import { scanHistoryRepository } from "../repositories/scanHistory.repository";
import type { IScanHistory } from "../models/ScanHistory";
import Recipe from "../models/Recipe";
import { geminiClient } from "../config/gemini";
import { parseFoodVisionResult } from "../services/food-vision-result";
import { ScanHistory } from "../models/ScanHistory";
import { validateFoodPhoto } from "../services/food-vision.service";

async function main() {
  const jpeg = readFileSync(resolve(__dirname, "../../../smartcook-mobile/assets/images/hero-teriyaki-bowl.jpg"));
  const uid = new Types.ObjectId();
  const records: Record<string, unknown>[] = [];
  let output: unknown = {
    isFood: true, title: "Cơm gà Teriyaki", accuracy: 64,
    dishes: [{ name: "Cơm gà Teriyaki", confidence: "72%" }],
    ingredients: [
      { name: "Thịt gà", confidence: "85%", icon: "food-drumstick", source: "visible", dishNames: ["Cơm gà Teriyaki"], evidence: "Miếng thịt gà trên cơm" },
      { name: "Nước tương", confidence: "55%", icon: "bottle-tonic", source: "inferred" },
    ],
    pins: [{ text: "Thịt gà", top: 30, left: 25 }],
    suggestedRecipe: { title: "Cơm gà (Teriyaki)+", desc: "Gợi ý liên quan đến món nhận diện.", calories: 0, durationMinutes: 0, matchPercent: 72 },
  };
  const validOutput = output;
  const normalized = parseFoodVisionResult({
    ...(validOutput as object),
    dishes: [{ name: "Cơm gà Teriyaki", confidence: "72%", icon: "food-drumstick" }],
    ingredients: [{ name: "Thịt gà", confidence: "85%", icon: "🍗", source: "visible", dishNames: ["Cơm gà Teriyaki"], evidence: "Miếng thịt gà trên cơm" }],
    pins: [
      { text: "Cơm gà Teriyaki", top: "30%", left: "75.5" },
      { text: "Thịt gà", top: 65, left: 20 },
      { text: "Thịt gà", top: 40, left: 50 },
      { text: "Không nhận diện", top: 20, left: 20 },
    ],
  });
  assert.equal(normalized.ingredients[0].name, "Thịt gà", "Decorative icon repair must not change food names");
  assert.equal(normalized.ingredients[0].confidence, "85%");
  assert.deepEqual(normalized.pins[0], { text: "Cơm gà Teriyaki", top: 30, left: 75.5, icon: "food-drumstick", confidence: "72%" });
  assert.equal(normalized.pins.length, 2, "Keep dish and ingredient pins, reject duplicates and unrelated labels");
  assert.equal(parseFoodVisionResult({ ...(validOutput as object), pins: [{ text: "Thịt gà", top: "bad", left: 30 }] }).pins.length, 0, "Invalid optional coordinates must not discard valid recognition");
  assert.equal(parseFoodVisionResult({ ...(validOutput as object), pins: [{ text: "Thịt gà", top: 500, left: 300 }] }).pins.length, 0, "Never guess the units of out-of-range coordinates");
  assert.equal(parseFoodVisionResult({ ...(validOutput as object), ingredients: [], pins: [{ text: "Cơm gà Teriyaki", top: 0, left: 100 }] }).pins[0].left, 100, "Allow dish-only results and preserve true edge positions");
  const persisted = new ScanHistory({ ...normalized, userId: new Types.ObjectId(), imageUrl: "https://example.com/photo.jpg" }).toObject();
  assert.equal(persisted.pins[0].icon, "food-drumstick");
  assert.equal(persisted.pins[0].confidence, "72%", "History must preserve label icons and confidence");
  assert.deepEqual(persisted.ingredients[0].dishNames, ["Cơm gà Teriyaki"]);
  assert.equal(persisted.ingredients[0].evidence, "Miếng thịt gà trên cơm");
  assert.throws(() => parseFoodVisionResult({ ...(validOutput as object), ingredients: [{ name: "Thịt gà", confidence: "85%", source: "visible", dishNames: ["Món không tồn tại"] }] }), { statusCode: 502 });
  assert.throws(() => parseFoodVisionResult({ ...(validOutput as object), ingredients: [{ name: "Thịt gà", confidence: "85%", source: "visible" }] }), { statusCode: 502 }, "Never silently assign the meal's ingredients to a dish");
  const separateDishes = parseFoodVisionResult({ ...(validOutput as object), dishes: [{ name: "Canh bí đỏ", confidence: "80%" }, { name: "Rau xào", confidence: "80%" }], ingredients: [
    { name: "Bí đỏ", confidence: "80%", icon: "leaf", source: "visible", dishNames: ["Canh bí đỏ"], evidence: "Miếng bí màu cam trong bát canh" },
    { name: "Rau muống", confidence: "80%", icon: "leaf", source: "visible", dishNames: ["Rau xào"], evidence: "Cọng rau dài trên đĩa" },
    { name: "Muối", confidence: "80%", icon: "shaker", source: "inferred", dishNames: ["Rau xào"] },
  ] });
  assert.deepEqual(separateDishes.ingredients.filter(item => item.dishNames.includes("Canh bí đỏ")).map(item => item.name), ["Bí đỏ"]);
  assert.deepEqual(separateDishes.ingredients.filter(item => item.dishNames.includes("Rau xào")).map(item => item.name), ["Rau muống"]);
  mock.method(JwtHelper, "verifyAccessToken", () => ({ id: uid.toString() }));
  mock.method(userRepository, "findById", async () => ({ _id: uid, isActive: true }));
  const upload = mock.method(cloudinary.uploader, "upload_stream", (_options: unknown, callback: (error: Error | null, result?: object) => void) => {
    const stream = new PassThrough();
    stream.resume();
    stream.on("finish", () => callback(null, { secure_url: "https://example.com/scans/real-photo.jpg", public_id: "test/new-photo" }));
    return stream;
  });
  const cleanup = mock.method(cloudinary.uploader, "destroy", async () => ({ result: "ok" }));
  const generation = mock.method(geminiClient.models, "generateContent", async () => ({ text: JSON.stringify(output) }));
  const lookup = mock.method(Recipe, "findOne", () => ({ exec: async () => null }));
  mock.method(scanHistoryRepository, "create", async (data: Partial<IScanHistory>) => {
    const record = { ...data, _id: new Types.ObjectId() };
    records.push(record);
    return record;
  });
  mock.method(scanHistoryRepository, "findByUserId", async () => records);
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/ai", aiRouter);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  };
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ai`;
  const headers = { Authorization: "Bearer test-scan-token" };
  const sendPhoto = (filename = "camera.jpg", bytes = jpeg, type = "image/jpeg") => {
    const body = new FormData();
    body.append("image", new Blob([new Uint8Array(bytes)], { type }), filename);
    return fetch(url + "/scan-ingredients", { method: "POST", headers, body });
  };
  const sendJson = (body: object) => fetch(url + "/scan-ingredients", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    assert.throws(() => validateFoodPhoto(Buffer.from("not a photo"), "image/jpeg"), { statusCode: 400 });
    assert.equal((await fetch(url + "/scan-ingredients", { method: "POST" })).status, 401);
    assert.equal((await sendJson({})).status, 400);
    assert.equal((await sendJson({ imageUrl: "https://example.com/photo.jpg" })).status, 400, "Never scan a dummy 1x1 image for a URL");
    assert.equal((await sendPhoto("fake.jpg", Buffer.from("not an image"))).status, 400);
    assert.equal((await sendPhoto("photo.png", jpeg, "image/png")).status, 400);
    assert.equal((await sendPhoto("too-large.jpg", Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
    assert.equal(upload.mock.callCount(), 0);

    for (const filename of ["camera.jpg", "gallery.jpg"]) {
      const response = await sendPhoto(filename);
      assert.equal(response.status, 201);
      const result = (await response.json()).data;
      assert.equal(result.title, "Cơm gà Teriyaki");
      assert.equal(result.accuracy, 64, "Keep the actual estimate, not a fabricated 96%");
      assert.equal(result.dishes[0].name, "Cơm gà Teriyaki");
      assert.equal(result.ingredients.length, 1, "Do not return inferred ingredients as detections");
      assert.equal(result.ingredients[0].source, "visible");
      assert.deepEqual(result.ingredients[0].dishNames, ["Cơm gà Teriyaki"]);
      assert.equal(result.imageUrl, "https://example.com/scans/real-photo.jpg");
      assert.equal(result.suggestedRecipe.id, undefined, "Never link an arbitrary recipe");
      assert.match(result.id, /^[a-f0-9]{24}$/);
    }
    const history = await fetch(url + "/scan-history", { headers });
    assert.equal((await history.json()).data.length, 2);
    assert.equal(cleanup.mock.callCount(), 0, "Keep successful uploads for history");
    const filter = lookup.mock.calls[0].arguments[0] as unknown as { title: { $regex: string }; isActive: boolean };
    assert.equal(filter.isActive, true);
    assert.equal(filter.title.$regex, "^Cơm gà \\(Teriyaki\\)\\+$");

    const jsonResponse = await sendJson({ imageBase64: jpeg.toString("base64"), mimeType: "image/jpeg" });
    assert.equal(jsonResponse.status, 201, "Mobile base64 must use the same recognition pipeline");
    const sent = generation.mock.calls.at(-1)!.arguments[0] as any;
    assert.equal(sent.contents[0].parts[0].inlineData.data, jpeg.toString("base64"), "Pass uploaded image bytes unchanged to vision");
    assert.equal(sent.contents[0].parts[0].inlineData.mimeType, "image/jpeg");
    assert.match(sent.config.responseJsonSchema.properties.pins.items.properties.top.description, /0–100/);
    assert.equal(sent.config.responseJsonSchema.properties.pins.maxItems, undefined, "Keep provider grammar compact; validate array bounds locally");
    const before = records.length;
    output = { isFood: false };
    assert.equal((await sendPhoto()).status, 422);
    output = { isFood: true, ingredients: "bad" };
    assert.equal((await sendPhoto()).status, 502);
    output = { ...(validOutput as object), accuracy: 0, dishes: [], ingredients: [
      { name: "Rau chưa rõ loại", confidence: "0%", icon: "leaf", source: "visible" },
    ], pins: [{ text: "Không có trong ảnh", top: 20, left: 20 }] };
    const uncertain = await sendPhoto();
    assert.equal(uncertain.status, 201);
    const uncertainResult = (await uncertain.json()).data;
    assert.equal(uncertainResult.accuracy, 0);
    assert.equal(uncertainResult.ingredients[0].confidence, "0%");
    assert.deepEqual(uncertainResult.dishes, []);
    assert.deepEqual(uncertainResult.pins, []);
    records.pop();
    output = { ...(validOutput as object), dishes: [], ingredients: [{ name: "Nước tương", confidence: "99%", icon: "bottle-tonic", source: "inferred" }] };
    assert.equal((await sendPhoto()).status, 422);
    output = { ...(validOutput as object), accuracy: undefined };
    assert.equal((await sendPhoto()).status, 502, "Missing confidence must not be fabricated");
    generation.mock.mockImplementation(async () => { throw Object.assign(new Error("unavailable"), { status: 429 }); });
    const quotaResponse = await sendPhoto();
    assert.equal(quotaResponse.status, 503);
    assert.match((await quotaResponse.json()).message, /hạn mức/);
    assert.equal(records.length, before, "Failures must never create sample history");
    assert.equal(cleanup.mock.callCount(), 5, "Remove only uploads from failed scans");
    upload.mock.mockImplementation(() => { throw new Error("storage down"); });
    const callsBeforeStorageFailure = generation.mock.callCount();
    assert.equal((await sendPhoto()).status, 503);
    assert.equal(generation.mock.callCount(), callsBeforeStorageFailure, "Do not spend AI tokens when upload fails");
    assert.equal((await fetch(url + "/unknown", { headers })).status, 404);
    output = validOutput;
    console.log("PASS: camera/gallery multipart uploads, MIME/signature/size validation, 201/400/401/404/413/422/502/503, real-image persistence, exclusion of inferred ingredients, exact recipe matching and failure cleanup; no live provider or database calls.");
  } finally {
    mock.restoreAll();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
