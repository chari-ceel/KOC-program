# 前端视觉规范

## 目标

本文档用于把 KOC 当前正式前端页面的视觉实现沉淀为 harness 文档规范。

覆盖对象：

- 正式聊天页
  - 人设打造 `profile`
  - 热门追踪 `trending`
  - 内容撰写 `content`
  - 灵光一闪 `/?view=dialog`
- 登录弹窗
- 注册弹窗
- 注册成功弹窗
- 解锁弹窗
- 登录页

本文档约束的是：

- UI 布局骨架
- 配色与设计 token 的使用方式
- 字体资产与字体角色分工
- 图标 / 矢量图的来源与语义
- 用户消息卡片、assistant 消息卡片、结构化结果卡片外壳
- 状态反馈块与顶部轻量通知的边界
- 输入区、发送 / 停止按钮、滚到底部按钮的视觉规则
- 登录 / 注册 / 解锁弹窗与登录页的统一视觉语言
- 哪些视觉项属于跨页面通用规范，哪些允许作为场景视觉特例存在

它不是一次性的 UI 备注，而是 `docs/harness/` 体系中的前端视觉实现规范。

## 适用范围

当前先覆盖以下正式页面和认证相关界面：

- [frontend/app/profile/page.tsx](../../../../frontend/app/profile/page.tsx)
- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx)
- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx)
- [frontend/app/page.tsx](../../../../frontend/app/page.tsx)
- [frontend/components/AuthDialog.tsx](../../../../frontend/components/AuthDialog.tsx)
- [frontend/components/RegisterSuccessDialog.tsx](../../../../frontend/components/RegisterSuccessDialog.tsx)
- [frontend/components/UnlockDialog.tsx](../../../../frontend/components/UnlockDialog.tsx)
- [frontend/app/login/page.tsx](../../../../frontend/app/login/page.tsx)

当前不覆盖：

- `/data`
- `/operation`

这两个扩展页不纳入本轮正式聊天视觉主线。

## 与其他文档的关系

这份文档回答的是：

```text
当前正式页面在前端应该使用什么统一视觉语言
```

配套文档分工：

- [frontend-chat-page-harness-guidelines.md](./frontend-chat-page-harness-guidelines.md)：定义聊天页页面骨架、消息流、状态和交互协议
- [frontend-feedback-guidelines.md](./frontend-feedback-guidelines.md)：定义顶部轻量通知的实现规范
- [frontend-auth-guest-harness.md](./frontend-auth-guest-harness.md)：定义登录态、游客态和门禁边界
- [markdown-rendering-guidelines.md](./markdown-rendering-guidelines.md)：定义普通 Markdown 文本的归一化和渲染规范

本文档位于这些文档之间，负责把页面骨架与交互协议进一步落实为统一的视觉规则。

## 视觉基准页

当前正式视觉基准页为热门追踪页：

- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx)

原因：

- 它完整体现了当前正式聊天页的入口态和聊天态
- 它同时覆盖了历史入口、结构化结果、状态反馈块、顶部轻量通知、输入区、滚到底部按钮、消息级动作和页面级场景动作
- 它是目前最接近正式视觉基准形态的聊天页

规则：

1. 其他正式页面默认先对齐热门追踪页的视觉语言。
2. 某个页面如果要偏离热门追踪页的基准样式，必须先判断这是不是场景视觉特例。
3. 如果不属于场景视觉特例，就应回到通用视觉规范，而不是单页自由发挥。

## 通用视觉规范与场景视觉特例

本规范分为两层：

- `通用视觉规范`
  - 所有正式页面必须共享
  - 不应被单页随意改掉
- `场景视觉特例`
  - 只属于具体场景
  - 必须依附在通用视觉规范之上
  - 不能反向改变通用视觉规则

判断规则：

1. 会直接影响多个正式页面的宽度、配色、字体、图标语义、消息卡片、状态反馈、通知或输入区样式时，默认属于通用视觉规范。
2. 只服务某个业务场景本身的结构化结果内部排版、入口网格、专属按钮时，默认属于场景视觉特例。

## 页面壳层与布局规范

### 1. 应用壳层

所有正式页面统一运行在同一应用壳层内：

- 左侧侧边栏
- 右侧主内容区

当前壳层实现位置：

