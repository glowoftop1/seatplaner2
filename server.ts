import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import type { QuizOptions, FileData, QuestionType, QuizData } from "./src/types.ts";

const app = express();
const PORT = 3000;

// Increase payload limit for base64 images/pdfs (100mb handles up to 50mb of files safely due to base64 encoding overhead)
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Configure CORS
app.use(cors({
  origin: true // Allow all origins for dev, or specify frontend domain
}));

const getTypeName = (type: QuestionType) => {
  switch (type) {
    case 'multiple_choice': return '객관식 (4지 또는 5지 선다)';
    case 'short_answer': return '단답형 (주관식)';
    case 'descriptive': return '서술형/논술형';
    case 'ox_quiz': return 'O/X 퀴즈';
    case 'selection': return '보기 선택형 (수능형 ㄱ, ㄴ, ㄷ 고르기)';
    case 'content_match': return '내용 일치/불일치 형';
    default: return type;
  }
};

app.post("/api/generate-questions", async (req, res) => {
  try {
    const { files, options } = req.body as { files: FileData[], options: QuizOptions };

    const useSystemKeyForPro = options.model === 'gemini-3.1-pro-preview' && options.unlockedViaAd;
    const systemKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.TESTMAKER;
    
    // For Pro mode, use the user's personal api key sent from the client, unless ad unlocked.
    const apiKey = (options.model === 'gemini-3.1-pro-preview' && !useSystemKeyForPro)
      ? (options.personalApiKey || systemKey)
      : systemKey;

    if (!apiKey) {
      if (options.model === 'gemini-3.1-pro-preview' && !useSystemKeyForPro) {
        return res.status(401).json({ error: "수석 교사 모드를 사용하려면 개인 API 키 선택이 필요합니다. (API_KEY_INVALID)" });
      } else {
        return res.status(401).json({ error: "시스템 API 키가 설정되지 않았습니다. 관리자에게 문의하세요. (API_KEY_INVALID)" });
      }
    }

    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [];

    for (const file of files) {
      parts.push({
        inlineData: {
          data: file.base64,
          mimeType: file.mimeType
        }
      });
    }

    if (parts.length === 0) {
      return res.status(400).json({ error: "파일을 업로드해주세요." });
    }

    const questionRequirements = options.questionConfigs.map((config, index) => 
      `${index + 1}번 문제: 난이도 [${config.difficulty}], 형식 [${getTypeName(config.type)}]`
    ).join('\\n');

    const personaName = options.model === 'gemini-3.1-pro-preview' ? '수석 교사' : '열심 교사';

    const dynamicInstruction = `당신은 대한민국 최고 수준의 'AI 교육 평가 위원'이자 '${personaName}'입니다.
교과서 본문 이미지, PDF 텍스트, 혹은 OCR 데이터가 주어지면 학습 목표를 정확히 파악하여 학생들의 이해도를 점검할 수 있는 핵심 문제를 자동으로 출제합니다.

# 목표 (Objective)
사용자가 업로드한 교과서 자료(텍스트 또는 이미지)를 분석하여, 아래의 상세 조건에 맞춰 정확히 ${options.totalCount}문제를 생성하고, 이를 JSON 형식으로 반환합니다.

# 출제 상세 조건 (Detailed Requirements)
제공된 텍스트를 바탕으로 다음 조건에 맞춰 정확히 ${options.totalCount}문제를 출제해 주세요:
${questionRequirements}

각 문제의 정답과 해설도 함께 제공해야 합니다.

# 맥락 (Context)
- 사용자: 바쁜 업무에 시달리는 현직 교사 또는 스스로 학습 내용을 점검하려는 학생.
- 환경: 사용자는 시간이 없으므로 즉시 인쇄(HWP 변환)하여 사용할 수 있도록 문항의 완성도(어투, 정확성, 오답의 매력도)가 매우 높아야 합니다. 
- 기조: 교과서 원문에 충실해야 하며, 원문에 없는 내용을 기반으로 출제하는 환각(Hallucination) 현상을 절대적으로 방지해야 합니다.

# 규칙 및 지식 (Knowledge & Rules)
1. 객관식 오답지: 정답과 헷갈릴 수 있는 매력적이고 논리적인 오답을 구성해야 합니다.
2. 출력 형식 (Strict Constraint): 반드시 JSON 포맷으로 응답해야 합니다. answer 필드는 항상 문자열(String)로 작성하세요.
3. 문제 유형 필드(type): 다음 값 중 하나를 사용하세요: multiple_choice, short_answer, descriptive, ox_quiz, selection, content_match.
4. 난이도 필드(difficulty): 요청된 난이도(하, 중, 상)를 정확히 반영하세요.`;

    const response = await ai.models.generateContent({
      model: options.model,
      contents: { parts },
      config: {
        systemInstruction: dynamicInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            document_summary: { type: Type.STRING, description: "업로드된 교과서 본문의 1줄 요약" },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  type: { type: Type.STRING, description: "multiple_choice, short_answer, descriptive, ox_quiz, selection, content_match 중 하나" },
                  difficulty: { type: Type.STRING, description: "하, 중, 상" },
                  question: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "객관식이나 보기 선택형일 경우에만 사용, 그 외에는 빈 배열"
                  },
                  answer: { type: Type.STRING, description: "정답 텍스트 또는 번호" },
                  explanation: { type: Type.STRING, description: "정답 및 오답에 대한 해설" }
                },
                required: ["id", "type", "difficulty", "question", "options", "answer", "explanation"]
              }
            }
          },
          required: ["document_summary", "questions"]
        }
      }
    });

    if (!response.text) {
      return res.status(500).json({ error: "결과를 생성하지 못했습니다." });
    }

    const quizData = JSON.parse(response.text) as QuizData;
    res.json(quizData);

  } catch (error: unknown) {
    console.error("Gemini API Error:", error);
    const errorMessage = error instanceof Error ? error.message : "문제 생성 중 서버 내부 오류가 발생했습니다.";
    res.status(500).json({ error: errorMessage });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // For Express 4.x
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
