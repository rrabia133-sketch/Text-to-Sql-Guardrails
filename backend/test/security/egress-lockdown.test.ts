import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProviderRouter } from "../../src/modules/providers/provider.router.js";
import { PolicyViolationError, ProviderNetworkError } from "../../src/modules/providers/base.provider.js";
import { OllamaProvider } from "../../src/modules/providers/ollama.provider.js";
import { GroqProvider } from "../../src/modules/providers/groq.provider.js";

describe("Sprint 7 - Task 7 / DO-13: Security Airgap Egress Lockdown Audit (US-16 / DO-13)", () => {
    it("strictly blocks cloud egress when in local airgap mode (PROVIDER_MODE=local)", async () => {
        const mockOllama = {
            checkHealth: async () => true,
        } as unknown as OllamaProvider;

        let cloudCallAttempted = false;
        const mockGroq = {
            checkHealth: async () => {
                cloudCallAttempted = true;
                return true;
            },
        } as unknown as GroqProvider;

        const router = new ProviderRouter({
            mode: "local",
            ollamaProvider: mockOllama,
            groqProvider: mockGroq,
        });

        // Requesting Groq in local mode must throw PolicyViolationError
        await assert.rejects(
            async () => {
                await router.resolveProvider("groq");
            },
            (err: any) => {
                assert.ok(err instanceof PolicyViolationError);
                assert.match(err.message, /strictly prohibited in local airgap mode/i);
                return true;
            }
        );

        // Verify zero outbound calls to cloud provider
        assert.equal(cloudCallAttempted, false, "Zero cloud network calls permitted in local mode");
    });

    it("fails closed with 503 ProviderNetworkError when Ollama is unreachable without falling back to cloud", async () => {
        const deadOllama = {
            checkHealth: async () => false, // Offline
        } as unknown as OllamaProvider;

        let cloudCallAttempted = false;
        const mockGroq = {
            checkHealth: async () => {
                cloudCallAttempted = true;
                return true;
            },
        } as unknown as GroqProvider;

        const router = new ProviderRouter({
            mode: "local",
            ollamaProvider: deadOllama,
            groqProvider: mockGroq,
        });

        // Requesting generation when Ollama is offline must fail closed
        await assert.rejects(
            async () => {
                await router.resolveProvider("ollama");
            },
            (err: any) => {
                assert.ok(err instanceof ProviderNetworkError);
                assert.match(err.message, /prohibits fallback to cloud/i);
                return true;
            }
        );

        // Verify that cloud was NEVER called as a fallback
        assert.equal(cloudCallAttempted, false, "Cloud fallback must never occur silently when Ollama fails");
    });
});

