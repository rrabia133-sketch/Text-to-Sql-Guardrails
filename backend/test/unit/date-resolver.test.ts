import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateResolver, ANALYTICS_TIMEZONE } from "../../src/modules/intent/date-resolver.js";

describe("Task 3: Deterministic Analytics Timezone & Relative Date Resolver (US-05)", () => {
    // Standard Sprint Anchor Date: 2026-10-01 00:00:00 UTC (Thursday, in Q4)
    const anchorDate = new Date("2026-10-01T00:00:00.000Z");
    const resolver = new DateResolver("UTC");

    it("verifies default analytics timezone is UTC", () => {
        assert.equal(ANALYTICS_TIMEZONE, "UTC");
    });

    it("resolves 'today' deterministically", () => {
        const result = resolver.resolve("What is our revenue today?", anchorDate);
        assert.equal(result.hasRelativeDate, true);
        assert.equal(result.resolvedRanges.length, 1);
        const range = result.resolvedRanges[0];
        assert.equal(range.expression, "today");
        assert.equal(range.startDate, "2026-10-01T00:00:00.000Z");
        assert.equal(range.endDate, "2026-10-02T00:00:00.000Z");
    });

    it("resolves 'yesterday' deterministically", () => {
        const result = resolver.resolve("Show me orders from yesterday", anchorDate);
        assert.equal(result.hasRelativeDate, true);
        const range = result.resolvedRanges[0];
        assert.equal(range.expression, "yesterday");
        assert.equal(range.startDate, "2026-09-30T00:00:00.000Z");
        assert.equal(range.endDate, "2026-10-01T00:00:00.000Z");
    });

    it("resolves 'last week' to previous calendar week", () => {
        // Anchor: Thursday 2026-10-01.
        // Current week's Monday is 2026-09-28.
        // Last week Monday is 2026-09-21.
        const result = resolver.resolve("Top selling products last week", anchorDate);
        assert.equal(result.hasRelativeDate, true);
        const range = result.resolvedRanges[0];
        assert.equal(range.expression, "last week");
        assert.equal(range.startDate, "2026-09-21T00:00:00.000Z");
        assert.equal(range.endDate, "2026-09-28T00:00:00.000Z");
    });

    it("resolves 'last month' exact boundaries", () => {
        const result = resolver.resolve("Calculate active customer count for last month", anchorDate);
        assert.equal(result.hasRelativeDate, true);
        const range = result.resolvedRanges[0];
        assert.equal(range.expression, "last month");
        assert.equal(range.startDate, "2026-09-01T00:00:00.000Z");
        assert.equal(range.endDate, "2026-10-01T00:00:00.000Z");
    });

    it("resolves 'last quarter' across quarter boundaries", () => {
        // On 2026-10-01 (Q4 start), last quarter is Q3 (2026-07-01 to 2026-10-01)
        const result = resolver.resolve("Revenue for last quarter", anchorDate);
        assert.equal(result.hasRelativeDate, true);
        const range = result.resolvedRanges[0];
        assert.equal(range.expression, "last quarter");
        assert.equal(range.startDate, "2026-07-01T00:00:00.000Z");
        assert.equal(range.endDate, "2026-10-01T00:00:00.000Z");
    });

    it("resolves 'last quarter' when anchor is in Q1 (cross-year boundary)", () => {
        const q1Anchor = new Date("2026-02-15T12:00:00.000Z");
        const result = resolver.resolve("Revenue for last quarter", q1Anchor);
        const range = result.resolvedRanges[0];
        assert.equal(range.startDate, "2025-10-01T00:00:00.000Z");
        assert.equal(range.endDate, "2026-01-01T00:00:00.000Z");
    });

    it("resolves 'this year' boundaries", () => {
        const result = resolver.resolve("Total orders this year", anchorDate);
        assert.equal(result.hasRelativeDate, true);
        const range = result.resolvedRanges[0];
        assert.equal(range.expression, "this year");
        assert.equal(range.startDate, "2026-01-01T00:00:00.000Z");
        assert.equal(range.endDate, "2027-01-01T00:00:00.000Z");
    });

    it("resolves 'year-to-date' / 'ytd'", () => {
        const result = resolver.resolve("Revenue year-to-date", anchorDate);
        assert.equal(result.hasRelativeDate, true);
        const range = result.resolvedRanges[0];
        assert.equal(range.expression, "year-to-date");
        assert.equal(range.startDate, "2026-01-01T00:00:00.000Z");
        assert.equal(range.endDate, "2026-10-02T00:00:00.000Z");
    });

    it("resolves 'last 30 days'", () => {
        const result = resolver.resolve("Show me sales for the last 30 days", anchorDate);
        assert.equal(result.hasRelativeDate, true);
        const range = result.resolvedRanges[0];
        assert.equal(range.expression, "last 30 days");
        assert.equal(range.startDate, "2026-09-01T00:00:00.000Z");
        assert.equal(range.endDate, "2026-10-01T00:00:00.000Z");
    });

    it("handles leap years deterministically (February in leap year)", () => {
        // Leap year 2024: Feb has 29 days. Anchor on 2024-03-01.
        const leapAnchor = new Date("2024-03-01T00:00:00.000Z");
        const result = resolver.resolve("orders last month", leapAnchor);
        const range = result.resolvedRanges[0];
        assert.equal(range.startDate, "2024-02-01T00:00:00.000Z");
        assert.equal(range.endDate, "2024-03-01T00:00:00.000Z");
    });

    it("returns formattedContext containing human and prompt-friendly explanations", () => {
        const result = resolver.resolve("Calculate revenue last month", anchorDate);
        assert.ok(result.formattedContext.includes("Current System Timestamp"));
        assert.ok(result.formattedContext.includes("Resolved Relative Temporal Bounds"));
        assert.ok(result.formattedContext.includes("2026-09-01T00:00:00.000Z"));
    });
});
