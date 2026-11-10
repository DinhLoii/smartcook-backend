import mongoose from "mongoose";
import { recipeRepository, RecipeFilter } from "../repositories/recipe.repository";
import { fridgeRepository } from "../repositories/fridge.repository";
import { userRepository } from "../repositories/user.repository";
import { ingredientRepository } from "../repositories/ingredient.repository";
import { IRecipe } from "../models/Recipe";
import { INITIAL_RECIPES } from "../data/seedRecipes";
import { normalizeVietnamese } from "../utils/text";
import { NotFoundError, ForbiddenError } from "../utils/errors";

export interface MatchedRecipeItem {
  recipe: IRecipe;
  fridgeMatchPercent: number;
  matchedCount: number;
  totalIngredients: number;
  availableIngredients: string[];
  missingIngredients: string[];
  isFavorite?: boolean;
}

function getRecipeVideoId(recipe: IRecipe): string | null {
  // Older seeded recipes predate this field. An explicit null clears the video.
  if (recipe.youtubeVideoId !== undefined) return recipe.youtubeVideoId;
  if (recipe.authorId) return null;

  const seed = INITIAL_RECIPES.find(
    (item) => item.title === recipe.title && item.author === recipe.author
  );
  return seed?.youtubeVideoId ?? null;
}

export class RecipeService {
  async getRecipes(
    filter: RecipeFilter = {},
    page = 1,
    limit = 10,
    sortField = "rating",
    sortOrder: "asc" | "desc" = "desc",
    userId?: string
  ) {
    const totalCount = await recipeRepository.count();
    if (totalCount === 0) {
      await this.seedRecipes();
    }

    const { recipes, total, totalPages } = await recipeRepository.findAll(
      filter,
      page,
      limit,
      sortField,
      sortOrder
    );

    let favoriteSet = new Set<string>();
    if (userId) {
      const user = await userRepository.findById(userId);
      if (user && user.favoriteRecipeIds) {
        favoriteSet = new Set(user.favoriteRecipeIds.map((id) => id.toString()));
      }
    }

    const mappedRecipes = recipes.map((r) => ({
      ...r.toJSON(),
      youtubeVideoId: getRecipeVideoId(r),
      isFavorite: favoriteSet.has(r._id.toString()),
    }));

    return {
      recipes: mappedRecipes,
      total,
      page,
      totalPages,
    };
  }

