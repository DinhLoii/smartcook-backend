import assert from "node:assert/strict";
import { mock } from "node:test";
import express from "express";
import { AddressInfo } from "node:net";
import { cookingAudioSchema } from "../validators/cooking-audio.validator";
import { cookingCopilotSchema } from "../validators/cooking-copilot.validator";
import { cookingAudioService } from "../services/cooking-audio.service";
import { geminiClient } from "../config/gemini";
import { validate } from "../middlewares/validate";
import { errorHandler } from "../middlewares/errorHandler";
import { aiController } from "../controllers/ai.controller";
import aiRouter from "../routes/ai.routes";
import { MealPlan } from "../models/MealPlan";
import { plannerRepository } from "../repositories/planner.repository";

async function main() {
  const originalKey = process.env.GEMINI_API_KEY;
  const body = { audioBase64: Buffer.from("test audio").toString("base64"), mimeType: "audio/mp4" };
  assert.ok(cookingAudioSchema.validate({}).error);
  assert.ok(cookingAudioSchema.validate({ ...body, mimeType: "image/png" }).error);
  assert.ok(cookingAudioSchema.validate({ ...body, audioBase64: "!invalid!" }).error);
  assert.ok(cookingAudioSchema.validate({ ...body, audioBase64: "a".repeat(2_800_004) }).error);
  assert.equal(cookingAudioSchema.validate(body).error, undefined);

  const app = express();
  app.use(express.json());
  // Exercise validation and controller with a controlled, authenticated test boundary.
  app.post("/test", validate(cookingAudioSchema), aiController.transcribeCookingAudio);
  app.post("/test-copilot", validate(cookingCopilotSchema), aiController.cookingVoiceCopilot);
  app.use("/ai", aiRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, data: object) => fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  try {
    assert.equal((await post("/ai/cooking-transcription", body)).status, 401);
    assert.equal((await post("/test", {})).status, 400);
    assert.equal((await post("/ai/cooking-copilot", {})).status, 401);
    assert.equal((await post("/test-copilot", {})).status, 400);
    const copilotReply = await post("/test-copilot", {
      recipeTitle: "Cơm gà", currentStep: { stepNumber: 2, title: "Pha sốt", description: "Khuấy đều." },
      userVoiceText: "Giá bitcoin hôm nay?",
    });
    assert.equal(copilotReply.status, 200);
    assert.equal((await copilotReply.json()).data.action, "NONE");
    assert.equal((await post("/test-copilot", {
      recipeTitle: "Cơm gà", currentStep: { stepNumber: 2, title: "Pha sốt", description: "Khuấy đều." },
      userVoiceText: "a".repeat(601),
    })).status, 400);
    assert.equal((await fetch(base + "/missing")).status, 404);
    assert.equal((await post("/ai/missing", body)).status, 401);
    process.env.GEMINI_API_KEY = "test-only";
    const generation = mock.method(geminiClient.models, "generateContent", async () => ({ text: '{"text":"Thêm hai phút"}' }));
    const response = await post("/test", body);
    assert.equal(response.status, 200);
    const transcription = await response.json();
    assert.equal(transcription.success, true);
    assert.equal(transcription.data.text, "Thêm hai phút");
    const parameters = generation.mock.calls[0].arguments[0] as unknown as { contents: { parts: { inlineData?: { mimeType: string } }[] }[] };
    assert.equal(parameters.contents[0].parts[0].inlineData?.mimeType, "audio/m4a");
    const config = (generation.mock.calls[0].arguments[0] as unknown as {
      config: { maxOutputTokens: number; responseJsonSchema: { required: string[] }; httpOptions: { timeout: number } };
    }).config;
    assert.equal(config.httpOptions.timeout, 15000);
    assert.ok(config.maxOutputTokens >= 1024, "Do not truncate the transcription JSON to save latency");
    assert.deepEqual(config.responseJsonSchema.required, ["text"]);
    generation.mock.mockImplementation(async () => ({ text: '{"text":""}' }));
    assert.equal((await post("/test", body)).status, 400);
    generation.mock.mockImplementation(async () => { throw new Error("provider unavailable"); });
    assert.equal((await post("/test", body)).status, 503);
    for (const [providerStatus, httpStatus, message] of [
      [400, 400, "không đọc được"], [401, 503, "chưa truy cập"],
      [403, 503, "chưa truy cập"], [429, 503, "hết hạn mức"],
    ] as const) {
      generation.mock.mockImplementation(async () => { throw Object.assign(new Error("private provider error"), { status: providerStatus }); });
      const failure = await post("/test", body);
      assert.equal(failure.status, httpStatus);
      const result = await failure.json();
      assert.ok(result.message.includes(message));
      assert.ok(!result.message.includes("private provider error"));
    }
    const adviceQuestion = {
      recipeTitle: "Cơm gà", currentStep: { stepNumber: 2, title: "Pha sốt", description: "Khuấy đều." },
      userVoiceText: "Nước sốt bị mặn thì xử lý sao?",
    };
    generation.mock.mockImplementation(async () => ({ text: JSON.stringify({
      scope: "in_scope", action: "TROUBLESHOOT", speechReply: "Nếm lại sốt sau khi pha loãng từng ít một.",
    }) }));
    const advice = await post("/test-copilot", adviceQuestion);
    assert.equal(advice.status, 200);
    const adviceBody = await advice.json();
    assert.equal(adviceBody.success, true);
    assert.equal(adviceBody.data.action, "TROUBLESHOOT");
    for (const status of [502, 503]) {
      generation.mock.mockImplementation(async () => {
        if (status === 503) throw Object.assign(new Error("provider busy"), { status: 429 });
        return { text: "invalid JSON" };
      });
      const failure = await post("/test-copilot", { ...adviceQuestion, userVoiceText: "Nước sốt quá mặn thì xử lý sao?" });
      assert.equal(failure.status, status);
      const failureBody = await failure.json();
      assert.equal(failureBody.success, false);
      assert.equal(failureBody.data, undefined);
    }
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(cookingAudioService.transcribe(body.audioBase64, body.mimeType), { statusCode: 503 });

    // Simulate the losing request in a concurrent weekly-plan insert.
    const existing = { marker: "existing plan" };
    mock.method(MealPlan, "findOneAndUpdate", () => ({
      populate: async () => { throw Object.assign(new Error("duplicate"), { code: 11000 }); },
    }));
    mock.method(MealPlan, "findOne", () => ({ populate: async () => existing }));
    assert.equal(await plannerRepository.getOrCreatePlan("507f1f77bcf86cd799439011"), existing);
    mock.method(MealPlan, "findOneAndUpdate", () => ({ populate: async () => existing }));
    const plans = await Promise.all(Array.from({ length: 8 }, () => plannerRepository.getOrCreatePlan("507f1f77bcf86cd799439011")));
    plans.forEach((plan) => assert.equal(plan, existing));
    console.log("PASS: audio validation, HTTP 200/400/401/503, provider failure, and weekly-plan insert race recovery.");
  } finally {
    mock.restoreAll();
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
