import { TranscriptionProxy } from "./proxy";
import { createLogger } from "./utils";

const logger = createLogger("Main");

// Keep references to all our clients for cleanup
let proxy: TranscriptionProxy | null = null;

// Graceful shutdown handler
function setupGracefulShutdown() {
  process.on("SIGINT", async () => {
    logger.info("Shutting down gracefully...");

    // Close Gladia connections (via proxy)
    if (proxy) {
      logger.info("Closing transcription services...");
      await proxy.shutdown();
    }

    logger.info("Cleanup complete, exiting...");
    process.exit(0);
  });
}

async function main() {
  try {
    logger.info("Starting transcription proxy server...");

    // Create instances
    proxy = new TranscriptionProxy();

    // Setup graceful shutdown
    setupGracefulShutdown();

    logger.info("Transcription proxy server initialized successfully and listening for connections.");
    // Keep the process alive until SIGINT
    // The proxy server itself will handle incoming connections.
    // No explicit connect logic is needed here anymore as that's handled by n8n.
  } catch (error) {
    logger.error("Error initializing proxy server:", error);
    process.exit(1);
  }
}

main();
