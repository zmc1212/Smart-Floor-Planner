import { GoogleGenAI } from "@google/genai";
import { StyleType } from "../types";

let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Please configure it in your environment variables.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

export const generateRendering = async (roomName: string, style: StyleType, width: number, height: number): Promise<string> => {
  const ai = getAI();
  const prompt = `Generate a high-quality, realistic interior design rendering for a room.
  Room Type: ${roomName}
  Dimensions: ${width / 10}m x ${height / 10}m
  Style: ${style}
  The image should be a wide-angle view showing the furniture, lighting, and textures consistent with the ${style} aesthetic.
  Professional photography, 8k resolution, cinematic lighting.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9",
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const base64EncodeString: string = part.inlineData.data;
        return `data:image/png;base64,${base64EncodeString}`;
      }
    }
    throw new Error("No image data returned from Gemini");
  } catch (error) {
    console.error("Error generating rendering:", error);
    throw error;
  }
};
