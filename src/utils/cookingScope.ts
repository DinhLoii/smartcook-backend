import { parseCookingCommand, readStepNumber } from "./cookingCommands";

export interface CookingNutrition {
  calories?: number;
  proteinGrams?: number;
  carbsGrams?: number;
  fatGrams?: number;
  fiberGrams?: number;
  sugarGrams?: number;
  sodiumMilligrams?: number;
  basis?: "per_serving" | "whole_recipe" | "unspecified";
}

/** Preserve unknown values and zero; never substitute nutrition from another recipe. */
export function normalizeCookingNutrition(input: unknown, calories?: unknown): CookingNutrition | undefined {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const number = (value: unknown, unit: string): number | undefined => {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
    if (typeof value !== "string") return undefined;
    const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kcal|mg|g)?$/i);
    if (!match) return undefined;
    const amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount)) return undefined;
    const sourceUnit = match[2]?.toLowerCase();
    if (!sourceUnit || sourceUnit === unit) return amount;
    if (sourceUnit === "g" && unit === "mg") return amount * 1000;
    if (sourceUnit === "mg" && unit === "g") return amount / 1000;
    return undefined;
  };
  const nutrition: CookingNutrition = {
    calories: number(raw.calories ?? calories, "kcal"),
    proteinGrams: number(raw.proteinGrams ?? raw.protein, "g"),
    carbsGrams: number(raw.carbsGrams ?? raw.carbs, "g"),
    fatGrams: number(raw.fatGrams ?? raw.fat, "g"),
    fiberGrams: number(raw.fiberGrams ?? raw.fiber, "g"),
    sugarGrams: number(raw.sugarGrams ?? raw.sugar, "g"),
    sodiumMilligrams: number(raw.sodiumMilligrams ?? raw.sodium, "mg"),
    basis: raw.basis === "per_serving" || raw.basis === "whole_recipe" ? raw.basis : "unspecified",
  };
  return Object.entries(nutrition).some(([key, value]) => key !== "basis" && value !== undefined) ? nutrition : undefined;
}

export interface CookingScopeContext {
  recipeTitle: string;
  currentStep: { stepNumber: number; title: string; description: string };
  recipeContext?: {
    ingredients: { name: string; amount: string }[];
    steps: { stepNumber: number; title: string; description: string; timerMinutes?: number }[];
    servings?: string;
    nutrition?: CookingNutrition;
  };
  conversationHistory?: { role: "user" | "assistant"; text: string }[];
}

export const COOKING_SCOPE_REFUSAL = "Mình chỉ hỗ trợ món đang nấu. Bạn hãy hỏi về nguyên liệu, cách làm, bước nấu hoặc hẹn giờ nhé.";
export const COOKING_CLARIFICATION = "Bạn đang hỏi nguyên liệu hay thao tác nào của món này? Hãy nói rõ hơn nhé.";

export function normalizeCookingText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function mentionsIngredient(text: string, name: string): boolean {
  return name.split(/[()]/).some((label) => {
    const alias = normalizeCookingText(label);
    return alias.length >= 2 && ` ${text} `.includes(` ${alias} `);
  });
}

