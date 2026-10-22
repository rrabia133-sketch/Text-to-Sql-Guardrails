import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GroqProvider } from "../../src/modules/providers/groq.provider.js";
import { ProviderQuotaError, ProviderTimeoutError } from "../../src/modules/providers/base.provider.js";

describe("Task 8: Groq Cloud Provider Adapter (US-08)", () => {
    const testSecret = "gsk_test_secret_key_1234567890abcdef";

    it("executes authenticated completions, passes response_format, and records token usage", async () => {
        let sentHeaders: any = null;
        let sentBody: any = null;

        const mockFetch: typeof fetch = async (url, init) => {
            if (String(url).endsWith("/chat/completions")) {
                sentHeaders = init?.headers;
                sentBody = JSON.parse(init?.body as string);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        choices: [
                            {
                                message: {
                                    content: JSON.stringify({
                                        sql: "SELECT id, category, unit_price FROM products LIMIT 50;",
                                        assumptions: ["All products"],
                                        referencedTables: ["products"],
                                        referencedColumns: ["products.id", "products.category", "products.unit_price"],
                                        explanation: "Retrieves 50 products.",
                                    }),
                                },
                            },
                        ],
                        usage: {
                            prompt_tokens: 110,
                            completion_tokens: 55,
                            total_tokens: 165,
                        },
                    }),
                } as any;
            }
            throw new Error(`Unhandled mock url: ${url}`);
        };

        const provider = new GroqProvider({
            apiKey: testSecret,
            fetchFn: mockFetch,
        });

        const res = await provider.generate("Show products");

        assert.equal(sentHeaders?.Authorization, `Bearer ${testSecret}`);
        assert.deepEqual(sentBody.response_format, { type: "json_object" });
        assert.equal(sentBody.model, "llama-3.3-70b-versatile");
        assert.equal(res.provider, "groq");
        assert.equal(res.promptTokens, 110);
        assert.equal(res.completionTokens, 55);
        assert.ok(res.rawText.includes("SELECT id, category, unit_price FROM products"));
    });

    it("redacts GROQ_API_KEY from error messages and never exposes in stack traces", async () => {
        const mockFetch: typeof fetch = async () => {
            return {
                ok: false,
                status: 400,
                text: async () => `Failed authorization using key ${testSecret}: invalid project.`,
            } as any;
        };

        const provider = new GroqProvider({
            apiKey: testSecret,
            fetchFn: mockFetch,
        });

        await assert.rejects(
            async () => {
                await provider.generate("Query");
            },
            (err: any) => {
                assert.ok(!err.message.includes(testSecret), "Error message must redact API key");
                assert.ok(err.message.includes("[REDACTED_API_KEY]"));
                return true;
            }
        );
    });

    it("translates HTTP 429 into ProviderQuotaError", async () => {
        const mockFetch: typeof fetch = async () => {
            return {
                ok: false,
                status: 429,
                text: async () => "Rate limit exceeded",
            } as any;
        };

        const provider = new GroqProvider({
            apiKey: testSecret,
            fetchFn: mockFetch,
        });

        await assert.rejects(
            async () => {
                await provider.generate("Query");
            },
            (err: any) => {
                assert.ok(err instanceof ProviderQuotaError);
                assert.equal(err.code, "PROVIDER_QUOTA_EXCEEDED");
                assert.equal(err.statusCode, 429);
                return true;
            }
        );
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

        const provider = new GroqProvider({
            apiKey: testSecret,
            timeoutMs: 25,
            fetchFn: mockFetch,
        });

        await assert.rejects(
            async () => {
                await provider.generate("Slow groq query");
            },
            (err: any) => {
                assert.ok(err instanceof ProviderTimeoutError);
                assert.equal(err.provider, "groq");
                return true;
            }
        );
    });

    it("returns false from checkHealth when apiKey is missing", async () => {
        const provider = new GroqProvider({ apiKey: "" });
        assert.equal(await provider.checkHealth(), false);
    });
});
