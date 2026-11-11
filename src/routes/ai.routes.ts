import { Router } from "express";
import { aiController } from "../controllers/ai.controller";
import { authenticate } from "../middlewares/auth";
import { uploadSingleImage } from "../middlewares/upload";
import { validate } from "../middlewares/validate";
import { cookingAudioSchema } from "../validators/cooking-audio.validator";
import { cookingCopilotSchema } from "../validators/cooking-copilot.validator";

const router = Router();

// Tất cả các endpoints AI bắt buộc đăng nhập
router.use(authenticate);

/**
 * @swagger
 * /api/v1/ai/cooking-transcription:
 *   post:
 *     tags: [AI Services]
 *     summary: Nhận diện bản ghi âm tiếng Việt từ web hoặc Expo Go
 *     description: Web chuẩn hóa bản ghi sang PCM WAV 16 kHz. Máy chủ hỗ trợ thêm M4A và WebM; audio/mp4 được ánh xạ sang audio/m4a khi gọi nhà cung cấp.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [audioBase64, mimeType]
 *             properties:
 *               audioBase64: { type: string, maxLength: 2800000 }
 *               mimeType: { type: string, enum: [audio/mp4, audio/m4a, audio/webm, audio/wav] }
 *     responses:
 *       200: { description: Lời nói đã nhận diện trong data.text }
 *       400: { description: Dữ liệu không hợp lệ hoặc không nghe rõ }
 *       401: { description: Chưa đăng nhập }
 *       503: { description: Dịch vụ nhận diện tạm thời không khả dụng }
 */
router.post("/cooking-transcription", validate(cookingAudioSchema), aiController.transcribeCookingAudio);

/**
 * @route   POST /api/v1/ai/assistant-chat
 * @desc    Chat with AI Chef Assistant with fridge & user preferences context
 * @access  Private
 */
router.post("/assistant-chat", aiController.assistantChat);

/**
 * @swagger
 * /api/v1/ai/cooking-copilot:
 *   post:
 *     tags: [AI Services]
 *     summary: Trợ lý cho món đang nấu, lọc chủ đề trước khi gọi AI
 *     description: Câu ngoài phạm vi, thiếu ngữ cảnh, lệnh điều khiển và dữ kiện có sẵn được xử lý cục bộ. Tư vấn dùng ngữ cảnh công thức và tối đa 6 lượt hội thoại ngắn.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipeTitle, currentStep, userVoiceText]
 *             properties:
 *               recipeTitle: { type: string, maxLength: 160 }
 *               userVoiceText: { type: string, maxLength: 600 }
 *               currentStep:
 *                 type: object
 *                 required: [stepNumber, title, description]
 *                 properties:
 *                   stepNumber: { type: integer, minimum: 1, maximum: 100 }
 *                   title: { type: string, maxLength: 160 }
 *                   description: { type: string, maxLength: 1600 }
 *               stepTimer:
 *                 type: object
 *                 properties:
 *                   targetMinutes: { type: number, minimum: 0 }
 *                   elapsedSeconds: { type: number, minimum: 0 }
 *                   remainingSeconds: { type: number, minimum: 0 }
 *                   isRunning: { type: boolean }
 *                   isOverdue: { type: boolean }
 *                   overdueSeconds: { type: number, minimum: 0 }
 *               recipeContext:
 *                 type: object
 *                 required: [ingredients, steps]
 *                 properties:
 *                   servings: { type: string, maxLength: 80 }
 *                   nutrition:
 *                     type: object
 *                     properties:
 *                       calories: { type: number, minimum: 0, maximum: 100000 }
 *                       proteinGrams: { type: number, minimum: 0, maximum: 100000 }
 *                       carbsGrams: { type: number, minimum: 0, maximum: 100000 }
 *                       fatGrams: { type: number, minimum: 0, maximum: 100000 }
 *                       fiberGrams: { type: number, minimum: 0, maximum: 100000 }
 *                       sugarGrams: { type: number, minimum: 0, maximum: 100000 }
 *                       sodiumMilligrams: { type: number, minimum: 0, maximum: 1000000 }
 *                       basis: { type: string, enum: [per_serving, whole_recipe, unspecified] }
 *                   ingredients:
 *                     type: array
 *                     maxItems: 40
 *                     items:
 *                       type: object
 *                       required: [name, amount]
 *                       properties:
 *                         name: { type: string, maxLength: 120 }
 *                         amount: { type: string, maxLength: 100 }
 *                   steps:
 *                     type: array
 *                     maxItems: 30
 *                     items:
 *                       type: object
 *                       required: [stepNumber, title, description]
 *                       properties:
 *                         stepNumber: { type: integer, minimum: 1, maximum: 100 }
 *                         title: { type: string, maxLength: 160 }
 *                         description: { type: string, maxLength: 1600 }
 *                         timerMinutes: { type: number, minimum: 0 }
 *               conversationHistory:
 *                 type: array
 *                 maxItems: 6
 *                 items:
 *                   type: object
 *                   required: [role, text]
 *                   properties:
 *                     role: { type: string, enum: [user, assistant] }
 *                     text: { type: string, maxLength: 350 }
 *     responses:
 *       200: { description: Phản hồi ngắn trong data.speechReply cùng action và actionPayload nếu có }
 *       400: { description: Dữ liệu đầu vào thiếu hoặc vượt giới hạn }
 *       401: { description: Chưa đăng nhập }
 *       502: { description: Nhà cung cấp trả về tư vấn không hợp lệ }
 *       503: { description: Dịch vụ tư vấn tạm thời không khả dụng hoặc hết hạn mức }
 */
/**
 * @route   POST /api/v1/ai/cooking-copilot
 * @desc    Real-time interactive Voice Copilot for cooking steps
 * @access  Private
 */
router.post("/cooking-copilot", validate(cookingCopilotSchema), aiController.cookingVoiceCopilot);

/**
 * @route   POST /api/v1/ai/scan-ingredients
 * @desc    Upload food image, detect ingredients + pins and get suggested recipe
 * @access  Private
 */
router.post("/scan-ingredients", uploadSingleImage, aiController.scanIngredients);

/**
 * @route   GET /api/v1/ai/scan-history
 * @desc    Get user's past AI scan history
 * @access  Private
 */
router.get("/scan-history", aiController.getScanHistory);

/**
 * @route   DELETE /api/v1/ai/scan-history/:id
 * @desc    Delete a scan history entry
 * @access  Private
 */
router.delete("/scan-history/:id", aiController.deleteScanHistory);

export default router;