/** Step explanations are recipe lookups, not model advice or navigation commands. */
export function getCookingStepReply(input: string, context: CookingScopeContext): string | null {
  const text = normalizeCookingText(input);
  const asksWhatToDo = /^(?:(?:bay )?gio |minh |tiep theo |roi |phai |can |nen )*lam gi(?: (?:tiep|tiep theo|bay gio|gio))?$/.test(text);
  if ((!/\bbuoc\b/.test(text) && !asksWhatToDo) || /\b(tai sao|vi sao|co nen|neu|duoc khong|chua chin|bi chay|bi man)\b/.test(text)) return null;
  if (/(?:bước|buoc)\s*(?:(?:thứ|thu|số|so)\s*)?(?:-\d|\d+[.,]\d)/i.test(input)) return "Số bước không hợp lệ. Bạn hãy hỏi một bước trong danh sách trên màn hình nhé.";
  if (/\b(nguyen lieu|gia vi|dinh duong|calo|protein|tinh bot|chat beo)\b/.test(text)) return null;
  if (/\b(bao nhieu|may muong|may gam|may ml)\b/.test(text) && !/\b(phut|giay|thoi gian)\b/.test(text)) return null;
  const question = /\b(thao tac|noi dung|gom|la gi|ra sao|lam the nao|lam nhu the nao|lam gi|lam nhung gi|can lam|huong dan|chi tiet|thuc hien|nhung gi|doc|nghe|nhac|bao lau|may phut|thoi gian)\b/.test(text)
    || /^buoc\s+(?:thu\s+|so\s+)?(?:\d+|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|dau|cuoi|nay)\b/.test(text);
  if (!question || /\b(chuyen|nhay|lui)\b/.test(text) && !/\b(gom|lam gi|thao tac|noi dung|nhung gi)\b/.test(text)) return null;
  const steps = context.recipeContext?.steps || [];
  const currentIndex = steps.findIndex((step) => step.stepNumber === context.currentStep.stepNumber);
  const matches = [...text.matchAll(/\bbuoc\s+(?:(?:thu|so)\s+)?(dau tien|cuoi cung|cuoi|hien tai|nay|tiep theo|tiep|sau|truoc|-?\d+(?:[.,]\d+)?|(?:khong|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi|tram)(?:\s+(?:khong|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi|tram))*)\b/g)];
  if (matches.length > 1) return "Bạn muốn nghe nội dung bước nào? Hãy hỏi một bước cụ thể nhé.";
  const reference = matches[0]?.[1] ?? (asksWhatToDo && /\btiep(?: theo)?\b/.test(text) ? "tiep theo" : undefined);
  let target = context.currentStep.stepNumber;
  if (reference && !["nay", "hien tai"].includes(reference)) {
    if (["cuoi", "cuoi cung"].includes(reference)) target = steps.at(-1)?.stepNumber ?? -1;
    else if (["tiep theo", "tiep", "sau", "truoc"].includes(reference)) {
      target = currentIndex < 0 ? -1 : steps[currentIndex + (reference === "truoc" ? -1 : 1)]?.stepNumber ?? -1;
    } else target = readStepNumber(reference) ?? -1;
  }
  const step = steps.find((item) => item.stepNumber === target) || (target === context.currentStep.stepNumber ? context.currentStep : undefined);
  if (!step) return "Công thức không có bước bạn hỏi. Bạn hãy chọn một bước trong danh sách trên màn hình nhé.";
  if (target === context.currentStep.stepNumber && /\b(con bao lau|con may phut|con bao nhieu giay)\b/.test(text)) return null;
  if (/\b(bao lau|may phut|bao nhieu phut|thoi gian)\b/.test(text)) {
    const minutes = "timerMinutes" in step ? step.timerMinutes : undefined;
    return typeof minutes === "number" && minutes > 0
      ? `Thời lượng dự kiến của bước ${step.stepNumber} trong công thức là ${minutes} phút. Hẹn giờ thực tế có thể đã được bạn điều chỉnh.`
      : `Công thức chưa ghi thời lượng cho bước ${step.stepNumber}. Bạn có thể tự đặt hẹn giờ trên màn hình.`;
  }
  const heading = normalizeCookingText(step.title) === `buoc ${step.stepNumber}` ? `Bước ${step.stepNumber}` : `Bước ${step.stepNumber}: ${step.title}`;
  if (!step.description.trim()) return `${heading}. Công thức chưa ghi hướng dẫn chi tiết cho bước này.`;
  return `${heading}. ${step.description}`;
}

