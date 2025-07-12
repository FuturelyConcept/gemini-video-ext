const express = require('express');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = 3000;

// Check for Gemini API key
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY environment variable is not set.");
    process.exit(1);
}

// Initialize the GoogleGenerativeAI with your API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const FRAMES_DIR = path.join(UPLOADS_DIR, 'frames');
const AUDIO_PATH = path.join(UPLOADS_DIR, 'audio.wav');
const TRANSCRIPT_PATH = path.join(UPLOADS_DIR, 'transcript.txt');

// Create necessary directories
[UPLOADS_DIR, FRAMES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Setup for video uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    cb(null, 'recording.webm');
  }
});
const upload = multer({ storage: storage });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));

let videoProcessedResolve;
let videoProcessedReject;
let serverInstance; // To hold the server instance

// --- Main Upload Handler ---
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No video file uploaded.' });
  }

  const videoPath = req.file.path;
  console.log(`Video uploaded successfully to ${videoPath}`);

  res.json({ message: 'Upload successful. Processing started in the background.' });

  try {
    const context = await processVideo(videoPath); // processVideo will now return the context
    videoProcessedResolve(context); // Resolve the promise with the context
  } catch (error) {
    videoProcessedReject(error); // Reject the promise on error
  } finally {
    // Close the server after processing is done and context is returned
    if (serverInstance) {
      serverInstance.close(() => {
        console.log('Server closed.');
      });
    }
  }
});

async function processVideo(videoPath) {
    console.log('Starting video processing...');
    const sanitizedVideoPath = path.join(UPLOADS_DIR, 'recording-fixed.webm');

    try {
        // 1. Sanitize video to fix potential header issues
        await sanitizeVideo(videoPath, sanitizedVideoPath);
        console.log('Video sanitized successfully.');

        // 2. Get video duration
        const videoDuration = await getVideoDuration(sanitizedVideoPath);
        console.log(`Video duration: ${videoDuration} seconds`);

        // 3. Extract frames from the sanitized video
        await extractFrames(sanitizedVideoPath);
        console.log('Frames extracted successfully.');

        // 4. Extract and transcribe audio from the sanitized video
        await transcribeAudio(sanitizedVideoPath);
        console.log('Audio transcribed successfully.');

        // Clean up the temporary sanitized file after all processing
        if (fs.existsSync(sanitizedVideoPath)) {
            fs.unlinkSync(sanitizedVideoPath);
        }

        } catch (error) {
        console.error('An error occurred during video processing:', error);
        throw error; // Re-throw to be caught by the promise rejection
    }
}

function sanitizeVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions('-c', 'copy') // Fast, lossless copy
            .on('end', () => {
                console.log(`Sanitized video created at: ${outputPath}`);
                resolve();
            })
            .on('error', (err) => {
                console.error(`Error during video sanitization: ${err.message}`);
                reject(new Error(`Error sanitizing video: ${err.message}`));
            })
            .save(outputPath);
    });
}

function getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                return reject(new Error(`Error getting video duration: ${err.message}`));
            }
            resolve(metadata.format.duration);
        });
    });
}

function extractFrames(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .on('end', resolve)
            .on('error', (err) => reject(new Error(`Error extracting frames: ${err.message}`)))
            .screenshots({
                count: 10,
                folder: FRAMES_DIR,
                filename: 'frame-%i.png'
            });
    });
}

// Function to convert a file to a generative part
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString("base64"),
      mimeType
    },
  };
}

async function transcribeAudio(videoPath) {
    // Clean up previous audio file if it exists
    if (fs.existsSync(AUDIO_PATH)) {
        fs.unlinkSync(AUDIO_PATH);
    }

    // 1. Extract audio using child_process.exec for more detailed ffmpeg errors
    const ffmpegCommand = `ffmpeg -i "${videoPath}" -y -acodec pcm_s16le -ar 16000 -ac 1 -vn -f wav "${AUDIO_PATH}"`;
    console.log(`Executing ffmpeg command: ${ffmpegCommand}`);

    await new Promise((resolve, reject) => {
        exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`ffmpeg stdout: ${stdout}`);
                console.error(`ffmpeg stderr: ${stderr}`);
                return reject(new Error(`Error extracting audio: ${error.message}. ffmpeg stderr: ${stderr}`));
            }
            console.log(`ffmpeg stdout: ${stdout}`);
            console.log(`ffmpeg stderr: ${stderr}`);
            resolve();
        });
    });

    console.log(`Audio extracted to ${AUDIO_PATH}`);

    // 2. Transcribe using Gemini API
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = "Please transcribe this audio file.";
    const audioFile = fileToGenerativePart(AUDIO_PATH, "audio/wav");
    const result = await model.generateContent([prompt, audioFile]);
    const response = await result.response;
    const text = response.text();

    // 3. Save transcript to file
    fs.writeFileSync(TRANSCRIPT_PATH, text);

    // 4. Clean up temporary audio file
    fs.unlinkSync(AUDIO_PATH);
}

async function generateGeminiContext(videoDuration) {
    const transcript = fs.readFileSync(TRANSCRIPT_PATH, 'utf8');
    const frames = [];

    for (let i = 1; i <= 10; i++) {
        const framePath = path.join(FRAMES_DIR, `frame-${i}.png`);
        const timestampPercentage = (i * 10 - 5); // 5%, 15%, ..., 95%
        const timestampSeconds = (videoDuration * timestampPercentage / 100);
        const minutes = Math.floor(timestampSeconds / 60);
        const seconds = Math.floor(timestampSeconds % 60);
        const formattedTimestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        const generativePart = fileToGenerativePart(framePath, "image/png");
        const base64Image = generativePart.inlineData.data; // Extract the base64 data

        frames.push(`${i}. [${formattedTimestamp}] ${base64Image}`); // Include base64 directly
    }

    // Placeholder for Context Summary - this would ideally be generated by another AI call
    const contextSummary = "User demonstrating an application workflow.";

    const now = new Date();
    const timestamp = now.toISOString().replace(/T/, ' ').replace(/\..+/, ''); // YYYY-MM-DD HH:MM:SS

    const contextMarkdown = `## Video Context Captured\n\n**Recording Details:**\n- Duration: ${Math.floor(videoDuration)} seconds\n- Capture Type: Unknown (Assumed Chrome Tab/Window/Screen)\n- Audio: Enabled\n- Timestamp: ${timestamp}\n\n**Visual Frames (10 samples):**\n${frames.join('\n')}\n\n**Audio Transcript:**\n"${transcript}"\n\n**Context Summary:**\n${contextSummary}\n`;

    return contextMarkdown;
}

// This is the function that the Gemini CLI will call
async function startVideoCapture() {
    return new Promise((resolve, reject) => {
        videoProcessedResolve = resolve;
        videoProcessedReject = reject;

        serverInstance = app.listen(port, () => {
            console.log(`Server started at http://localhost:${port}`);
            // Automatically open the browser
            const start = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');
            exec(start + ' ' + `http://localhost:${port}`);
        });

        serverInstance.on('error', (err) => {
            console.error('Server failed to start:', err);
            reject(err);
        });
    });
}

// Export the function for the CLI
module.exports = {
    startVideoCapture
};

// If this script is run directly (e.g., for testing without CLI)
if (require.main === module) {
    startVideoCapture().then(context => {
        console.log("Generated Context:\n", context);
    }).catch(err => {
        console.error("Error during video capture process:", err);
    });
}