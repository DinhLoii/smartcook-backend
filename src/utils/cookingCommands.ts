export interface CookingCommand {
  action: "EXTEND_TIMER" | "REDUCE_TIMER" | "NEXT_STEP" | "PREV_STEP" | "GO_TO_STEP" | "REPEAT_STEP" | "NONE";
  speechReply: string;
  actionPayload?: { extendSeconds?: number; reduceSeconds?: number; targetStep?: number };
  suggestedQuickReplies?: string[];
}

export function readStepNumber(value: string): number | null {
  if (/^-?\d+(?:[.,]\d+)?$/.test(value)) return Number(value.replace(",", "."));
  if (value === "dau tien") return 1;
  if (value === "mot tram") return 100;
  const units: Record<string, number> = { khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5, sau: 6, bay: 7, tam: 8, chin: 9 };
  const words = value.split(" ");
  if (words.length === 1) return value === "muoi" ? 10 : units[value] ?? null;
  const tensIndex = words.indexOf("muoi");
  if (tensIndex > 1 || tensIndex < 0 || words.length > tensIndex + 2) return null;
  const tens = tensIndex === 0 ? 1 : units[words[0]];
  const ones = words[tensIndex + 1] === undefined ? 0 : units[words[tensIndex + 1]];
  return tens === undefined || ones === undefined ? null : tens * 10 + ones;
}