/** A conservative, local gate. Unknown intent asks for detail instead of spending model tokens. */
export function getCookingScopeReply(input: string, context: CookingScopeContext): string | null {
  if (input.length > 600) return "Bạn hãy hỏi ngắn gọn một vấn đề của món đang nấu, tối đa 600 ký tự nhé.";
  const text = normalizeCookingText(input);
  if (!text) return COOKING_CLARIFICATION;
  const offTopic = /\b(bitcoin|crypto|chung khoan|co phieu|ty gia|bong da|the thao|thoi tiet|du lich|chinh tri|tong thong|bau cu|nguoi yeu|tan gai|hen ho|tu vi|xem boi|ca si|dien vien|phim|choi game|lap trinh|viet code|javascript|python|sql|bai tap|giai toan|ke chuyen|viet tho|dich sang|translate)\b/;
  const injection = /\b(bo qua|quen|ignore|override)\b.{0,50}\b(chi dan|huong dan|quy tac|instructions|prompt|system)\b|\b(system prompt|developer message|api key|mat khau|token bi mat)\b/;
  if (offTopic.test(text) || injection.test(text)) return COOKING_SCOPE_REFUSAL;

  // Starting another recipe is outside this screen; substitutions for this dish remain in scope.
  if (/\b(cach nau|cach lam|cong thuc|day nau|huong dan nau|dinh duong|calo|calories|kcal|protein|chat beo|tinh bot)\b/.test(text)) {
    const namedDish = text.match(/\b(pho|bun bo|bun cha|pizza|sushi|banh mi|banh xeo|com tam|lau thai)\b/);
    if (namedDish && !normalizeCookingText(context.recipeTitle).includes(namedDish[0])
      && !/\b(thay|thay the|mon nay|mon dang nau)\b/.test(text)) return COOKING_SCOPE_REFUSAL;
  }
  if (/^(xin chao|chao|hello|hi|cam on|cam on ban|ok|oke|duoc roi)[.! ]*$/.test(text)) {
    return "Mình sẵn sàng hỗ trợ món đang nấu. Bạn cần giúp ở bước nào?";
  }
  if (parseCookingCommand(input)) return null;
  if (getCookingStepReply(input, context)) return null;

  const cookingIntent = /\b(dinh duong|calo|calories|calorie|kcal|nang luong|protein|chat dam|dam|fat|bao nhieu duong|carbs?|carbohydrate|tinh bot|chat beo|lipid|chat xo|fiber|sugar|luong duong|natri|sodium|macro|nau|chien|xao|hap|luoc|nuong|ham|uop|nem|tron|khuay|dao|cat|thai|bam|so che|rua|ra dong|bao quan|thay the|thay bang|co the thay|nguyen lieu|gia vi|dinh luong|khau phan|nhiet do|lua|chao nau|noi nau|bep|hen gio|dong ho|thoi gian|phut|giay|con bao lau|chua chin|chua xong|bi man|qua man|bi chay|bi khet|bi song|thit|sot|mon nay|mon dang nau|buoc nay|buoc hien tai|buoc thu|buoc nao|dang lam gi|buoc \d+|nuoc mam|mat ong|nuoc tuong|gung|muoi|dau an|di ung)\b/;
  if (cookingIntent.test(text)) return null;

  // Ingredient names from the actual recipe support questions such as "mirin dùng bao nhiêu?".
  const ingredientQuestion = /\b(bao nhieu|may|thieu|het|khong co|dung|cho|bo|thay|co can|duoc khong)\b/;
  if (ingredientQuestion.test(text) && context.recipeContext?.ingredients.some((item) => {
    const name = normalizeCookingText(item.name);
    return name.length >= 3 && (mentionsIngredient(text, item.name)
      || name.split(" ").some((word) => word.length >= 4 && ` ${text} `.includes(` ${word} `)));
  })) return null;

  // Only short follow-ups with an actual recent cooking question can reuse context.
  const followUp = /^(tai sao|vi sao|bao nhieu|bao lau|nhu vay duoc khong|lam vay duoc khong|con cach khac khong|cai do thi sao|vay thi sao|the con|vay con)\b/;
  const lastQuestion = context.conversationHistory?.filter((turn) => turn.role === "user").at(-1);
  if (followUp.test(text) && lastQuestion && cookingIntent.test(normalizeCookingText(lastQuestion.text))
    && !offTopic.test(normalizeCookingText(lastQuestion.text))) return null;
  return COOKING_CLARIFICATION;
}

