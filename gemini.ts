import { FileData, QuizOptions, QuizData } from "../types";

export async function generateQuestions(files: FileData[], options: QuizOptions): Promise<QuizData> {
  const response = await fetch('/api/generate-questions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    // files might be up to ~65MB encoded, Node.js and fetch will handle it as long as backend limits allow.
    body: JSON.stringify({ files, options })
  });

  if (!response.ok) {
    const isJson = response.headers.get("content-type")?.includes("application/json");
    if (isJson) {
      const errorData = await response.json();
      throw new Error(errorData.error || '문제 생성 중 서버 내부 오류가 발생했습니다.');
    } else {
      const errorText = await response.text();
      console.error("Non-JSON API Error:", errorText);
      
      if (response.status === 413) throw new Error("업로드한 파일의 전체 용량이 너무 큽니다. 줄여서 다시 시도해주세요.");
      if (response.status === 504) throw new Error("서버 응답 시간이 초과되었습니다. 파일 크기나 문제 난이도로 인해 출제가 지연되고 있습니다.");
      
      throw new Error(`알 수 없는 통신 오류가 발생했습니다. (상태 코드: ${response.status})`);
    }
  }

  const data = await response.json();
  return data as QuizData;
}
