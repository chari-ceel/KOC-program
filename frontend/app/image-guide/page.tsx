'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ScenarioHeader from '@/components/ScenarioHeader';
import { SKIP_UNLOCK_ONCE_STORAGE_KEY, useAuth } from '@/context/AuthContext';
import { useAppState, type DraftItem } from '@/context/AppStateContext';

type StructuredDraft = NonNullable<DraftItem['structured']>;
type ImageMethod = '原图实拍' | '截图素材' | '醒图修图' | '美图文字卡' | '豆包生图';
type ImageToolChoice = '未选择' | '豆包生图或改图' | '小红书文字图/贴纸排版';
type ContentScene =
  | '情侣日常'
  | '漫展COS'
  | '美妆穿搭'
  | '美食探店'
  | '产品种草'
  | '家居生活'
  | '母婴育儿'
  | '宠物日常'
  | '健身健康'
  | '游戏影视'
  | '线下活动'
  | '旅行记录'
  | '学习求职'
  | '生活种草'
  | '观点经验';
type VisualRole = '点击封面' | '真实证据' | '细节审美' | '过程说明' | '对比总结' | '互动留评';
type VisualStyle = '杂志封面感' | '手账拼贴感' | '截图标注感' | '生活抓拍感' | '清单卡片感' | '前后对比感';

interface ImageCardInput {
  material: string;
  intention: string;
  tool: ImageToolChoice;
}

interface GeneratedImageGuide {
  title: string;
  intro: string;
  steps: string[];
  copyText: string;
  copyLabel: string;
  detailBlocks?: {
    label: string;
    text: string;
  }[];
}

interface PlanInput {
  materials: string;
  idea: string;
  count: string;
}

interface ImageGuideStep {
  label: string;
  purpose: string;
  visualRole: string;
  visualStyle: VisualStyle;
  method: ImageMethod;
  sourcePhoto: string;
  captureInstruction: string;
  composition: string;
  editGuide: string[];
  doubaoPrompt: string;
  checklist: string[];
}

interface BlogVisualPlan {
  scene: ContentScene;
  strategy: string;
  imageCount: string;
  sequence: string[];
  styleMix: string[];
}

const CONTENT_CHAT_STATE_STORAGE_KEY = 'koc-agent-content-chat-state';

const imageToolOptions: ImageToolChoice[] = [
  '未选择',
  '豆包生图或改图',
  '小红书文字图/贴纸排版',
];

const emptyImageCardInput: ImageCardInput = {
  material: '',
  intention: '',
  tool: '未选择',
};

const emptyPlanInput: PlanInput = {
  materials: '',
  idea: '',
  count: '',
};

