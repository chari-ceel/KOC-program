export function buildInitialTrendAgentPrompt(userInput: string) {
  const rawInput = userInput.trim();
  return [
    '这是热门追踪初始页的首条业务输入。',
    '身份边界：顶流小猪梨只是 Agent 助手昵称，不是用户的人设、账号名或内容主角；用户的具体人设只以已保存人设为准。',
    '请把用户原始输入直接理解为本轮要追踪的赛道、方向、偏好或线索，不要先停留在讨论态，也不要只做解释。',
    '请直接输出一版可展示、可保存的结构化热门追踪结果，保留 trendSummary、hotTrends、audienceNeeds、topicOpportunities、validationKeywords 和 cardPreview，同时多给能转成小红书图文的切入点。',
    '如果没有真实检索数据，不要伪造热度；请写成保守判断，并给出需要继续验证的关键词。',
    `用户原始输入：${rawInput}`,
  ].join('');
}

export function buildVisibleInitialTrendMessage(userInput: string) {
  const rawInput = userInput.trim();
  return rawInput
    ? `请直接围绕“${rawInput}”开始热门追踪，给我一版可写成图文的结构化结果。`
    : '请直接开始热门追踪，给我一版可写成图文的结构化结果。';
}

export function buildInitialContentAgentPrompt(topic: string, instruction?: string) {
  const rawTopic = topic.trim();
  const rawInstruction = (instruction || '').trim() || rawTopic;
  return [
    '这是内容撰写初始页的首条业务输入。',
    '身份边界：顶流小猪梨只是 Agent 助手昵称，不是用户的人设、账号名或内容主角；用户的具体人设只以已保存人设为准。',
    '请把用户原始输入直接理解为本轮要写的主题、口吻要求或写作方向，不要先停留在讨论态，也不要只给思路。',
    '请直接输出一篇可展示、可保存、能直接改用的小红书图文笔记草稿，重点给标题备选、封面文字、正文第一句、正文、图片顺序、结尾互动、标签和 cardPreview。',
    '标题备选和选中标题都必须控制在 20 个中文字符以内，符合小红书标题长度限制。',
    '表达要像真实小红书图文笔记，少用运营术语和报告腔；不要生成视频脚本、分镜或视频建议。',
    `主题：${rawTopic}`,
    `用户原始输入：${rawInstruction}`,
  ].join('\n');
}

export function buildVisibleInitialContentMessage(topic: string) {
  const rawTopic = topic.trim();
  return rawTopic
    ? `请直接围绕“${rawTopic}”写一篇小红书图文笔记草稿。`
    : '请直接写一篇小红书图文笔记草稿。';
}
