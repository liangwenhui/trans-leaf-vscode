/**
 * 文本段
 */
export interface Segment {
  index: number;        // 段序号，从 0 开始
  startLine: number;    // 起始行号（0-indexed）
  endLine: number;      // 结束行号（0-indexed，包含）
  text: string;         // 段文本内容
}

/**
 * 文本分段器
 * 根据文件类型和语义边界将文本分段
 */
export function segmentText(text: string, languageId: string): Segment[] {
  const lines = text.split('\n');
  const totalLines = lines.length;

  // 小文件规则：≤50 行不分段
  if (totalLines <= 50) {
    return [{
      index: 0,
      startLine: 0,
      endLine: totalLines - 1,
      text
    }];
  }

  // 根据文件类型确定分段策略
  const segments: Segment[] = [];
  let segmentStart = 0;
  let segmentIndex = 0;

  if (languageId === 'markdown') {
    // Markdown 分段策略
    const maxLines = 300;
    let i = 0;

    while (i < totalLines) {
      let endLine = Math.min(i + maxLines - 1, totalLines - 1);

      // 在 maxLines 范围内寻找最佳断点
      for (let j = endLine; j > i + maxLines / 2; j--) {
        const line = lines[j];

        // 一级标题边界
        if (line.startsWith('# ')) {
          endLine = j - 1;
          break;
        }
        // 二级标题边界
        if (line.startsWith('## ')) {
          endLine = j - 1;
          break;
        }
        // 连续空行边界
        if (j > 0 && lines[j].trim() === '' && lines[j - 1].trim() === '') {
          endLine = j - 1;
          break;
        }
      }

      const segmentText = lines.slice(segmentStart, endLine + 1).join('\n');
      segments.push({
        index: segmentIndex++,
        startLine: segmentStart,
        endLine,
        text: segmentText
      });

      i = endLine + 1;
      segmentStart = i;
    }

  } else if (isCodeFile(languageId)) {
    // 代码文件分段策略
    const maxLines = 200;
    let i = 0;

    while (i < totalLines) {
      let endLine = Math.min(i + maxLines - 1, totalLines - 1);

      // 在 maxLines 范围内寻找空行作为断点
      for (let j = endLine; j > i + maxLines / 2; j--) {
        if (lines[j].trim() === '') {
          endLine = j;
          break;
        }
      }

      const segmentText = lines.slice(segmentStart, endLine + 1).join('\n');
      segments.push({
        index: segmentIndex++,
        startLine: segmentStart,
        endLine,
        text: segmentText
      });

      i = endLine + 1;
      segmentStart = i;
    }

  } else {
    // 纯文本/其他分段策略
    const maxLines = 200;
    let i = 0;

    while (i < totalLines) {
      let endLine = Math.min(i + maxLines - 1, totalLines - 1);

      // 寻找段落边界（空行）
      for (let j = endLine; j > i + maxLines / 2; j--) {
        if (lines[j].trim() === '') {
          endLine = j;
          break;
        }
      }

      const segmentText = lines.slice(segmentStart, endLine + 1).join('\n');
      segments.push({
        index: segmentIndex++,
        startLine: segmentStart,
        endLine,
        text: segmentText
      });

      i = endLine + 1;
      segmentStart = i;
    }
  }

  return segments;
}

/**
 * 判断是否为代码文件
 */
function isCodeFile(languageId: string): boolean {
  const codeLanguages = [
    'typescript', 'javascript', 'python', 'go', 'java', 'rust',
    'cpp', 'c', 'csharp', 'php', 'ruby', 'swift', 'kotlin',
    'tsx', 'jsx', 'vue', 'svelte'
  ];
  return codeLanguages.includes(languageId);
}
