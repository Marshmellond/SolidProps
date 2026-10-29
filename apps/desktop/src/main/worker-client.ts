import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

export const ALLOWED_METHODS = new Set([
  "discover",
  "connect",
  "snapshot",
  "apply",
  "disconnect",
]);
const MAX_MESSAGE = 16 * 1024 * 1024;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** One process per adapter host; no SDK object crosses this JSON boundary. */
export class WorkerClient extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, Pending>();
  private sequence = 0;
  private activeMutation = false;
  private disposed = false;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly cwd: string,
    private readonly log: (message: string) => void,
  ) {
    super();
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.disposed) throw new Error("工作进程已关闭，请重新启动工具");
    if (this.process) return this.process;
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE) {
        this.log("Worker message exceeded size limit");
        return;
      }
      try {
        const message = JSON.parse(line);
        if (message.protocolVersion !== 1 || typeof message.id !== "string") {
          this.log("Invalid protocol response");
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            new Error(String(message.error.message || "CAD 操作失败")),
          );
        else pending.resolve(message.result);
      } catch (error) {
        this.log(`Invalid worker JSON: ${String(error)}`);
      }
    });
    child.stderr.on("data", (data: Buffer) => this.log(data.toString("utf8")));
    child.once("error", (error) =>
      this.failAll(new Error(`无法启动 CAD 工作进程：${error.message}`)),
    );
    child.once("exit", (code) => {
      if (this.process === child) this.process = undefined;
      if (this.activeMutation) this.disposed = true;
      this.failAll(
        new Error(
          `CAD 工作进程已退出（${code}）。未收到结果的保存状态未知，请到 CAD 检查。`,
        ),
      );
      reader.close();
    });
    return child;
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    if (!ALLOWED_METHODS.has(method)) throw new Error("不允许的工作进程操作");
    if (!params || typeof params !== "object" || Array.isArray(params))
      throw new Error("请求参数必须是对象");
    if (this.activeMutation)
      throw new Error("正在写回，请等待结果；不要关闭 CAD");
    const mutation = method === "apply";
    if (mutation) this.activeMutation = true;
    try {
      const child = this.start();
      const id = `req-${++this.sequence}`;
      const line =
        JSON.stringify({ id, method, params, protocolVersion: 1 }) + "\n";
      if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE)
        throw new Error("请求数据过大");
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => {
            this.pending.delete(id);
            // Do not kill or retry an unknown-outcome CAD save.
            if (mutation) this.disposed = true;
            reject(
              new Error(
                mutation
                  ? "写回等待超时，状态未知。已锁定后续操作，请在 CAD 核实后重启工具；不要重复提交。"
                  : "CAD 请求超时。工作进程可能仍忙，请稍后重试。",
              ),
            );
          },
          mutation ? 300_000 : 120_000,
        );
        this.pending.set(id, { resolve, reject, timer });
        child.stdin.write(line, "utf8", (error) => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(id);
            reject(error);
          }
        });
      });
    } finally {
      if (mutation) this.activeMutation = false;
    }
  }

  get isSaving(): boolean {
    return this.activeMutation;
  }

  private failAll(error: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }

  close(): void {
    this.disposed = true;
    this.failAll(new Error("应用正在关闭"));
    this.process?.stdin.end();
    this.process?.kill();
    this.process = undefined;
  }
}
