import mongoose, { Document, Model, Schema } from "mongoose";

export interface IScanDetectedIngredient {
  name: string;
  confidence: string; // e.g. "98%"
  icon: string;       // e.g. "food-drumstick", "fruit-cherries", "leaf"
  source?: "visible" | "inferred";
  dishNames?: string[];
  evidence?: string;
}

export interface IScanPin {
  text: string;
  icon?: string;
  confidence?: string;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface IScanSuggestedRecipe {
  id?: string;
  title: string;
  desc: string;
  calories: number;
  durationMinutes: number;
  matchPercent: number;
}

export interface IScanHistory extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  imageUrl: string;
  imagePublicId?: string;
  accuracy: number;
  dishes?: { name: string; confidence: string; icon?: string }[];
  ingredients: IScanDetectedIngredient[];
  pins: IScanPin[];
  suggestedRecipe: IScanSuggestedRecipe;
  scannedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ScanDetectedIngredientSchema = new Schema<IScanDetectedIngredient>(
  {
    name: { type: String, required: true, trim: true },
    confidence: { type: String, required: true, default: "95%" },
    icon: { type: String, required: true, default: "food-apple" },
    source: { type: String, enum: ["visible", "inferred"] },
    dishNames: { type: [String], default: [] },
    evidence: { type: String, trim: true },
  },
  { _id: false }
);

const ScanPinSchema = new Schema<IScanPin>(
  {
    text: { type: String, required: true },
    icon: { type: String },
    confidence: { type: String },
    top: { type: Number },
    bottom: { type: Number },
    left: { type: Number },
    right: { type: Number },
  },
  { _id: false }
);

const ScanSuggestedRecipeSchema = new Schema<IScanSuggestedRecipe>(
  {
    id: { type: String },
    title: { type: String, required: true },
    desc: { type: String, required: true },
    calories: { type: Number, default: 350 },
    durationMinutes: { type: Number, default: 20 },
    matchPercent: { type: Number, default: 95 },
  },
  { _id: false }
);

const ScanHistorySchema = new Schema<IScanHistory>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },
    title: {
      type: String,
      required: [true, "Scan title is required"],
      trim: true,
      default: "Quét thực phẩm thông minh",
    },
    imageUrl: {
      type: String,
      required: [true, "Image URL is required"],
    },
    imagePublicId: {
      type: String,
      trim: true,
    },
    accuracy: {
      type: Number,
      default: 95,
      min: 0,
      max: 100,
    },
    ingredients: {
      type: [ScanDetectedIngredientSchema],
      default: [],
    },
    dishes: {
      type: [new Schema({ name: { type: String, required: true }, confidence: { type: String, required: true }, icon: { type: String } }, { _id: false })],
      default: [],
    },
    pins: {
      type: [ScanPinSchema],
      default: [],
    },
    suggestedRecipe: {
      type: ScanSuggestedRecipeSchema,
      required: true,
    },
    scannedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret: Record<string, any>) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        ret.image = ret.imageUrl; // Mobile compatibility
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound index for querying user scan history sorted by date
ScanHistorySchema.index({ userId: 1, scannedAt: -1 });

export const ScanHistory: Model<IScanHistory> =
  mongoose.models.ScanHistory || mongoose.model<IScanHistory>("ScanHistory", ScanHistorySchema);
