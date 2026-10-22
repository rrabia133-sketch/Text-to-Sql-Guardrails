import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProviderRouter } from "../../src/modules/providers/provider.router.js";
import { OllamaProvider } from "../../src/modules/providers/ollama.provider.js";
import { GroqProvider } from "../../src/modules/providers/groq.provider.js";
import { BudgetService } from "../../src/modules/providers/budget.service.js";
import { PolicyViolationError, ProviderNetworkError, ProviderQuotaError } from "../../src/modules/providers/base.provider.js";

describe("Task 9 & DO-05: Provider Policy Router & Privacy Airgap Guard", () => {
    // Mock healthy Ollama
    const mockOllama = new OllamaProvider({
        fetchFn: async () => ({
            ok: true,
            json: async () => ({ models: [{ name: "qwen2.5-coder:7b" }] }),
        } as any),
    });

    // Mock healthy Groq
    const mockGroq = new GroqProvider({
        apiKey: "gsk_valid_key",
        fetchFn: async () => ({
            ok: true,
            json: async () => ({ data: [] }),
        } as any),
    });

    it("in local mode, unconditionally rejects routing to Groq with PolicyViolationError", async () => {
        const router = new ProviderRouter({
            mode: "local",
            ollamaProvider: mockOllama,
            groqProvider: mockGroq,
        });

        await assert.rejects(
            async () => {
                await router.resolveProvider("groq");
            },
            (err: any) => {
                assert.ok(err instanceof PolicyViolationError);
                assert.ok(err.message.includes("strictly prohibited in local airgap mode"));
                return true;
            }
        );
    });

    it("in local mode, throws ProviderNetworkError if Ollama is down and NEVER falls back to cloud", async () => {
        const downOllama = new OllamaProvider({
            fetchFn: async () => {
                throw new Error("ECONNREFUSED");
            },
        });

        let groqCalled = false;
        const spyGroq = new GroqProvider({
            apiKey: "gsk_spy",
            fetchFn: async () => {
                groqCalled = true;
                return { ok: true, json: async () => ({}) } as any;
            },
        });

        const router = new ProviderRouter({
            mode: "local",
            ollamaProvider: downOllama,
            groqProvider: spyGroq,
        });

        await assert.rejects(
            async () => {
                await router.resolveProvider();
            },
            (err: any) => {
                assert.ok(err instanceof ProviderNetworkError);
                assert.equal(err.provider, "ollama");
                return true;
            }
        );

        assert.equal(groqCalled, false, "Zero calls must be made to Groq in local mode!");
    });

    it("in hybrid mode, routes to Groq when preferred, but checks budget first", async () => {
        const budgetService = new BudgetService(null, 5.0);
        // Exceed budget
        budgetService.setSimulatedTodaySpend(5.50);

        const router = new ProviderRouter({
            mode: "hybrid",
            ollamaProvider: mockOllama,
            groqProvider: mockGroq,
            budgetService,
        });

        await assert.rejects(
            async () => {
                await router.resolveProvider("groq");
            },
            (err: any) => {
                assert.ok(err instanceof ProviderQuotaError);
                assert.ok(err.message.includes("Daily cloud budget cap"));
                return true;
            }
        );
    });

    it("returns permitted provider options without exposing API credentials", async () => {
        const router = new ProviderRouter({
            mode: "local",
            ollamaProvider: mockOllama,
            groqProvider: mockGroq,
        });

        const summary = await router.getAvailableProviders();
        assert.equal(summary.activeMode, "local");
        assert.deepEqual(summary.allowedProviders, ["ollama"]);
        assert.equal(summary.providers.length, 1);
        assert.equal(summary.providers[0].provider, "ollama");
        assert.equal((summary.providers[0] as any).apiKey, undefined);
    });
});
