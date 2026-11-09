import { describe, expect, it } from "vitest";
import { StorageClient, LOCAL_METHODS } from "../src/main/storage-client";

function client(script: string): StorageClient {
  // -- prevents node interpreting the appended --store; no Python or CAD needed.
  return new StorageClient(process.execPath, ["-e", script, "--"], process.cwd(), "C:\\trusted\\local.sqlite3");
}
const echo = `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const r=JSON.parse(input);console.log(JSON.stringify({result:{...r.params,path:process.env.CADWEAVE_STORE_PATH,args:process.argv.slice(1)}}));});`;

describe("StorageClient bounded one-shot IPC", () => {
  it("exposes only public local operations", async () => {
    expect([...LOCAL_METHODS]).toEqual(["draft.save", "draft.load", "draft.delete"]);
    const c = client(echo);
    await expect(c.request("audit.begin", {})).rejects.toThrow("不允许");
    await expect(c.request("execute", {})).rejects.toThrow("不允许");
    await expect(c.request("draft.load", [])).rejects.toThrow("参数");
  });
  it("preserves Unicode and supplies DB path only from main configuration", async () => {
    const result = await client(echo).request("draft.load", { text: "装配体·材料" });
    expect(result.text).toBe("装配体·材料");
    expect(result.path).toBe("C:\\trusted\\local.sqlite3");
    expect(result.args).toContain("--store");
  });
  it("rejects byte-sized payload overflow before starting process", async () => {
    await expect(client(echo).request("draft.save", { text: "中".repeat(1500000) })).rejects.toThrow("过大");
  });
  it("reports SQLite failures and unexpected process exit", async () => {
    await expect(client(`process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({error:'database is locked'})));`).request("draft.load")).rejects.toThrow("database is locked");
    await expect(client(`process.stdin.resume();process.stdin.on('end',()=>process.exit(3));`).request("draft.load")).rejects.toThrow("退出（3）");
    await expect(client(`process.stdin.resume();process.stdin.on('end',()=>console.log('bad json'));`).request("draft.load")).rejects.toThrow();
  });
  it("limits concurrent short-lived processes and releases capacity", async () => {
    const c = client(`process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>console.log('{"result":true}'),150));`);
    const requests = Array.from({ length: 4 }, () => c.request("draft.load"));
    await expect(c.request("draft.load")).rejects.toThrow("忙");
    await expect(Promise.all(requests)).resolves.toEqual([true, true, true, true]);
    await expect(c.request("draft.load")).resolves.toBe(true);
  });
});
