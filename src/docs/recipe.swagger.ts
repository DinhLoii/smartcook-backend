/**
 * @swagger
 * tags:
 *   name: Recipes
 *   description: Recipe Discovery, Details & Smart Fridge Matching
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     RecipeIngredient:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           example: "Đùi gà rút xương"
 *         amount:
 *           type: string
 *           example: "500g"
 *         inFridge:
 *           type: boolean
 *           example: true
 *     RecipeStep:
 *       type: object
 *       properties:
 *         stepNumber:
 *           type: number
 *           example: 1
 *         title:
 *           type: string
 *           example: "Sơ chế gà"
 *         description:
 *           type: string
 *           example: "Rửa sạch đùi gà với nước muối loãng..."
 *         timerMinutes:
 *           type: number
 *           example: 5
 *     Recipe:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "6507a1b2c3d4e5f6a7b8c9d4"
 *         title:
 *           type: string
 *           example: "Cơm Gà Teriyaki Áp Chảo"
 *         youtubeVideoId:
 *           type: string
 *           nullable: true
 *           pattern: '^[A-Za-z0-9_-]{11}$'
 *           description: Mã video hướng dẫn trên YouTube. Gửi null khi cập nhật để gỡ video.
 *           example: "LZ6rXyFRJjk"
 *         author:
 *           type: string
 *           example: "@smartcook.chef"
 *         calories:
 *           type: number
 *           example: 580
 *         minutes:
 *           type: number
 *           example: 30
 *         difficulty:
 *           type: string
 *           enum: [Dễ, Trung bình, Nâng cao]
 *           example: "Dễ"
 *         categoryCode:
 *           type: string
 *           example: "family"
 *         rating:
 *           type: number
 *           example: 4.9
 *         fridgeMatchPercent:
 *           type: number
 *           example: 85
 *         ingredients:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/RecipeIngredient'
 *         steps:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/RecipeStep'
 */

/**
 * @swagger
 * /recipes:
 *   get:
 *     summary: Discover and filter recipes
 *     tags: [Recipes]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Category code (e.g. family, healthy, quick)
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: string
 *           enum: [Dễ, Trung bình, Nâng cao]
 *       - in: query
 *         name: maxMinutes
 *         schema:
 *           type: integer
 *           example: 30
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *           example: "gà"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Paginated recipes list
 */

/**
 * @swagger
 * /recipes/fridge-match:
 *   get:
 *     summary: Smart Fridge Matching - Ranked recipes based on user's fridge contents
 *     tags: [Recipes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Recipes ranked by fridge match percentage (descending)
 */

/**
 * @swagger
 * /recipes/{id}/favorite:
 *   post:
 *     summary: Toggle recipe favorite status for current user
 *     tags: [Recipes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Favorite toggled successfully
 */
export {};
