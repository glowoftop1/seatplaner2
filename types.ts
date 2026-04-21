export type QuestionType = 
  | 'multiple_choice' 
  | 'short_answer' 
  | 'descriptive' 
  | 'ox_quiz' 
  | 'selection' 
  | 'content_match';

export interface Question {
  id: number;
  type: QuestionType;
  difficulty: '하' | '중' | '상';
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

export interface QuestionConfig {
  difficulty: '하' | '중' | '상';
  type: QuestionType;
}

export interface QuizOptions {
  totalCount: number;
  difficultyDistribution: {
    상: number;
    중: number;
    하: number;
  };
  questionConfigs: QuestionConfig[];
  model: 'gemini-3.1-pro-preview' | 'gemini-3-flash-preview';
  unlockedViaAd?: boolean;
  personalApiKey?: string;
}

export interface QuizData {
  document_summary: string;
  questions: Question[];
}

export interface FileData {
  file: File;
  base64: string;
  mimeType: string;
}