- [frontend/app/ClientLayout.tsx](../../../../frontend/app/ClientLayout.tsx)
- [frontend/components/Sidebar.tsx](../../../../frontend/components/Sidebar.tsx)

统一要求：

- 主内容区不应自行发明第二套页面主框架
- 正式页面允许在主内容区内组织自己的入口态与聊天态
- 但不允许跳出统一壳层，改成另一套后台式页面框架

### 2. 主内容区与页面主宽度

正式页面的主内容区应遵循以下规则：

- 主内容区在右侧 `main` 容器中呈现
- 页面内容允许纵向滚动，不允许横向滚动
- 正式聊天页以中轴收束布局为主
- 不允许某页长期保留极宽后台面板式布局

当前正式聊天页宽度体系的视觉基准是：

- 头部区：`max-w-[980px]`
- 消息滚动区：`max-w-[980px]`
- 底部输入区：`max-w-[980px]`
- 入口态主输入条：`max-w-[860px]`

这个宽度约束当前出现在头部区、消息区和输入区的外层容器中，应视为通用视觉规范，不应被单页删除。

它的作用是：

- 控制阅读宽度
- 保证头部、消息区、输入区对齐
- 防止大屏下消息和输入框被拉得过宽
- 保证 flex 布局下不被压缩变形

当前应用壳层的固定外边距与关系如下：

- 应用壳层左右 padding：`24px`，对应 `px-6`
- 应用壳层上下 padding：`28px`，对应 `py-7`
- 侧边栏与主内容区间距：`24px`，对应 `ml-6`

当前聊天页主内容区的固定内边距与关系如下：

- 页面外层左右 padding：约 `5.5vw`
- 页面底部 padding：`28px`
- 页面顶部 padding：`28px`
- 消息滚动区左右 padding：`20px`，小屏以上 `28px`
- 消息滚动区底部 padding：`32px`

### 3. 三段式聊天骨架的视觉落点

正式聊天页统一采用三段式视觉结构：

- 顶部头部区
- 中部消息滚动区
- 底部输入区

规则：

- 三段式聊天骨架属于通用视觉规范
- 场景视觉特例只能附着在骨架上，不能破坏骨架本身
- 例如热门追踪的“总结实时进度”按钮可以位于输入区上方，但不应改变底部输入区的基础结构

### 4. 页面滚动与消息区滚动

正式聊天页必须明确区分：

- 页面级滚动
- 消息区滚动

当前基准做法是：

- 页面整体由应用壳层控制主滚动边界
- 聊天态内部消息区自主管理滚动
- 当消息区离底部有明显距离时，可以出现滚到底部按钮

这部分视觉规则属于通用视觉规范，不应只存在于单个页面。

当前滚到底部按钮显示阈值基准为：

- 热门追踪页：距离底部超过 `160px` 时显示
- 内容撰写页：距离底部超过 `160px` 时显示

后续如果统一到其他正式页面，应默认继承这一数值，除非单独评估调整。

## 配色规范

### 1. 颜色来源

正式页面的颜色应优先来自全局 CSS 变量，不应在页面中长期散写色值。

颜色变量定义位置：

- [frontend/app/globals.css](../../../../frontend/app/globals.css)

### 2. 当前系统级色板

当前系统级色板应正式认定为：

- `--background`
  - 页面基础背景，当前值：`#f5f5f5`
- `--ambient-background`
  - 主页面氛围渐变背景
- `--ambient-background-compact`
  - 弹窗 / 登录页紧凑背景
- `--foreground`
  - 主文字颜色，当前值：`#0b1838`
- `--app-shell`
  - 应用壳层基底，当前值：`#f5f5f5`
- `--sidebar`
  - 侧边栏背景，当前值：`rgba(255, 255, 255, 0.45)`
- `--paper`
  - 标准卡片底，当前值：`rgba(255, 255, 255, 0.92)`
- `--paper-strong`
  - 更实的卡片底，当前值：`rgba(255, 255, 255, 0.96)`
- `--panel`
  - 面板层，当前值：`rgba(255, 255, 255, 0.88)`
- `--box-border`
  - 统一边框色，当前值：`#bbbbbb`
- `--box-shadow`
  - 统一阴影语义，当前值：`4px 6px 10px rgba(33, 84, 118, 0.24)`
- `--cta-shadow`
  - CTA 阴影，当前值：`0 2px 8px rgba(0, 0, 0, 0.22)`
