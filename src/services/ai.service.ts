import { foodVisionService } from "./food-vision.service";
import { Types } from "mongoose";
import { cookingCopilotService } from "./cooking-copilot.service";
import { geminiClient, GEMINI_MODEL, GEMINI_CANDIDATE_MODELS } from "../config/gemini";
import Recipe, { IRecipe } from "../models/Recipe";
import { IScanHistory, IScanDetectedIngredient, IScanPin, IScanSuggestedRecipe } from "../models/ScanHistory";
import { fridgeRepository } from "../repositories/fridge.repository";
import { scanHistoryRepository } from "../repositories/scanHistory.repository";
import { userRepository } from "../repositories/user.repository";
import { normalizeVietnamese } from "../utils/text";

export interface ScanIngredientResult {
  id: string;
  title: string;
  imageUrl: string;
  image: string; // Mobile compatibility
  accuracy: number;
  dishes?: { name: string; confidence: string; icon?: string }[];
  ingredients: IScanDetectedIngredient[];
  pins: IScanPin[];
  suggestedRecipe: IScanSuggestedRecipe;
  scannedAt: string;
}

export interface ChatMessageContext {
  sender: "user" | "ai";
  text: string;
}

export interface AssistantChatResponse {
  replyText: string;
  suggestedDishes: string[];
  quickPrompts: string[];
}

export interface CookingCopilotStep {
  stepNumber: number;
  title: string;
  description: string;
}

export interface CookingCopilotTimer {
  targetMinutes?: number;
  elapsedSeconds?: number;
  remainingSeconds?: number;
  isRunning?: boolean;
  isOverdue?: boolean;
  overdueSeconds?: number;
}

export interface CookingCopilotRequest {
  recipeTitle: string;
  currentStep: CookingCopilotStep;
  stepTimer?: CookingCopilotTimer;
  recipeContext?: {
    ingredients: { name: string; amount: string }[];
    steps: { stepNumber: number; title: string; description: string; timerMinutes?: number }[];
    servings?: string;
    nutrition?: import("../utils/cookingScope").CookingNutrition;
  };
  userVoiceText: string;
  conversationHistory?: { role: "user" | "assistant"; text: string }[];
}

export type CookingActionType =
  | "REDUCE_TIMER"
  | "EXTEND_TIMER"
  | "GO_TO_STEP"
  | "NEXT_STEP"
  | "PREV_STEP"
  | "REPEAT_STEP"
  | "TROUBLESHOOT"
  | "NONE";

export interface CookingCopilotResponse {
  speechReply: string;
  action: CookingActionType;
  actionPayload?: {
    extendSeconds?: number;
    reduceSeconds?: number;
    targetStep?: number;
  };
  suggestedQuickReplies?: string[];
}

