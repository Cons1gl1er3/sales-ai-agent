import axios from "axios";
import { apiKeys, proxyConfig } from "./config";
import { createLogger } from "./utils";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const logger = createLogger("OpenAI");

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

class OpenAIClient {
  private apiKey: string;
  private apiUrl: string = "https://api.openai.com/v1/audio/transcriptions";
  private audioBuffer: Buffer[] = [];
  private isProcessing: boolean = false;
  private onTranscriptionCallback: ((text: string, isFinal: boolean) => void) | null = null;
  private processingInterval: NodeJS.Timeout | null = null;
  private tempDir: string;

  constructor() {
    this.apiKey = apiKeys.openai || "";
    if (!this.apiKey) {
      logger.error("OpenAI API key not found. Please set OPENAI_API_KEY in .env");
    }
    this.tempDir = path.join(os.tmpdir(), 'meeting-transcription-openai');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  // Initialize the transcription service
  async initSession(): Promise<boolean> {
    try {
      // Start processing audio chunks every 5 seconds
      this.processingInterval = setInterval(() => this.processAudioBuffer(), 5000);
      logger.info("OpenAI transcription service initialized");
      return true;
    } catch (error) {
      logger.error("Failed to initialize OpenAI session:", error);
      return false;
    }
  }

  // Process accumulated audio buffer
  private async processAudioBuffer() {
    if (this.isProcessing || this.audioBuffer.length === 0) return;

    this.isProcessing = true;
    try {
      const rawAudioData = Buffer.concat(this.audioBuffer);
      this.audioBuffer = [];

      const sampleRate = proxyConfig.audioParams.sampleRate;
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

      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      fs.unlinkSync(tempFile);

      if (response.data && response.data.text) {
        const transcription = response.data.text;
        logger.info(`Transcription: ${transcription}`);
        
        if (this.onTranscriptionCallback) {
          this.onTranscriptionCallback(transcription, true);
        }
      }
    } catch (error) {
      logger.error("Error processing audio with OpenAI:", error);
      if (axios.isAxiosError(error) && error.response) {
        logger.error("OpenAI API error details:", JSON.stringify(error.response.data, null, 2));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // Send audio chunk for transcription
  sendAudioChunk(audioData: Buffer) {
    this.audioBuffer.push(audioData);
    return true;
  }

  // Set callback for transcription results
  onTranscription(callback: (text: string, isFinal: boolean) => void) {
    this.onTranscriptionCallback = callback;
  }

  // End transcription session
  endSession() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    // Process any remaining audio
    if (this.audioBuffer.length > 0) {
      this.processAudioBuffer();
    }
    try {
      const files = fs.readdirSync(this.tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.tempDir, file));
      }
      fs.rmdirSync(this.tempDir);
    } catch (error) {
      logger.error("Error cleaning up temp directory:", error);
    }
  }
}

export { OpenAIClient }; 