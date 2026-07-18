const inlineSectionLabels = [
  '为什么值得追',
  '与人设匹配',
  '和您人设怎么匹配',
  '和你人设怎么匹配',
  '风险在哪里',
  '风险提示',
  '受众需求',
  '下一步验证',
  '应该怎么验证',
  '总结一下',
];

interface NormalizeAiMarkdownOptions {
  plainValidationKeywords?: boolean;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function protectFencedCodeBlocks(content: string) {
  const blocks: string[] = [];
  const protectedContent = content.replace(/```[\s\S]*?```/g, (block) => {
    const token = `\uE000CODE_BLOCK_${blocks.length}\uE000`;
    blocks.push(block);
    return token;
  });

  return {
    content: protectedContent,
    restore: (value: string) =>
      blocks.reduce((nextValue, block, index) => nextValue.replace(`\uE000CODE_BLOCK_${index}\uE000`, block), value),
  };
}

function cleanupMarkdownLine(rawLine: string) {
  let line = rawLine.trimEnd();
  const sectionLabelPattern = inlineSectionLabels.map(escapeRegExp).join('|');

  const inlineBulletListMatch = line.match(/^(.*[：:])\s*\*\s+(.+)$/);
  if (inlineBulletListMatch) {
    line = `${inlineBulletListMatch[1]} ${inlineBulletListMatch[2]
      .split(/\s+\*\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .join('、')}`;
  }

  if (/^\s*(?:[-+•]|\d{1,3}[.)]|\*{1,3}|#{1,6})\s*$/.test(line)) {
    return '';
  }

  line = line
    .replace(/^(\s*)(\d{1,3})、\s*(?=\S)/, '$1$2. ')
    .replace(/^(\s*)（(\d{1,3})）\s*(?=\S)/, '$1$2. ')
    .replace(/^(\s*[-+])(?=\*\*)/, '$1 ')
    .replace(/^(\s*\d{1,3}[.)])(?=\*\*)/, '$1 ')
    .replace(/^(\s*[-+])\*(?![\s*])(?=\S)/, '$1 ')
    .replace(/^(\s*\d{1,3}[.)])\*(?![\s*])(?=\S)/, '$1 ')
    .replace(/^\s*(#{1,6})\s*(.+?)\s*\*{1,3}\s*$/, '$1 $2')
    .replace(/(?<!\*)\s+\*{1,3}\s*$/g, '')
    // 标准星号列表需要空格；半截强调 "*正文" 只去掉坏标记，不把正文强行改成列表。
    .replace(/^\s*\*\s+(?=\S)/, '- ')
    .replace(/^\s*\*(?![\s*])(?=\S)/, '')
    // 列表或编号后跟半截星号时保留列表结构，移除会裸露的坏标记。
    .replace(/^(\s*[-+]\s+)\*(?![\s*])(?=\S)/, '$1')
    .replace(/^(\s*\d{1,3}[.)]\s+)\*(?![\s*])(?=\S)/, '$1');

  line = line.replace(/^\s*(\d+)[.)]\s*(.+?)[：:]\s*$/, '### $1. $2');

  if (new RegExp(`^\\s*(?:${sectionLabelPattern})[：:？?]?\\s*$`).test(line)) {
    line = `### ${line.trim()}`;
  }

  return line.trimEnd();
}

function normalizeSectionMarkers(content: string) {
  const sectionLabelPattern = [...inlineSectionLabels]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|');

  return content
    // 只把“编号后直接换行再接标题”的完整模式转标题，不把 1.* 这类可能合法续写的片段判死。
    .replace(/(^|\n)\s*(\d+)[.)]\s*\n+\s*([^\n：:]{2,60}[：:])/g, '$1### $2. $3')
    .replace(/(^|\n)\s*(\d+)[.)]\s*([^\n]{2,80}[：:])\s*$/gm, '$1### $2. $3')
    .replace(new RegExp(`(^|\\n)\\s*(${sectionLabelPattern})([：:？?]?)\\s*$`, 'g'), '$1### $2$3')
    .replace(/(^|\n)\s*\*{1,2}\s*([^*\n]{2,40}[：:？?])\s*\*{1,2}\s*(?=\n|$)/g, '$1$2\n\n');
}