function cleanGuideText(value = '') {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s{0,3}>\s?/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

function readDraftFromContentSession(draftId: string): DraftItem | null {
  if (!draftId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CONTENT_CHAT_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { activeDraft?: DraftItem | null };
    const activeDraft = parsed.activeDraft;
    return activeDraft?.id === draftId && activeDraft.structured ? activeDraft : null;
  } catch {
    return null;
  }
}

function compact(value: string, fallback: string) {
  const cleaned = cleanGuideText(value).replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function removeImagePrefix(value: string, index: number) {
  const cleaned = cleanGuideText(value).replace(/^图\s*\d+\s*[:：\-]\s*/, '').trim();
  return cleaned || `围绕笔记主题制作第 ${index + 1} 张配图`;
}

const sceneSignals: Array<{ scene: ContentScene; weight: number; pattern: RegExp }> = [
  { scene: '漫展COS', weight: 8, pattern: /漫展|展子|comicup|bilibiliworld|cosplay|妆造|痛包|谷子|出片|正片|返图|假毛|毛娘|场照|宅舞|lolita|洛丽塔/i },
  { scene: '漫展COS', weight: 6, pattern: /(^|[#\s，。！？、])cos($|[#\s，。！？、])|女团cos|男娘cos|cos妆|cos服|找搭子.*漫展|漫展.*搭子/i },
  { scene: '美妆穿搭', weight: 5, pattern: /穿搭|ootd|显瘦|通勤|裙子|上衣|外套|包包|鞋|配饰|护肤|化妆|彩妆|底妆|眼妆|口红|腮红|粉底|妆容|发型|变美|美甲|香水/i },
  { scene: '美食探店', weight: 5, pattern: /美食|探店|餐厅|咖啡|饮料|甜品|菜单|菜品|吃饭|夜宵|火锅|烤肉|面包|蛋糕|店名|人均|排队|打卡店/ },
  { scene: '产品种草', weight: 5, pattern: /好物|测评|开箱|种草|拔草|产品|商品|实物|包装|礼物|平替|避雷|购买|链接|使用感|体验感/ },
  { scene: '家居生活', weight: 5, pattern: /家居|收纳|房间|卧室|客厅|厨房|书桌|租房|改造|布置|软装|清洁|整理|桌搭|氛围灯/ },
  { scene: '母婴育儿', weight: 5, pattern: /母婴|宝宝|孩子|小孩|育儿|早教|绘本|奶粉|尿不湿|辅食|亲子|幼儿园|带娃/ },
  { scene: '宠物日常', weight: 5, pattern: /宠物|猫|狗|猫咪|狗狗|主子|铲屎|猫粮|狗粮|洗护|遛狗|猫砂|毛孩子/ },
  { scene: '健身健康', weight: 5, pattern: /健身|减脂|减肥|塑形|瑜伽|普拉提|跑步|运动|体态|饮食|早餐|低卡|健康|睡眠|养生|羽毛球|网球|篮球|足球|游泳|跳舞|骑行/ },
  { scene: '游戏影视', weight: 5, pattern: /游戏|手游|端游|主机|攻略|抽卡|角色|剧情|电影|电视剧|追剧|综艺|动漫|番剧|周边/ },
  { scene: '线下活动', weight: 4, pattern: /活动|展会|市集|演唱会|音乐节|发布会|讲座|沙龙|比赛|现场|观展|门票/ },
  { scene: '情侣日常', weight: 5, pattern: /情侣|恋爱|男朋友|女朋友|对象|约会|暧昧|异地|分手|复合/ },
  { scene: '学习求职', weight: 5, pattern: /学习|面试|offer|求职|代码|项目|考试|笔记|论文|作业|课程|职场|简历|截图/ },
  { scene: '旅行记录', weight: 4, pattern: /旅行|旅游|景点|路线|行程|酒店|机票|车票|门票|寺|海边|爬山|地标|民宿|出游/ },
  { scene: '生活种草', weight: 3, pattern: /生活|日常|记录|分享|清单|建议|经验/ },
];

function inferContentScene(draft: StructuredDraft, userIdea = ''): ContentScene {
  const text = `${draft.noteTitle} ${draft.hook} ${draft.body.join(' ')} ${draft.ending} ${draft.tags.join(' ')} ${userIdea}`;
  const scores = new Map<ContentScene, number>();
  sceneSignals.forEach(({ scene, weight, pattern }) => {
    if (pattern.test(text)) {
      scores.set(scene, (scores.get(scene) || 0) + weight);
    }
  });
  let bestScene: ContentScene = '观点经验';
  let bestScore = 0;
  scores.forEach((score, scene) => {
    if (score > bestScore) {
      bestScene = scene;
      bestScore = score;
    }
  });
  return bestScene;
}

function pickMethod(text: string, index: number): ImageMethod {
  const value = text.toLowerCase();
  if (value.includes('截图') || value.includes('聊天记录') || value.includes('代码') || value.includes('地图') || value.includes('票') || value.includes('清单')) {
    return '截图素材';
  }
  if (value.includes('文字') || value.includes('清单') || value.includes('步骤') || value.includes('总结') || value.includes('对比')) {
    return '美图文字卡';
  }
  if (value.includes('自拍') || value.includes('本人') || value.includes('日常') || value.includes('宿舍') || value.includes('课堂') || value.includes('穿搭')) {
    return index === 0 ? '醒图修图' : '原图实拍';
  }
  return index === 0 ? '醒图修图' : '豆包生图';
}

function pickVisualRole(text: string, index: number): VisualRole {
  if (index === 0 || /封面|第一眼|标题|吸引/.test(text)) return '点击封面';
  if (/截图|聊天|代码|票|地图|结果|证明|证据/.test(text)) return '真实证据';
  if (/细节|材质|食物|建筑|礼物|局部|氛围/.test(text)) return '细节审美';
  if (/步骤|过程|路线|教程|怎么|方法/.test(text)) return '过程说明';
  if (/对比|总结|适合|不适合|清单|避坑/.test(text)) return '对比总结';
  return '互动留评';
}

function pickVisualStyle(role: VisualRole, scene: ContentScene, method: ImageMethod): VisualStyle {
  if (method === '截图素材') return '截图标注感';
  if (role === '点击封面') return scene === '旅行记录' || scene === '生活种草' ? '杂志封面感' : '生活抓拍感';
  if (role === '真实证据') return '截图标注感';
  if (role === '细节审美') return scene === '旅行记录' ? '手账拼贴感' : '生活抓拍感';
  if (role === '过程说明') return '清单卡片感';
  if (role === '对比总结') return '前后对比感';
  return '清单卡片感';
}

function buildRoleGoal(role: VisualRole, scene: ContentScene) {
  const goals: Record<VisualRole, string> = {
    点击封面: '负责让用户停下来，必须有一个明确视觉钩子：脸、手、结果、冲突词、强场景或高识别度物品。',
    真实证据: '负责增强可信度，展示文字无法证明的部分：截图、票据、过程痕迹、前后结果或真实场景。',
    细节审美: '负责补充质感和记忆点，用近景、局部、光影、颜色或材质让笔记不像干巴巴的说明。',
    过程说明: '负责降低理解成本，把路线、步骤、操作、顺序拆开，让用户看图就知道下一步怎么做。',
    对比总结: '负责制造保存价值，把差异、适合/不适合、前后变化、避坑点压缩成一眼能懂的图。',
    互动留评: '负责引导评论或收藏，用短问题、投票感选项、反问句或一句共鸣收尾。',
  };
  if (scene === '旅行记录' && role === '细节审美') return '负责让旅行笔记有审美记忆点，拍建筑纹理、路牌、门票、食物、光影，不要只放普通风景。';
  if (scene === '学习求职' && role === '真实证据') return '负责证明方法真的发生过，截图要截关键代码、题目、运行结果或笔记局部，而不是整屏糊图。';
  return goals[role];
}

function buildDraftImagePlanSummary(draft: StructuredDraft) {
  const sequence = draft.imageTextStructure?.map((line, index) => removeImagePrefix(line, index)).filter(Boolean) || [];
  if (sequence.length === 0) return null;
  return {
    imageCount: `建议 ${sequence.length} 张：优先按内容撰写已规划的图片顺序执行。`,
    sequence: sequence.map((line, index) => `图${index + 1}：${line}`),
  };
}

function buildVisualPlan(draft: StructuredDraft, userIdea = ''): BlogVisualPlan {
  const scene = inferContentScene(draft, userIdea);
  const custom = userIdea.trim() ? `用户想法：${userIdea.trim()}。` : '';
  const draftImagePlan = buildDraftImagePlanSummary(draft);
  const applyDraftImagePlan = (plan: BlogVisualPlan): BlogVisualPlan =>
    draftImagePlan
      ? {
          ...plan,
          imageCount: draftImagePlan.imageCount,
          sequence: draftImagePlan.sequence,
          strategy: '',
        }
      : plan;

  if (scene === '情侣日常') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}这类笔记的图不是把恋爱观点逐条配图，而是用“关系证据 + 甜蜜细节 + 情绪氛围”让人相信这是真实日常。优先用两个人的合照、牵手背影、互送礼物、聊天记录、约会场景。`,
      imageCount: '建议 4-6 张：封面 1 张、关系证据 1-2 张、日常细节 1-2 张、文字互动卡 1 张。',
      sequence: ['封面：两人合照、背影、牵手、礼物或聊天截图里最有情绪的一张', '中段：礼物、一起吃饭、散步、电影票、日程截图等关系证据', '补充：一张甜蜜氛围或好笑瞬间，不需要每段正文都配图', '收尾：小红书文字图或简单问题卡，引导评论'],
      styleMix: ['生活抓拍感', '截图标注感', '细节审美', '清单卡片感'],
    });
  }
  if (scene === '漫展COS') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}漫展/COS 类不能按旅游攻略处理。图的核心是“倒计时紧迫感 + 搭子招募 + 妆造/角色氛围 + 出片参考”，优先围绕妆面、假毛、服装、动作姿势、展会同行需求和小红书封面吸引力来拆。`,
      imageCount: '建议 4-6 张：封面招募 1 张、妆造/角色氛围 1-2 张、出片姿势/参考 1 张、同行要求或互动卡 1 张。',
      sequence: ['封面：突出漫展倒计时、找搭子、女团 cos/妆造关键词，不要写成旅行封面', '妆造图：展示妆面、假毛、服装色系、角色氛围或改造前后', '出片参考图：给动作、站姿、双人互动、拍照氛围参考', '同行说明图：写清时间、地点、想找什么搭子、互拍/化妆/同行需求', '收尾互动图：一句评论引导，比如“有没有同天去的搭子”'],
      styleMix: ['杂志封面感', '生活抓拍感', '手账拼贴感', '清单卡片感'],
    });
  }
  if (scene === '美妆穿搭') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}美妆穿搭类重点不是泛泛“变好看”，而是把妆面/单品/上身效果/细节质感拆开。封面要有结果感，中段要有细节和步骤，最后给适合人群或避雷点。`,
      imageCount: '建议 4-6 张：结果封面 1 张、细节/步骤 1-2 张、上身/上脸 1-2 张、总结文字图 1 张。',
      sequence: ['封面：上脸/上身后的结果图，标题突出变化或风格', '细节：妆面、口红色号、配饰、面料、包鞋局部', '过程：改造前后、搭配拆解、底妆/眼妆关键步骤', '总结：适合谁、不适合谁、踩雷点或购买建议'],
      styleMix: ['杂志封面感', '细节审美', '前后对比感', '清单卡片感'],
    });
  }
  if (scene === '美食探店') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}美食探店类要同时让人“想吃”和“会去”。图片不能只有菜品特写，要有店名/环境/菜单/人均/排队或真实体验证据。`,
      imageCount: '建议 4-7 张：封面菜品 1 张、环境/店名 1 张、菜单/价格 1 张、细节和总结 1-3 张。',
      sequence: ['封面：最有食欲或最有记忆点的一道菜', '环境：门头、座位、排队、招牌或店内氛围', '信息：菜单、人均、地址、推荐点单或避雷菜', '细节：拉丝、切面、蘸料、分量、多人同桌真实感', '收尾：一句“值不值得去”的结论'],
      styleMix: ['生活抓拍感', '细节审美', '截图标注感', '清单卡片感'],
    });
  }
  if (scene === '产品种草') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}产品种草类要把“实物可信度 + 使用场景 + 结果/缺点”讲清楚。不要只做漂亮商品图，也不要每张都像广告。`,
      imageCount: '建议 4-7 张：封面结果 1 张、实物细节 1-2 张、使用场景 1-2 张、对比/避雷 1 张。',
      sequence: ['封面：产品和最终效果同框，突出一个最强卖点', '细节：包装、材质、尺寸、质地、开合或使用痕迹', '场景：放在桌上、包里、脸上、家里或真实使用中', '对比：前后变化、平替对比、适合/不适合人群', '收尾：购买建议或避雷总结'],
      styleMix: ['杂志封面感', '细节审美', '生活抓拍感', '前后对比感'],
    });
  }
  if (scene === '家居生活') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}家居生活类要突出“空间变化”和“可照抄”。图片要有全景、局部、前后对比、清单，不要只拍一堆好看的角落。`,
      imageCount: '建议 4-6 张：空间封面 1 张、前后对比 1 张、局部细节 1-2 张、清单/尺寸 1 张。',
      sequence: ['封面：最明显的空间变化或最有氛围的角落', '对比：改造前后、整理前后、桌面前后', '细节：收纳盒、灯光、材质、走线、尺寸关系', '清单：物品清单、预算、尺寸或购买避雷', '收尾：适合小房间/租房/宿舍的执行建议'],
      styleMix: ['生活抓拍感', '前后对比感', '细节审美', '清单卡片感'],
    });
  }
  if (scene === '母婴育儿') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}母婴育儿类要重视真实使用和安全感。图片优先展示场景、步骤、对比和注意事项，避免夸张承诺。`,
      imageCount: '建议 3-6 张：场景封面 1 张、步骤/清单 1-2 张、实物/对比 1-2 张、注意事项 1 张。',
      sequence: ['封面：宝宝/用品/场景里最能说明问题的一张', '步骤：喂养、收纳、早教或出门流程拆成小步骤', '实物：尺寸、材质、使用前后、宝宝反应或家长操作', '提醒：适合年龄、注意事项、避坑点'],
      styleMix: ['生活抓拍感', '清单卡片感', '细节审美', '前后对比感'],
    });
  }
  if (scene === '宠物日常') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}宠物类图文要有萌点，但不能只有可爱。要把宠物表情、行为证据、用品细节和照护经验拆开。`,
      imageCount: '建议 4-6 张：萌点封面 1 张、行为/对比 1-2 张、用品或环境 1 张、经验文字图 1 张。',
      sequence: ['封面：表情、动作或反差最强的一张', '行为：训练前后、吃饭、洗护、出门、互动瞬间', '细节：猫粮狗粮、窝、玩具、毛发、清洁用品', '总结：照护经验、避坑点或评论提问'],
      styleMix: ['生活抓拍感', '细节审美', '前后对比感', '清单卡片感'],
    });
  }
  if (scene === '健身健康') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}健身健康类要避免空泛鸡汤，图片要承担动作、饮食、对比和执行证据。每张图负责一个信息点。`,
      imageCount: '建议 4-6 张：结果/状态封面 1 张、动作/饮食 1-2 张、记录证据 1 张、总结清单 1 张。',
      sequence: ['封面：状态变化、运动装备或一餐低卡组合', '动作：一个动作一张图，标出关键姿势或错误点', '饮食：食材、分量、搭配、热量或替代方案', '证据：打卡记录、体态对比、睡眠/饮水/训练记录', '总结：适合谁、频率、注意事项'],
      styleMix: ['生活抓拍感', '前后对比感', '截图标注感', '清单卡片感'],
    });
  }
  if (scene === '游戏影视') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}游戏影视类要围绕角色/剧情/攻略/情绪点拆图。不要只做泛泛海报，截图、角色图、台词、步骤和观点卡要分工。`,
      imageCount: '建议 3-6 张：情绪封面 1 张、截图/角色 1-2 张、攻略/观点卡 1-2 张、互动收尾 1 张。',
      sequence: ['封面：角色、名场面、抽卡结果或一句强情绪标题', '证据：游戏截图、剧情截图、角色细节或数据页面', '说明：攻略步骤、观看顺序、人物关系或推荐理由', '收尾：评论问题、投票选项或同好互动'],
      styleMix: ['杂志封面感', '截图标注感', '清单卡片感', '互动留评'],
    });
  }
  if (scene === '线下活动') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}线下活动类要讲清现场感和实用信息。图片不能只像旅行，要有门票/时间/地点/人流/亮点/注意事项。`,
      imageCount: '建议 4-6 张：现场封面 1 张、凭证/路线 1 张、亮点 1-2 张、避坑或总结 1 张。',
      sequence: ['封面：现场最有氛围或最有辨识度的一张', '信息：门票、时间、入口、路线或地图截图', '亮点：摊位、舞台、展品、互动区或周边', '避坑：排队、携带物、拍照点、预算或时间安排', '收尾：值不值得去、适合谁去'],
      styleMix: ['生活抓拍感', '截图标注感', '细节审美', '清单卡片感'],
    });
  }
  if (scene === '旅行记录') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}旅行类更适合“封面大片 + 路线证据 + 细节审美 + 拼贴总结”。不要全放同角度风景，也不要把所有照片做成 AI 感模板。`,
      imageCount: '建议 5-8 张：封面 1 张、景点 2-3 张、人物/细节 1-2 张、路线或拼贴 1 张。',
      sequence: ['封面：最有识别度的景点或人物入镜照片', '中段：不同景别，远景、建筑细节、路牌/票根/地图、食物或纪念品', '拼贴：把同一地点 3-4 张照片组织成旅行手账', '收尾：路线、花费、避坑或一句旅行感受'],
      styleMix: ['杂志封面感', '细节审美', '手账拼贴感', '清单卡片感'],
    });
  }
  if (scene === '学习求职') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}学习求职类重点是“可信证据”。优先用截图、笔记、代码、结果页、题目卡片；AI 图只能做背景，不要替代真实截图。`,
      imageCount: '建议 3-6 张：封面题卡 1 张、关键截图 1-2 张、清单卡 1-2 张、结果证明 1 张。',
      sequence: ['封面：一句明确结果或痛点，比如已 offer、面试题、报错解决', '中段：代码/页面/笔记截图，圈出关键位置', '补充：问题清单或步骤卡片', '收尾：结果截图、复盘总结或下一步建议'],
      styleMix: ['清单卡片感', '截图标注感', '对比总结', '结果证明'],
    });
  }
  if (scene === '生活种草') {
    return applyDraftImagePlan({
      scene,
      strategy: `${custom}种草类要让用户看见“实物、使用场景、效果对比”。不要只有商品图，也不要只拍随便背景。`,
      imageCount: '建议 4-7 张：封面 1 张、细节 1-2 张、使用场景 1-2 张、对比或清单 1 张。',
      sequence: ['封面：实物最漂亮或最有结果感的一张', '中段：细节、尺寸、材质、使用前后、真实场景', '补充：购买理由或避雷点文字卡', '收尾：适合谁/不适合谁'],
      styleMix: ['杂志封面感', '细节审美', '生活抓拍感', '前后对比感'],
    });
  }
  return applyDraftImagePlan({
    scene,
    strategy: `${custom}观点经验类不用每个段落都配图。更适合“情绪封面 + 证据截图/素材 + 文字卡片 + 互动收尾”，让图片承担吸引和补充说明。`,
    imageCount: '建议 3-5 张：封面 1 张、补充证据 1 张、文字卡 1-2 张、互动卡 1 张。',
    sequence: ['封面：情绪最强的梗图、照片或短句卡', '中段：截图、案例、聊天记录、列表素材，只展示文字说不清的部分', '补充：把核心观点做成一张小红书文字图', '收尾：一句提问或投票感短句'],
    styleMix: ['杂志封面感', '截图标注感', '清单卡片感', '互动留评'],
  });
}

function buildSourcePhotoGuide(purpose: string, method: ImageMethod, title: string, scene: ContentScene, role: VisualRole, style: VisualStyle, userIdea = '') {
  const custom = userIdea.trim() ? `你自己的方向是“${userIdea.trim()}”，拍摄和选图优先贴合这个方向。` : '';
  if (role === '点击封面') {
    if (scene === '旅行记录') return `${custom}从相册里先挑“地点一眼能认出”的图：地标远景、人物站在景点前、车窗/路牌/门票压在画面边角。封面不要拼太碎，一张主图比四张小图更容易停留。`;
    if (scene === '学习求职') return `${custom}准备一张高对比题卡或结果截图：比如面试题标题、offer 局部、项目页面、代码运行结果。封面只放一个核心信息，不要把整篇清单塞上去。`;
    if (scene === '生活种草') return `${custom}选最能体现“结果感”的实物图：上脸/上身/使用中/前后变化。背景要服务主体，别用随便的墙面或杂乱桌面。`;
    return `${custom}选一张情绪最强的主图：人物表情、手部动作、聊天截图金句、礼物/物品特写、梗图或短句卡都可以。封面只需要一个钩子，不需要解释完整正文。`;
  }
  if (role === '真实证据') {
    if (scene === '学习求职') return `${custom}准备关键证据截图：代码片段、报错信息、运行结果、笔记重点、面试题、offer/邮件局部。先打码姓名、邮箱、公司内部信息，再截取最关键区域。`;
    if (scene === '旅行记录') return `${custom}准备路线和真实凭证：地图路线、门票、车票、排队现场、店名招牌、菜单、定位截图。只保留能帮助别人复刻行程的信息。`;
    return `${custom}准备能证明内容真实的素材：聊天记录、订单/票据、对比前后、过程截图、现场照片。隐私先打码，只留下关键句和关键结果。`;
  }
  if (role === '细节审美') {
    if (style === '手账拼贴感') return `${custom}准备 3-4 张同主题细节图：建筑纹理、票根、食物、路牌、纪念品、局部光影。图片颜色尽量同一色系，后面拼贴才不会乱。`;
    return `${custom}准备近景或局部：手拿物品、桌面角落、包装材质、衣服纹理、光落在物体上的一小块。细节图不是凑数，是让笔记有质感和记忆点。`;
  }
  if (role === '过程说明') {
    return `${custom}准备能串成步骤的素材：第 1 步的入口、第 2 步的操作、第 3 步的结果。每张图只负责一个动作，不要一张图塞完整流程。`;
  }
  if (role === '对比总结') {
    return `${custom}准备两组能对照的素材：前后变化、好坏案例、适合/不适合、正确/错误、买前/买后。图片角度尽量一致，对比才明显。`;
  }
  if (method === '豆包生图') {
    return `没有合适原图时再用 AI。先找 2-3 张同类博主的参考图，观察画面里真实出现的物品、人物姿态和背景，不要只追求“高级感”。主题是“${title}”，画面要像手机随手拍后精修过。`;
  }
  if (method === '截图素材') {
    return `${custom}准备能证明内容的截图或素材，不要截整屏。只保留标题、关键段落、核心数据或对话，隐私信息用涂抹/马赛克处理。`;
  }
  if (method === '美图文字卡') {
    return `准备一张干净底图：可以是桌面、笔记本、电脑屏幕、天空、墙面或纯色背景。不要直接让 AI 生成大段文字，文字卡片建议用美图秀秀或 Canva可画手动排版。`;
  }
  if (method === '醒图修图') {
    return `优先用自己的原图：人物半身、桌面细节、物品平铺、手机截图、出门路上都可以。拍照时留出上方或侧边空白，方便后面加标题。`;
  }
  return `这张图优先实拍。围绕“${purpose}”拍一个具体瞬间：手正在做事、物品摆在桌上、截图配实物、环境有一点生活痕迹，比纯 AI 场景更有网感。`;
}

function buildCompositionGuide(purpose: string, method: ImageMethod, role: VisualRole, style: VisualStyle) {
  if (role === '点击封面') {
    return `按 3:4 竖版做封面，主视觉占画面 60%-70%，标题放上方或左上安全区，四周至少留 48px。封面只保留一个强信息：一个结果、一个冲突词或一个高识别主体。`;
  }
  if (method === '截图素材') {
    return `截图不要铺满全屏。放在 3:4 画布中间，占 70%-82%，外面留浅色边框；重点用 1 个框线或箭头标出，最多标 2 处，避免像课件。`;
  }
  if (method === '美图文字卡') {
    return `标题占上方 25%，正文放中间 55%，底部留互动或页码。每张卡只讲一个观点，最多 4 行正文；文字左对齐更像真实笔记，居中适合情绪短句。`;
  }
  if (style === '手账拼贴感') {
    return `用 2x2、上下错落或一大三小排版。最大的一张负责主信息，其余三张补细节；贴纸、胶带、箭头只能做点缀，不能压住照片主体。`;
  }
  if (style === '前后对比感') {
    return `用左右对比或上下对比，左右两侧拍摄角度尽量一致。中间留 24-36px 间隔，标题写对比结论，不要写成大段解释。`;
  }
  if (method === '豆包生图') {
    return `3:4 竖版，镜头像手机拍摄。主体不要正中死板，可以放三分线位置；背景保留 2-3 个真实物件，不要空旷影棚或完美样板间。`;
  }
  return `用三分法或对角线安排主体，上方留标题空间，前景可以放手、杯子、票根、电脑边角这类真实物件。画面要有层次：前景/主体/背景至少有两层。`;
}

function buildCaptureInstruction(purpose: string, scene: ContentScene, method: ImageMethod, role: VisualRole) {
  if (role === '点击封面') {
    if (scene === '学习求职') return '做封面时不要截一整页资料。只截标题、结果或最关键题目，再加一句 12 字以内大标题，比如“这题面试真会问”。';
    if (scene === '旅行记录') return '封面优先拍“人 + 地点”或“地标 + 天气光线”。同一个景点横竖各拍一张，竖图留天空或墙面给标题。';
    if (scene === '生活种草') return '拍结果感：上脸、上身、使用中、打开前后。不要只拍包装，除非包装本身就是卖点。';
    return '封面只抓一个情绪瞬间：表情、手势、聊天金句、物品特写或一句短问题。让用户不用读正文也知道这篇在讲什么。';
  }
  if (role === '真实证据') {
    if (method === '截图素材') return '截图只截关键区域：聊天保留 2-5 句，代码保留函数和报错，地图保留路线和地点名，票据保留时间/地点但打码个人信息。';
    return '拍摄“发生过”的证据：收据、票根、桌面过程、完成结果、现场环境。画面里最好出现一个可验证细节，比如日期、地点、物品、步骤痕迹。';
  }
  if (role === '细节审美') {
    return '靠近拍局部，不要站远拍全貌。找纹理、颜色、光影、手部动作、边角细节；拍 3 张不同距离，选最有质感的一张。';
  }
  if (role === '过程说明') {
    return '按动作截/拍：入口在哪、点哪里、变化是什么、结果长什么样。每一步只展示一个动作，必要时用箭头标一下，不要把教程全塞一张。';
  }
  if (role === '对比总结') {
    return '拍对比时保持同角度、同光线、同距离。截图对比也要统一缩放比例，避免用户分不清差异来自内容还是排版。';
  }
  if (scene === '情侣日常') {
    if (method === '截图素材') {
      return '截聊天记录时只截最有情绪的 2-5 句，比如关心、报备、约定、互相调侃；把头像昵称打码，保留时间感或一句关键回复。';
    }
    return '拍两个人真实互动，不一定露脸：牵手过马路、同一桌饭、礼物拆开的瞬间、并排走路的影子、对方视角的半身照都可以。重点是“关系感”，不是精致摆拍。';
  }
  if (scene === '旅行记录') {
    if (purpose.includes('拼') || purpose.includes('手账')) {
      return '每个地点选一张远景、一张近景、一张细节，后期拼成 2x2 或上下错落版式。照片方向尽量一致，天空/建筑/人物不要都挤在同一边。';
    }
    return '按“远景交代地点、近景展示细节、人物增加代入感”去拍。每个景点至少拍横竖各一张，方便后面拼贴。';
  }
  if (scene === '学习求职') {
    return '截图前先把页面缩放到 90%-110%，只截关键代码、题目或结果。像你发的示例那样，用框线圈出截图位置，并写清“在哪里截、截什么、为什么截”。';
  }
  if (method === '美图文字卡') {
    return '先从正文里挑一句最能引发保存/评论的话，不要整段搬上图。用小红书自带文字生成图片、美图秀秀或 Canva可画做成卡片。';
  }
  return '先问自己：这张图是吸引点击、证明真实性、解释文字说不清的部分，还是制造情绪？只拍能完成这个作用的内容。';
}

function buildEditGuide(method: ImageMethod, role: VisualRole, style: VisualStyle, scene: ContentScene) {
  if (role === '点击封面') {
    return [
      '先裁 3:4，保留标题安全区；小红书封面标题建议 8-14 字，放在空白处，不遮脸、不遮主体。',
      '用曲线或亮度把主体提亮一档，背景不要提得一样亮；主体和背景要有明暗差。',
      '用 HSL 单独压低杂乱颜色的饱和度，只保留一个强调色，比如粉色、红色、蓝色或绿色。',
      '用消除/修补去掉画面边缘杂物，再用文字描边或半透明底条增强标题可读性。',
    ];
  }
  if (method === '截图素材') {
    return [
      '截图前把隐私信息先遮掉：头像、昵称、邮箱、手机号、地址、订单号都不要露出。',
      '只截关键区域，不要整屏。需要说明位置时，用绿色框、黄色荧光笔或红色箭头标出。',
      '放进美图秀秀或 Canva可画，外面加 40-64px 留白，背景用白色、浅灰、网格纸或浅色渐变。',
      '用马赛克/涂鸦遮隐私，用描边矩形圈重点；如果截图字太小，拆成两张图，不要硬塞。',
    ];
  }
  if (method === '美图文字卡') {
    return [
      '用小红书文字生成图片、美图秀秀或 Canva可画建 3:4 画布；背景可选纯色、网格纸、便签纸、照片虚化底。',
      '标题 14 字以内，字号比正文大 1.6-2 倍；正文分 2-4 条，每条不超过 18 字。',
      '用文字层级而不是堆装饰：标题粗体，重点词换强调色，正文深灰；最多 1 个贴纸或小图标。',
      '用对齐/间距功能统一行距，四周留 48px 以上；导出前放大检查错字、溢出和安全边距。',
    ];
  }
  if (method === '豆包生图') {
    return [
      '如果有参考图，先上传参考图，再粘贴提示词；没有参考图就把主体、颜色、场景写具体。',
      '第一版只改主体和构图，不要同时要求换风格、加文字、换背景。',
      '生成后如果太 AI，就追问：更像手机原图，降低商业摄影感，减少完美布光，保留一点生活杂物。',
      '不要让豆包生成长文字图片；需要文字时导出底图后去美图秀秀或 Canva可画排版。',
    ];
  }
  if (method === '醒图修图') {
    if (scene === '旅行记录' || style === '手账拼贴感') {
      return [
        '先批量裁成同一比例 3:4，天空多的图保留上方，建筑细节图保留纹理和边线。',
        '用 HSL 单独压低天空蓝或树叶绿的饱和度 5-12，避免颜色太刺；建筑红/黄可轻微保留。',
        '用局部调整提亮主体区域，阴影 +8 到 +15，锐化 +8 到 +15，颗粒 +3 到 +6 做轻微胶片感。',
        '拼图前统一色温：偏黄降色温 3-8，偏灰加对比 3-6；最后用贴纸/胶带/手写箭头少量点缀。',
      ];
    }
    return [
      '先裁成 3:4，用网格线把主体放三分线；如果要加标题，提前留一块干净背景。',
      '基础调节：亮度 +8 到 +15，对比 -5 到 +5，饱和 +3 到 +8，锐化 +5 到 +12，颗粒 +3 到 +6。',
      '用局部调整单独提亮脸、手、物品或截图主体；背景用虚化/暗角轻压，不要全图一起拉亮。',
      '用消除去边角杂物，用 HSL 压杂色；人像磨皮控制在 10 以下，滤镜强度 20-35，保留真实纹理。',
    ];
  }
  if (style === '前后对比感') {
    return [
      '把两张图裁成同尺寸，放左右或上下对比，主体大小保持一致。',
      '用文字标注“之前/之后”“错误/正确”，每侧只写 1 个短标签。',
      '用同一滤镜和亮度，避免因为修图差异影响对比可信度。',
      '用边框或分割线区分两侧，导出前检查主体没有被裁掉。',
    ];
  }
  return [
    '拍摄时打开手机网格线，主体不要贴边；前景放手、杯子、票根、笔、本子这类真实物件增加层次。',
    '后期先统一曝光和白平衡，再处理滤镜；不要先套重滤镜，否则多图会不统一。',
    '用局部、消除、HSL 和文字工具解决具体问题：主体不亮就局部提亮，背景乱就消除，颜色脏就 HSL。',
    '发布前按顺序预览九宫格：第一张能停留，第二张能解释，后面每张信息不同，不要重复同一角度。',
  ];
}

function buildDoubaoPrompt(draft: StructuredDraft, purpose: string, method: ImageMethod, composition: string, scene: ContentScene, role: VisualRole, style: VisualStyle, userIdea = '') {
  const title = compact(draft.noteTitle, '小红书图文笔记');
  const cover = draft.coverSuggestion;
  const hook = compact(draft.hook || draft.body[0] || title, title);
  const styleText = compact(cover?.visualStyle || '真实手机照片质感，生活化，有网感，不要商业棚拍感', '真实手机照片质感');
  const mainText = compact(cover?.mainText || title, title);
  const custom = userIdea.trim() ? `用户额外想法：${userIdea.trim()}` : '';

  return [
    '生成一张适合小红书图文发布的竖版 3:4 图片。',
    `内容主题：${title}`,
    `内容类型：${scene}`,
    `图片角色：${role}`,
    `视觉风格：${style}`,
    custom,
    `图片用途：${purpose}`,
    `主体细节：围绕“${hook}”，画面中要有一个清楚主体，可以是人物手部动作、桌面物品、生活场景或主题相关道具；主体不要悬浮，不要过度完美。`,
    `场景氛围：像普通用户用手机拍完后认真修过，干净但有生活痕迹；要有一个能吸引停留的视觉钩子，不要影棚大片，不要赛博霓虹，不要过度磨皮。`,
    `参考调性：${styleText}`,
    `构图要求：${composition}`,
    `颜色要求：低饱和、自然光、轻微胶片颗粒，整体偏清爽；如果有粉色/蓝色/绿色，只作为小面积点缀。`,
    method === '美图文字卡'
      ? '这张只生成干净背景图，不要生成任何文字。文字我会后期用美图秀秀或 Canva可画添加。'
      : `如果要出现短字，只能出现“${mainText.slice(0, 12)}”这类 12 字以内大标题，不能出现小段落文字。`,
    '禁止项：不要水印，不要乱码文字，不要多手指，不要畸形脸，不要塑料皮肤，不要夸张光效，不要过度花哨贴纸，不要像广告海报。',
  ].filter(Boolean).join('\n');
}

function buildDefaultImageLines(plan: BlogVisualPlan, title: string, hook: string) {
  if (plan.scene === '情侣日常') {
    return [
      `封面图：两个人的合照、牵手背影、礼物细节或甜蜜聊天截图，突出“${title}”的关系感`,
      '关系证据图：聊天记录、互送礼物、共同日程、电影票或吃饭照片，证明这是真实日常',
      '氛围细节图：一起散步、对方视角、桌面两杯饮料、并排影子、手部互动，补充文字说不出的甜感',
      '文字互动卡：用一句问题引导评论，比如“你们会这样报备吗”或“这种相处方式舒服吗”',
    ];
  }
  if (plan.scene === '旅行记录') {
    return [
      `封面图：最有识别度的地点或人物入镜照片，第一眼让人知道“${title}”`,
      '路线证据图：地图截图、门票、车票、打卡点列表或行程截图，告诉用户怎么去、怎么安排',
      '审美细节图：建筑纹理、街角、食物、纪念品、路牌，不只放大景',
      '旅行拼贴图：选 4 张同主题照片做手账式拼贴，像旅行相册页一样组织',
    ];
  }
  if (plan.scene === '漫展COS') {
    return [
      `封面招募图：围绕“${title}”突出倒计时、找搭子、角色/女团 cos 或妆造结果`,
      '妆造氛围图：展示假毛、妆面、服装色系、痛包/谷子或角色参考',
      '出片参考图：给站姿、动作、双人互动、拍照角度或返图氛围',
      '同行说明图：写清时间、地点、想找什么搭子、互拍/化妆/同行需求',
    ];
  }
  if (plan.scene === '美妆穿搭') {
    return [
      `结果封面图：上脸/上身后的最终效果，突出“${title}”的变化或风格`,
      '细节图：妆面、色号、面料、配饰、包鞋或发型局部',
      '步骤/对比图：改造前后、搭配拆解、底妆/眼妆关键步骤',
      '总结文字图：适合谁、不适合谁、踩雷点或购买建议',
    ];
  }
  if (plan.scene === '美食探店') {
    return [
      `封面菜品图：最有食欲或最有记忆点的一道菜，服务“${title}”`,
      '门店信息图：门头、环境、菜单、人均、地址或排队情况',
      '细节图：切面、拉丝、蘸料、分量、多人同桌真实感',
      '结论图：推荐点单、避雷菜、值不值得去',
    ];
  }
  if (plan.scene === '产品种草') {
    return [
      `封面结果图：产品和使用效果同框，突出“${title}”里最强卖点`,
      '实物细节图：包装、材质、尺寸、质地、开合或使用痕迹',
      '使用场景图：放在桌上、包里、脸上、家里或真实使用中',
      '对比/避雷图：前后变化、平替对比、适合/不适合人群',
    ];
  }
  if (plan.scene === '家居生活') {
    return [
      `空间封面图：最明显的空间变化或最有氛围的角落，突出“${title}”`,
      '前后对比图：改造前后、整理前后或桌面前后',
      '局部细节图：收纳、灯光、材质、走线、尺寸关系',
      '清单文字图：物品清单、预算、尺寸或购买避雷',
    ];
  }
  if (plan.scene === '母婴育儿') {
    return [
      `场景封面图：宝宝/用品/场景里最能说明“${title}”的一张`,
      '步骤图：喂养、收纳、早教或出门流程拆成小步骤',
      '实物/对比图：尺寸、材质、使用前后、宝宝反应或家长操作',
      '提醒文字图：适合年龄、注意事项、避坑点',
    ];
  }
  if (plan.scene === '宠物日常') {
    return [
      `萌点封面图：表情、动作或反差最强的一张，突出“${title}”`,
      '行为证据图：训练前后、吃饭、洗护、出门或互动瞬间',
      '用品细节图：粮、窝、玩具、毛发、清洁用品或环境',
      '经验文字图：照护经验、避坑点或评论提问',
    ];
  }
  if (plan.scene === '健身健康') {
    return [
      `状态封面图：状态变化、运动装备或饮食组合，突出“${title}”`,
      '动作/饮食图：一个动作、一餐搭配或一个替代方案',
      '记录证据图：打卡记录、体态对比、睡眠/饮水/训练记录',
      '总结清单图：适合谁、频率、注意事项',
    ];
  }
  if (plan.scene === '游戏影视') {
    return [
      `情绪封面图：角色、名场面、抽卡结果或一句强情绪标题，突出“${title}”`,
      '截图/角色图：游戏截图、剧情截图、角色细节或数据页面',
      '攻略/观点卡：步骤、观看顺序、人物关系或推荐理由',
      '互动收尾图：评论问题、投票选项或同好互动',
    ];
  }
  if (plan.scene === '线下活动') {
    return [
      `现场封面图：最有氛围或最有辨识度的一张，突出“${title}”`,
      '信息证据图：门票、时间、入口、路线或地图截图',
      '亮点图：摊位、舞台、展品、互动区或周边',
      '避坑总结图：排队、携带物、拍照点、预算或时间安排',
    ];
  }
  if (plan.scene === '学习求职') {
    return [
      `封面题卡：把“${title}”做成一张清晰题卡或结果卡`,
      '关键截图图：截代码、页面、报错、题目或结果，只展示文字无法说清的部分',
      '清单文字图：把核心步骤、题目或方法整理成一张列表卡',
      '结果证明图：offer、通过截图、运行结果、项目页面或笔记局部，隐私打码',
    ];
  }
  if (plan.scene === '生活种草') {
    return [
      `封面图：商品或场景最有吸引力的一张，突出“${title}”的结果感`,
      '实物细节图：材质、大小、使用痕迹、包装、局部功能，不要只放精修图',
      '使用场景图：真实放在桌上、身上、包里、房间里的样子',
      '对比/清单图：适合谁、不适合谁、购买理由或避雷点',
    ];
  }
  return [
    `封面图：用梗图、情绪照片、短句卡或素材图表达“${title}”的第一眼情绪`,
    `补充说明图：围绕“${hook}”放截图、聊天记录、案例、清单或对比图`,
    '文字观点卡：只放最有用的一条结论，不把正文整段搬上去',
    '互动收尾图：一句问题、投票感短句或评论引导，让用户愿意留言',
  ];
}

function buildImageGuideSteps(draft: StructuredDraft, userIdea = ''): ImageGuideStep[] {
  const title = compact(draft.noteTitle, '这篇笔记');
  const plan = buildVisualPlan(draft, userIdea);
  const imageLines = draft.imageTextStructure?.map((line, index) => removeImagePrefix(line, index)).filter(Boolean) || [];
  const hook = compact(draft.hook || draft.body[0] || title, title);
  const baseLines =
    imageLines.length > 0
      ? imageLines
      : buildDefaultImageLines(plan, title, hook);

  return baseLines.slice(0, 8).map((line, index) => {
    const purpose = line.replace(/^封面图[:：]\s*/, '').replace(/^内容场景图[:：]\s*/, '').replace(/^文字卡片[:：]\s*/, '').replace(/^收尾图[:：]\s*/, '');
    const method = pickMethod(line, index);
    const role = pickVisualRole(line, index);
    const visualStyle = pickVisualStyle(role, plan.scene, method);
    const composition = buildCompositionGuide(purpose, method, role, visualStyle);

    return {
      label: `图${index + 1}`,
      purpose,
      visualRole: plan.sequence[index] || buildRoleGoal(role, plan.scene),
      visualStyle,
      method,
      sourcePhoto: buildSourcePhotoGuide(purpose, method, title, plan.scene, role, visualStyle, userIdea),
      captureInstruction: buildCaptureInstruction(purpose, plan.scene, method, role),
      composition,
      editGuide: buildEditGuide(method, role, visualStyle, plan.scene),
      doubaoPrompt: buildDoubaoPrompt(draft, purpose, method, composition, plan.scene, role, visualStyle, userIdea),
      checklist: ['第一眼能看懂这张图在讲什么', '画面不要像海报模板，保留一点真实细节', '多张图色调统一，不要一张冷一张暖', '文字类图片不要交给豆包直接生成长文字'],
    };
  });
}

function hasCardBrief(input: ImageCardInput) {
  return input.material.trim().length > 0 && input.intention.trim().length > 0;
}

function matchAny(value: string, pattern: RegExp) {
  return pattern.test(value);
}

function inferVisualMission(step: ImageGuideStep) {
  const text = `${step.purpose} ${step.visualRole} ${step.visualStyle}`;
  if (/停下来|封面|第一眼|标题|吸引|点击/.test(text)) return '封面吸引点击';
  if (/证明|证据|真实|截图|票据|结果/.test(text)) return '真实素材证明';
  if (/步骤|过程|路线|教程|操作|方法/.test(text)) return '步骤过程说明';
  if (/对比|总结|清单|避坑|适合|不适合/.test(text)) return '总结收藏价值';
  if (/评论|互动|提问|留评/.test(text)) return '评论互动引导';
  return '审美氛围补充';
}

function buildMaterialProfile(draft: StructuredDraft, step: ImageGuideStep, input: ImageCardInput) {
  const text = `${draft.noteTitle} ${step.purpose} ${step.visualRole} ${input.material} ${input.intention}`;
  return {
    hasScreenshot: matchAny(text, /截图|聊天|对话|订单|票|地图|代码|页面|屏幕|课程|笔记|表格|后台|数据/),
    hasPortrait: matchAny(text, /自拍|合照|人像|本人|脸|半身|全身|穿搭|妆造|cos|cosplay|同框|背影|手/),
    hasProduct: matchAny(text, /产品|商品|好物|护肤|口红|衣服|包|鞋|礼物|开箱|实物|包装|测评/),
    hasTravel: matchAny(text, /旅行|旅游|景点|城市|酒店|机票|车票|门票|路线|地标|街道|海|山|寺|展览/),
    hasFood: matchAny(text, /美食|餐厅|探店|咖啡|饮料|甜品|菜单|菜|饭|吃/),
    hasTextCard: matchAny(text, /文字卡|清单|标题|金句|观点|总结|步骤卡|教程卡|备忘录/),
    wantsCartoon: matchAny(text, /卡通|漫画|插画|手绘|二次元|Q版|贴纸风/),
    wantsDoodle: matchAny(text, /涂鸦|贴纸|可爱|手账|胶带|箭头|标注/),
    wantsCollage: matchAny(text, /拼图|拼贴|九宫格|宫格|手账|多图|组合/),
    wantsClean: matchAny(text, /干净|清爽|高级|质感|统一|简洁|不花|不乱/),
    wantsReal: matchAny(text, /真实|生活感|原图|自然|不AI|不要AI|随手拍|网感/),
    wantsTutorial: matchAny(text, /教程|步骤|怎么|流程|攻略|路线|说明|操作/),
    wantsPrivacy: matchAny(text, /打码|隐私|头像|昵称|姓名|电话|地址|账号|不露脸/),
    wantsCompare: matchAny(text, /对比|前后|变化|避坑|差异|效果|前后/),
  };
}

function buildSubjectRule(profile: ReturnType<typeof buildMaterialProfile>) {
  if (profile.hasPortrait) {
    return '如果上传人物/穿搭/cos/合照参考图，请保留人物姿态、服装、妆造、发型和关系感，只优化背景、光线、画面整洁度。';
  }
  if (profile.hasProduct) {
    return '如果上传产品或实物图，请保留商品外形、材质、包装信息和使用痕迹，生成真实使用场景，不要做成电商白底广告。';
  }
  if (profile.hasScreenshot) {
    return '如果素材是截图，请不要重绘截图里的原文字；只设计截图外框、背景、标注、贴纸和整体版式。';
  }
  if (profile.hasTravel) {
    return '如果素材是旅行照片，请保留地点真实感、天气、路人尺度和手机拍摄痕迹，不要变成空旷幻想风景。';
  }
  if (profile.hasFood) {
    return '如果素材是食物或探店照片，请保留食物真实质感、餐具和桌面环境，不要修成塑料感菜单图。';
  }
  return '如果没有上传原图，请生成像手机实拍后轻修的真实场景图，画面里保留生活细节。';
}

function buildHotStyleName(scene: ContentScene, role: VisualRole, profile: ReturnType<typeof buildMaterialProfile>) {
  if (profile.hasScreenshot) return '小红书热门截图改造风：手机截图容器、荧光笔标注、手写箭头、浅色纸张背景';
  if (profile.wantsCollage || scene === '旅行记录') return '旅行手账拼贴风：胶带、票根、路牌、小照片错落叠放、统一暖调';
  if (profile.hasProduct) return '生活化种草静物风：自然光、桌面实拍、手部使用动作、低饱和高级色';
  if (profile.hasPortrait || /点击封面|细节审美/.test(role)) return '真实生活抓拍封面风：人物或手部动作做主视觉，干净背景加一点日常痕迹';
  if (profile.hasTextCard || profile.wantsTutorial) return 'Notion/课程讲义卡片风：清晰信息层级、便签块、编号步骤、少量高亮';
  return '小红书爆款图文封面风：大主体、短标题留白、强识别道具、自然光、轻微胶片颗粒';
}

function buildPromptVisualFocus(profile: ReturnType<typeof buildMaterialProfile>, mission: string) {
  if (profile.hasScreenshot) return '主体是截图本身，截图占画面 62%-72%，外面加白色圆角卡片和浅色阴影，只用 1-2 个箭头/圈圈标重点。';
  if (profile.hasProduct) return '主体是实物和使用动作，产品占画面 55%-68%，旁边放手、桌面、包、电脑或生活道具说明使用场景。';
  if (profile.hasTravel) return '主体是地点识别物或人入镜照片，保留地标、路牌、票根或地图线索，画面像真实旅行相册页。';
  if (profile.hasPortrait) return '主体是人物、背影、手部动作或妆造细节，人物不贴边，表情/姿态自然，不做影楼大片。';
  if (profile.hasFood) return '主体是食物和餐桌氛围，保留餐具、菜单、桌面光线和真实热气/酱汁质感。';
  if (/封面/.test(mission)) return '主体要一眼能停留：一个大物件、一个手部动作、一张强情绪照片或一张高识别截图，不要多主体平均分布。';
  return '主体围绕这张图的任务展开，只保留一个核心画面，不要把正文里所有信息都塞进同一张图。';
}

function buildDoubaoPromptVariants(draft: StructuredDraft, step: ImageGuideStep, input: ImageCardInput) {
  const profile = buildMaterialProfile(draft, step, input);
  const mission = inferVisualMission(step);
  const styleName = buildHotStyleName(inferContentScene(draft, input.intention), step.visualRole as VisualRole, profile);
  const subjectRule = buildSubjectRule(profile);
  const visualFocus = buildPromptVisualFocus(profile, mission);
  const title = cleanGuideText(draft.noteTitle);
  const hook = compact(draft.hook || draft.body[0] || title, title);
  const common = [
    '画幅：小红书 3:4 竖版，手机端缩略图也要清楚。',
    `笔记主题：${title}`,
    `这张图任务：${mission}`,
    `这张图要表达：${step.purpose}`,
    `已有素材：${input.material.trim()}`,
    `希望效果：${input.intention.trim()}`,
    `素材处理：${subjectRule}`,
    `画面主体：${visualFocus}`,
    '文字规则：不要直接生成大段中文，不要生成小字段落；最多只保留 1 句 8-12 字标题区，正文和贴纸文字后期手动加。',
    '统一规则：画面边缘留 48px 安全区，主体不贴边，颜色不超过 3 个主色，保留一点真实生活痕迹。',
    '避开：廉价 AI 感、影楼棚拍、PPT 模板、夸张渐变、乱码文字、多余手指、塑料皮肤、无关装饰、水印。',
  ];

  return [
    {
      label: '稳妥改图版',
      text: [
        '请按下面要求生成/改图，优先贴近我已有素材。',
        ...common,
        `风格：${profile.wantsReal ? '真实手机实拍轻修，降低 AI 味，保留自然瑕疵和现场感。' : styleName}`,
        `构图：${step.composition}`,
        '处理重点：只强化主体、光线、留白和信息层级，不大幅改人物五官、产品外形、截图内容或地点特征。',
        `画面情绪：围绕“${hook}”做真实、可相信、像普通用户认真整理过的图。`,
      ].join('\n'),
    },
    {
      label: '爆款吸睛版',
      text: [
        '请生成一张更适合小红书首屏停留的图片，但不要像广告海报。',
        ...common,
        `热门风格参考：${styleName}`,
        profile.hasScreenshot
          ? '构图：截图放进手机壳/白色圆角卡片，背景用浅色便签纸或桌面，1 个荧光圈重点，1 个手写箭头指向关键句。'
          : profile.wantsCollage
            ? '构图：一大两小拼贴，大图放最有情绪/结果的素材，小图放证据和细节，边角加胶带、票根或手写页码。'
            : '构图：主体占 60%-70%，上方或左侧留短标题区，边角放 1 个小贴纸或手写箭头制造停留点。',
        '颜色：低饱和奶油白/浅灰做底，搭配一个强调色，整体像热门小红书图文而不是商业海报。',
        `视觉钩子：把“${step.purpose}”压缩成一个能一眼看懂的画面冲突、结果或证据。`,
      ].join('\n'),
    },
    {
      label: '干净高级版',
      text: [
        '请生成一张干净、高级、适合正文配图或封面备选的图片。',
        ...common,
        '风格：浅色背景、明确留白、自然光、细腻纸张/桌面/手机屏质感，少装饰，信息层级清楚。',
        profile.hasTextCard || profile.wantsTutorial
          ? '构图：像 Notion 卡片或课程讲义，1 个标题区 + 3 个信息块位置，背景干净，文字后期手动添加。'
          : '构图：主体放在视觉中心或三分线，背景做低干扰虚化/留白，边角只保留页码或一个小符号。',
        '颜色：白、浅灰、低饱和粉/蓝/绿任选 1 个作为强调色，避免大面积紫蓝渐变和杂乱贴纸。',
        '质感：像真实照片或真实截图被精心排版，不要过度光滑，不要塑料感。',
      ].join('\n'),
    },
  ];
}

function limitText(value: string, max: number) {
  return Array.from(cleanGuideText(value)).slice(0, max).join('').trim();
}

function buildXhsEditorPlan(draft: StructuredDraft, step: ImageGuideStep, input: ImageCardInput) {
  const profile = buildMaterialProfile(draft, step, input);
  const mission = inferVisualMission(step);
  const titleBase = limitText(draft.coverSuggestion?.mainText || draft.noteTitle, 12);
  const purposeTitle = limitText(step.purpose.replace(/^[^：:]+[：:]/, ''), 14);
  const mainTitle = profile.hasScreenshot
    ? '重点看这里'
    : profile.wantsTutorial
      ? '照着这步做'
      : profile.wantsCompare
        ? '差别就在这'
        : profile.hasTravel
          ? '这张最出片'
          : profile.hasProduct
            ? '真实用下来'
            : purposeTitle || titleBase || '先看这一张';
  const subtitle = profile.hasScreenshot
    ? '圈出关键句，不用整屏解释'
    : profile.wantsTutorial
      ? '入口 / 动作 / 结果分开写'
      : profile.wantsCompare
        ? '左边问题，右边解决'
        : profile.hasProduct
          ? '场景、细节、结果放一张'
          : profile.hasTravel
            ? '地点、路线、感受只留重点'
            : limitText(draft.hook || input.intention, 18);
  const shortLines = profile.wantsTutorial
    ? ['第1步：先找到入口', '第2步：只做这个动作', '第3步：看结果变化']
    : profile.wantsCompare
      ? ['之前：哪里不对', '之后：改了什么', '结论：适合谁用']
      : profile.hasScreenshot
        ? ['只截关键区域', '隐私先打码', '用圈圈标 1 个重点']
        : profile.hasProduct
          ? ['真实使用场景', '细节别修太假', '一句话讲清结果']
          : profile.hasTravel
            ? ['地点名放角标', '路线用小箭头', '票根/路牌做贴纸']
            : ['一句结论放最大', '2 个要点分开写', '最后留一句互动'];
  const stickers = profile.hasScreenshot
    ? ['荧光笔圈出关键句', '细线箭头指向截图重点', '头像/昵称用手写涂鸦打码', '右上角加“亲测”小贴纸']
    : profile.wantsTutorial
      ? ['步骤编号 01/02/03', '入口位置用小箭头', '关键动作下划线', '完成结果用对勾贴纸']
      : profile.wantsCompare
        ? ['中间加分割线', '左侧贴“之前”', '右侧贴“之后”', '差异处用圈圈标出']
        : profile.hasTravel
          ? ['地点名做小邮戳', '路线用虚线箭头', '票根/地图角标', '边角加日期页码']
          : profile.hasProduct
            ? ['卖点词做小标签', '手部/细节用箭头', '效果处加小星星', '避雷点用感叹号贴纸']
            : ['重点词加荧光底', '空白处加 1 个手写箭头', '页码放右下角', '结尾加评论气泡'];
  const layout = profile.hasScreenshot
    ? '上方大标题，中间放截图圆角卡片，下方放 1 句解释；截图占画面 65% 左右。'
    : profile.wantsCompare
      ? '左右对比或上下对比，标题放顶部，中间用分割线，两边各只写 1 个短标签。'
      : profile.wantsTutorial
        ? '顶部标题，中间 3 个步骤块，下方放结果提示；每个步骤只写一行动作。'
        : profile.wantsCollage || profile.hasTravel
          ? '一大两小拼贴，大图放情绪或结果，小图放证据/细节；边角贴日期、地点或页码。'
          : '上方主标题，中间放主体照片/素材，下方放 2-3 条短句；四周留白，不做满屏文字。';
  const steps = [
    `主标题写“${mainTitle}”，不要超过 8 个字；副标题写“${subtitle}”。`,
    `图上短句用这 3 条：${shortLines.join(' / ')}。每条控制在 12-16 字，不搬正文长段落。`,
    `贴纸和涂鸦只选 2-3 个：${stickers.slice(0, 4).join('、')}。装饰必须指向重点，不做满屏可爱。`,
    `排版按“${layout}”来做，标题、素材、解释分区清楚。`,
    `导出前缩小看一眼：主标题能不能读清、箭头有没有指对、截图/人物/产品有没有被文字遮住。`,
  ];

  return {
    steps,
    blocks: [
      {
        label: '图上文字',
        text: [`主标题：${mainTitle}`, `副标题：${subtitle}`, ...shortLines.map((line, index) => `短句${index + 1}：${line}`)].join('\n'),
      },
      {
        label: '贴纸/涂鸦',
        text: stickers.map((item, index) => `${index + 1}. ${item}`).join('\n'),
      },
      {
        label: '排版方案',
        text: [`页面任务：${mission}`, `版式：${layout}`, '文字层级：主标题最大，副标题次之，短句放底部或侧边。', '颜色建议：背景浅色，正文深灰，只用 1 个强调色标重点。'].join('\n'),
      },
    ],
  };
}

function buildGeneratedImageGuide(draft: StructuredDraft, step: ImageGuideStep, input: ImageCardInput): GeneratedImageGuide {
  const intro = `按“${input.material.trim()}”和“${input.intention.trim()}”生成。`;
  if (input.tool === '豆包生图或改图') {
    const promptBlocks = buildDoubaoPromptVariants(draft, step, input);
    const prompt = promptBlocks.map((item) => `【${item.label}】\n${item.text}`).join('\n\n---\n\n');
    return {
      title: '豆包生图/改图',
      intro,
      steps: [
        '先上传你的原图、截图或参考图；没有素材时直接复制其中一个提示词。',
        '优先试“稳妥改图版”，想更吸睛再试“爆款吸睛版”，正文配图可试“干净高级版”。',
        '生成后如果文字乱码，保留底图，把标题、贴纸和标注放到小红书文字图里手动加。',
      ],
      copyText: prompt,
      copyLabel: '复制全部豆包提示词',
      detailBlocks: promptBlocks,
    };
  }
  const xhsPlan = buildXhsEditorPlan(draft, step, input);
  const copyText = [
    `${step.label} 小红书文字图/贴纸排版`,
    intro,
    '',
    ...xhsPlan.steps.map((item, index) => `${index + 1}. ${item}`),
    '',
    ...xhsPlan.blocks.map((block) => `【${block.label}】\n${block.text}`),
  ].join('\n');
  return {
    title: '小红书文字图/贴纸排版步骤',
    intro,
    steps: xhsPlan.steps,
    copyText,
    copyLabel: '复制文字图方案',
    detailBlocks: xhsPlan.blocks,
  };
}

function buildWaitingGuide(input: ImageCardInput) {
  if (input.tool === '未选择') return '先选择制作方式，再点击生成指导。';
  if (!hasCardBrief(input)) return '先写清楚这张图的素材和目标，再点击生成指导。';
  return '点击“生成这张图指导”，系统会按这张图的素材、目标和制作方式生成专属步骤。';
}

function parseImageCount(value: string, fallback: number) {
  const match = value.match(/\d+/);
  if (!match) return fallback;
  const count = Number(match[0]);
  if (!Number.isFinite(count)) return fallback;
  return Math.min(Math.max(count, 1), 8);
}

function defaultToolForStep(step: ImageGuideStep): ImageToolChoice {
  if (step.method === '豆包生图') return '豆包生图或改图';
  if (step.method === '截图素材' || step.method === '美图文字卡') return '小红书文字图/贴纸排版';
  if (/文字|清单|总结|步骤|对比|避坑|互动|评论|收尾/.test(step.purpose)) return '小红书文字图/贴纸排版';
  return '豆包生图或改图';
}

function buildUserFacingMaterialSuggestion(step: ImageGuideStep) {
  const purpose = step.purpose;
  if (/截图|聊天|代码|地图|票|订单|页面|结果|证明|证据/.test(purpose)) return '准备关键截图或凭证，只保留能说明问题的局部，隐私先打码。';
  if (/文字|清单|总结|步骤|对比|避坑|适合/.test(purpose)) return '准备一句核心结论或 3 条要点，适合做文字卡、清单卡或对比卡。';
  if (/旅行|路线|景点|城市|街|门票|食物|酒店/.test(purpose)) return '准备地点照片、人物入镜图、路牌/票根/地图截图或旅行细节图。';
  if (/产品|商品|好物|实物|测评|开箱|使用|礼物/.test(purpose)) return '准备实物图、使用中照片、局部细节和前后对比素材。';
  if (/自拍|合照|人物|日常|穿搭|cos|妆造|背影|牵手/.test(purpose)) return '准备人物照片、背影、手部动作、合照或能体现关系/氛围的生活瞬间。';
  return '准备最能说明这张图主题的照片、截图或实物素材；没有素材也可以先用文字描述想要的画面。';
}

function buildDefaultCardInput(step: ImageGuideStep, planInput: PlanInput): ImageCardInput {
  const material = cleanGuideText(planInput.materials || buildUserFacingMaterialSuggestion(step)).slice(0, 260);
  const intention = cleanGuideText(planInput.idea || `把这张图做成适合“${step.purpose}”的小红书配图`).slice(0, 260);
  return {
    material,
    intention,
    tool: defaultToolForStep(step),
  };
}

function buildUserPlannedSteps(draft: StructuredDraft, planInput: PlanInput) {
  const idea = [planInput.materials, planInput.idea].filter(Boolean).join('；');
  const baseSteps = buildImageGuideSteps(draft, idea);
  const fallbackCount = Math.min(Math.max(baseSteps.length || 4, 3), 6);
  return baseSteps.slice(0, parseImageCount(planInput.count, fallbackCount));
}

function CopyPromptButton({ prompt, label = '复制提示词' }: { prompt: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="koc-heading-font rounded-full border border-[var(--box-border)] bg-white px-4 py-2 text-[13px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[#fff3f5]"
    >
      {copied ? '已复制' : label}
    </button>
  );
}

function VisualPlanCard({ plan }: { plan: BlogVisualPlan }) {
  return (
    <section className="rounded-[22px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] p-6 shadow-[var(--box-shadow)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="koc-heading-font text-[15px] text-[var(--foreground)]/70">初步图片规划</p>
          <h2 className="koc-heading-font mt-1 text-[22px] leading-tight text-[var(--foreground)]">{plan.imageCount}</h2>
        </div>
      </div>
      {plan.strategy && <p className="mt-4 text-[15px] leading-7 text-[var(--foreground)]">{plan.strategy}</p>}
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-[var(--foreground)]">
        {plan.sequence.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </section>
  );
}

function PlanInputCard({
  value,
  onChange,
  onGenerate,
}: {
  value: PlanInput;
  onChange: (next: PlanInput) => void;
  onGenerate: () => void;
}) {
  return (
    <section className="rounded-[22px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] p-6 shadow-[var(--box-shadow)]">
      <h2 className="koc-heading-font text-[22px] leading-tight text-[var(--foreground)]">你的素材和想法</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="koc-heading-font text-[15px] text-[var(--foreground)]">我现在有什么素材</span>
          <textarea
            value={value.materials}
            onChange={(event) => onChange({ ...value, materials: event.target.value })}
            maxLength={320}
            placeholder="例如：3 张旅行照片、聊天截图、cos 正片、产品实拍、课程截图、票据、自拍、想打码的截图等。"
            className="mt-2 min-h-[96px] w-full resize-none rounded-[14px] border border-[var(--box-border)] bg-white px-4 py-3 text-[14px] leading-6 text-[var(--foreground)] outline-none"
          />
        </label>
        <label className="block">
          <span className="koc-heading-font text-[15px] text-[var(--foreground)]">我想要的配图感觉</span>
          <textarea
            value={value.idea}
            onChange={(event) => onChange({ ...value, idea: event.target.value })}
            maxLength={320}
            placeholder="例如：真实一点、不要 AI 味、想做手账拼贴、加可爱涂鸦、像教程截图、想统一色调。没有想法也可以留空。"
            className="mt-2 min-h-[96px] w-full resize-none rounded-[14px] border border-[var(--box-border)] bg-white px-4 py-3 text-[14px] leading-6 text-[var(--foreground)] outline-none"
          />
        </label>
      </div>
      <label className="mt-5 block">
        <span className="koc-heading-font text-[15px] text-[var(--foreground)]">我想做几张图</span>
        <input
          value={value.count}
          onChange={(event) => onChange({ ...value, count: event.target.value })}
          maxLength={8}
          placeholder="不填则自动建议"
          className="mt-2 w-full rounded-[14px] border border-[var(--box-border)] bg-white px-4 py-3 text-[14px] text-[var(--foreground)] outline-none md:w-[220px]"
        />
      </label>
      <button
        type="button"
        onClick={onGenerate}
        className="koc-heading-font mt-5 rounded-full border border-[#888888] bg-[#DE868F] px-6 py-3 text-[16px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90"
      >
        生成配图方案
      </button>
    </section>
  );
}

function ImageStepCard({
  step,
  value,
  onChange,
  generated,
  onGenerate,
}: {
  step: ImageGuideStep;
  value: ImageCardInput;
  onChange: (next: ImageCardInput) => void;
  generated?: GeneratedImageGuide;
  onGenerate: () => void;
}) {
  const canGenerate = value.tool !== '未选择' && hasCardBrief(value);

  return (
    <section className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] p-5 shadow-[var(--box-shadow)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="koc-heading-font text-[14px] text-[var(--foreground)]/70">{step.label}</p>
          <h2 className="koc-heading-font mt-1 text-[21px] leading-tight text-[var(--foreground)]">{step.purpose}</h2>
        </div>
        {generated?.copyText && <CopyPromptButton prompt={generated.copyText} label={generated.copyLabel} />}
      </div>
      <div className="mt-4 rounded-[14px] border border-[var(--box-border)] bg-[rgba(245,245,245,0.52)] p-4 text-[15px] leading-7 text-[var(--foreground)]">
        <p className="koc-heading-font">建议素材</p>
        <p className="mt-2">{buildUserFacingMaterialSuggestion(step)}</p>
      </div>

      <div className="mt-4 grid gap-4 text-[15px] leading-7 text-[var(--foreground)] md:grid-cols-2">
        <label className="block rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.72)] p-4">
          <span className="koc-heading-font">这张图用什么素材</span>
          <textarea
            value={value.material}
            onChange={(event) => onChange({ ...value, material: event.target.value })}
            maxLength={260}
            placeholder="写具体一点：几张照片、截图内容、实物、场景、人物、参考图、不能露脸/要打码等。"
            className="mt-2 min-h-[96px] w-full resize-none rounded-[12px] border border-[var(--box-border)] bg-white px-3 py-2 text-[14px] leading-6 outline-none"
          />
        </label>
        <label className="block rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.72)] p-4">
          <span className="koc-heading-font">这张图想怎么改</span>
          <textarea
            value={value.intention}
            onChange={(event) => onChange({ ...value, intention: event.target.value })}
            maxLength={260}
            placeholder="写你想要的结果：更真实、更清楚、更可爱、更有教程感、做成拼贴、加涂鸦、转插画、统一色调等。"
            className="mt-2 min-h-[96px] w-full resize-none rounded-[12px] border border-[var(--box-border)] bg-white px-3 py-2 text-[14px] leading-6 outline-none"
          />
        </label>
      </div>

      <div className="mt-4 rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.72)] p-4">
        <label className="block">
          <span className="koc-heading-font text-[15px]">选择制作方式</span>
          <select
            value={value.tool}
            onChange={(event) => onChange({ ...value, tool: event.target.value as ImageToolChoice })}
            className="mt-2 w-full rounded-[12px] border border-[var(--box-border)] bg-white px-3 py-3 text-[14px] text-[var(--foreground)] outline-none"
          >
            {imageToolOptions.map((tool) => (
              <option key={tool} value={tool}>
                {tool}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className="koc-heading-font mt-3 rounded-full border border-[#888888] bg-[#DE868F] px-5 py-2 text-[14px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[#c9c1c3] disabled:text-white/80 disabled:shadow-none"
        >
          生成这张图指导
        </button>
        {!canGenerate && <p className="mt-2 text-[13px] leading-6 text-[var(--foreground)]/65">需要先填写素材、目标，并选择制作方式。</p>}
      </div>

      <div className="mt-4 rounded-[14px] border border-[var(--box-border)] bg-[rgba(245,245,245,0.52)] p-4 text-[15px] leading-7 text-[var(--foreground)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="koc-heading-font">{generated ? generated.title : '还没有生成步骤'}</p>
        </div>
        {!generated && <p className="mt-2">{buildWaitingGuide(value)}</p>}
        {generated && (
          <>
            <p className="mt-2">{generated.intro}</p>
            <div className="mt-3 rounded-[12px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.62)] p-4">
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {generated.steps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>
            {generated.detailBlocks && generated.detailBlocks.length > 0 && (
              <div className="mt-3 space-y-3">
                {generated.detailBlocks.map((block) => (
                  <div key={block.label} className="rounded-[12px] border border-[var(--box-border)] bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="koc-heading-font text-[14px]">{block.label}</p>
                      <CopyPromptButton prompt={block.text} label="复制这一段" />
                    </div>
                    <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-[var(--foreground)]">{block.text}</pre>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function LoadingGuide() {
  return (
    <div className="flex h-full w-full items-center justify-center p-8 text-[var(--foreground)]">
      <p className="koc-heading-font text-[20px]">正在读取图文指导...</p>
    </div>
  );
}

function ImageGuidePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state } = useAppState();
  const { status, isAuthenticated, openUnlockDialog } = useAuth();
  const draftId = searchParams.get('draftId') || '';
  const [planInput, setPlanInput] = useState<PlanInput>(emptyPlanInput);
  const [generatedSteps, setGeneratedSteps] = useState<ImageGuideStep[]>([]);
  const [cardInputs, setCardInputs] = useState<Record<string, ImageCardInput>>({});
  const [generatedGuides, setGeneratedGuides] = useState<Record<string, GeneratedImageGuide>>({});
  const draft = useMemo(() => state.drafts.find((item) => item.id === draftId) || readDraftFromContentSession(draftId), [draftId, state.drafts]);
  const structured = draft?.structured;
  const visualPlan = useMemo(() => (structured ? buildVisualPlan(structured) : null), [structured]);

  useEffect(() => {
    if (status === 'loading' || isAuthenticated) return;
    openUnlockDialog({
      title: '登录后解锁图文指导',
      descriptionLines: ['图文指导需要读取你保存过的内容草稿', '保存后可以按每张图生成配图提示词'],
      redirectTo: draftId ? `/image-guide?draftId=${encodeURIComponent(draftId)}` : '/image-guide',
      closeRedirectTo: '/',
    });
    window.sessionStorage.setItem(SKIP_UNLOCK_ONCE_STORAGE_KEY, '1');
    router.replace('/');
  }, [draftId, isAuthenticated, openUnlockDialog, router, status]);

  if (status === 'loading' || state.draftsHydrating) {
    return <LoadingGuide />;
  }

  if (!structured) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden px-[5.5vw] pb-6 pt-7">
        <ScenarioHeader
          title="图文指导"
          subtitle="先从内容撰写里选择一篇已保存草稿，再生成每张图的制作步骤"
          action={
            <Link
              href="/content"
              className="koc-heading-font rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.82)] px-5 py-3 text-[18px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-white"
            >
              返回内容撰写
            </Link>
          }
        />
        <div className="mx-auto mt-8 w-full max-w-[980px] rounded-[24px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] p-8 text-center shadow-[var(--box-shadow)]">
          <h1 className="koc-title-font text-[28px] leading-tight text-[var(--foreground)]">还没有选中草稿</h1>
          <p className="mt-3 text-[16px] leading-7 text-[var(--foreground)]">请回到内容撰写，在已保存的草稿卡片上点击“图文指导”。</p>
        </div>
      </div>
    );
  }

  const tags = structured.tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ');

  return (
    <div className="flex h-full w-full flex-col overflow-hidden px-[5.5vw] pb-6 pt-7">
      <ScenarioHeader
        title="图文指导"
        subtitle="先生成配图方案，再逐张选择制作方式"
        action={
          <Link
            href="/content"
            className="koc-heading-font rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.82)] px-5 py-3 text-[18px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-white"
          >
            返回内容撰写
          </Link>
        }
      />

      <div className="mx-auto min-h-0 w-full max-w-[980px] flex-1 space-y-5 overflow-y-auto px-1 pb-8 pr-3 text-[var(--foreground)]">
        <section className="rounded-[22px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] p-6 shadow-[var(--box-shadow)]">
          <p className="koc-heading-font text-[15px] text-[var(--foreground)]/70">当前草稿</p>
          <h1 className="koc-title-font mt-1 text-[30px] leading-tight text-[var(--foreground)]">{structured.noteTitle}</h1>
          {tags && <p className="mt-3 text-[15px] leading-7 text-[var(--foreground)]">{tags}</p>}
          <p className="mt-4 text-[13px] leading-6 text-[var(--foreground)]/70">
            可以直接用默认方案，也可以补充自己的素材、想法和图片数量后重新生成。
          </p>
        </section>

        {visualPlan && <VisualPlanCard plan={visualPlan} />}

        <PlanInputCard
          value={planInput}
          onChange={setPlanInput}
          onGenerate={() => {
            const nextSteps = buildUserPlannedSteps(structured, planInput);
            const nextInputs = nextSteps.reduce<Record<string, ImageCardInput>>((acc, step) => {
              acc[`${step.label}-${step.purpose}`] = buildDefaultCardInput(step, planInput);
              return acc;
            }, {});
            setGeneratedSteps(nextSteps);
            setCardInputs(nextInputs);
            setGeneratedGuides({});
          }}
        />

        {generatedSteps.length === 0 ? (
          <section className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.72)] p-5 text-[15px] leading-7 text-[var(--foreground)] shadow-[var(--box-shadow)]">
            点击“生成配图方案”后，这里会出现每张图片的安排。
          </section>
        ) : (
          <div className="space-y-5">
            {generatedSteps.map((step) => {
            const key = `${step.label}-${step.purpose}`;
            return (
              <ImageStepCard
                key={key}
                step={step}
                value={cardInputs[key] ?? emptyImageCardInput}
                generated={generatedGuides[key]}
                onChange={(next) => {
                  setCardInputs((previous) => ({ ...previous, [key]: next }));
                  setGeneratedGuides((previous) => {
                    const nextGuides = { ...previous };
                    delete nextGuides[key];
                    return nextGuides;
                  });
                }}
                onGenerate={() => {
                  const input = cardInputs[key] ?? emptyImageCardInput;
                  if (input.tool === '未选择' || !hasCardBrief(input)) return;
                  setGeneratedGuides((previous) => ({
                    ...previous,
                    [key]: buildGeneratedImageGuide(structured, step, input),
                  }));
                }}
              />
            );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ImageGuidePage() {
  return (
    <Suspense fallback={<LoadingGuide />}>
      <ImageGuidePageInner />
    </Suspense>
  );
}