/** Explicit controls take priority over model guesses, including during offline fallback. */
export function parseCookingCommand(input: string): CookingCommand | null {
  const text = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/[^a-z0-9.,\s-]/g, " ").replace(/\s+/g, " ").trim();
  const unchanged = (speechReply: string): CookingCommand => ({ action: "NONE", speechReply });
  // A polite request is still an instruction; "có ... không" alone must not
  // turn "Bạn có thể thêm 2 phút cho mình không?" into model advice.
  const controlVerb = /\b(them|tang|cong|gia han|giam|tru|bot|rut ngan|lui|chuyen|doc lai|nghe lai)\b/;
  const politeRequest = controlVerb.test(text) && (
    /\b(giup|dum|ho|cho (?:minh|toi|em|anh|chi))\b/.test(text)
    || /^(?:ban\s+)?co the\s+(them|tang|cong|gia han|giam|tru|bot|rut ngan|lui|chuyen|doc lai|nghe lai)\b/.test(text)
  );
  // Asking what a step contains never authorizes navigation or changing its timer.
  if (/\bbuoc\b/.test(text) && /\b(thao tac|noi dung|gom|la gi|ra sao|lam the nao|lam nhu the nao|lam gi|lam nhung gi|can lam|bao lau|may phut|nhung gi)\b/.test(text)) return null;
  // Asking whether an action is appropriate is advice, not permission to execute it.
  if (/\b(co nen|co can|nen hay khong|neu|tai sao|vi sao)\b/.test(text)
    || (/\b(co|lieu)\b.*\b(khong|khong nhi)\b/.test(text)
      && !politeRequest)) return null;
  const back = /\b(lui|quay lai|tro lai|buoc truoc|previous|back)\b/.test(text);
  const forward = /\b(tiep theo|buoc tiep|buoc sau|next)\b/.test(text);
  const repeat = /\b(doc lai|nghe lai|noi lai|nhac lai|repeat)\b/.test(text);
  if (repeat && /\bbuoc\s+(?:(?:thu|so)\s+)?(?:\d+|dau|cuoi|hien tai|nay|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\b/.test(text)) return null;
  const decrease = /\b(lui|giam|tru|bot|rut ngan)\b/.test(text);
  const increase = /\b(them|tang|cong|gia han)\b/.test(text);
  const hasTime = /\b(phut|giay|gio|hen gio|thoi gian)\b|\d\s*[sp]\b/.test(text);

  if (repeat && (back || forward)) return unchanged("Bạn muốn đọc lại bước hiện tại hay chuyển bước? Hãy nói rõ giúp mình nhé.");

  if (/\b(khong|dung|chua)\b.{0,25}\b(lui|quay lai|chuyen|them|tang|cong|giam|tru|bot|doc lai|nghe lai)\b/.test(text)) {
    return unchanged("Mình giữ nguyên bước và hẹn giờ nhé.");
  }
  if ((back && forward) || (hasTime && decrease && increase)) {
    return unchanged("Bạn muốn lùi bước, giảm thời gian hay thêm thời gian? Hãy nói một yêu cầu nhé.");
  }
  const navigate = /\b(chuyen|sang|qua|toi|den|ve|nhay|quay lai|tro lai|lui|mo|bat dau)\b.{0,45}\bbuoc\b/.test(text);
  if (navigate && !repeat) {
    const targets = [...text.matchAll(/\bbuoc\s+(?:(?:thu|so)\s+)?(-?\d+(?:[.,]\d+)?|dau tien|(?:khong|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi)(?:\s+(?:khong|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi))*)\b/g)];
    if (targets.length > 1 || (targets.length && hasTime)) return unchanged("Bạn muốn chuyển tới bước nào? Hãy nói một số bước cụ thể nhé.");
    if (targets.length) {
      const targetStep = readStepNumber(targets[0][1]);
      if (targetStep === null || !Number.isInteger(targetStep) || targetStep < 1 || targetStep > 100) {
        return unchanged("Số bước không hợp lệ. Bạn muốn chuyển tới bước số mấy?");
      }
      return { action: "GO_TO_STEP", actionPayload: { targetStep }, speechReply: `Mình chuyển sang bước ${targetStep} nhé.` };
    }
    if (!back && !forward) {
      if (/\b(chuyen (?:sang |qua )?buoc|qua buoc)\b/.test(text) && !/\b(khac|thu|so|may|gi|nao)\b/.test(text)) {
        return { action: "NEXT_STEP", speechReply: "Mình chuyển sang bước tiếp theo nhé." };
      }
      return unchanged("Bạn muốn chuyển sang bước tiếp theo hay bước số mấy?");
    }
  }
  if (hasTime && (decrease || increase)) {
    const numbers: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10, nua: 0.5 };
    const pattern = /(-?\d+(?:[.,]\d+)?|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|nua)\s*(phut|giay|gio|s\b|p\b)(\s+ruoi\b)?/g;
    let seconds = 0;
    for (const match of text.matchAll(pattern)) {
      const amount = numbers[match[1]] ?? Number(match[1].replace(",", "."));
      const unit = match[2] === "gio" ? 3600 : ["phut", "p"].includes(match[2]) ? 60 : 1;
      seconds += (amount + (match[3] ? 0.5 : 0)) * unit;
    }
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600 || !Number.isInteger(seconds)) {
      return unchanged("Bạn muốn chỉnh bao nhiêu phút hoặc giây? Hãy nói rõ, ví dụ giảm 30 giây.");
    }
    return decrease
      ? { action: "REDUCE_TIMER", actionPayload: { reduceSeconds: seconds }, speechReply: `Mình giảm ${seconds} giây trên hẹn giờ, tối thiểu còn 0 giây nhé.` }
      : { action: "EXTEND_TIMER", actionPayload: { extendSeconds: seconds }, speechReply: `Mình cộng thêm ${seconds} giây vào hẹn giờ nhé.` };
  }
  if (back) {
    if (/\d/.test(text) && !/\bbuoc\b/.test(text)) return unchanged("Bạn muốn lùi bước hay giảm bao nhiêu giây trên hẹn giờ?");
    if (/\b[2-9]\d*\s*buoc\b/.test(text)) return unchanged("Mỗi lần mình lùi một bước. Bạn muốn quay về bước trước chứ?");
    return { action: "PREV_STEP", speechReply: "Mình quay lại bước trước nhé." };
  }
  if (repeat) return { action: "REPEAT_STEP", speechReply: "Mình đọc lại bước hiện tại nhé." };
  if (/\b(chua xong|chua chin|chua hoan thanh)\b/.test(text)) return null;
  if (forward || /\b(da xong|xong roi|chin roi|hoan thanh roi)\b/.test(text)) {
    return { action: "NEXT_STEP", speechReply: "Mình chuyển sang bước tiếp theo nhé." };
  }
  return null;
}

