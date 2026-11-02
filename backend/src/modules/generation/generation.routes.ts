import type { FastifyPluginAsync } from "fastify";
import { parse } from "pgsql-ast-parser";
import { requireAuth } from "../../plugins/auth.js";
import {
    QueryGenerationRequestSchema,
    type QueryGenerationResponse,
    type SemanticRepairAttempt,
} from "@text2sql/contracts";
import { QueryArtifactRepository } from "./query-artifact.repository.js";
import { ProviderRouter } from "../providers/provider.router.js";
import { PromptBuilder } from "./prompts/prompt-builder.js";
import { ClarificationService } from "../intent/clarification.service.js";
import { GenerationRetryHandler } from "./retry.handler.js";
import { IntentExtractorService } from "../intent/intent-extractor.service.js";
import { GuardrailsService } from "../guardrails/guardrails.service.js";
import { SemanticValidatorService } from "../semantic/semantic-validator.service.js";
import { RepairEngineService } from "../semantic/repair-engine.service.js";
import { ConfidenceService } from "../semantic/confidence.service.js";
import { ArtifactStateService } from "../execution/artifact-state.service.js";
import { SemanticRepository } from "../semantic/semantic.repository.js";

export interface GenerationRoutesOptions {
    queryArtifactRepo?: QueryArtifactRepository;
    providerRouter?: ProviderRouter;
    promptBuilder?: PromptBuilder;
    clarificationService?: ClarificationService;
    retryHandler?: GenerationRetryHandler;
    intentExtractor?: IntentExtractorService;
    guardrailsService?: GuardrailsService;
    semanticValidator?: SemanticValidatorService;
    repairEngine?: RepairEngineService;
    confidenceService?: ConfidenceService;
    artifactStateService?: ArtifactStateService;
    semanticRepo?: SemanticRepository;
    prefix?: string;
}

