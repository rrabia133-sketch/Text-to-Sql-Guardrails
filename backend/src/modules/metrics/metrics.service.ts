import type { Pool } from "pg";

export interface RecordRequestParams {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
}

export class MetricsService {
    // Histogram duration buckets in seconds
    private static readonly DURATION_BUCKETS_SECONDS = [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];

    // Counters: key -> count
    private httpRequestsTotal: Map<string, number> = new Map();
    private guardrailRefusalsTotal: Map<string, number> = new Map();
    private cacheHitsTotal: Map<string, number> = new Map();

    // Latency histograms: route:method -> { counts: Map<bucket, number>, sum: number, count: number }
    private durationHistograms: Map<string, { counts: number[]; sumSeconds: number; count: number }> = new Map();

    private appPool?: Pool | null;
    private analyticsPool?: Pool | null;

    constructor(appPool?: Pool | null, analyticsPool?: Pool | null) {
        this.appPool = appPool;
        this.analyticsPool = analyticsPool;
    }

    public recordHttpRequest(params: RecordRequestParams): void {
        const { method, route, statusCode, durationMs } = params;
        const normalizedRoute = route || "unknown";
        const key = `method="${method}",route="${normalizedRoute}",status="${statusCode}"`;

        // 1. Increment total requests counter
        this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) || 0) + 1);

        // 2. Record duration in histogram
        const histKey = `method="${method}",route="${normalizedRoute}"`;
        let hist = this.durationHistograms.get(histKey);
        if (!hist) {
            hist = {
                counts: new Array(MetricsService.DURATION_BUCKETS_SECONDS.length).fill(0),
                sumSeconds: 0,
                count: 0,
            };
            this.durationHistograms.set(histKey, hist);
        }

        const durationSeconds = durationMs / 1000;
        hist.sumSeconds += durationSeconds;
        hist.count += 1;

        for (let i = 0; i < MetricsService.DURATION_BUCKETS_SECONDS.length; i++) {
            if (durationSeconds <= MetricsService.DURATION_BUCKETS_SECONDS[i]) {
                hist.counts[i]++;
            }
        }
    }

    public recordGuardrailRefusal(code: string): void {
        const key = `code="${code}"`;
        this.guardrailRefusalsTotal.set(key, (this.guardrailRefusalsTotal.get(key) || 0) + 1);
    }

    public recordCacheHit(cacheName: "result" | "idempotency"): void {
        const key = `cache="${cacheName}"`;
        this.cacheHitsTotal.set(key, (this.cacheHitsTotal.get(key) || 0) + 1);
    }

    /**
     * Serializes collected metrics into standard Prometheus exposition format (text/plain)
     */
    public async exportPrometheus(): Promise<string> {
        const lines: string[] = [
            "# HELP http_requests_total Total number of HTTP requests processed.",
            "# TYPE http_requests_total counter",
        ];

        for (const [labels, count] of this.httpRequestsTotal.entries()) {
            lines.push(`http_requests_total{${labels}} ${count}`);
        }

        lines.push(
            "",
            "# HELP http_request_duration_seconds Latency of HTTP requests in seconds.",
            "# TYPE http_request_duration_seconds histogram"
        );

        for (const [labels, hist] of this.durationHistograms.entries()) {
            for (let i = 0; i < MetricsService.DURATION_BUCKETS_SECONDS.length; i++) {
                const le = MetricsService.DURATION_BUCKETS_SECONDS[i];
                lines.push(`http_request_duration_seconds_bucket{${labels},le="${le}"} ${hist.counts[i]}`);
            }
            lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${hist.count}`);
            lines.push(`http_request_duration_seconds_sum{${labels}} ${hist.sumSeconds.toFixed(6)}`);
            lines.push(`http_request_duration_seconds_count{${labels}} ${hist.count}`);
        }

        // Database pool gauges
        lines.push(
            "",
            "# HELP db_pool_active_connections Number of actively allocated connections in database pool.",
            "# TYPE db_pool_active_connections gauge"
        );

        const appActive = this.appPool ? (this.appPool.totalCount - this.appPool.idleCount) : 0;
        const appWaiting = this.appPool ? this.appPool.waitingCount : 0;
        const analyticsActive = this.analyticsPool ? (this.analyticsPool.totalCount - this.analyticsPool.idleCount) : 0;
        const analyticsWaiting = this.analyticsPool ? this.analyticsPool.waitingCount : 0;

        lines.push(`db_pool_active_connections{pool="app"} ${Math.max(0, appActive)}`);
        lines.push(`db_pool_active_connections{pool="analytics"} ${Math.max(0, analyticsActive)}`);

        lines.push(
            "",
            "# HELP db_pool_waiting_clients Number of client requests waiting for an available database connection.",
            "# TYPE db_pool_waiting_clients gauge"
        );
        lines.push(`db_pool_waiting_clients{pool="app"} ${Math.max(0, appWaiting)}`);
        lines.push(`db_pool_waiting_clients{pool="analytics"} ${Math.max(0, analyticsWaiting)}`);

        // Guardrail Refusals
        lines.push(
            "",
            "# HELP guardrail_refusals_total Total queries blocked by AST, semantic, or policy guardrails.",
            "# TYPE guardrail_refusals_total counter"
        );
        for (const [labels, count] of this.guardrailRefusalsTotal.entries()) {
            lines.push(`guardrail_refusals_total{${labels}} ${count}`);
        }

        // Cache Hits
        lines.push(
            "",
            "# HELP cache_hits_total Total cache hits for ephemeral results or idempotency lookups.",
            "# TYPE cache_hits_total counter"
        );
        for (const [labels, count] of this.cacheHitsTotal.entries()) {
            lines.push(`cache_hits_total{${labels}} ${count}`);
        }

        lines.push("");
        return lines.join("\n");
    }

    public clear(): void {
        this.httpRequestsTotal.clear();
        this.durationHistograms.clear();
        this.guardrailRefusalsTotal.clear();
        this.cacheHitsTotal.clear();
    }
}