/** Read facts that are already known, without asking a model to guess quantities or timer state. */
export function getCookingFactReply(input: string, context: CookingScopeContext & {
  stepTimer?: { remainingSeconds?: number; isRunning?: boolean };
}): string | null {
  const text = normalizeCookingText(input);
  const stepReply = getCookingStepReply(input, context);
  if (stepReply) return stepReply;
  if (/\b(dang o buoc nao|buoc hien tai la gi|dang lam gi)\b/.test(text)) {
    return `Bạn đang ở bước ${context.currentStep.stepNumber}: ${context.currentStep.title}. ${context.currentStep.description}`;
  }
  const nutrients: { key: keyof CookingNutrition; label: string; unit: string; pattern: RegExp }[] = [
    { key: "calories", label: "năng lượng", unit: "kcal", pattern: /\b(calo|calories|calorie|kcal|nang luong)\b/ },
    { key: "proteinGrams", label: "đạm", unit: "g", pattern: /\b(protein|chat dam|dam)\b/ },
    { key: "carbsGrams", label: "tinh bột", unit: "g", pattern: /\b(carbs?|carbohydrate|tinh bot)\b/ },
    { key: "fatGrams", label: "chất béo", unit: "g", pattern: /\b(fat|chat beo|lipid)\b/ },
    { key: "fiberGrams", label: "chất xơ", unit: "g", pattern: /\b(fiber|chat xo)\b/ },
    { key: "sugarGrams", label: "đường", unit: "g", pattern: /\b(sugar|luong duong|bao nhieu duong)\b/ },
    { key: "sodiumMilligrams", label: "natri", unit: "mg", pattern: /\b(natri|sodium)\b/ },
  ];
  const selected = nutrients.filter((item) => item.pattern.test(text));
  const nutritionQuestion = /\b(dinh duong|thanh phan dinh duong|macro)\b/.test(text) || selected.length > 0;
  if (nutritionQuestion && !/\b(co nen|phu hop|tot cho|tot khong|tai sao|vi sao|tang co|giam can|tieu duong|thay|them|tang|giam|bot|tinh lai|gap doi|gap ba)\b/.test(text)) {
    const nutrition = context.recipeContext?.nutrition;
    const wanted = selected.length ? selected : nutrients;
    const known = wanted.filter((item) => typeof nutrition?.[item.key] === "number" && Number.isFinite(nutrition[item.key]) && Number(nutrition[item.key]) >= 0);
    if (!known.length) return "Công thức này chưa có số liệu dinh dưỡng bạn hỏi. Mình chưa thể đưa ra con số chính xác và sẽ không tự đoán nhé.";
    const values = known.map((item) => `${item.label} ${nutrition![item.key]} ${item.unit}`).join(", ");
    const basis = nutrition?.basis === "per_serving" ? "cho một khẩu phần" : nutrition?.basis === "whole_recipe" ? "cho toàn bộ món" : "chưa ghi rõ cho một phần hay toàn bộ món";
    const missing = selected.length && known.length < wanted.length ? " Một số chỉ số bạn hỏi chưa được ghi." : "";
    return `Số liệu tham khảo của ${context.recipeTitle} (${basis}): ${values}.${missing}`;
  }
  if (/\b(con bao lau|con may phut|con bao nhieu giay|hen gio con|dong ho con)\b/.test(text)) {
    const seconds = context.stepTimer?.remainingSeconds;
    if (seconds === undefined) return "Mình chưa có số giây còn lại. Bạn kiểm tra bộ hẹn giờ trên màn hình nhé.";
    const duration = Math.max(0, Math.floor(seconds));
    return `Hẹn giờ còn ${Math.floor(duration / 60)} phút ${duration % 60} giây${context.stepTimer?.isRunning ? "." : ", đang dừng."}`;
  }
  const ingredients = context.recipeContext?.ingredients ?? [];
  if (/\b(?:nguyen lieu|gia vi)\b/.test(text) && /\b(can nhung gi|gom nhung gi|gom gi|can gi|nhung nguyen lieu nao|danh sach|liet ke)\b/.test(text)
    && !/\b(buoc|thay|them|bot|gap doi|gap ba)\b/.test(text) && ingredients.length) {
    return "Nguyên liệu cho toàn bộ công thức: " + ingredients.map((item) => [item.name, item.amount].filter(Boolean).join(" ")).join("; ") + ".";
  }
  if (/\b(bao nhieu|may muong|may gam|may gram|may ml|dinh luong)\b/.test(text)
    && !/\b(thay|gap doi|gap ba|khau phan|tang|giam|them|da dung|da cho|con lai|buoc|gia|tien|calo|calories|protein|dam|chat beo)\b/.test(text)) {
    const matches = ingredients.filter((item) => mentionsIngredient(text, item.name));
    if (matches.length) return "Theo toàn bộ công thức: " + matches.map((item) => `${item.name}: ${item.amount || "công thức chưa ghi định lượng"}`).join(". ") + ".";
  }
  return null;
}
