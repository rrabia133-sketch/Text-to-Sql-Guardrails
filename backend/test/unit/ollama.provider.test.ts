import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../../src/modules/providers/ollama.provider.js";
import { ProviderTimeoutError, ProviderNetworkError } from "../../src/modules/providers/base.provider.js";

describe("Task 7: Ollama Local Provider Adapter (US-08)", () => {
    it("connects to local Ollama, sends format: 'json', and returns structured response", async () => {
        let sentPayload: any = null;

        const mockFetch: typeof fetch = async (url, init) => {
            if (String(url).endsWith("/api/generate")) {
                sentPayload = JSON.parse(init?.body as string);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        response: JSON.stringify({
                            sql: "SELECT id, name FROM customers LIMIT 50;",
                            assumptions: ["Sample assumption"],
                            referencedTables: ["customers"],
                            referencedColumns: ["customers.id", "customers.name"],
                            explanation: "Returns 50 customers.",
                        }),
                        prompt_eval_count: 85,
                        eval_count: 42,
                        total_duration: 350_000_000,
                        done: true,
                    }),
                } as any;
            }
            throw new Error(`Unhandled mock url: ${url}`);
        };

        const provider = new OllamaProvider({ fetchFn: mockFetch });
        const res = await provider.generate("Show customers");

        assert.equal(sentPayload.format, "json", "Ollama payload must enforce format: 'json'");
        assert.equal(sentPayload.model, "qwen2.5-coder:7b");
        assert.equal(res.provider, "ollama");
        assert.equal(res.promptTokens, 85);
        assert.equal(res.completionTokens, 42);
        assert.ok(res.rawText.includes("SELECT id, name FROM customers"));
    });

    it("cleanly aborts on timeout and throws ProviderTimeoutError", async () => {
        const mockFetch: typeof fetch = async (_url, init) => {
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    const abortErr = new Error("This operation was aborted");
                    abortErr.name = "AbortError";
                    reject(abortErr);
                });
            });
        };

        const provider = new OllamaProvider({ timeoutMs: 30, fetchFn: mockFetch });
        await assert.rejects(
            async () => {
                await provider.generate("Slow query");
            },
            (err: any) => {
                assert.ok(err instanceof ProviderTimeoutError);
                assert.equal(err.code, "PROVIDER_TIMEOUT");
                assert.equal(err.provider, "ollama");
                return true;
            }
        );
    });

    it("normalizes connection failure into ProviderNetworkError", async () => {
        const mockFetch: typeof fetch = async () => {
            throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
        };

        const provider = new OllamaProvider({ fetchFn: mockFetch });
        await assert.rejects(
            async () => {
                await provider.generate("Show orders");
            },
            (err: any) => {
                assert.ok(err instanceof ProviderNetworkError);
                assert.equal(err.code, "PROVIDER_NETWORK_ERROR");
                return true;
            }
        );
    });

    it("verifies health check queries /api/tags", async () => {
        const healthyFetch: typeof fetch = async (url) => {
            if (String(url).endsWith("/api/tags")) {
                return {
                    ok: true,
                    json: async () => ({
                        models: [{ name: "qwen2.5-coder:7b" }],
                    }),
                } as any;
            }
            throw new Error("Unhandled");
        };

        const healthyProvider = new OllamaProvider({ fetchFn: healthyFetch });
        assert.equal(await healthyProvider.checkHealth(), true);

        const downFetch: typeof fetch = async () => {
            throw new Error("ECONNREFUSED");
        };
        const downProvider = new OllamaProvider({ fetchFn: downFetch });
        assert.equal(await downProvider.checkHealth(), false);
    });
});
