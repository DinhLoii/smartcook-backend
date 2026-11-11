import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCookingCommand, resolveCookingCommand } from "../utils/cookingCommands";
import type { CookingCopilotResponse } from "../services/ai.service";
import { aiService } from "../services/ai.service";
import { geminiClient } from "../config/gemini";

async function main() {
  assert.equal(
    readFileSync(resolve(__dirname, "../utils/cookingCommands.ts"), "utf8").replace(/\r\n/g, "\n"),
    readFileSync(resolve(__dirname, "../../../smartcook-mobile/src/utils/cookingCommands.ts"), "utf8").replace(/\r\n/g, "\n"),
    "Online and offline command rules must stay identical",
  );
  const cases: [string, string, number?][] = [
    ["lùi", "PREV_STEP"], ["lùi bước đi", "PREV_STEP"],
    ["quay lại bước trước vì thịt chưa chín", "PREV_STEP"],
    ["lui lai", "PREV_STEP"], ["quay lại bước trước, đừng cộng thêm", "NONE"],
    ["lùi 30 giây", "REDUCE_TIMER", 30], ["giảm một phút", "REDUCE_TIMER", 60],
    ["trừ ba mươi giây", "REDUCE_TIMER", 30],
    ["bớt 1 phút 30 giây", "REDUCE_TIMER", 90], ["lui 30s", "REDUCE_TIMER", 30],
    ["lùi thời gian", "NONE"], ["lùi 30", "NONE"],
    ["thêm 2 phút", "EXTEND_TIMER", 120], ["tăng nửa phút", "EXTEND_TIMER", 30],
    ["thêm một phút rưỡi", "EXTEND_TIMER", 90],
    ["Bạn có thể thêm 2 phút cho mình không?", "EXTEND_TIMER", 120],
    ["Bạn có thể cộng thêm hai phút không?", "EXTEND_TIMER", 120],
    ["Cho mình thêm hai phút có được không?", "EXTEND_TIMER", 120],
    ["Bạn có thể trừ đi 2 phút cho mình không?", "REDUCE_TIMER", 120],
    ["Có thể giảm hai phút không?", "REDUCE_TIMER", 120],
    ["Giúp mình bớt 30 giây có được không?", "REDUCE_TIMER", 30],
    ["đừng thêm 2 phút", "NONE"], ["không lùi bước", "NONE"],
    ["lùi bước rồi chuyển bước tiếp theo", "NONE"],
    ["giảm 0 giây", "NONE"], ["giảm 500 phút", "NONE"],
    ["đã xong rồi", "NEXT_STEP"], ["nghe lại", "REPEAT_STEP"],
  ];
  const generation = mock.method(geminiClient.models, "generateContent", async () => ({
    text: '{"speechReply":"Bạn kiểm tra món ăn nhé.","action":"EXTEND_TIMER","actionPayload":{"extendSeconds":120}}',
  }));
  const payload = {
    recipeTitle: "Cơm gà", currentStep: { stepNumber: 2, title: "Pha sốt", description: "Khuấy đều sốt." },
    userVoiceText: "",
  };
  try {
    for (const [text, action, seconds] of cases) {
      {
        const result = parseCookingCommand(text);
        assert.equal(result?.action, action, text);
        if (seconds) assert.equal(result?.actionPayload?.reduceSeconds ?? result?.actionPayload?.extendSeconds, seconds, text);
      }
      const result = await aiService.cookingVoiceCopilot("test", { ...payload, userVoiceText: text });
      assert.equal(result.action, action, text);
    }
    assert.equal(generation.mock.callCount(), 0, "Explicit commands must bypass model guesses");
    const navigation = {
      ...payload,
      recipeTitle: "Phở Bò Tái Lăn Hà Nội",
      currentStep: { stepNumber: 1, title: "Nấu nước dùng", description: "Nấu nước dùng phở." },
      recipeContext: { ingredients: [], steps: Array.from({ length: 5 }, (_, index) => ({
        stepNumber: index + 1, title: `Bước ${index + 1}`, description: "Nấu phở.",
      })) },
    };
    const stepCases: [string, string, number?][] = [
      ["Chuyển sang bước thứ hai nấu ăn cho mình.", "GO_TO_STEP", 2],
      ["Chuyển qua bước 2", "GO_TO_STEP", 2],
      ["Cho mình sang bước số ba", "GO_TO_STEP", 3],
      ["Qua bước thứ tư giúp tôi", "GO_TO_STEP", 4],
      ["Chuyen sang buoc thu nam", "GO_TO_STEP", 5],
      ["Bạn có thể chuyển bước hai giúp mình được không?", "GO_TO_STEP", 2],
      ["Chuyển sang bước tiếp theo", "NEXT_STEP"],
      ["Chuyển bước giúp mình", "NEXT_STEP"],
      ["Qua bước giúp mình", "NEXT_STEP"],
      ["Sang bước tiếp giúp tôi", "NEXT_STEP"],
      ["Chuyển sang bước khác", "NONE"],
      ["Đừng chuyển sang bước 2", "NONE"],
      ["Chuyển bước 0", "NONE"], ["Chuyển bước -1", "NONE"],
      ["Chuyển bước 2.5", "NONE"], ["Chuyển bước 1000", "NONE"],
      ["Chuyển bước 6", "NONE"], ["Chuyển sang bước một", "NONE"],
      ["Chuyển bước hai hoặc bước ba", "NONE"],
      ["Chuyển bước 2 rồi thêm 1 phút", "NONE"],
    ];
    // Exercise the same action executor used by the mobile hook, without loading React Native.
    const mobileActions = require(resolve(__dirname, "../../../smartcook-mobile/src/utils/cookingVoiceActions.ts")) as {
      applyCookingVoiceAction: (response: CookingCopilotResponse, handlers: {
        onGoToStep: (step: number) => void; onNextStep: () => void; onPrevStep: () => void;
      }) => void;
      getCookingStepIndex: (steps: { stepNumber: number }[], number: number) => number;
    };
    for (const [text, action, target] of stepCases) {
      const response = await aiService.cookingVoiceCopilot("navigation-tests", { ...navigation, userVoiceText: text });
      assert.equal(response.action, action, text);
      let visibleStep = 1;
      mobileActions.applyCookingVoiceAction(response, {
        onGoToStep: (number) => { visibleStep = number; },
        onNextStep: () => { visibleStep++; }, onPrevStep: () => { visibleStep--; },
      });
      assert.equal(visibleStep, target ?? (action === "NEXT_STEP" ? 2 : 1), text);
      if (target) assert.equal(response.actionPayload?.targetStep, target, text);
    }
    const backToFirst = resolveCookingCommand("Quay về bước đầu tiên", { ...navigation, currentStep: { ...navigation.currentStep, stepNumber: 3 } });
    assert.equal(backToFirst?.actionPayload?.targetStep, 1);
    assert.equal(resolveCookingCommand("Chuyển sang bước trước", { ...navigation, currentStep: { ...navigation.currentStep, stepNumber: 3 } })?.action, "PREV_STEP");
    assert.equal(parseCookingCommand("Chuyển bước mười hai")?.actionPayload?.targetStep, 12);
    assert.equal(parseCookingCommand("Chuyển bước hai mươi mốt")?.actionPayload?.targetStep, 21);
    assert.equal(parseCookingCommand("Có nên chuyển bước hai không?"), null);
    assert.equal(parseCookingCommand("Bước thứ hai cần làm gì?"), null);
    assert.equal(resolveCookingCommand("Chuyển bước hai", payload)?.action, "NONE");
    assert.equal(mobileActions.getCookingStepIndex([{ stepNumber: 1 }, { stepNumber: 4 }], 4), 1);
    assert.equal(mobileActions.getCookingStepIndex(navigation.recipeContext.steps, 9), -1);
    assert.equal(generation.mock.callCount(), 0, "Navigation must not need any generative model calls");
    const firstStep = await aiService.cookingVoiceCopilot("test", {
      ...payload, currentStep: { ...payload.currentStep, stepNumber: 1 }, userVoiceText: "lùi",
    });
    assert.equal(firstStep.action, "NONE");
    assert.equal(parseCookingCommand("chưa xong"), null);
    assert.equal(parseCookingCommand("giảm lửa xuống"), null);
    await assert.rejects(aiService.cookingVoiceCopilot("test", { ...payload, userVoiceText: "thịt chưa chín" }),
      { statusCode: 502 }, "Model advice must not silently add time");
    generation.mock.mockImplementation(async () => { throw new Error("offline"); });
    await assert.rejects(aiService.cookingVoiceCopilot("test", { ...payload, userVoiceText: "chưa xong" }),
      { statusCode: 503 }, "Unfinished must not match finished or add time");
    console.log(`PASS: ${cases.length + stepCases.length} command/navigation cases, mobile action dispatch, numbered-step boundaries, model override and offline fallback.`);
  } finally {
    mock.restoreAll();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
