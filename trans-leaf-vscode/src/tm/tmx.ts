/**
 * TMX (Translation Memory eXchange) 格式处理
 * TMX 1.4 标准: https://www.gala-global.org/tmx-14b
 */

export interface TuEntry {
  /** 翻译单元 - 原文和译文的配对 */
  sourceText: string;
  targetText: string;
  sourceLang: string;
  targetLang: string;
  /** 创建时间 (ISO 8601) */
  createdAt?: string;
  /** 修改时间 (ISO 8601) */
  modifiedAt?: string;
}

/**
 * 将翻译单元数组转换为 TMX XML 字符串
 */
export function toTmx(entries: TuEntry[]): string {
  if (entries.length === 0) {
    return emptyTmx();
  }

  // 按源语言分组
  const bySourceLang = new Map<string, TuEntry[]>();
  for (const entry of entries) {
    if (!bySourceLang.has(entry.sourceLang)) {
      bySourceLang.set(entry.sourceLang, []);
    }
    bySourceLang.get(entry.sourceLang)!.push(entry);
  }

  // 如果有多种源语言，生成多语言 TMX
  const parts: string[] = [];

  for (const [srcLang, langEntries] of bySourceLang) {
    for (const entry of langEntries) {
      const tu = buildTu(entry);
      parts.push(tu);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header
    segtype="sentence"
    o-tmf="Trans-Leaf"
    adminlang="en"
    srclang="${entries[0].sourceLang}"
    datatype="plaintext"
  />
  <body>
${parts.map(p => '    ' + p).join('\n')}
  </body>
</tmx>`;
}

/**
 * 构建单个翻译单元 (TU) XML
 */
function buildTu(entry: TuEntry): string {
  const now = entry.modifiedAt || entry.createdAt || new Date().toISOString();
  const tuvSource = buildTuv(entry.sourceLang, escapeXml(entry.sourceText));
  const tuvTarget = buildTuv(entry.targetLang, escapeXml(entry.targetText));

  return `<tu>
      ${tuvSource}
      ${tuvTarget}
      <prop type="x-created-at">${escapeXml(now)}</prop>
    </tu>`;
}

/**
 * 构建翻译单元变体 (TUV)
 */
function buildTuv(lang: string, content: string): string {
  return `<tuv xml:lang="${lang}">
        <seg>${content}</seg>
      </tuv>`;
}

/**
 * 生成空的 TMX 文件
 */
export function emptyTmx(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header
    segtype="sentence"
    o-tmf="Trans-Leaf"
    adminlang="en"
    srclang="*all*"
    datatype="plaintext"
  />
  <body>
  </body>
</tmx>`;
}

/**
 * 从 TMX XML 字符串解析翻译单元
 */
export function fromTmx(tmxContent: string): TuEntry[] {
  const entries: TuEntry[] = [];

  // 简单解析（不使用 XML 解析器，避免依赖）
  const tuMatches = tmxContent.matchAll(/<tu>([\s\S]*?)<\/tu>/g);

  for (const match of tuMatches) {
    const tuContent = match[1];
    const entry = parseTu(tuContent);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * 解析单个 TU 元素
 */
function parseTu(tuContent: string): TuEntry | null {
  let sourceText = '';
  let targetText = '';
  let sourceLang = '';
  let targetLang = '';
  let createdAt: string | undefined;

  // 解析 TUV
  const tuvMatches = tuContent.matchAll(/<tuv[^>]*xml:lang="([^"]+)"[^>]*>([\s\S]*?)<\/tuv>/g);
  const tuvs: Array<{ lang: string; text: string }> = [];

  for (const match of tuvMatches) {
    const lang = match[1];
    const content = match[2];
    const segMatch = content.match(/<seg>([\s\S]*?)<\/seg>/);
    const text = segMatch ? unescapeXml(segMatch[1]) : '';
    tuvs.push({ lang, text });
  }

  // 取第一个为源，第二个为目标（TMX 惯例）
  if (tuvs.length >= 2) {
    sourceLang = tuvs[0].lang;
    sourceText = tuvs[0].text;
    targetLang = tuvs[1].lang;
    targetText = tuvs[1].text;
  } else if (tuvs.length === 1) {
    sourceLang = tuvs[0].lang;
    sourceText = tuvs[0].text;
  }

  // 解析属性
  const createdMatch = tuContent.match(/<prop[^>]*type="x-created-at"[^>]*>([\s\S]*?)<\/prop>/);
  if (createdMatch) {
    createdAt = unescapeXml(createdMatch[1].trim());
  }

  if (sourceText && targetText && sourceLang && targetLang) {
    return { sourceText, targetText, sourceLang, targetLang, createdAt };
  }

  return null;
}

/**
 * XML 转义
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * XML 反转义
 */
function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * TMX 文件名（默认）
 */
export const TMX_FILENAME = '.trans-leaf.tmx';