  async getRecipeById(id: string, userId?: string) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundError(`Recipe with id '${id}' not found`);
    }

    const recipe = await recipeRepository.findById(id);
    if (!recipe) {
      throw new NotFoundError("Recipe not found");
    }

    let isFavorite = false;
    let fridgeIngredientNames: string[] = [];

    if (userId) {
      const user = await userRepository.findById(userId);
      if (user && user.favoriteRecipeIds) {
        isFavorite = user.favoriteRecipeIds.some(
          (favId) => favId.toString() === recipe._id.toString()
        );
      }

      const fridge = await fridgeRepository.getOrCreateFridge(userId);
      fridgeIngredientNames = fridge.items.map((it) => it.normalizedName);
    }

    const recipeObj = (recipe as any).toObject ? (recipe as any).toObject() : recipe;

    // Annotate recipe ingredients with inFridge boolean
    const annotatedIngredients = (recipeObj.ingredients || []).map((ing: any) => {
      const normIngName = ing.normalizedName || normalizeVietnamese(ing.name || '');
      const inFridge = fridgeIngredientNames.some(
        (fridgeName) =>
          fridgeName.includes(normIngName) ||
          normIngName.includes(fridgeName) ||
          normIngName.split(" ").some((word: string) => word.length > 2 && fridgeName.includes(word))
      );
      return {
        ...ing,
        inFridge,
      };
    });

    const matchedCount = annotatedIngredients.filter((i: any) => i.inFridge).length;
    const fridgeMatchPercent =
      annotatedIngredients.length > 0
        ? Math.round((matchedCount / annotatedIngredients.length) * 100)
        : 0;

    return {
      ...recipeObj,
      youtubeVideoId: getRecipeVideoId(recipe),
      ingredients: annotatedIngredients,
      fridgeMatchPercent,
      isFavorite,
    };
  }

  /**
   * Fridge Match Ranking Algorithm
   * Scores recipes based on ingredients available in the user's fridge and sorts descending.
   */
  async getFridgeMatchedRecipes(
    userId: string,
    limit = 10
  ): Promise<MatchedRecipeItem[]> {
    const totalCount = await recipeRepository.count();
    if (totalCount === 0) {
      await this.seedRecipes();
    }

    const [fridge, recipes, user] = await Promise.all([
      fridgeRepository.getOrCreateFridge(userId),
      recipeRepository.getAllActive(),
      userRepository.findById(userId),
    ]);

    const favoriteSet = new Set(
      (user?.favoriteRecipeIds || []).map((id) => id.toString())
    );

    // Build comprehensive search tokens from user's fridge
    const fridgeTokens: { normalized: string; aliases: string[] }[] = [];
    for (const item of fridge.items) {
      const master = await ingredientRepository.findByNameOrAlias(item.name);
      fridgeTokens.push({
        normalized: item.normalizedName,
        aliases: master ? master.aliases : [],
      });
    }

    const scoredRecipes: MatchedRecipeItem[] = recipes.map((recipe) => {
      const availableIngredients: string[] = [];
      const missingIngredients: string[] = [];

      for (const ingredient of recipe.ingredients) {
        const norm = ingredient.normalizedName || normalizeVietnamese(ingredient.name);

        const isFound = fridgeTokens.some((f) => {
          // Direct name match or substring
          if (f.normalized.includes(norm) || norm.includes(f.normalized)) {
            return true;
          }
          // Match against any alias of the fridge item
          if (f.aliases.some((a) => norm.includes(a) || a.includes(norm))) {
            return true;
          }
          return false;
        });

        if (isFound) {
          availableIngredients.push(ingredient.name);
        } else {
          missingIngredients.push(ingredient.name);
        }
      }

      const totalIngredients = recipe.ingredients.length;
      const matchedCount = availableIngredients.length;
      const fridgeMatchPercent =
        totalIngredients > 0
          ? Math.round((matchedCount / totalIngredients) * 100)
          : 0;

      return {
        recipe,
        fridgeMatchPercent,
        matchedCount,
        totalIngredients,
        availableIngredients,
        missingIngredients,
        isFavorite: favoriteSet.has(recipe._id.toString()),
      };
    });

    // Sort primarily by fridgeMatchPercent (descending), secondarily by rating (descending)
    scoredRecipes.sort((a, b) => {
      if (b.fridgeMatchPercent !== a.fridgeMatchPercent) {
        return b.fridgeMatchPercent - a.fridgeMatchPercent;
      }
      return b.recipe.rating - a.recipe.rating;
    });

    return scoredRecipes.slice(0, limit);
  }

  async toggleFavorite(
    userId: string,
    recipeId: string
  ): Promise<{ isFavorite: boolean }> {
    if (!recipeId) {
      throw new NotFoundError("Recipe not found");
    }

    if (!mongoose.Types.ObjectId.isValid(recipeId)) {
      // Mock / non-mongo ID (e.g. dish-1, dish-2): Return success without database error
      return { isFavorite: true };
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const isAlreadyFav = (user.favoriteRecipeIds || []).some(
      (id) => id.toString() === recipeId
    );

    if (isAlreadyFav) {
      await userRepository.removeFavoriteRecipe(userId, recipeId);
      return { isFavorite: false };
    } else {
      await userRepository.addFavoriteRecipe(userId, recipeId);
      return { isFavorite: true };
    }
  }

  async createRecipe(data: Partial<IRecipe>): Promise<IRecipe> {
    return recipeRepository.create(data);
  }

  async updateRecipe(
    id: string,
    data: Partial<IRecipe>,
    currentUser?: any
  ): Promise<IRecipe> {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundError("Recipe not found");
    }

    const existing = await recipeRepository.findById(id);
    if (!existing) {
      throw new NotFoundError("Recipe not found");
    }

    if (
      currentUser &&
      currentUser.role !== "admin" &&
      existing.authorId?.toString() !== currentUser._id.toString()
    ) {
      throw new ForbiddenError("You are not authorized to update this recipe");
    }

    const updated = await recipeRepository.update(id, data);
    return updated!;
  }

  async deleteRecipe(id: string, currentUser?: any): Promise<void> {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundError("Recipe not found");
    }

    const existing = await recipeRepository.findById(id);
    if (!existing) {
      throw new NotFoundError("Recipe not found");
    }

    if (
      currentUser &&
      currentUser.role !== "admin" &&
      existing.authorId?.toString() !== currentUser._id.toString()
    ) {
      throw new ForbiddenError("You are not authorized to delete this recipe");
    }

    await recipeRepository.delete(id);
  }

  async seedRecipes(): Promise<void> {
    await recipeRepository.bulkUpsert(INITIAL_RECIPES);
  }
}

export const recipeService = new RecipeService();
export default recipeService;
