import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClarificationService } from "../../src/modules/intent/clarification.service.js";

describe("Task 13: Ambiguity Detection Engine & Clarification Response Generator (US-07)", () => {
    const service = new ClarificationService();

    it("triggers explainable refusal on out-of-domain requests (e.g. employee salary)", () => {
        const response = service.evaluateQuestion("What is the average employee salary in engineering?");
        assert.ok(response !== null);
        assert.equal(response.type, "clarification");
        assert.equal(response.reasonCode, "UNSUPPORTED_DOMAIN");
        assert.ok(response.message.includes("Customers, Products, Orders, and Order Items"));
        assert.ok(response.options.length >= 2);
    });

    it("detects ambiguous superlative queries lacking explicit metrics (e.g. best customers)", () => {
        const response = service.evaluateQuestion("Who are our best customers?");
        assert.ok(response !== null);
        assert.equal(response.reasonCode, "AMBIGUOUS_METRIC");
        assert.equal(response.options.length, 3);
        const optionIds = response.options.map((o) => o.id);
        assert.ok(optionIds.includes("metric_revenue"));
        assert.ok(optionIds.includes("metric_order_count"));
        assert.ok(optionIds.includes("metric_aov"));
    });

    it("does not trigger clarification when metric is already specified (e.g. best customers by revenue)", () => {
        const response = service.evaluateQuestion("Who are our best customers by revenue in 2026?");
        assert.equal(response, null);
    });

    it("detects missing time bounds on rankings (e.g. top products)", () => {
        const response = service.evaluateQuestion("Show me the top products");
        assert.ok(response !== null);
        assert.equal(response.reasonCode, "MISSING_TIME_BOUND");
        assert.ok(response.options.length >= 3);
    });

    it("does not trigger clarification when timeframe is already present", () => {
        const response = service.evaluateQuestion("Show me top products last month");
        assert.equal(response, null);
    });

    it("resumes clarification session by merging original question and selected option", () => {
        const clarification = service.evaluateQuestion("Who are our best customers?");
        assert.ok(clarification !== null);

        const resumed = service.resumeClarification(
            clarification.clarificationSessionId,
            "metric_revenue"
        );

        assert.ok(resumed.clarifiedPrompt.includes("Who are our best customers?"));
        assert.ok(resumed.clarifiedPrompt.includes("Total Recognized Revenue"));
        assert.ok(resumed.clarificationContext.includes("Total Recognized Revenue"));
    });
});
