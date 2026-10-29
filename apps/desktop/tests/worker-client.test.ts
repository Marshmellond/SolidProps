import { describe, expect, it, afterEach } from "vitest";
import { WorkerClient, ALLOWED_METHODS } from "../src/main/worker-client";

const clients: WorkerClient[] = [];
function client(script: string): WorkerClient {
  const c = new WorkerClient(
    process.execPath,
    ["-e", script],
    process.cwd(),
    () => {},
  );
  clients.push(c);
  return c;
}
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

const echo = `require('readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,protocolVersion:1,result:r.params}));});`;

describe("WorkerClient security and lifecycle", () => {
  it("only exposes the five protocol operations", () => {
    expect([...ALLOWED_METHODS]).toEqual([
      "discover",
      "connect",
      "snapshot",
      "apply",
      "disconnect",
    ]);
  });
  it("roundtrips Chinese JSON without SDK objects", async () => {
    await expect(
      client(echo).request("discover", { text: "装配体·参数" }),
    ).resolves.toEqual({ text: "装配体·参数" });
  });
  it("rejects unknown operations and scalar parameters", async () => {
    const c = client(echo);
    await expect(c.request("exec", {})).rejects.toThrow("不允许");
    await expect(c.request("discover", "bad")).rejects.toThrow("参数");
  });
  it("propagates structured worker errors", async () => {
    const c = client(
      `require('readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,protocolVersion:1,error:{code:'READ_ONLY',message:'模型只读'}}));});`,
    );
    await expect(c.request("snapshot")).rejects.toThrow("模型只读");
  });
  it("reports unexpected exit instead of pretending save succeeded", async () => {
    const c = client(`process.stdin.once('data',()=>process.exit(3));`);
    await expect(c.request("apply")).rejects.toThrow("状态未知");
    await expect(c.request("discover")).rejects.toThrow("关闭");
  });
  it("serializes mutation requests and disallows further work after close", async () => {
    const c = client(echo);
    const saving = c.request("apply", { confirmSave: true });
    await expect(c.request("snapshot")).rejects.toThrow("正在写回");
    await saving;
    c.close();
    await expect(c.request("discover")).rejects.toThrow("关闭");
  });
});
