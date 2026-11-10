/**
 * 辅助视觉：让另一个 OpenAI 兼容的视觉模型看图，把「它看到了什么」转成文字。
 *
 * 判定方式是**盲猜**：视觉模型不知道答案，只拿到图；它给出描述与最多三个猜测，
 * 由 World 打分。这样主模型没有资格宣布「我画对了」，也就不会出现
 * 「永远觉得自己对」或「永远觉得自己不对」两种退化。
 *
 * 客户端本身不碰 World 状态，只负责一次请求与一次性结果。
 */

export interface VisionOptions {
  /** OpenAI 兼容根地址，如 https://openrouter.ai/api/v1。 */
  baseUrl: string;
  /** 视觉模型名。 */
  model: string;
  /** 密钥；空字符串视为没配。 */
  apiKey: string;
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number;
}

export interface VisionReading {
  /** 看见了什么（一句话到几句话）。 */
  description: string;
  /** 最多三个猜测，按把握从高到低。 */
  guesses: string[];
  /** 0–100 的把握度。 */
  confidence: number;
}

export interface VisionScore {
  /** 3=第一猜命中；2=前三猜命中；1=描述里提到；0=完全没认出来。 */
  points: 0 | 1 | 2 | 3;
  matched: 'top1' | 'top3' | 'description' | 'none';
}

export type VisionPing =
  | { ok: true }
  | { ok: false; code: 'no-model' | 'no-key' | 'auth' | 'unreachable'; reason: string };

export class VisionError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'VisionError';
    this.status = status;
  }
}

const PROMPT =
  '你是一个画图检查员。你会看到一张简笔画，但不知道它想表达什么。\n' +
  '只输出一个 JSON 对象，不要代码块、不要解释，格式：\n' +
  '{"description":"客观描述你看到的形状与它们的关系，两句话以内","guesses":["最可能的答案","第二可能","第三可能"],"confidence":0到100的整数}\n' +
  'guesses 最多三个，没把握就少给；看不清就把 description 写得具体一点，别猜。';

const TIMEOUT_MS = 20_000;

/** 一个真实的 PNG data URL（视觉接口普遍接受这种形式）。 */
export function pngDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

/** 从可能带代码块或前后废话的回复里抠出 JSON 对象。 */
export function parseReading(text: string): VisionReading {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new VisionError('视觉模型没有按 JSON 回答。');
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new VisionError('视觉模型的回复不是合法 JSON。');
  }
  if (typeof raw !== 'object' || raw === null) throw new VisionError('视觉模型的回复不是对象。');
  const record = raw as Record<string, unknown>;
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  if (!description) throw new VisionError('视觉模型没给描述。');
  const guesses = Array.isArray(record.guesses)
    ? record.guesses
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item !== '')
        .slice(0, 3)
    : [];
  const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(100, Math.round(record.confidence)))
    : 0;
  return { description, guesses, confidence };
}

export class VisionClient {
  private readonly options: VisionOptions;

  constructor(options: VisionOptions) {
    this.options = options;
  }

  private get root(): string {
    return this.options.baseUrl.replace(/\/+$/, '');
  }

  /** 开局前的连通性检查：先看配置齐不齐，再打一次 /models。 */
  async ping(): Promise<VisionPing> {
    if (!this.options.model.trim()) {
      return { ok: false, code: 'no-model', reason: '还没填视觉模型名。' };
    }
    if (!this.options.apiKey.trim()) {
      return { ok: false, code: 'no-key', reason: '还没配视觉模型的密钥。' };
    }
    try {
      const response = await fetch(`${this.root}/models`, {
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return { ok: true };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, code: 'auth', reason: `视觉模型拒绝了密钥（HTTP ${response.status}）。` };
      }
      // 有的网关不实现 /models，但聊天接口能用；留给第一次真实检查去发现。
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, code: 'unreachable', reason: `连不上视觉模型：${message}` };
    }
  }

  /** 盲猜：只给图，不给答案。 */
  async check(png: Uint8Array): Promise<VisionReading> {
    const body = {
      model: this.options.model,
      messages: [
        { role: 'system', content: PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '这张图画的是什么？' },
            { type: 'image_url', image_url: { url: pngDataUrl(png) } },
          ],
        },
      ],
      max_tokens: 400,
      reasoning: { enabled: false },
    };
    let response: Response;
    try {
      response = await fetch(`${this.root}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new VisionError(`视觉模型请求失败：${message}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new VisionError(`视觉模型返回 HTTP ${response.status}：${text.slice(0, 200)}`, response.status);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    if (!text) throw new VisionError('视觉模型没有返回内容。');
    return parseReading(text);
  }
}

/** 打分：第一猜 3 分、前三猜 2 分、只在描述里提到 1 分、都没有 0 分。 */
export function scoreReading(reading: VisionReading, word: string, matcher: (a: string, b: string) => boolean): VisionScore {
  const [first] = reading.guesses;
  if (first && matcher(first, word)) return { points: 3, matched: 'top1' };
  if (reading.guesses.some((guess) => matcher(guess, word))) return { points: 2, matched: 'top3' };
  if (matcher(reading.description, word)) return { points: 1, matched: 'description' };
  return { points: 0, matched: 'none' };
}

/** 分数够 2 就说明「不知情的旁观者能猜出来」，可以定稿。 */
export const PASS_POINTS = 2;
