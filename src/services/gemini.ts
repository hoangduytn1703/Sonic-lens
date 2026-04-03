import { GoogleGenAI } from "@google/genai";
import { GEMINI_NATIVE_AUDIO_MODEL } from '../lib/geminiTextModel';
import { AI_SUMMARY_FIELD_RULES_EN } from '../lib/aiSummaryPrompt';

// Khởi tạo AI với API Key từ môi trường
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export const transcribeAudio = async (base64Audio: string, mimeType: string) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Mất API Key. Vui lòng cấu hình GEMINI_API_KEY trong mục Secrets.");
  }

  const prompt = `
    Bạn là một chuyên gia ghi chép biên bản cuộc họp chuyên nghiệp. 
    Hãy nghe đoạn âm thanh này và chuyển nó thành văn bản (transcript).
    Cuộc họp này chủ yếu bằng tiếng Việt, đôi khi có xen kẽ các thuật ngữ tiếng Anh công sở.
    
    YÊU CẦU:
    1. Phân biệt các người nói khác nhau (Speaker 1, Speaker 2, Speaker 3...).
    2. Đoán giới tính của người nói (Nam/Nữ/Không rõ).
    3. Ghi lại chính xác nội dung hội thoại.
    4. Đánh dấu "isUncertain": true cho những đoạn hội thoại nào mà âm thanh không rõ, bạn phải đoán hoặc không chắc chắn 100% về nội dung.

    ${AI_SUMMARY_FIELD_RULES_EN}

    Định dạng kết quả trả về BẮT BUỘC là JSON với cấu trúc:
    {
      "transcript": [
        { 
          "speaker": "Tên người nói", 
          "gender": "Nam/Nữ/Không rõ",
          "text": "Nội dung nói...", 
          "timestamp": "mm:ss",
          "isUncertain": true/false 
        },
        ...
      ],
      "summary": "<chuỗi tiếng Việt: tuân thủ SUMMARY FIELD rules; dùng tiêu đề ## và bullet - trên các dòng trong chuỗi>"
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_NATIVE_AUDIO_MODEL,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Audio,
                mimeType: mimeType
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    console.log("AI Response:", text);
    
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};
