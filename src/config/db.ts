import mongoose from "mongoose";
import { env } from "./env";

export const connectDB = async (): Promise<void> => {
  try {
    // Event listeners
    mongoose.connection.on("connected", () => {
      console.log("[MongoDB] Database connection established.");
    });

    mongoose.connection.on("error", (err) => {
      console.error("[MongoDB] Database connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("[MongoDB] Database connection disconnected.");
    });

    const conn = await mongoose.connect(env.MONGODB_URI, {
      autoIndex: true, // Đảm bảo tự động xây dựng các chỉ mục (text index, unique) trên MongoDB Atlas
      serverSelectionTimeoutMS: 10000,
    });

    console.log(
      `[MongoDB] Connected successfully to host: ${conn.connection.host} | DB: ${conn.connection.name}`
    );
  } catch (error: any) {
    console.error("[MongoDB] Failed to connect on startup:", error?.message || error);
    if (error?.name === "MongoParseError" || error?.message?.includes("Protocol and host list are required")) {
      console.error(
        `🚨 [MongoDB] Chuỗi MONGODB_URI không hợp lệ! Chuỗi bắt buộc phải bắt đầu bằng 'mongodb+srv://' hoặc 'mongodb://'. Giá trị hiện tại bạn đang truyền vào bắt đầu bằng: '${env.MONGODB_URI.substring(0, 15)}...'`
      );
    } else if (env.NODE_ENV === "production" && (env.MONGODB_URI.includes("127.0.0.1") || env.MONGODB_URI.includes("localhost"))) {
      console.error(
        "🚨 [MongoDB] Bạn đang chạy chế độ Production nhưng MONGODB_URI vẫn trỏ về localhost! Vui lòng cấu hình connection string MongoDB Atlas trong biến môi trường Render."
      );
    }
    process.exit(1);
  }
};

export const disconnectDB = async (): Promise<void> => {
  try {
    await mongoose.connection.close();
    console.log("[MongoDB] Connection closed successfully.");
  } catch (error) {
    console.error("[MongoDB] Error while closing connection:", error);
    throw error;
  }
};

export default connectDB;
