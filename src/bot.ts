import WebSocket from "ws";
import { apiKeys, botConfig, proxyConfig } from "./config";
import { createLogger } from "./utils";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const logger = createLogger("Bot");

// Function to create a WAV header
function getWavHeader(dataLength: number, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // ByteRate
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size
  return buffer;
}

// Simple message types to replace protobufs
interface AudioMessage {
  type: "audio";
  data: {
    audio: string; // Base64 encoded audio
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

type Message = AudioMessage | TranscriptionMessage | TextMessage;

class TranscriptionBot {
  private server: WebSocket.Server;
  private proxyClient: WebSocket | null = null;
  private audioBuffer: Buffer[] = [];
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private tempDir: string;

  constructor() {
    this.server = new WebSocket.Server({
      host: botConfig.host,
      port: botConfig.port,
    });
    this.tempDir = path.join(os.tmpdir(), 'meeting-transcription-bot');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  public async start() {
    logger.info(`Starting bot server on ${botConfig.host}:${botConfig.port}`);

    // Start processing audio chunks every 5 seconds
    this.processingInterval = setInterval(() => this.processAudioBuffer(), 5000);

    this.server.on("connection", (ws) => {
      logger.info("Proxy client connected");
      this.proxyClient = ws;

      ws.on("message", (message) => {
        try {
          // Parse incoming JSON message
          const msg = JSON.parse(message.toString()) as Message;

          if (msg.type === "audio") {
            // Process audio data
            this.processAudioData(msg.data);
          }
        } catch (error) {
          logger.error("Error processing message:", error);
        }
      });

      ws.on("close", () => {
        logger.info("Proxy client disconnected");
        this.proxyClient = null;
      });

      ws.on("error", (error) => {
        logger.error("Proxy client error:", error);
      });
    });
  }

  private async processAudioBuffer() {
    if (this.isProcessing || this.audioBuffer.length === 0) return;

    this.isProcessing = true;
    try {
      const rawAudioData = Buffer.concat(this.audioBuffer);
      this.audioBuffer = []; // Clear the buffer

      const sampleRate = proxyConfig.audioParams.sampleRate; // Or botConfig if more appropriate
      const numChannels = proxyConfig.audioParams.channels;
      const bitsPerSample = 16; // Assuming 16-bit audio

      const wavHeader = getWavHeader(rawAudioData.length, sampleRate, numChannels, bitsPerSample);
      const wavAudioData = Buffer.concat([wavHeader, rawAudioData]);

      const tempFile = path.join(this.tempDir, `audio_${Date.now()}.wav`);
      fs.writeFileSync(tempFile, wavAudioData);

      const formData = new FormData();
      formData.append('file', new Blob([fs.readFileSync(tempFile)], { type: 'audio/wav' }), 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'json');

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKeys.openai}`,
        },
        body: formData,
      });

      fs.unlinkSync(tempFile);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      if (data.text) {
        logger.info(`Transcription: ${data.text}`);
        if (this.proxyClient && this.proxyClient.readyState === WebSocket.OPEN) {
          const transcriptionMessage: TranscriptionMessage = {
            type: "transcription",
            data: {
              text: data.text,
              isFinal: true,
              startTime: Date.now() - 5000,
              endTime: Date.now(),
            },
          };
          this.proxyClient.send(JSON.stringify(transcriptionMessage));
        }
      }
    } catch (error) {
      logger.error("Error processing audio with OpenAI:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  private processAudioData(audioData: {
    audio: string;
    sampleRate: number;
    channels: number;
  }) {
    try {
      // Convert base64 audio to buffer and add to buffer
      const audioBuffer = Buffer.from(audioData.audio, 'base64');
      this.audioBuffer.push(audioBuffer);
    } catch (error) {
      logger.error("Error processing audio data:", error);
    }
  }

  public async shutdown(): Promise<void> {
    // Clear the processing interval
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Process any remaining audio
    if (this.audioBuffer.length > 0) {
      await this.processAudioBuffer();
    }

    // Clean up temp directory
    try {
      const files = fs.readdirSync(this.tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.tempDir, file));
      }
      fs.rmdirSync(this.tempDir);
    } catch (error) {
      logger.error("Error cleaning up temp directory:", error);
    }

    // Close all client connections
    if (this.proxyClient && this.proxyClient.readyState === WebSocket.OPEN) {
      this.proxyClient.close();
    }

    // Close the WebSocket server
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info("WebSocket server closed");
        resolve();
      });
    });
  }
}

export { TranscriptionBot };