- `--chat-bubble-bg`
  - 聊天气泡背景，当前值：`rgba(245, 245, 245, 0.4)`
- `--chat-bubble-border`
  - 聊天气泡边框，当前值：`#bbbbbb`
- `--chat-input-shadow`
  - 输入区阴影，当前值：`2px 4px 7px rgba(33, 84, 118, 0.18)`
- `--chat-bubble-shadow`
  - 消息气泡阴影，当前值：`0 1px 3px rgba(0, 0, 0, 0.08)`
- `--chat-action-shadow`
  - 消息动作阴影，当前值：`0 1px 3px rgba(0, 0, 0, 0.08)`
- `--title-blue`
  - 标题 / 品牌强调色，当前值：`#0b3598`
- `--accent-rose`
  - 强调与运行态辅助色，当前值：`#de868f`
- `--muted-text`
  - 辅助文本语义，当前值：`#0b1838`

### 3. 配色使用规则

统一要求：

- 所有正式页面必须共用同一品牌色板
- 通用卡片、状态反馈块、顶部轻量通知、输入区应共享同一视觉语义
- 不允许单页长期定义另一套主色系统
- 场景特例允许在结构化结果内部做小范围强调，但不得形成新的主题系统

热门追踪页当前体现的基准关系为：

- 整体浅灰背景 + 多层氛围渐变
- 主文字深蓝黑
- 标题强调蓝
- 重点提示玫瑰色
- 卡片、输入区和弹窗以白色半透明底为主
- 阴影和边框都保持柔和统一

### 4. 当前现状与后续方向

当前保留：

- 现有全局色板整体保留
- 热门追踪页作为配色基准保留

后续统一项：

- 页面散写色值逐步回收到变量
- 各页对 `rgba(255,255,255,...)` 的局部写法后续可统一抽象
- `TopToast` 的 `success / error / info` 当前视觉差异较弱，后续可进一步显式化

## 字体规范

### 1. 字体资产

当前系统字体资产定义于：

- [frontend/app/globals.css](../../../../frontend/app/globals.css)

包含：

- `ZiHunXinQuHei`
- `HanYiDaHeiJian`
- `TengXiangJiaLiXiHeiJian`
- `SanJiZhuoSongTiXi`

### 2. 字体角色分工

应正式认定以下字体变量与类名：

- `--font-koc-base`
  - 全局基础字体
- `--font-koc-title`
  - 品牌标题 / 页面大标题
- `--font-koc-heading`
  - 分节标题 / 卡片标题 / 动作标题
- `--font-koc-input`
  - 登录、表单、输入字段内容
- `--font-koc-song`
  - 长文本、聊天正文、Markdown 正文

对应类名：

- `.koc-title-font`
- `.koc-heading-font`
- `.koc-input-font`
- `.koc-song-font`

### 3. 字体使用规则

统一要求：

- 页面主标题使用标题字体
- 分节标题、卡片标题、场景动作标题优先使用 heading 字体
- 输入字段和表单字段优先使用 input 字体
- 聊天正文、普通 Markdown 文本、长文本内容优先使用 song 字体
- 不允许单页随意改乱字体角色分工

当前字号基准如下：

- 页面主标题：
  - 热门追踪/内容撰写入口态：`30px`
  - 人设打造入口态：`36px`
  - 登录/注册弹窗标题：`34px`
  - 解锁弹窗标题：`40px`，小屏以上 `56px`
- `ScenarioHeader` 标题：`34px`
- `ScenarioHeader` 副标题：`17px`
- 结构化结果分节标题：`22px`
- 普通聊天正文：`16px`
- 用户消息正文：`15px`
- 入口态说明文案：
  - 热门/内容入口副文：`22px`
  - 历史/草稿卡片说明：`13px`
- 输入框正文：
  - 入口态输入条：`17px`
  - 聊天态输入条：`16px`
- 登录/注册输入：`18px`

### 4. 认证体系的字体使用

登录 / 注册 / 解锁相关界面也必须遵循同一字体语义：

- 标题：`koc-title-font`
- 输入：`koc-input-font`
- 主 CTA 与切换入口：`koc-heading-font`

当前对应文件：

