import { buildApp } from "./app.js";
import { config } from "./config/env.js";

async function start() {
    const app = await buildApp();

    try {
        const address = await app.listen({
            port: config.PORT,
            host: config.HOST,
        });
        app.log.info(`Server listening at ${address}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }

    // Graceful shutdown
    const closeSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    for (const signal of closeSignals) {
        process.on(signal, async () => {
            app.log.info(`Received ${signal}, closing server gracefully...`);
            await app.close();
            process.exit(0);
        });
    }
}

start();
