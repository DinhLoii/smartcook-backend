import Joi from "joi";

const youtubeVideoIdSchema = Joi.string()
  .trim()
  .pattern(/^[A-Za-z0-9_-]{11}$/)
  .allow(null)
  .messages({ "string.pattern.base": "Mã video YouTube phải gồm 11 ký tự hợp lệ" });

const recipeIngredientSchema = Joi.object({
  name: Joi.string().trim().required(),
  amount: Joi.string().trim().required(),
  isOptional: Joi.boolean().optional(),
  icon: Joi.string().trim().allow("").optional(),
});

const recipeStepSchema = Joi.object({
  stepNumber: Joi.number().integer().min(1).required(),
  title: Joi.string().trim().required(),
  description: Joi.string().trim().required(),
  timerMinutes: Joi.number().min(0).optional(),
  tip: Joi.string().trim().allow("").optional(),
});

const recipeNutritionSchema = Joi.object({
  calories: Joi.number().min(0).required(),
  protein: Joi.string().trim().optional(),
  carbs: Joi.string().trim().optional(),
  fat: Joi.string().trim().optional(),
  fiber: Joi.string().trim().optional(),
  sodium: Joi.string().trim().optional(),
  advice: Joi.string().trim().allow("").optional(),
});

export const createRecipeSchema = Joi.object({
  title: Joi.string().trim().min(3).max(150).required(),
  author: Joi.string().trim().optional(),
  calories: Joi.number().min(0).optional(),
  minutes: Joi.number().min(1).max(360).required(),
  difficulty: Joi.string().valid("Dễ", "Trung bình", "Nâng cao").required(),
  servings: Joi.string().trim().optional(),
  servingsCount: Joi.number().min(1).max(20).optional(),
  price: Joi.string().trim().optional(),
  categoryCode: Joi.string().trim().lowercase().required(),
  badge: Joi.string().trim().allow("").optional(),
  sub: Joi.string().trim().allow("").optional(),
  tags: Joi.array().items(Joi.string().trim()).optional(),
  image: Joi.string().uri().required(),
  youtubeVideoId: youtubeVideoIdSchema,
  description: Joi.string().trim().allow("").optional(),
  ingredients: Joi.array().items(recipeIngredientSchema).min(1).required(),
  steps: Joi.array().items(recipeStepSchema).min(1).required(),
  nutrition: recipeNutritionSchema.optional(),
  isActive: Joi.boolean().optional(),
});

export const updateRecipeSchema = Joi.object({
  title: Joi.string().trim().min(3).max(150).optional(),
  author: Joi.string().trim().optional(),
  calories: Joi.number().min(0).optional(),
  minutes: Joi.number().min(1).max(360).optional(),
  difficulty: Joi.string().valid("Dễ", "Trung bình", "Nâng cao").optional(),
  servings: Joi.string().trim().optional(),
  servingsCount: Joi.number().min(1).max(20).optional(),
  price: Joi.string().trim().optional(),
  categoryCode: Joi.string().trim().lowercase().optional(),
  badge: Joi.string().trim().allow("").optional(),
  sub: Joi.string().trim().allow("").optional(),
  tags: Joi.array().items(Joi.string().trim()).optional(),
  image: Joi.string().uri().optional(),
  youtubeVideoId: youtubeVideoIdSchema,
  description: Joi.string().trim().allow("").optional(),
  ingredients: Joi.array().items(recipeIngredientSchema).min(1).optional(),
  steps: Joi.array().items(recipeStepSchema).min(1).optional(),
  nutrition: recipeNutritionSchema.optional(),
  isActive: Joi.boolean().optional(),
});