- [frontend/components/AuthDialog.tsx](../../../../frontend/components/AuthDialog.tsx)
- [frontend/components/RegisterSuccessDialog.tsx](../../../../frontend/components/RegisterSuccessDialog.tsx)
- [frontend/components/UnlockDialog.tsx](../../../../frontend/components/UnlockDialog.tsx)
- [frontend/app/login/page.tsx](../../../../frontend/app/login/page.tsx)

### 5. 当前现状与后续方向

当前保留：

- 当前字体资产和字体角色整体保留

后续统一项：

- 各页零散字号可进一步对齐
- 标题字号层级可以后续形成更正式的 scale
- 认证体系与聊天页内部标题字号的比例关系可进一步标准化

## 图标与矢量图规范

### 1. 图标来源

正式页面图标统一来自：

- [frontend/public/koc-assets/icons/图标](../../../../frontend/public/koc-assets/icons/%E5%9B%BE%E6%A0%87)

当前核心图标资源包括：

- `人设打造.svg`
- `热门追踪.svg`
- `内容撰写.svg`
- `灵光一闪.svg`
- `保存.svg`
- `刷新.svg`
- `发送.svg`
- `等待.svg`
- `登录.svg`
- `收缩.svg`
- `小眼睛开.svg`
- `小眼睛闭.svg`

### 2. 图标角色分工

建议正式定义为四类：

- 导航图标
  - 侧边栏页面入口
- 动作图标
  - 发送、刷新、保存
- 状态图标
  - 等待、显示 / 隐藏密码
- 场景图标
  - 人设打造、热门追踪、内容撰写、灵光一闪

### 3. 图标使用规则

统一要求：

- 同一图标不应长期承载两个不同业务语义
- 同一业务语义应尽量使用固定图标
- 导航图标和页面动作图标应严格区分
- 图标尺寸、对齐方式、hover 响应应保持统一
- 图标资源变更时应检查所有引用点

当前通用尺寸基准如下：

- 侧边栏导航图标：`34px * 34px`
- 顶部灵光一闪入口图标：`56px * 56px`
- 发送按钮图标：`24px * 24px`
- 等待按钮图标：`24px * 24px`
- 消息级刷新按钮图标：`28px * 28px`
- 消息级保存按钮图标：`38px * 38px`
- 状态反馈块等待图标：`18px * 18px`
- 状态反馈块重试按钮图标：`22px * 22px`

### 4. 当前现状与后续方向

当前保留：

- 当前图标资源目录与引用方式整体保留
- 灵光一闪作为正式页面时，应只把 `灵光一闪.svg` 绑定给它本身

后续统一项：

- 所有正式场景入口图标语义应形成正式映射表
- 图标尺寸和 hover 态可进一步标准化
- 图标混用风险应在导航规范中显式记录

## 消息卡片规范

### 1. 消息卡片分类

正式消息流中的视觉卡片分为三类：

- 用户消息卡片
- assistant 消息卡片
- 状态反馈块

状态反馈块不属于普通正文消息，但它同样占据消息流中的正式视觉位置。

### 2. 用户消息卡片

用户消息卡片属于通用视觉规范，应满足：

- 固定右侧对齐
- 当前最大宽度约束：`max-w-[min(72%,680px)]`
- 边框：`1px solid var(--chat-bubble-border)`
- 背景：`var(--chat-bubble-bg)`
- 圆角：`18px`
- 阴影：`var(--chat-bubble-shadow)`
- 当前内边距：左右 `20px`、上下 `12px`
- 正文使用 `MarkdownText`
- 不挂 `MessageActions`
- 不承载结构化结果

### 3. assistant 普通消息卡片

assistant 普通消息卡片属于通用视觉规范，应满足：

- 固定左侧对齐
- 当前最大宽度约束：`max-w-[min(74%,720px)]`
- 当前外层与消息动作之间的垂直间距：`12px` 左右
- 统一气泡壳层，当前：
  - 边框：`1px solid var(--chat-bubble-border)`
  - 背景：`var(--chat-bubble-bg)`
  - 圆角：`18px`
  - 阴影：`var(--chat-bubble-shadow)`
  - 普通正文卡片内边距：`24px`
- 普通正文使用 `MarkdownText`
- 可挂消息级动作
- 结构化结果之外的普通回复均应落入这一壳层

相关组件：

- [frontend/components/MessageActions.tsx](../../../../frontend/components/MessageActions.tsx)
- [frontend/components/MarkdownText.tsx](../../../../frontend/components/MarkdownText.tsx)