export class AIService {
  /**
   * Helper to format date into friendly Vietnamese string
   */
  private formatScannedAt(date: Date): string {
    const now = new Date();
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");

    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();

    if (isToday) {
      return `Hôm nay, ${hours}:${minutes}`;
    }
    if (isYesterday) {
      return `Hôm qua, ${hours}:${minutes}`;
    }

    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}, ${hours}:${minutes}`;
  }

  /**
   * Scan image for ingredients, detection pins and suggested recipe
   */
  async scanIngredients(
    userId: string,
    imageBuffer: Buffer,
    mimeType: string,
    imageUrl: string,
    imagePublicId?: string
  ): Promise<ScanIngredientResult> {
    const parsed = await foodVisionService.analyze(imageBuffer, mimeType);
    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = await Recipe.findOne({ isActive: true, title: { $regex: `^${escapeRegex(parsed.suggestedRecipe.title)}$`, $options: "i" } }).exec();
    const scanDoc = await scanHistoryRepository.create({
      userId: new Types.ObjectId(userId), title: parsed.title, imageUrl, imagePublicId,
      accuracy: parsed.accuracy, dishes: parsed.dishes, ingredients: parsed.ingredients, pins: parsed.pins,
      suggestedRecipe: { ...parsed.suggestedRecipe, id: matched?._id.toString() }, scannedAt: new Date(),
    });
    return {
      id: scanDoc._id.toString(), title: scanDoc.title, imageUrl: scanDoc.imageUrl, image: scanDoc.imageUrl,
      accuracy: scanDoc.accuracy, dishes: scanDoc.dishes, ingredients: scanDoc.ingredients, pins: scanDoc.pins,
      suggestedRecipe: scanDoc.suggestedRecipe, scannedAt: this.formatScannedAt(scanDoc.scannedAt),
    };
  }

  /**
   * Get user's scan history list
   */
  async getUserScanHistory(userId: string, limit: number = 30): Promise<ScanIngredientResult[]> {
    const list = await scanHistoryRepository.findByUserId(userId, limit);
    return list.map((item) => ({
      id: item._id.toString(),
      title: item.title,
      imageUrl: item.imageUrl,
      image: item.imageUrl,
      accuracy: item.accuracy,
      dishes: item.dishes,
      ingredients: item.ingredients,
      pins: item.pins,
      suggestedRecipe: item.suggestedRecipe,
      scannedAt: this.formatScannedAt(item.scannedAt),
    }));
  }

  /**
   * Delete a scan history entry by ID
   */
  async deleteScanHistory(userId: string, scanId: string): Promise<boolean> {
    const scan = await scanHistoryRepository.findById(scanId);
    if (!scan) return false;

    if (scan.userId.toString() !== userId) {
      const error: any = new Error("Không có quyền xoá lịch sử quét này");
      error.statusCode = 403;
      throw error;
    }

    return await scanHistoryRepository.deleteById(scanId);
  }

  /**
   * Smart AI Chef Assistant Chat with Context Injection (Fridge + Preferences)
   */
  async assistantChat(
    userId: string,
    message: string,
    conversationHistory: ChatMessageContext[] = []
  ): Promise<AssistantChatResponse> {
    try {
      // 1. Context Injection: Get user preferences
      const isGuest = !userId || userId === "guest";
      const user = !isGuest ? await userRepository.findById(userId).catch(() => null) : null;
      const preferences = user?.preferences;

      // 2. Context Injection: Get user fridge items
      const fridge = !isGuest ? await fridgeRepository.getOrCreateFridge(userId).catch(() => null) : null;
      const fridgeIngredientNames = (fridge?.items || [])
        .map((it) => `${it.name}${it.amount ? ` (${it.amount})` : ""}`)
        .join(", ");

      const systemPrompt = `Bạn là Trợ lý Ảo SmartCook 👩‍🍳 - Bếp trưởng AI tận tâm, thấu hiểu dinh dưỡng và kỹ thuật nấu nướng gia đình.
NGỮ CẢNH CỦA NGƯỜI DÙNG HIỆN TẠI:
- Nguyên liệu đang có sẵn trong tủ lạnh: ${fridgeIngredientNames || "Tủ lạnh hiện chưa lưu nguyên liệu nào"}.
- Khẩu vị & Mục tiêu cá nhân:
  + Khẩu phần: ${preferences?.portion || "2-3"} người
  + Chế độ ăn kiêng / Hạn chế: ${(preferences?.restrictions || []).join(", ") || "Không có"}
  + Mục tiêu sức khoẻ: ${preferences?.healthGoal || "healthy (Ăn ngon khỏe, cân bằng)"}
  + Hương vị yêu thích: ${(preferences?.tasteProfile || []).join(", ") || "Đậm đà, thanh đạm"}
  + Phong cách ẩm thực: ${(preferences?.cuisines || []).join(", ") || "Việt Nam, Eat Clean"}
  + Thời gian nấu: ${preferences?.cookingTime || "standard (Dưới 30 phút)"}

YÊU CẦU:
1. Hãy trả lời câu hỏi của người dùng một cách ấm áp, súc tích, thực tế, kèm các mẹo nấu ăn hoặc gợi ý món phù hợp nhất với nguyên liệu tủ lạnh và khẩu vị của họ.
2. Trả về định dạng JSON thuần (KHÔNG có markdown codeblock \`\`\`json) theo đúng cấu trúc:
{
  "replyText": "Nội dung phản hồi chi tiết, dùng emoji sinh động, in đậm các mẹo và tên món ăn",
  "suggestedDishes": ["Tên món ăn 1", "Tên món ăn 2"],
  "quickPrompts": ["Gợi ý câu hỏi tiếp theo 1", "Gợi ý câu hỏi tiếp theo 2"]
}`;

      // Build conversation turns
      const recentHistory = conversationHistory.slice(-4).map((m) => ({
        role: m.sender === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: m.text }],
      }));

      const contents = [
        {
          role: "user" as const,
          parts: [{ text: systemPrompt }],
        },
        ...recentHistory,
        {
          role: "user" as const,
          parts: [{ text: message }],
        },
      ];

      let responseText = "{}";
      let lastChatErr: any = null;

      for (const candidateModel of GEMINI_CANDIDATE_MODELS) {
        try {
          const response = await geminiClient.models.generateContent({
            model: candidateModel,
            contents,
            config: {
              responseMimeType: "application/json",
              temperature: 0.6,
            },
          });
          if (response.text) {
            responseText = response.text;
            break;
          }
        } catch (err: any) {
          lastChatErr = err;
          console.warn(`⚠️ [AIService] AssistantChat with ${candidateModel} failed, trying next candidate...`);
        }
      }

      if (responseText === "{}" && lastChatErr) {
        throw lastChatErr;
      }

      let cleaned = responseText.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
      }
      const parsed = JSON.parse(cleaned);

      return {
        replyText:
          parsed.replyText ||
          "SmartCook đã ghi nhận câu hỏi của bạn. Hãy cho mình biết thêm nguyên liệu bạn muốn kết hợp nhé!",
        suggestedDishes: Array.isArray(parsed.suggestedDishes) ? parsed.suggestedDishes : [],
        quickPrompts: Array.isArray(parsed.quickPrompts)
          ? parsed.quickPrompts
          : ["Hôm nay ăn gì?", "Món thanh đạm ít dầu"],
      };
    } catch (err: any) {
      console.warn("⚠️ [AIService] Gemini Chat failed, executing smart fallback:", err?.message || err);
      return this.createChatFallback(message);
    }
  }

  /**
   * Smart fallback when Gemini Assistant Chat is unavailable or rate-limited
   */
  private createChatFallback(query: string): AssistantChatResponse {
    const lower = query.toLowerCase();
    const normalized = normalizeVietnamese(query);

    // Gà / Cơm gà / Teriyaki
    if (
      lower.includes("teriyaki") ||
      normalized.includes("com ga") ||
      normalized.includes("thit ga") ||
      normalized.includes("uc ga") ||
      lower.includes("gà")
    ) {
      return {
        replyText:
          `Chào bạn! Dưới đây là công thức chi tiết và các bước nấu món **Cơm Gà Teriyaki Áp Chảo** thơm lừng, da giòn vàng óng chuẩn vị Nhật:\n\n` +
          `🥣 **Nguyên liệu chuẩn bị (2 người ăn):**\n` +
          `- 2 miếng đùi gà rút xương hoặc ức gà phi lê (khoảng 350-400g)\n` +
          `- 2 chén cơm trắng dẻo nóng hổi\n` +
          `- **Nước sốt Teriyaki:** 3 thìa canh nước tương (xì dầu), 2 thìa canh mật ong (hoặc đường nâu), 2 thìa canh rượu nấu ăn (hoặc mirin), 1 thìa cà phê dầu mè, 1 nhánh gừng nhỏ băm nhuyễn, 2 tép tỏi băm.\n` +
          `- Mè trắng rang vàng, hành lá thái nhỏ, rau xà lách hoặc dưa leo ăn kèm.\n\n` +
          `👩‍🍳 **Các bước thực hiện:**\n` +
          `1. **Sơ chế thịt gà:** Gà rửa sạch với nước muối loãng, dùng khăn giấy thấm thật khô. Khứa nhẹ vài đường chéo bên trong thớ thịt để gà nhanh chín và ngấm gia vị sâu hơn.\n` +
          `2. **Pha sốt Teriyaki:** Khuấy đều nước tương, mật ong, rượu, dầu mè, tỏi và gừng băm trong bát nhỏ cho tan hết.\n` +
          `3. **Áp chảo da gà giòn rụm:** Đặt chảo lên bếp với 1 thìa cà phê dầu ăn ở lửa vừa. Đặt mặt da gà xuống trước, áp chảo khoảng 5-6 phút cho lớp mỡ dưới da tiết ra vàng ruộm và giòn rụm. Sau đó lật mặt thịt áp chảo thêm 3-4 phút nữa.\n` +
          `4. **Rim sốt đậm đà:** Rót toàn bộ hỗn hợp sốt Teriyaki vào chảo. Hạ lửa nhỏ liu riu, liên tục dùng thìa múc nước sốt rưới lên miếng gà cho đến khi sốt sánh lại, phủ đều lớp áo nâu bóng bẩy quanh miếng gà thì tắt bếp.\n` +
          `5. **Trình bày & Thưởng thức:** Thái gà thành từng lát vừa ăn. Xới cơm nóng ra bát hoặc đĩa sâu lòng, xếp thịt gà lên trên, rưới phần sốt sánh đậm đà trong chảo lên cơm, rắc thêm chút mè rang và hành lá xanh mát.\n\n` +
          `💡 *Bí quyết đầu bếp:* Thấm khô da gà trước khi áp chảo và không đậy nắp chảo sẽ giúp da gà đạt độ giòn chuẩn nhất mà không bị dai ướt!`,
        suggestedDishes: ["Cơm Gà Teriyaki Áp Chảo", "Salad Ức Gà Bơ Sốt Chanh Leo", "Canh Rong Biển Thịt Bò"],
        quickPrompts: ["Mẹo áp chảo da gà giòn", "Lượng calo trong 1 đĩa cơm gà", "Cách làm sốt Teriyaki bảo quản lâu"],
      };
    }

    // Bò / Bít tết / Bò sốt tiêu
    if (
      lower.includes("bò") ||
      normalized.includes("thit bo") ||
      normalized.includes("bit tet") ||
      normalized.includes("bo sot")
    ) {
      return {
        replyText:
          `Bếp gửi bạn công thức **Bò Bít Tết Sốt Tiêu Đen & Măng Tây** mềm mọng chuẩn nhà hàng:\n\n` +
          `🥩 **Nguyên liệu (2 phần):** 400g thăn bò (tenderloin hoặc ribeye), 150g măng tây non, 2 thìa bơ lạt, 2 tép tỏi đập dập, 1 nhánh hương thảo (rosemary), hạt tiêu đen đập dập, muối biển, dầu ô liu.\n\n` +
          `👩‍🍳 **Các bước chế biến:**\n` +
          `1. **Chuẩn bị thịt:** Để thịt bò về nhiệt độ phòng 20 phút trước khi nấu. Thấm khô, rắc muối biển và tiêu đen đều hai mặt.\n` +
          `2. **Làm nóng chảo:** Đun chảo gang thật nóng với 1 thìa dầu ô liu đến khi bốc khói nhẹ.\n` +
          `3. **Áp chảo:** Cho thịt vào áp chảo mỗi mặt 2-2.5 phút (độ chín Medium-Rare). Phút cuối cùng cho bơ lạt, tỏi và hương thảo vào, múc bơ nóng liên tục rưới lên mặt thịt.\n` +
          `4. **Nghỉ thịt (Bắt buộc):** Gắp thịt ra đĩa để nghỉ 5 phút cho nước ngọt trong thịt phân bổ đều, không bị chảy mất nước.\n` +
          `5. **Xào măng tây & làm sốt tiêu:** Dùng chảo vừa áp chảo, xào măng tây vừa chín tới giòn ngọt, nêm thêm chút tiêu đen xay và bơ làm sốt rưới lên thịt bò.\n\n` +
          `💡 *Bí quyết:* Tuyệt đối không cắt thịt ngay sau khi nhấc khỏi chảo để thịt luôn giữ trọn vị ngọt mọng mọng nước!`,
        suggestedDishes: ["Bò Bít Tết Sốt Tiêu Măng Tây", "Bò Lúc Lắc Khoai Tây", "Salad Bò Áp Chảo"],
        quickPrompts: ["Cách chọn phần thịt bò mềm", "Thời gian áp chảo theo độ chín", "Sốt tiêu đen ăn kèm"],
      };
    }

    // Eat clean / Thanh đạm / Giảm cân
    if (
      lower.includes("eat clean") ||
      lower.includes("thanh đạm") ||
      lower.includes("ít dầu") ||
      lower.includes("giảm cân") ||
      lower.includes("healthy")
    ) {
      return {
        replyText:
          `Gợi ý thực đơn **Eat Clean - Giàu Đạm Ít Calo** chuẩn khoa học hôm nay:\n\n` +
          `🥗 **Món chính: Salad Cá Hồi Bơ Sáp Sốt Chanh Leo (~380 kcal)**\n` +
          `- Phi lê cá hồi áp chảo dầu ô liu giòn da, bên trong mềm ẩm béo ngậy.\n` +
          `- Trộn cùng bơ sáp cắt hạt lựu, cà chua bi, xà lách rocket và sốt chanh leo chua thanh kích thích vị giác.\n\n` +
          `🍲 **Món canh: Canh Nấm Đậu Phụ Thanh Nhiệt (~120 kcal)**\n` +
          `- Nấm kim châm, nấm hương tươi nấu cùng đậu hũ non mềm mượt, điểm thêm vài nhánh hẹ thanh mát.\n\n` +
          `💡 *Lợi ích:* Bữa ăn cung cấp hơn 35g Protein, giàu Omega-3 tốt cho tim mạch và làn da, hoàn toàn không gây đầy bụng!`,
        suggestedDishes: ["Salad Cá Hồi Bơ Sáp", "Canh Nấm Đậu Hũ Non", "Ức Gà Hấp Lá Chanh"],
        quickPrompts: ["Món dưới 400 kcal", "Gợi ý bữa trưa Eat Clean", "Cách làm sốt salad healthy"],
      };
    }

    // Hôm nay ăn gì / Gợi ý bữa tối
    if (
      lower.includes("hôm nay ăn gì") ||
      lower.includes("gợi ý") ||
      lower.includes("bữa tối") ||
      lower.includes("bữa trưa")
    ) {
      return {
        replyText:
          `Bếp trưởng gợi ý cho bạn mâm cơm gia đình 3 món hài hòa dinh dưỡng, chuẩn bị chỉ trong 25 phút:\n\n` +
          `1. 🍲 **Canh Chua Cá Hồi:** Vị chua thanh của thơm (dứa) và cà chua quyện cùng vị ngọt béo của cá hồi tươi, rắc ngò gai rau ngổ thơm phức.\n` +
          `2. 🍳 **Thịt Ba Chỉ Kho Trứng Cút:** Thịt mềm rục, màu cánh gián bắt mắt, nước kho sánh đậm đà rất đưa cơm.\n` +
          `3. 🥗 **Rau Củ Luộc Chấm Kho Quẹt:** Bông cải xanh, cà rốt, đậu bắp giòn ngọt cân bằng lại vị đậm của món kho.\n\n` +
          `Bạn có muốn xem công thức chi tiết của món nào trong thực đơn này không?`,
        suggestedDishes: ["Canh Chua Cá Hồi", "Thịt Kho Tàu", "Rau Củ Luộc"],
        quickPrompts: ["Món ngon nấu dưới 20 phút", "Thực đơn cho 4 người", "Món xào thanh đạm"],
      };
    }

    return {
      replyText:
        `Chào bạn! SmartCook rất vui được đồng hành cùng bạn vào bếp 👩‍🍳.\n\n` +
        `Để hướng dẫn chuẩn xác nhất, bạn có thể nói cho mình biết:\n` +
        `- 🥘 **Tên món ăn** bạn muốn nấu (ví dụ: *Cơm Gà Teriyaki, Bò Bít Tết, Canh Chua...*)\n` +
        `- 🥬 **Nguyên liệu** bạn đang có sẵn trong tủ lạnh\n` +
        `- ⚖️ **Mục tiêu khẩu phần hay chế độ ăn** (Eat Clean, ít dầu, giàu đạm...)\n\n` +
        `Bếp sẽ phân tích và lên ngay công thức chi tiết từng bước cho bạn nhé!`,
      suggestedDishes: ["Cơm Gà Teriyaki Áp Chảo", "Bò Bít Tết Sốt Tiêu", "Salad Cá Hồi Bơ Sáp"],
      quickPrompts: ["Hôm nay ăn gì nhanh gọn?", "Món thanh đạm ít dầu", "Cách ướp thịt bò mềm"],
    };
  }

  /**
   * Real-time Cooking Voice Copilot
   * Provides concise, spoken feedback and executes kitchen actions (timers, step changes)
   */
  async cookingVoiceCopilot(
    userId: string,
    payload: CookingCopilotRequest
  ): Promise<CookingCopilotResponse> {
    return cookingCopilotService.reply(userId, payload);
  }
}

export const aiService = new AIService();
