import { db } from "./db";

export async function insertBot(botId: string, meetingId: string) {
  try {
    const [result] = await db.execute(
      "INSERT INTO call_data (Bot_Id, meetingid) VALUES (?, ?)",
      [botId, meetingId]
    );
    console.log("✅ Bot inserted into DB:", result);
  } catch (err) {
    console.error("❌ Error inserting bot:", err);
  }
}

export async function appendTranscription(botId: string, newText: string) {
  try {
    const [rows]: any = await db.execute(
      "SELECT transcription FROM call_data WHERE Bot_Id = ?",
      [botId]
    );

    const currentText = rows.length > 0 ? rows[0].transcription || "" : "";
    const updatedText = currentText + " " + newText;

    await db.execute(
      "UPDATE call_data SET transcription = ? WHERE Bot_Id = ?",
      [updatedText, botId]
    );
    console.log("📝 Transcription appended for bot:", botId);
  } catch (err) {
    console.error("❌ Error appending transcription:", err);
  }
}