### 4. 结构化结果卡片

结构化结果卡片的基础外壳属于通用视觉规范，但内部内容布局属于场景视觉特例。

以热门追踪页为基准：

- 外壳仍使用 assistant 卡片视觉体系
- 内部按“趋势 / 受众 / 选题”组织结构段
- 标题、正文、链接式选题属于场景专属排版
- 当前热门追踪结构化卡片内边距：
  - 小屏：`20px`
  - `sm` 以上：`24px`
- 当前结构块内部段间距：`16px`
- 当前结构块内部正文行高：约 `1.75`

规则：

- 通用层统一的是结构化结果卡片外壳
- 场景层差异化的是结构化结果内部内容排版

### 5. 卡片壳层规则

消息卡片以下部分属于通用视觉规范：

- 最大宽度
- 边框
- 背景
- 圆角
- 阴影
- 基础内边距层级
- 与消息级动作之间的间距关系

### 6. 当前现状与后续方向

当前保留：

- 热门追踪的结构化结果外壳作为视觉基准保留
- 人设页当前 Markdown 文本化结果保留
- 内容页 `DraftRenderer` 内部排版保留为场景特例

后续统一项：

- 用户消息卡片和 assistant 卡片的尺寸、间距可进一步 token 化
- 结构化结果卡片内部标题层级可进一步统一规范

## 状态反馈块规范

### 1. 定义

状态反馈块是当前 Agent 请求的主状态通道，不属于普通聊天正文。

当前统一组件：

- [frontend/components/AgentStatusMessage.tsx](../../../../frontend/components/AgentStatusMessage.tsx)

### 2. 状态类型

当前正式支持的状态类型：

- `running`
- `stopped`
- `error`

### 3. 视觉规则

状态反馈块应满足：

- 使用独立块级或行内块级容器
- 当前容器为 `inline-flex`
- 当前圆角：`14px`
- 当前边框：`1px solid var(--box-border)`
- 当前背景：`rgba(255,255,255,0.94)`
- 当前阴影：`var(--box-shadow)`
- 当前内边距：左右 `16px`、上下 `12px`
- 当前字号：`14px`
- 当前行高：`24px`
- `running` 使用等待图标
- `stopped` 与 `error` 使用状态指示点
- 错误态允许挂“刷新 / 重试”按钮
- 状态块不挂 `MessageActions`
- 状态块不可保存

当前状态指示元素尺寸：

- `running` 图标：`18px`
- `stopped/error` 圆点：`10px`
- 错误态重试按钮：`36px * 36px`

### 4. 插入位置规则

状态反馈块属于通用视觉规范，其插入位置应统一：

- 入口态：位于入口主操作区下方附近
- 聊天态：位于消息流底部状态槽位

### 5. 与页面级场景动作的关系

热门追踪页当前存在两类运行中状态：

- 普通对话生成中的 `running`
- “总结实时进度”过程中的 `running`

统一规则：

- 通用层只统一状态反馈块的视觉壳层
- 不把 `isSummarizingProgress` 升格为全局通用状态类型
- 场景专属文案和场景专属触发按钮，仍属于热门追踪的视觉特例

### 6. 当前现状与后续方向

当前保留：

- 当前 `AgentStatusMessage` 视觉方案整体保留

后续统一项：

- `stopped` 与 `error` 的视觉差异可进一步精炼
- 状态反馈块在各页的垂直间距可进一步统一
- 灵光一闪作为正式页面后，应补齐这一统一状态壳层

## 顶部轻量通知规范

### 1. 定义

顶部轻量通知用于页面级短时反馈，不承担请求主状态表达。

当前统一组件：

- [frontend/components/TopToast.tsx](../../../../frontend/components/TopToast.tsx)

### 2. 适用场景

顶部轻量通知适用于：

- 保存成功
- 删除成功
- 已更新
- 页面级轻量错误提醒

### 3. 视觉规则

顶部轻量通知应满足：

- 固定在顶部居中浮层
- 当前顶部偏移：`20px`
- 当前左右安全内边距：`16px`
- 当前最小高度：`44px`
- 当前容器圆角：`999px`
- 当前边框：`1px solid var(--box-border)`
- 当前背景：`rgba(255,255,255,0.95)`
- 当前阴影：`var(--box-shadow)`
- 当前左右内边距：`20px`
- 当前上下内边距：`8px`
- 当前字号：`14px`
- 支持短时自动消失
- 可选附带一个轻动作按钮

