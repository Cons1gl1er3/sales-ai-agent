<p align="center"><a href="https://discord.com/invite/dsvFgDTr6c"><img height="60px" src="https://user-images.githubusercontent.com/31022056/158916278-4504b838-7ecb-4ab9-a900-7dc002aade78.png" alt="Join our Discord!"></a></p>

# Real-Time Meeting Transcription

A Node.js application that connects to video meetings (Zoom, Google Meet, Microsoft Teams) and provides real-time audio transcription using MeetingBaas and OpenAI Whisper.

## Features

- Joins video conferences as a bot participant
- Streams audio from meetings to OpenAI Whisper for real-time transcription
- Logs transcriptions with speaker detection
- Provides clean shutdown with proper resource cleanup
- Supports multiple video conferencing platforms through MeetingBaas

## Prerequisites

- Node.js (v16 or later)
- pnpm (or npm/yarn)
- MeetingBaas API key
- OpenAI API key
- Ngrok or similar tool for exposing local webhook endpoints

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/real-time-meeting-transcription.git
   cd real-time-meeting-transcription
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create a `.env` file in the root directory:
   ```
   MEETING_BAAS_API_KEY=your_meetingbaas_api_key
   OPENAI_API_KEY=your_openai_api_key
   PROXY_HOST=0.0.0.0
   PROXY_PORT=3000
   ```

## Usage

1. Start ngrok to create a public URL for your webhook:

   ```bash
   ngrok http 3000
   ```

   Note the https URL that ngrok provides (e.g., https://abcd-123-456-789.ngrok-free.app).

2. Run the application:

   ```bash
   pnpm run dev <meeting_url> <bot_name> <ngrok_url>
   ```

   Example:

   ```bash
   pnpm run dev https://us06web.zoom.us/j/12345?pwd=abcdef "Transcription Bot" https://abcd-123-456-789.ngrok-free.app
   ```

3. The bot will join the meeting and begin transcribing audio in real-time.

4. To stop the transcription service, press `Ctrl+C` in your terminal. The application will gracefully shutdown.

## Architecture

The project consists of three main components:

1. **MeetingBaas Client** (`src/meetingbaas.ts`): Handles communication with the MeetingBaas API, which provides the bot service that joins meetings and streams audio.

2. **Proxy Server** (`src/proxy.ts`): A WebSocket server that acts as a bridge between MeetingBaas and OpenAI. It receives audio from MeetingBaas and forwards it to OpenAI, then captures transcriptions from OpenAI.

3. **OpenAI Client** (`src/openai.ts`): Manages the connection to OpenAI's Whisper API for transcription.

Data flow:

1. MeetingBaas bot joins a meeting via API
2. Audio from the meeting is sent to your webhook URL (ngrok)
3. The proxy server receives this audio and forwards it to OpenAI
4. OpenAI transcribes the audio and returns the transcription
5. The transcription is logged and can be processed further as needed

## Troubleshooting

- **401 Unauthorized Error**: Verify your MeetingBaas API key is correct in the `.env` file.
- **WebSocket Connection Issues**: Make sure your ngrok URL is correct and the proxy server is running.
- **No Audio Transcription**: Check that OpenAI API key is valid and the audio format is correct.
- **Bot Not Joining Meeting**: Ensure the meeting URL is valid and accessible without additional authentication.

## Configuration

The application can be configured via the `src/config.ts` file or environment variables:

- `MEETING_BAAS_API_KEY`: Your MeetingBaas API key
- `OPENAI_API_KEY`: Your OpenAI API key
- `PROXY_HOST`: Host for the proxy server (default: 0.0.0.0)
- `PROXY_PORT`: Port for the proxy server (default: 3000)
- `MEETING_BAAS_API_URL`: MeetingBaas API URL (default: https://api.meetingbaas.com)

## Deployment to Railway

1. Install the Railway CLI:
   ```bash
   npm i -g @railway/cli
   ```

2. Login to Railway:
   ```bash
   railway login
   ```

3. Initialize your project:
   ```bash
   railway init
   ```

4. Add your environment variables in the Railway dashboard:
   - `MEETING_BAAS_API_KEY`
   - `OPENAI_API_KEY`
   - `PROXY_HOST` (set to 0.0.0.0)
   - `PROXY_PORT` (set to 3000)

5. Deploy your application:
   ```bash
   railway up
   ```

6. Your application will be deployed and Railway will provide you with a public URL. Use this URL instead of ngrok for your webhook endpoint.

Note: Make sure to update your MeetingBaas webhook URL to point to your Railway deployment URL.

## License

MIT
