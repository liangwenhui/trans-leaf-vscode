import type { Translator } from '../translator/types.js';

/**
 * 文件分析结果
 */
export interface FileAnalysis {
  fileType: string;      // 'markdown' | 'code' | 'plain' | 'html' | 'json' 等
  domain: string;        // 领域描述，如 "前端开发技术文档"、"学术论文"、"产品说明"
  context: string;       // 一句话语境描述，如 "这是一篇介绍 React Hooks 的技术博客"
  terminology: string[]; // 文中出现的需要统一翻译的关键术语
}

/**
 * 默认分析结果
 */
const DEFAULT_ANALYSIS: FileAnalysis = {
  fileType: 'plain',
  domain: '通用',
  context: '通用文本',
  terminology: []
};

/**
 * 文件分析器
 * 用 AI 分析文件的类型、领域、语境和术语
 */
export async function analyzeFile(
  fullText: string,
  languageId: string,
  translator: Translator,
  isMock: boolean = false
): Promise<FileAnalysis> {
  // Mock 翻译器跳过分析
  if (isMock) {
    return {
      ...DEFAULT_ANALYSIS,
      fileType: languageId || 'plain'
    };
  }

  // 取前 2000 字符和后 500 字符
  const prefix = fullText.slice(0, 2000);
  const suffix = fullText.slice(-500);

  const prompt = `你是一个翻译预分析助手。请分析以下文本，返回 JSON 格式结果：

{
  "fileType": "文件类型（markdown/code/plain/html/其他）",
  "domain": "所属领域（如：前端开发、机器学习、产品文档、学术论文等）",
  "context": "一句话描述这个文件的内容和语境",
  "terminology": ["需要统一翻译的关键术语列表，最多10个"]
}

文件语言标识：${languageId}

=== 文本开头 ===
${prefix}
=== 文本结尾 ===
${suffix}

请只返回 JSON，不要其他内容。`;

  try {
    const result = await translator.analyze(prompt);

    if (!result.success || !result.text) {
      return { ...DEFAULT_ANALYSIS, fileType: languageId || 'plain' };
    }

    // 解析 JSON
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ...DEFAULT_ANALYSIS, fileType: languageId || 'plain' };
    }

    const analysis = JSON.parse(jsonMatch[0]) as FileAnalysis;

    // 验证并填充缺失字段
    return {
      fileType: analysis.fileType || languageId || 'plain',
      domain: analysis.domain || '通用',
      context: analysis.context || '通用文本',
      terminology: Array.isArray(analysis.terminology) ? analysis.terminology : []
    };
  } catch {
    return { ...DEFAULT_ANALYSIS, fileType: languageId || 'plain' };
  }
}
