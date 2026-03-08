/**
 * 检测文本是中文还是英文
 * 使用字符统计法：统计 CJK 字符和 ASCII 字母的比例
 */
export function detectLanguage(text: string): 'zh-CN' | 'en' | 'unknown' {
  // 统计 CJK 字符数量（Unicode 范围 \u4e00-\u9fff）
  const cjkRegex = /[\u4e00-\u9fff]/g;
  const cjkMatches = text.match(cjkRegex);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // 统计 ASCII 字母数量
  const asciiRegex = /[a-zA-Z]/g;
  const asciiMatches = text.match(asciiRegex);
  const asciiCount = asciiMatches ? asciiMatches.length : 0;

  const total = cjkCount + asciiCount;
  if (total === 0) {
    return 'unknown';
  }

  const cjkRatio = cjkCount / total;

  if (cjkRatio > 0.3) {
    return 'zh-CN';
  } else if (cjkRatio < 0.1) {
    return 'en';
  }
  return 'unknown';
}
