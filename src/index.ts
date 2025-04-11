import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import { MeetingBaasClient } from "./meetingbaas";
import { TranscriptionProxy } from "./proxy";
import { createLogger } from "./utils";

const logger = createLogger("Server");

const app = express();
const port = 4000;

app.use(bodyParser.json());

let meetingBaasClient: MeetingBaasClient | null = null;
let proxy: TranscriptionProxy | null = null;

// Register shutdown logic once
function setupGracefulShutdown() {
  process.on("SIGINT", async () => {
    logger.info("Shutting down gracefully...");

    if (meetingBaasClient) {
      logger.info("Telling bot to leave the meeting...");
      meetingBaasClient.disconnect();
    }

    if (proxy) {
      logger.info("Shutting down transcription proxy...");
      await proxy.shutdown();
    }

    logger.info("Cleanup complete. Exiting.");
    process.exit(0);
  });
}

// Register the handler once when app starts
setupGracefulShutdown();

const startBotHandler = async (req: Request, res: Response): Promise<void> => {
  const { meeting_id,meeting_url, bot_name, ngrok_url } = req.body;

  if (!meeting_url || !bot_name || !ngrok_url) {
    res.status(400).json({ error: "Missing required parameters" });
    return;
  }

  try {
    logger.info("Starting transcription system...");

    //proxy = new TranscriptionProxy(meetingBaasClient.getBotId());
    meetingBaasClient = new MeetingBaasClient();

    const connected = await meetingBaasClient.connect(
      meeting_id,
      meeting_url,
      bot_name,
      ngrok_url
    );

    if (!connected) {
      logger.error("Failed to connect to meeting");
      res.status(500).json({ error: "Failed to connect to meeting" });
      return;
    }
    const botId = meetingBaasClient.getBotId();
    if (!botId) {
      logger.error("Bot ID is null after connecting");
      res.status(500).json({ error: "Bot ID is missing after connection" });
      return;
    }
    //logger.info(botId);
    proxy = new TranscriptionProxy(botId);

    logger.info("Bot started successfully");
    res.status(200).json({ message: "Bot started successfully" });
  } catch (error) {
    logger.error("Error initializing system:", error);
    res.status(500).json({ error: "Internal server error", details: error });
  }
};


app.get("/", (req: Request, res: Response) => {
  res.send("Hello World!");
});
app.post("/start-bot", startBotHandler);

app.listen(port, () => {
  logger.info(`Server listening on port ${port}`);
});
