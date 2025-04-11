import WebSocket from "ws";
import { proxyConfig } from "./config";
import { GladiaClient } from "./gladia";
import { createLogger } from "./utils";
import { appendTranscription } from "./callDataService"; // ✅ New import

const logger = createLogger("Proxy");

interface AudioMessage {
  type: "audio";
  data: {
    audio: string;
    sampleRate: number;
    channels: number;
  };
}

interface TranscriptionMessage {
  type: "transcription";
  data: {
    text: string;
    isFinal: boolean;
    startTime: number;
    endTime: number;
  };
}

interface TextMessage {
  type: "text";
  data: {
    text: string;
  };
}

interface SpeakerInfo {
  name: string;
  id: number;
  timestamp: number;
  isSpeaking: boolean;
}

type Message = AudioMessage | TranscriptionMessage | TextMessage;

function inspectMessage(message: Buffer | string | unknown): string {
  try {
    if (Buffer.isBuffer(message)) {
      try {
        const jsonStr = message.toString("utf8");
        const json = JSON.parse(jsonStr);
        return `[Buffer as JSON] ${JSON.stringify(json, null, 2)}`;
      } catch {
        const str = message.toString("utf8");
        if (/[\x00-\x08\x0E-\x1F\x80-\xFF]/.test(str)) {
          return `[Binary Buffer] ${message.slice(0, 100).toString("hex")}${message.length > 100 ? "..." : ""}`;
        } else {
          return `[String Buffer] ${str.slice(0, 500)}${str.length > 500 ? "..." : ""}`;
        }
      }
    }

    if (typeof message === "string") {
      try {
        const json = JSON.parse(message);
        return `[String as JSON] ${JSON.stringify(json, null, 2)}`;
      } catch {
        return `[String] ${message.slice(0, 500)}${message.length > 500 ? "..." : ""}`;
      }
    }

    return `[${typeof message}] ${JSON.stringify(message, null, 2)}`;
  } catch (error) {
    return `[Inspection Error] Failed to inspect message: ${error}`;
  }
}

class TranscriptionProxy {
  private server: WebSocket.Server;
  private botClient: WebSocket | null = null;
  private meetingBaasClients: Set<WebSocket> = new Set();
  private gladiaClient: GladiaClient;
  private isGladiaSessionActive: boolean = false;
  private lastSpeaker: string | null = null;
  private activeBotId: string | null = null; // ✅ Track bot ID

  constructor(botId: string) {
    this.activeBotId = botId;

    this.server = new WebSocket.Server({
      host: proxyConfig.host,
      port: proxyConfig.port,
    });

    this.gladiaClient = new GladiaClient();

    this.gladiaClient.onTranscription(async (text, isFinal) => {
      const transcriptionMsg = {
        type: "transcription",
        data: {
          text: text,
          isFinal: isFinal,
          startTime: Date.now(),
          endTime: Date.now(),
        },
      };

      // ✅ Append to database only if it's a final result and botId is available
      if (isFinal && this.activeBotId) {
        await appendTranscription(this.activeBotId, text);
      }

      if (this.botClient && this.botClient.readyState === WebSocket.OPEN) {
        this.botClient.send(JSON.stringify(transcriptionMsg));
      }
    });

    logger.info(`Proxy server started on ${proxyConfig.host}:${proxyConfig.port}`);

    this.server.on("connection", (ws) => {
      logger.info("New connection established");

      ws.once("message", (message) => {
        try {
          const msg = JSON.parse(message.toString());
          if (msg.type === "register" && msg.client === "bot") {
            this.setupBotClient(ws);
          } else {
            this.setupMeetingBaasClient(ws);
          }
        } catch {
          this.setupMeetingBaasClient(ws);
        }
      });
    });
  }

  private setupBotClient(ws: WebSocket) {
    logger.info("Bot client connected");
    this.botClient = ws;

    ws.on("message", (message) => {
      logger.info(`Message from bot: ${inspectMessage(message)}`);
      this.meetingBaasClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message.toString());
        }
      });
    });

    ws.on("close", () => {
      logger.info("Bot client disconnected");
      this.botClient = null;
    });

    ws.on("error", (error) => {
      logger.error("Bot client error:", error);
    });
  }

  private setupMeetingBaasClient(ws: WebSocket) {
    logger.info("MeetingBaas client connected");
    this.meetingBaasClients.add(ws);

    if (!this.isGladiaSessionActive) {
      this.gladiaClient.initSession().then((success) => {
        this.isGladiaSessionActive = success;
      });
    }

    ws.on("message", (message) => {
      if (Buffer.isBuffer(message)) {
        try {
          const jsonStr = message.toString("utf8");
          const jsonData = JSON.parse(jsonStr);

          if (
            Array.isArray(jsonData) &&
            jsonData.length > 0 &&
            "name" in jsonData[0] &&
            "isSpeaking" in jsonData[0]
          ) {
            const speakerInfo = jsonData[0] as SpeakerInfo;

            if (
              speakerInfo.isSpeaking &&
              (this.lastSpeaker === null || this.lastSpeaker !== speakerInfo.name)
            ) {
              this.lastSpeaker = speakerInfo.name;
              logger.info(`New speaker: ${speakerInfo.name} (id: ${speakerInfo.id})`);
            }
          } else {
            logger.info(`Message from MeetingBaas: ${inspectMessage(message)}`);
          }
        } catch {
          if (this.isGladiaSessionActive) {
            this.gladiaClient.sendAudioChunk(message);
          }
        }
      } else {
        logger.info(`Message from MeetingBaas: ${inspectMessage(message)}`);
      }

      if (this.botClient && this.botClient.readyState === WebSocket.OPEN) {
        this.botClient.send(message.toString());
      }
    });

    ws.on("close", () => {
      logger.info("MeetingBaas client disconnected");
      this.meetingBaasClients.delete(ws);

      if (this.meetingBaasClients.size === 0 && this.isGladiaSessionActive) {
        this.gladiaClient.endSession();
        this.isGladiaSessionActive = false;
      }
    });

    ws.on("error", (error) => {
      logger.error("MeetingBaas client error:", error);
    });
  }

  public async shutdown(): Promise<void> {
    if (this.isGladiaSessionActive) {
      logger.info("Ending Gladia transcription session...");
      await this.gladiaClient.endSession();
      this.isGladiaSessionActive = false;
    }

    this.meetingBaasClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });

    if (this.botClient && this.botClient.readyState === WebSocket.OPEN) {
      this.botClient.close();
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info("WebSocket server closed");
        resolve();
      });
    });
  }
}

export { TranscriptionProxy };