function normalizeDanglingMarkdownMarkers(content: string) {
  return content
    .replace(/([：:])\s*\*\s+([^\n]+)/g, (_match, prefix: string, items: string) => {
      const normalizedItems = items
        .split(/\s+\*\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .join('、');
      return `${prefix} ${normalizedItems}`;
    })
    // 旧回复里会出现“、* / ：、*”这类被压缩后遗留的伪列表碎片。
    .replace(/([：:。！？!?；;，,、])、?\*{1,3}(?=\s|\n|$)/g, '$1')
    .replace(/([：:])、(?=\S)/g, '$1 ')
    .replace(/([。！？!?；;，,])、(?=\s|\n|$)/g, '$1')
    .replace(/(?<!\*)[ \t]+\*{1,3}(?=\n|$)/g, '')
    // 去掉普通中文句尾和标点后面的孤立星号，不影响合法 **加粗**。
    .replace(/([\u4e00-\u9fffA-Za-z0-9）》）】」』。！？!?；;，,、])\s+\*{1,3}(?=\s|$|\n)/g, '$1')
    .replace(/(^|\n)\s*\*{1,3}\s*(?=\n|$)/g, '$1')
    .replace(/(^|\n)\s*\*\s+(?=\*)/g, '$1')
    .replace(/(^|\n)\s*\*\s*([^\n*]{2,})(?=\n|$)/g, '$1- $2')
    .replace(/\n{3,}/g, '\n\n');
}

function demoteValidationKeywordFormatting(content: string) {
  return content
    .replace(/(^|\n)\s*#{1,6}\s*(下一步验证|应该怎么验证|验证关键词)[：:？?]?\s*$/gm, '$1$2：')
    .replace(/(^|\n)\s*\*{1,2}\s*(下一步验证|应该怎么验证|验证关键词)[：:？?]?\s*\*{0,2}\s*$/gm, '$1$2：');
}

export function normalizeAiMarkdown(content: string, options: NormalizeAiMarkdownOptions = {}) {
  const protectedCode = protectFencedCodeBlocks(content.replace(/\r\n/g, '\n').replace(/\t/g, '  '));
  let normalized = normalizeDanglingMarkdownMarkers(
    normalizeSectionMarkers(
      protectedCode.content
        // 容错一些常见的“伪代码块”写法。
        .replace(/^[`~]{3,}\s*$/gm, '```')
        // 模型偶尔会漏掉列表/编号和加粗之间的空格，先补成标准 Markdown。
        .replace(/(^|\n)(\s*[-+])\s*(\*{1,2}[^*\n]{1,80}[：:？?]\*{1,2})(?=\S)/g, '$1$2 $3 ')
        .replace(/(^|\n)(\s*\d{1,3}[.)])\s*(\*{1,2}[^*\n]{1,80}[：:？?]\*{1,2})(?=\S)/g, '$1$2 $3 ')
        // 把黏在正文里的 markdown 标题拆出来，避免整段挤成一行。
        .replace(/([^\n])\s*(#{1,6}\s+)/g, '$1\n\n$2')
        // 把 "*标题：*正文" 拆成两段，后面再转标题。
        .replace(/(\*{1,2}[^*\n]{1,60}[：:？?]\*{1,2})(?=\S)/g, '$1\n\n')
        .replace(/(?<=\S)(\*{1,2}[^*\n]{1,60}[：:？?]\*{1,2})/g, '\n\n$1')
        // 给常见中文段落标题补换行，修复模型把所有内容压在一段里的情况。
        .replace(new RegExp(`\\s+(${inlineSectionLabels.map(escapeRegExp).join('|')})([：:？?]?)\\s*`, 'g'), '\n\n$1$2\n\n'),
    ),
  )
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(cleanupMarkdownLine)
    .join('\n')
    .replace(/^(#{1,6}\s+.+)\n(?!\n|[-*]\s|\d+[.)]\s)/gm, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (options.plainValidationKeywords) {
    normalized = demoteValidationKeywordFormatting(normalized).replace(/\n{3,}/g, '\n\n').trim();
  }

  return protectedCode.restore(normalized);
}