function formatStepSpeech(stepNumber: number, title: string, description?: string): string {
  const cleanTitle = title?.trim() || "";
  const prefix = /^bước\s+\d+/i.test(cleanTitle) ? cleanTitle : `Bước ${stepNumber}: ${cleanTitle}`;
  const desc = description?.trim() || "";
  if (!desc || desc === cleanTitle) return prefix;
  return `${prefix}. ${desc}`;
}

/** Resolve real step numbers instead of treating a spoken number as an array index. */
export function resolveCookingCommand(input: string, context: {
  currentStep: { stepNumber: number; title: string; description: string };
  recipeContext?: { steps: { stepNumber: number; title: string; description?: string }[] };
}): CookingCommand | null {
  const command = parseCookingCommand(input);
  if (!command) return null;
  const unchanged = (speechReply: string): CookingCommand => ({ action: "NONE", speechReply });
  const steps = context.recipeContext?.steps;
  if (command.action === "GO_TO_STEP") {
    const target = command.actionPayload?.targetStep;
    if (typeof target !== "number") return unchanged("Số bước không hợp lệ. Bạn muốn chuyển tới bước số mấy?");
    if (!steps?.length) return unchanged("Mình chưa có danh sách bước của món này. Bạn hãy chọn bước trên màn hình nhé.");
    const targetStepObj = steps.find((step) => step.stepNumber === target);
    if (!targetStepObj) return unchanged(`Món này không có bước ${target}. Bạn hãy chọn một bước trên màn hình nhé.`);
    if (target === context.currentStep.stepNumber) return unchanged(`Bạn đang ở bước ${target} rồi nhé.`);
    const stepSpeech = formatStepSpeech(target, targetStepObj.title, targetStepObj.description);
    return { ...command, speechReply: `Mình chuyển sang bước ${target} nhé. ${stepSpeech}` };
  }
  const currentIndex = steps?.findIndex((step) => step.stepNumber === context.currentStep.stepNumber) ?? -1;
  if (command.action === "PREV_STEP") {
    if (currentIndex === 0 || (!steps?.length && context.currentStep.stepNumber <= 1)) {
      return unchanged("Bạn đang ở bước đầu tiên rồi nhé.");
    }
    const prevStep = steps
      ? (currentIndex > 0 ? steps[currentIndex - 1] : steps.find((s) => s.stepNumber === context.currentStep.stepNumber - 1))
      : undefined;
    if (prevStep) {
      const stepSpeech = formatStepSpeech(prevStep.stepNumber, prevStep.title, prevStep.description);
      return { ...command, speechReply: `Mình đã quay lại bước ${prevStep.stepNumber} nhé. ${stepSpeech}` };
    }
  }
  if (command.action === "NEXT_STEP") {
    if (steps?.length && currentIndex === steps.length - 1) {
      return unchanged("Bạn đang ở bước cuối. Hãy bấm Hoàn thành trên màn hình khi món đã sẵn sàng nhé.");
    }
    const nextStep = steps
      ? (currentIndex >= 0 && currentIndex < steps.length - 1 ? steps[currentIndex + 1] : steps.find((s) => s.stepNumber === context.currentStep.stepNumber + 1))
      : undefined;
    if (nextStep) {
      const stepSpeech = formatStepSpeech(nextStep.stepNumber, nextStep.title, nextStep.description);
      return { ...command, speechReply: `Mình chuyển sang bước ${nextStep.stepNumber} nhé. ${stepSpeech}` };
    }
  }
  if (command.action === "REPEAT_STEP") return { ...command,
    speechReply: formatStepSpeech(context.currentStep.stepNumber, context.currentStep.title, context.currentStep.description) };
  return command;
}