当前动画基准：

- 总时长：`2s`
- 进入位移：`translate3d(24px, -8px, 0)`
- 退出位移：`translate3d(-18px, 0, 0)`

### 4. 与状态反馈块的关系

统一关系：

- 请求状态主通道：状态反馈块
- 页面级轻提醒：顶部轻量通知

不得以顶部轻量通知替代请求运行态、停止态或错误态的主表达。

### 5. 当前现状与后续方向

当前保留：

- 当前 `TopToast` 位置、动画与整体壳层保留

后续统一项：

- `success / error / info` 的 tone 差异可进一步视觉化
- 动画节奏可进一步标准化

## 输入区规范

### 1. 输入区地位

底部输入区属于正式聊天页通用视觉规范，不属于场景特例。

### 2. 视觉规则

输入区应满足：

- 位于聊天态底部
- 与消息区共享同一宽度体系
- 当前聊天态输入区高度：`72px`
- 当前入口态输入条高度：`68px`
- 使用圆角长条形壳层，当前为整条 `999px` 圆角
- 当前边框：`1px solid var(--box-border)`
- 当前背景：`rgba(255,255,255,0.96)`，入口态首屏输入条使用 `#FFFFFF`
- 当前阴影：`var(--chat-input-shadow)` 或 `var(--box-shadow)`（入口态首屏）
- 左侧为输入框
- 右侧为发送 / 停止按钮

### 3. 输入文本规则

统一要求：

- 输入文字使用统一正文 / 输入字体语义
- placeholder 使用统一占位色
- 输入框本身不再叠多层额外边框
- 生成中输入框是否允许继续编辑，属于通用交互与视觉共同约束，应全场景统一

### 4. 发送 / 停止按钮

统一要求：

- 空闲时显示发送语义
- 生成中显示等待 / 停止语义
- 当前按钮触控尺寸：`44px * 44px`
- 当前图标字号级：约 `29px`
- hover 动效：`scale-105`
- 禁用态透明度应统一

### 5. 场景特例边界

热门追踪页在输入区上方有“总结实时进度”按钮。

这属于页面级场景动作，不属于输入区通用壳层本身。

当前正式实现约束：

- 按钮必须依附于热门追踪聊天页底部输入区上沿，不得覆盖输入框本体
- 按钮只能放入“消息区与输入区之间原本就存在的留白”中，不得为了容纳按钮额外抬高输入区整体高度
- 按钮宽度保持内容宽度，不允许拉伸为整行宽度
- 按钮高度应使用轻量胶囊尺寸，视觉上对齐现有标签类模块，不允许做成与输入框同高的大按钮
- 按钮与输入框之间允许保留一小段明确间距，但这段间距应是轻量微调，不应形成第二层明显大空白
- 该按钮只属于热门追踪页场景动作，后续其他聊天页若无明确产品要求，不应复制这一布局

当前参考实现：

- 定位关系：挂在 `ChatInputShell` 上方，依附输入区上沿
- 宽度语义：`w-fit`
- 当前胶囊尺寸基准：`px-4 py-1.5`
- 当前与输入框的垂直间距基准：`mb-2`

### 6. 当前现状与后续方向

当前保留：

- 热门页输入区作为视觉基准保留
- `max-w-[980px]` 与长条形输入壳层保留

后续统一项：

- 人设、热门、内容、灵光一闪的输入区间距应进一步严格对齐
- 生成中禁用编辑策略应统一

## 滚到底部按钮规范

### 1. 定义

滚到底部按钮应归类为正式聊天页通用视觉能力，不应只属于个别页面。

### 2. 视觉规则

滚到底部按钮应满足：

- 悬浮在消息区与输入区之间的安全位置
- 当前定位基准：距离底部 `96px`，水平居中
- 使用圆形按钮，当前尺寸：`40px * 40px`
- 当前边框：`1px solid var(--box-border)`
- 当前背景：`rgba(255,255,255,0.96)`
- 当前阴影：`var(--box-shadow)`
- 使用简洁方向性符号
- 仅在需要时显示

### 3. 交互规则

统一要求：

