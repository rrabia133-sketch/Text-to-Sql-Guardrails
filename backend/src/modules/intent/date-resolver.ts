import { config } from "../../config/env.js";

export const ANALYTICS_TIMEZONE = config.ANALYTICS_TIMEZONE || "UTC";

export interface ResolvedDateRange {
    expression: string;
    startDate: string; // ISO-8601 inclusive: e.g. 2026-09-01T00:00:00.000Z
    endDate: string;   // ISO-8601 exclusive: e.g. 2026-10-01T00:00:00.000Z
    timezone: string;
    description: string;
}

export interface DateResolutionResult {
    hasRelativeDate: boolean;
    referenceDate: string;
    resolvedRanges: ResolvedDateRange[];
    formattedContext: string;
}

export class DateResolver {
    private timezone: string;

    constructor(timezone: string = ANALYTICS_TIMEZONE) {
        this.timezone = timezone;
    }

    /**
     * Resolves temporal expressions within a natural language prompt.
     * @param prompt The user's natural language question
     * @param anchorDate Optional reference anchor date for deterministic testing/evaluations
     */
    resolve(prompt: string, anchorDate?: Date): DateResolutionResult {
        const ref = anchorDate ? new Date(anchorDate) : new Date();
        const refIso = ref.toISOString();
        const lowerPrompt = prompt.toLowerCase();

        const ranges: ResolvedDateRange[] = [];

        // 1. "today"
        if (/\btoday\b/.test(lowerPrompt)) {
            const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));
            const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + 1, 0, 0, 0, 0));
            ranges.push({
                expression: "today",
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                timezone: this.timezone,
                description: `Full calendar day of ${start.toISOString().split("T")[0]}`,
            });
        }

        // 2. "yesterday"
        if (/\byesterday\b/.test(lowerPrompt)) {
            const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - 1, 0, 0, 0, 0));
            const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));
            ranges.push({
                expression: "yesterday",
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                timezone: this.timezone,
                description: `Full calendar day of ${start.toISOString().split("T")[0]}`,
            });
        }

        // 3. "last week"
        if (/\blast week\b/.test(lowerPrompt)) {
            // Previous full calendar week (Monday to Sunday)
            const dayOfWeek = ref.getUTCDay(); // 0 is Sunday, 1 is Monday...
            const daysSinceLastMonday = (dayOfWeek + 6) % 7; // days since current week's Monday
            const thisWeekMonday = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - daysSinceLastMonday, 0, 0, 0, 0));
            const lastWeekMonday = new Date(thisWeekMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
            ranges.push({
                expression: "last week",
                startDate: lastWeekMonday.toISOString(),
                endDate: thisWeekMonday.toISOString(),
                timezone: this.timezone,
                description: `Previous calendar week from ${lastWeekMonday.toISOString().split("T")[0]} to ${thisWeekMonday.toISOString().split("T")[0]}`,
            });
        }

        // 4. "last month"
        if (/\blast month\b/.test(lowerPrompt)) {
            const year = ref.getUTCFullYear();
            const month = ref.getUTCMonth(); // 0-indexed
            // Previous month
            const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
            const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
            ranges.push({
                expression: "last month",
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                timezone: this.timezone,
                description: `Previous calendar month (${start.toISOString().slice(0, 7)})`,
            });
        }

        // 5. "last quarter"
        if (/\blast quarter\b/.test(lowerPrompt) || /\bprevious quarter\b/.test(lowerPrompt)) {
            const year = ref.getUTCFullYear();
            const month = ref.getUTCMonth();
            const currentQuarter = Math.floor(month / 3); // 0 (Q1), 1 (Q2), 2 (Q3), 3 (Q4)

            let startYear = year;
            let startQuarter = currentQuarter - 1;
            if (startQuarter < 0) {
                startQuarter = 3;
                startYear -= 1;
            }

            const startMonth = startQuarter * 3;
            const endMonth = startMonth + 3;
            const start = new Date(Date.UTC(startYear, startMonth, 1, 0, 0, 0, 0));
            const end = new Date(Date.UTC(startYear, endMonth, 1, 0, 0, 0, 0));

            ranges.push({
                expression: "last quarter",
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                timezone: this.timezone,
                description: `Previous calendar quarter Q${startQuarter + 1} ${startYear} (${start.toISOString().split("T")[0]} to ${end.toISOString().split("T")[0]})`,
            });
        }

        // 6. "this year"
        if (/\bthis year\b/.test(lowerPrompt)) {
            const year = ref.getUTCFullYear();
            const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
            const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
            ranges.push({
                expression: "this year",
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                timezone: this.timezone,
                description: `Calendar year ${year}`,
            });
        }

        // 7. "year-to-date" or "ytd"
        if (/\byear-to-date\b/.test(lowerPrompt) || /\bytd\b/.test(lowerPrompt)) {
            const year = ref.getUTCFullYear();
            const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
            const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + 1, 0, 0, 0, 0));
            ranges.push({
                expression: "year-to-date",
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                timezone: this.timezone,
                description: `From beginning of ${year} through current date (${start.toISOString().split("T")[0]} to ${end.toISOString().split("T")[0]})`,
            });
        }

        // 8. "last 30 days"
        if (/\blast 30 days\b/.test(lowerPrompt)) {
            const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));
            const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
            ranges.push({
                expression: "last 30 days",
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                timezone: this.timezone,
                description: `Trailing 30-day window ending ${end.toISOString().split("T")[0]}`,
            });
        }

        let formattedContext = `Current System Timestamp (Anchor): ${refIso} (${this.timezone})\n`;
        if (ranges.length > 0) {
            formattedContext += "Resolved Relative Temporal Bounds:\n";
            for (const r of ranges) {
                formattedContext += `- "${r.expression}": ${r.startDate} (inclusive) to ${r.endDate} (exclusive) [${r.description}]\n`;
            }
        }

        return {
            hasRelativeDate: ranges.length > 0,
            referenceDate: refIso,
            resolvedRanges: ranges,
            formattedContext,
        };
    }
}
