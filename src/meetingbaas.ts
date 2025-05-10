import axios from "axios";
import { apiKeys, apiUrls } from "./config";
import { createLogger } from "./utils";
import { insertBot } from "./callDataService"; // ✅ Import DB insert helper

const logger = createLogger("MeetingBaas");

// Define an interface for the API response
interface MeetingBaasResponse {
  bot_id: string;
  status?: string;
  message?: string;
}

class MeetingBaasClient {
  private apiUrl: string;
  private apiKey: string;
  private botId: string | null = null;

  constructor() {
    this.apiUrl = apiUrls.meetingBaas;
    this.apiKey = apiKeys.meetingBaas || "";
    logger.info(`Initialized with API URL: ${this.apiUrl}`);
  }

  /**
   * Connect to a meeting via MeetingBaas and store botId in the database
   * @param meetingId ID of the meeting
   * @param meetingUrl URL of the meeting to join
   * @param botName Name of the bot
   * @param webhookUrl URL where MeetingBaas will send events/audio
   * @returns true if successful
   */
  async connect(
    meetingId: string,
    meetingUrl: string,
    botName: string,
    webhookUrl?: string
  ): Promise<boolean> {
    try {
      logger.info(`Connecting to meeting: ${meetingUrl}`);

      const response = await axios.post(
        `${this.apiUrl}/bots`,
        {
          bot_name: botName,
          meeting_url: meetingUrl,
          reserved: false,
          deduplication_key: botName,
          webhook_url: webhookUrl,
          streaming: {
            output: webhookUrl,
          },
        },
        {
          headers: {
            "x-meeting-baas-api-key": this.apiKey,
            "Content-Type": "application/json",
          },
        }
      );

      logger.info(`API Response: ${JSON.stringify(response.data)}`);

      const data = response.data as MeetingBaasResponse;
      if (!data.bot_id) {
        logger.error("No bot_id in response");
        return false;
      }

      this.botId = data.bot_id;
      logger.info(`Bot created with ID: ${this.botId}`);

      // ✅ Insert botId into database
      await insertBot(this.botId, meetingId);

      return true;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        logger.error(
          `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else {
        logger.error("Error connecting to meeting:", error);
      }
      return false;
    }
  }

  public disconnect() {
    if (this.botId) {
      axios
        .delete(`${this.apiUrl}/bots/${this.botId}`, {
          headers: {
            "x-meeting-baas-api-key": this.apiKey,
          },
        })
        .then(() => {
          logger.info(`Bot ${this.botId} successfully removed`);
        })
        .catch((error) => {
          logger.error("Error removing bot:", error);
        });

      this.botId = null;
    }
  }
    // ✅ Getter to retrieve the current bot ID
  public getBotId(): string | null {
    return this.botId;
  }
}

export { MeetingBaasClient };