- 当消息区未处于底部且有明显滚动距离时显示
- 点击后平滑滚动到底部
- 不得遮挡输入区主要操作

### 4. 当前现状与后续方向

当前现状：

- 热门追踪页和内容页已有滚到底部按钮能力
- 人设页和灵光一闪后续应补齐

当前保留：

- 热门页现有滚到底部按钮作为基准保留

后续统一项：

- 人设页、灵光一闪补齐
- 触发阈值与位置进一步统一

## 登录 / 注册 / 解锁弹窗规范

### 1. 范围

认证相关视觉规范覆盖：

- [frontend/components/AuthDialog.tsx](../../../../frontend/components/AuthDialog.tsx)
- [frontend/components/RegisterSuccessDialog.tsx](../../../../frontend/components/RegisterSuccessDialog.tsx)
- [frontend/components/UnlockDialog.tsx](../../../../frontend/components/UnlockDialog.tsx)
- [frontend/app/login/page.tsx](../../../../frontend/app/login/page.tsx)
- [frontend/components/LoginButton.tsx](../../../../frontend/components/LoginButton.tsx)

### 2. 挂载位置

登录 / 注册 / 解锁弹窗属于全局应用壳层的一部分，由全局布局统一挂载，而不是某个页面私有弹窗。

相关位置：

- [frontend/app/ClientLayout.tsx](../../../../frontend/app/ClientLayout.tsx)

### 3. 弹窗容器规则

登录 / 注册 / 解锁弹窗应满足：

- 使用居中模态层
- 使用全屏半透明遮罩 + 轻微背景模糊
- 使用 `koc-auth-ambient-background`
- 当前遮罩背景：`rgba(11,24,56,0.08)`
- 当前背景模糊：`2px`
- 当前圆角：`34px`
- 当前边框：`1px solid var(--box-border)`
- 当前阴影：`var(--box-shadow)`
- 关闭按钮位置统一在右上

当前容器宽度基准：

- 登录 / 注册弹窗：`max-w-[620px]`
- 注册成功弹窗：沿用认证体系弹窗宽度语言
- 解锁弹窗：`max-w-[850px]`
- 登录页主容器：`max-w-[620px]`

### 4. 标题、输入与 CTA 规则

统一要求：

- 标题使用 `koc-title-font`
- 输入字段使用 `koc-input-font`
- 主 CTA 和切换入口使用 `koc-heading-font`
- 表单输入统一为大圆角输入
- 主 CTA 统一使用玫瑰色实底按钮

当前数值基准：

- 登录 / 注册弹窗标题：`34px`
- 解锁弹窗标题：`40px`，小屏以上 `56px`
- 登录 / 注册输入高度：`64px`
- 登录页输入高度：`64px`
- 登录 / 注册弹窗主 CTA 高度：`64px`
- 登录页主 CTA 高度：`58px`
- 解锁弹窗主 CTA 高度：`72px`
- 登录 / 注册弹窗主 CTA 字号：`34px`
- 登录页主 CTA 字号：`24px`
- 解锁弹窗主 CTA 字号：`28px`
- 登录 / 注册切换入口字号：`18px`
- 解锁弹窗次级注册入口字号：`20px`，小屏以上 `24px`

### 5. 登录页规则

登录页虽然不是弹窗，但视觉上必须与弹窗体系一致：

- 同一背景氛围
- 同一容器宽度和圆角语言
- 同一标题和输入样式
- 同一 CTA 语义

### 6. 注册成功弹窗规则

注册成功弹窗应视为认证体系的辅助弹窗，沿用同一弹窗壳层和背景语义，不应重新做另一套视觉风格。

### 7. 解锁弹窗规则

解锁弹窗属于认证门禁体系的一部分，应与登录 / 注册弹窗保持同一视觉语言。

统一要求：

- 沿用同一模态层与背景模糊
- 沿用同一标题字体与 CTA 语义
- 允许使用更大的标题和说明块
- 但不应脱离统一的认证体系视觉风格

### 8. 当前现状与后续方向

当前保留：

- `AuthDialog`、`RegisterSuccessDialog`、`UnlockDialog`、登录页整体视觉保留

后续统一项：

- 登录页与弹窗的字号、按钮高度、错误态样式可进一步精确对齐
- 认证体系错误提示块样式可与正式状态反馈体系进一步协调

