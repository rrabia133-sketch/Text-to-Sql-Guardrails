import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import {
    QueryGenerationRequestSchema,
    type QueryGenerationResponse,
} from "@text2sql/contracts";
import { QueryArtifactRepository } from "./query-artifact.repository.js";
import { ProviderRouter } from "../providers/provider.router.js";
import { PromptBuilder } from "./prompts/prompt-builder.js";
import { ClarificationService } from "../intent/clarification.service.js";
import { GenerationRetryHandler } from "./retry.handler.js";

export interface GenerationRoutesOptions {
    queryArtifactRepo?: QueryArtifactRepository;
    providerRouter?: ProviderRouter;
    promptBuilder?: PromptBuilder;
    clarificationService?: ClarificationService;
    retryHandler?: GenerationRetryHandler;
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

                // 7. Persist Query Artifact in app_db with unexecuted 'preview' status
                const artifact = await queryArtifactRepo.create({
                    userId: request.user!.id,
                    prompt: effectiveQuestion,
                    generatedSql: genResult.output.sql,
                    assumptions: genResult.output.assumptions,
                    referencedTables: genResult.output.referencedTables,
                    referencedColumns: genResult.output.referencedColumns,
                    explanation: genResult.output.explanation,
                    provider: genResult.provider,
                    model: genResult.model,
                    promptVersion: promptContext.metadata.promptVersion,
                    schemaVersion: promptContext.metadata.schemaVersion,
                });

                const responseData: QueryGenerationResponse = {
                    type: "generation",
                    artifactId: artifact.id,
                    status: "preview",
                    sql: artifact.generatedSql,
                    assumptions: artifact.assumptions,
                    referencedTables: artifact.referencedTables,
                    referencedColumns: artifact.referencedColumns,
                    explanation: artifact.explanation,
                    confidencePreview: 0.95,
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

            return reply.status(200).send({
                type: "generation",
                artifactId: artifact.id,
                status: artifact.status,
                sql: artifact.generatedSql,
                assumptions: artifact.assumptions,
                referencedTables: artifact.referencedTables,
                referencedColumns: artifact.referencedColumns,
                explanation: artifact.explanation,
                confidencePreview: 0.95,
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
