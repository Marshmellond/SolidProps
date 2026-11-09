import { spawn } from "node:child_process";

export const LOCAL_METHODS = new Set(["draft.save", "draft.load", "draft.delete"]);
const MAX_PAYLOAD = 4 * 1024 * 1024;

/** Short-lived stdlib sqlite3 process; never accepts a renderer-supplied DB path. */
export class StorageClient {
  private active = 0;
  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly cwd: string,
    private readonly databasePath: string,
  ) {}

  async request(method: string, params: unknown = {}, internal = false): Promise<any> {
    if (!LOCAL_METHODS.has(method) && !(internal && ["audit.begin", "audit.finish"].includes(method)))
      throw new Error("不允许的本地存储操作");
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("存储参数必须为对象");
    const maxOutput = MAX_PAYLOAD * 2;
    const input = JSON.stringify({ method, params }) + "\n";
    if (Buffer.byteLength(input, "utf8") > MAX_PAYLOAD) throw new Error("存储请求过大");
    if (this.active >= 4) throw new Error("本地存储忙，请稍后重试");
    this.active++;
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(this.command, [...this.args, "--store"], {
          cwd: this.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", CADWEAVE_STORE_PATH: this.databasePath },
        });
        let output = "", errorOutput = "", bytes = 0, done = false;
        const finish = (error?: Error, value?: unknown): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (error) { child.kill(); reject(error); } else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error("本地存储超时；未确认操作是否提交")), 5000);
        child.on("error", (error) => finish(new Error(`无法启动本地存储：${error.message}`)));
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (data: string) => {
          bytes += Buffer.byteLength(data, "utf8");
          if (bytes > maxOutput) finish(new Error("存储响应过大"));
          else output += data;
        });
        child.stderr.on("data", (data: Buffer) => { if (errorOutput.length < 8192) errorOutput += data.toString("utf8"); });
        child.once("close", (code) => {
          if (done) return;
          try {
            if (code !== 0) throw new Error(`存储进程退出（${code}）：${errorOutput}`);
            const response = JSON.parse(output);
            if (response.error) throw new Error(String(response.error));
            finish(undefined, response.result);
          } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
        });
        child.stdin.on("error", (error) => finish(error));
        child.stdin.end(input, "utf8");
      });
    } finally { this.active--; }
  }
}