## 场景视觉特例

### 1. 人设打造

属于人设打造的视觉特例：

- 表单入口布局
- 游客提示块
- 当前 Markdown 人设结果展示
- 场景内登录按钮的露出方式

这些内容必须依附在通用视觉规范之上，不得改掉正式聊天页的壳层逻辑。

### 2. 热门追踪

属于热门追踪的视觉特例：

- 历史卡片网格
- 结构化 `analysis` 的内部三段布局
- “总结实时进度”按钮
- 结构化结果中的选题链接样式

热门追踪页本身是本规范的视觉基准页，但其业务结构内容仍然属于场景视觉特例。

### 3. 内容撰写

属于内容撰写的视觉特例：

- 草稿箱卡片
- `DraftRenderer` 内部结构
- suggestions chips
- 草稿来源展示

### 4. 灵光一闪

灵光一闪当前作为正式页面纳入体系，但仅接最小通用视觉设置：

- 正式页面壳层
- 普通 Markdown 对话视觉
- 输入区
- 发送 / 停止语义
- 状态反馈块
- 滚到底部能力

当前不要求：

- 保存
- 结构化结果
- 与热门追踪、内容撰写同等级复杂度的结构块

## 现状保留与后续统一项

### 1. 现状保留

以下内容当前保留：

- 热门追踪页作为正式视觉基准
- 全局色板、氛围背景和字体体系
- `ScenarioHeader`
- `AgentStatusMessage`
- `TopToast`
- 登录 / 注册 / 解锁弹窗整体视觉
- 结构化结果“外壳统一、内部场景化”的方向
- 输入区长条壳层方案
- 登录页与弹窗共用的视觉语言

### 2. 后续统一项

以下内容记为后续统一项：

- 正式页面散写色值逐步回收到变量
- 头部区、消息区、输入区的间距进一步精确统一
- 用户消息卡片和 assistant 卡片的尺寸 token 化
- 滚到底部按钮在全部正式聊天页补齐
- 生成中输入框是否禁用形成统一规则
- `stopped / error` 的视觉差异进一步精炼
- 顶部轻量通知的 tone 差异进一步显式化
- 登录页与登录 / 注册 / 解锁弹窗的字号、按钮高度、错误态样式进一步对齐
- 文档内部路径统一改为相对路径

## 参考实现与证据索引

### 1. CSS 与设计 Token

- [frontend/app/globals.css](../../../../frontend/app/globals.css)

### 2. 通用组件

- [frontend/components/ScenarioHeader.tsx](../../../../frontend/components/ScenarioHeader.tsx)
- [frontend/components/AgentStatusMessage.tsx](../../../../frontend/components/AgentStatusMessage.tsx)
- [frontend/components/TopToast.tsx](../../../../frontend/components/TopToast.tsx)
- [frontend/components/MessageActions.tsx](../../../../frontend/components/MessageActions.tsx)
- [frontend/components/LoginButton.tsx](../../../../frontend/components/LoginButton.tsx)

### 3. 认证相关

- [frontend/components/AuthDialog.tsx](../../../../frontend/components/AuthDialog.tsx)
- [frontend/components/RegisterSuccessDialog.tsx](../../../../frontend/components/RegisterSuccessDialog.tsx)
- [frontend/components/UnlockDialog.tsx](../../../../frontend/components/UnlockDialog.tsx)
- [frontend/app/login/page.tsx](../../../../frontend/app/login/page.tsx)
- [frontend/app/ClientLayout.tsx](../../../../frontend/app/ClientLayout.tsx)

### 4. 正式页面

- [frontend/app/profile/page.tsx](../../../../frontend/app/profile/page.tsx)
- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx)
- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx)
- [frontend/app/page.tsx](../../../../frontend/app/page.tsx)

### 5. 图标资源

- [frontend/public/koc-assets/icons/图标](../../../../frontend/public/koc-assets/icons/%E5%9B%BE%E6%A0%87)

### 6. 现有 harness 文档参考

- [frontend-chat-page-harness-guidelines.md](./frontend-chat-page-harness-guidelines.md)
- [frontend-feedback-guidelines.md](./frontend-feedback-guidelines.md)
- [markdown-rendering-guidelines.md](./markdown-rendering-guidelines.md)
- [frontend-auth-guest-harness.md](./frontend-auth-guest-harness.md)