export const generationRoutes: FastifyPluginAsync<GenerationRoutesOptions> = async (
    fastify,
    opts
) => {
    const queryArtifactRepo = opts.queryArtifactRepo || new QueryArtifactRepository();
    const providerRouter = opts.providerRouter || new ProviderRouter();
    const promptBuilder = opts.promptBuilder || new PromptBuilder();
    const clarificationService = opts.clarificationService || new ClarificationService();
    const retryHandler = opts.retryHandler || new GenerationRetryHandler();
    const intentExtractor = opts.intentExtractor || new IntentExtractorService();
    const guardrailsService = opts.guardrailsService || new GuardrailsService();
    const semanticValidator = opts.semanticValidator || new SemanticValidatorService();
    const repairEngine =
        opts.repairEngine ||
        new RepairEngineService({
            guardrailsService,
            semanticValidator,
            providerRouter,
        });
    const confidenceService = opts.confidenceService || new ConfidenceService(semanticValidator);
    const artifactStateService = opts.artifactStateService || new ArtifactStateService();
    const semanticRepo = opts.semanticRepo || new SemanticRepository();

    // POST /api/v1/queries
    fastify.post(
        "/",
        {
            preHandler: [requireAuth],
        },
        async (request, reply) => {
            // 1. Validate request body against contract schema
            const parseResult = QueryGenerationRequestSchema.safeParse(request.body);
            if (!parseResult.success) {
                const message = parseResult.error.issues.map((i) => i.message).join("; ");
                return reply.status(400).send({
                    statusCode: 400,
                    error: "Bad Request",
                    message,
                    timestamp: new Date().toISOString(),
                });
            }

            const {
                question,
                providerPreference,
                clarificationSessionId,
                selectedClarificationOption,
            } = parseResult.data;

            let effectiveQuestion = question;
            let clarificationContext: string | undefined;

            // 2. Handle Clarification Flow
            if (clarificationSessionId && selectedClarificationOption) {
                const resumed = clarificationService.resumeClarification(
                    clarificationSessionId,
                    selectedClarificationOption
                );
                effectiveQuestion = resumed.clarifiedPrompt;
                clarificationContext = resumed.clarificationContext;
            } else {
                const clarification = clarificationService.evaluateQuestion(question);
                if (clarification) {
                    return reply.status(200).send(clarification);
                }
            }

            try {
                // 3. Assemble Grounded Prompt Context
                const promptContext = await promptBuilder.buildPrompt(effectiveQuestion, {
                    clarificationContext,
                });

                // 4. Resolve LLM Provider with privacy policy and budget guards
                const provider = await providerRouter.resolveProvider(providerPreference);

                // 5. Execute bounded generation with retry
                const genResult = await retryHandler.execute(
                    provider,
                    promptContext.completePrompt
                );

                // 6. Record Token Usage & Dollar Cost
                await providerRouter.getBudgetService().recordUsage({
                    provider: genResult.provider,
                    model: genResult.model,
                    promptTokens: genResult.promptTokens,
                    completionTokens: genResult.completionTokens,
                });

                // 7. Extract Intent Slots & Run Deterministic Guardrails + Semantic Validation
                const intentSlots = intentExtractor.extract(effectiveQuestion);
                let guardrailResult = await guardrailsService.validate(genResult.output.sql);
                let currentSql = guardrailResult.normalizedSql || genResult.output.sql;

                const parsedAst = parse(currentSql)[0];
                let semanticValidation = semanticValidator.validate(parsedAst, intentSlots);

                // 8. Bounded Automated Semantic Repair (Max 1 attempt)
                let repairAttempt: SemanticRepairAttempt | undefined;
                if (!semanticValidation.isValid && semanticValidation.hasRepairableFindings) {
                    const repairResult = await repairEngine.repair(
                        currentSql,
                        effectiveQuestion,
                        intentSlots,
                        semanticValidation,
                        { provider }
                    );
                    repairAttempt = repairResult.attempt;

                    if (repairResult.success && repairResult.semanticResult) {
                        currentSql = repairResult.normalizedSql || repairResult.attempt.repairedSql;
                        semanticValidation = repairResult.semanticResult;
                        if (repairResult.guardrailResult) {
                            guardrailResult = repairResult.guardrailResult;
                        }
                    }
                }

                // 9. Compute 4-Component Confidence Score & Resolve Artifact State
                const confidenceResult = confidenceService.computeConfidence({
                    semanticResult: semanticValidation,
                    guardrailResult,
                });

                const resolvedStatus = artifactStateService.resolveState({
                    confidenceBand: confidenceResult.band,
                    hasCriticalFindings: confidenceResult.hasCriticalFindings,
                    guardrailsValid: guardrailResult.valid,
                });

                // 10. Persist Query Artifact in app_db and update lifecycle state
                const createdArtifact = await queryArtifactRepo.create({
                    userId: request.user!.id,
                    prompt: effectiveQuestion,
                    generatedSql: currentSql,
                    assumptions: genResult.output.assumptions,
                    referencedTables: genResult.output.referencedTables,
                    referencedColumns: genResult.output.referencedColumns,
                    explanation: genResult.output.explanation,
                    provider: genResult.provider,
                    model: genResult.model,
                    promptVersion: promptContext.metadata.promptVersion,
                    schemaVersion: promptContext.metadata.schemaVersion,
                });

                const artifact =
                    (await queryArtifactRepo.updateStatus(createdArtifact.id, resolvedStatus)) ||
                    createdArtifact;

                await semanticRepo.saveArtifactSemanticMetadata({
                    artifactId: artifact.id,
                    confidenceScore: confidenceResult.score,
                    confidenceBand: confidenceResult.band,
                    confidenceBreakdown: confidenceResult.breakdown,
                    confidenceResult,
                    semanticFindings: semanticValidation.findings,
                    semanticValidation,
                    repairAttempts: repairAttempt ? repairAttempt.attemptNumber : 0,
                    repairAttempt,
                });

                const responseData: QueryGenerationResponse = {
                    type: "generation",
                    artifactId: artifact.id,
                    status: resolvedStatus,
                    sql: artifact.generatedSql,
                    assumptions: artifact.assumptions,
                    referencedTables: artifact.referencedTables,
                    referencedColumns: artifact.referencedColumns,
                    explanation: artifact.explanation,
                    confidencePreview: Math.round((confidenceResult.score / 100) * 100) / 100,
                    confidenceScore: confidenceResult.score,
                    confidenceBand: confidenceResult.band,
                    confidenceBreakdown: confidenceResult.breakdown,
                    confidenceResult,
                    semanticFindings: semanticValidation.findings,
                    semanticValidation,
                    repairAttempt,
                    provider: genResult.provider as any,
                    model: genResult.model,
                    versions: {
                        promptVersion: artifact.promptVersion,
                        schemaVersion: artifact.schemaVersion,
                        glossaryVersion: promptContext.metadata.glossaryVersion,
                    },
                    createdAt: artifact.createdAt,
                    expiresAt: artifact.expiresAt,
                };

                return reply.status(201).send(responseData);
            } catch (err: any) {
                const statusCode = err?.statusCode || 500;
                return reply.status(statusCode).send({
                    statusCode,
                    error: err?.name || "GenerationError",
                    message: err?.message || "Internal generation error",
                    timestamp: new Date().toISOString(),
                });
            }
        }
    );

    // GET /api/v1/queries/:id
    fastify.get<{ Params: { id: string } }>(
        "/:id",
        {
            preHandler: [requireAuth],
        },
        async (request, reply) => {
            const { id } = request.params;
            const artifact = await queryArtifactRepo.findById(id, request.user!.id);

            if (!artifact) {
                return reply.status(404).send({
                    statusCode: 404,
                    error: "Not Found",
                    message: `Query artifact "${id}" not found or unauthorized`,
                    timestamp: new Date().toISOString(),
                });
            }

            const semanticMeta = await semanticRepo.getArtifactSemanticMetadata(id);
            const confidenceScore = semanticMeta?.confidenceScore;
            const confidencePreview =
                confidenceScore !== undefined
                    ? Math.round((confidenceScore / 100) * 100) / 100
                    : 0.95;

            return reply.status(200).send({
                type: "generation",
                artifactId: artifact.id,
                status: artifact.status,
                sql: artifact.generatedSql,
                assumptions: artifact.assumptions,
                referencedTables: artifact.referencedTables,
                referencedColumns: artifact.referencedColumns,
                explanation: artifact.explanation,
                confidencePreview,
                confidenceScore: semanticMeta?.confidenceScore,
                confidenceBand: semanticMeta?.confidenceBand,
                confidenceBreakdown: semanticMeta?.confidenceBreakdown,
                confidenceResult: semanticMeta?.confidenceResult,
                semanticFindings: semanticMeta?.semanticFindings,
                semanticValidation: semanticMeta?.semanticValidation,
                repairAttempt: semanticMeta?.repairAttempt,
                provider: artifact.provider,
                model: artifact.model,
                versions: {
                    promptVersion: artifact.promptVersion,
                    schemaVersion: artifact.schemaVersion,
                    glossaryVersion: "1.0.0",
                },
                createdAt: artifact.createdAt,
                expiresAt: artifact.expiresAt,
            });
        }
    );
};
