# 浏览器 + VS Code 联动边界（预留，未实现）

本版只实现日常练习。正式比赛的自动切题、倒计时、编辑器文件创建、代码提交和浏览器与 VS Code 通信均未启用，也没有监听端口或注册本地程序。

## 当前可复用模块

- `core.mjs`：题目标识与 URL、评分和标签筛选。
- `model.mjs`：提交记录归并、候选过滤、混合组题；`nextContestProblem` 是独立纯函数，供未来比赛控制器调用，当前 UI 不调用。
- `background.mjs`：CF 公共 API 串行请求、缓存、账号同步和写入队列。
- `client.mjs`：浏览器内部消息请求，不暴露网页 postMessage 通道。
- `enhance.mjs`：CF 原网页视图，练习 AC 卡片。

## 后续实现建议

引入独立 SessionController，不在 UI 中硬编码比赛流程：

```ts
type ProblemRef = { contestId: number; index: string; url: string };
type Session = {
  id: string;
  mode: 'practice' | 'training' | 'official';
  handle: string;
  contestId?: number;
  problems: ProblemRef[];
  autoAdvance: boolean; // 默认 false
};
type SessionEvent =
  | { version: 1; type: 'problem.open'; sessionId: string; problem: ProblemRef }
  | { version: 1; type: 'submission.judged'; sessionId: string;
      submissionId: number; problem: ProblemRef; handle: string; verdict: string }
  | { version: 1; type: 'problem.nextRequested'; sessionId: string };
```

未来浏览器负责 CF 登录和原生提交结果，VS Code 负责工作区、题目目录、编译和本地样例。仅由已验证的本次 submissionId、handle 和 problem 联合确认 AC；不能以某题历史 AC 或任意页面 OK 文本触发自动切换。公开 API 在正式比赛中的可见性有限，需单独验证原生提交状态来源。

正式比赛按官方题序跳过已通过题，普通练习按筛选随机选题，训练按清单题序；三个策略应独立。自动切换需显式开启，倒计时可取消，避免切走正在编辑的页面。

通信方式待正式开发时决定（例如用户安装的 Native Messaging host）；先不要建立任意网页可调用的本地 HTTP 服务。认证、配对、会话隔离和去重需与传输方式一起设计，不在本版假定已完成。
