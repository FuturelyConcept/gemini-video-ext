const express = require('express');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

let effectiveFfmpegPath;
let effectiveFfprobePath;

try {
    effectiveFfmpegPath = require('@ffmpeg-installer/ffmpeg').path;
} catch (error) {
    console.warn('Warning: @ffmpeg-installer/ffmpeg not found, trying system ffmpeg');
    effectiveFfmpegPath = 'ffmpeg';
}

try {
    effectiveFfprobePath = require('ffprobe-static').path;
} catch (error) {
    console.warn('Warning: ffprobe-static not found, trying system ffprobe');
    effectiveFfprobePath = 'ffprobe';
}

console.log(`FFmpeg path: ${effectiveFfmpegPath}`);
console.log(`FFprobe path: ${effectiveFfprobePath}`);

if (effectiveFfmpegPath) {
    ffmpeg.setFfmpegPath(effectiveFfmpegPath);
    ffmpeg.setFfprobePath(effectiveFfprobePath);
} else {
    console.error("FFmpeg executable not found. Please ensure ffmpeg-static is correctly installed or install FFmpeg manually.");
}
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

        // 5. Generate and return the context
        const context = await generateGeminiContext(videoDuration);
        console.log('Context generated successfully.');

        // Clean up the temporary sanitized file after all processing
        if (fs.existsSync(sanitizedVideoPath)) {
            fs.unlinkSync(sanitizedVideoPath);
        }

        return context;

        } catch (error) {
        console.error('An error occurred during video processing:', error);
        throw error; // Re-throw to be caught by the promise rejection
    }
}

function sanitizeVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const ffmpegCommand = `"${effectiveFfmpegPath}" -i "${inputPath}" -y -c copy "${outputPath}"`;
        console.log(`Executing sanitizeVideo ffmpeg command: ${ffmpegCommand}`);
        exec(ffmpegCommand, { shell: true }, (error, stdout, stderr) => {
            if (error) {
                console.error(`ffmpeg stdout: ${stdout}`);
                console.error(`ffmpeg stderr: ${stderr}`);
                return reject(new Error(`Error sanitizing video: ${error.message}. ffmpeg stderr: ${stderr}`));
            }
            console.log(`Sanitized video created at: ${outputPath}`);
            resolve();
        });
    });
}

function getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
        const ffprobeCommand = `"${effectiveFfprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
        console.log(`Executing getVideoDuration ffprobe command: ${ffprobeCommand}`);
        exec(ffprobeCommand, { shell: true }, (error, stdout, stderr) => {
            if (error) {
                console.error(`ffprobe stdout: ${stdout}`);
                console.error(`ffprobe stderr: ${stderr}`);
                return reject(new Error(`Error getting video duration: ${error.message}. ffprobe stderr: ${stderr}`));
            }
            const duration = parseFloat(stdout.trim());
            console.log(`Raw duration output: "${stdout.trim()}", parsed: ${duration}`);
            if (isNaN(duration)) {
                // Fallback: try to get duration from video stream
                const fallbackCommand = `"${effectiveFfprobePath}" -v error -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
                exec(fallbackCommand, { shell: true }, (fallbackError, fallbackStdout, fallbackStderr) => {
                    const fallbackDuration = parseFloat(fallbackStdout.trim());
                    if (!fallbackError && !isNaN(fallbackDuration)) {
                        console.log(`Using fallback duration: ${fallbackDuration}`);
                        resolve(fallbackDuration);
                    } else {
                        console.warn('Could not determine video duration, using default 5 seconds');
                        resolve(5.0); // Default fallback duration
                    }
                });
            } else {
                resolve(duration);
            }
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

async function checkVideoHasAudio(videoPath) {
    return new Promise((resolve, reject) => {
        const ffprobeCommand = `"${effectiveFfprobePath}" -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
        exec(ffprobeCommand, { shell: true }, (error, stdout, stderr) => {
            if (error) {
                // If error, assume no audio
                resolve(false);
            } else {
                resolve(stdout.trim().length > 0);
            }
        });
    });
}

async function checkAudioSilence(audioPath) {
    return new Promise((resolve, reject) => {
        // First, get detailed audio information
        const infoCommand = `"${effectiveFfprobePath}" -v quiet -print_format json -show_format -show_streams "${audioPath}"`;
        exec(infoCommand, { shell: true }, (infoError, infoStdout, infoStderr) => {
            if (!infoError) {
                try {
                    const audioInfo = JSON.parse(infoStdout);
                    console.log('Audio file details:', JSON.stringify(audioInfo, null, 2));
                } catch (e) {
                    console.log('Could not parse audio info as JSON');
                }
            }
            
            // Use FFmpeg's silencedetect filter to check if audio is mostly silent
            const ffmpegCommand = `"${effectiveFfmpegPath}" -i "${audioPath}" -af silencedetect=noise=-30dB:d=0.5 -f null - 2>&1`;
            exec(ffmpegCommand, { shell: true }, (error, stdout, stderr) => {
                const output = stdout + stderr;
                console.log(`Silence detection output (first 1000 chars): ${output.substring(0, 1000)}`);
                
                // Count silence periods - if there are many, audio is likely silent
                const silenceMatches = output.match(/silence_start/g);
                const silenceCount = silenceMatches ? silenceMatches.length : 0;
                console.log(`Detected ${silenceCount} silence periods`);
                
                // Also check for volume levels
                const volumeCommand = `"${effectiveFfmpegPath}" -i "${audioPath}" -af "volumedetect" -f null - 2>&1`;
                exec(volumeCommand, { shell: true }, (volError, volStdout, volStderr) => {
                    const volOutput = volStdout + volStderr;
                    console.log(`Volume detection output: ${volOutput}`);
                    
                    // Extract max volume
                    const maxVolMatch = volOutput.match(/max_volume:\s*([-\d.]+)\s*dB/);
                    const maxVolume = maxVolMatch ? parseFloat(maxVolMatch[1]) : -100;
                    console.log(`Max volume detected: ${maxVolume} dB`);
                    
                    // Consider silent if max volume is very low (less than -60dB) or many silence periods
                    const isSilent = maxVolume < -60 || silenceCount > 3;
                    console.log(`Audio considered silent: ${isSilent} (maxVol: ${maxVolume}dB, silencePeriods: ${silenceCount})`);
                    resolve(isSilent);
                });
            });
        });
    });
}

async function transcribeAudio(videoPath) {
    // Check if video has audio track first
    const hasAudio = await checkVideoHasAudio(videoPath);
    
    if (!hasAudio) {
        console.log('Video has no audio track. Skipping audio transcription.');
        // Create empty transcript file
        fs.writeFileSync(TRANSCRIPT_PATH, '[No audio detected in recording]');
        return;
    }

    // Clean up previous audio file if it exists
    if (fs.existsSync(AUDIO_PATH)) {
        fs.unlinkSync(AUDIO_PATH);
    }

    // 1. Extract audio using child_process.exec for more detailed ffmpeg errors
    // Add volume amplification for low audio signals
    const ffmpegCommand = `"${effectiveFfmpegPath}" -i "${videoPath}" -y -af "volume=10" -acodec pcm_s16le -ar 16000 -ac 1 -vn -f wav "${AUDIO_PATH}"`;
    console.log(`Executing ffmpeg command with volume boost: ${ffmpegCommand}`);

    await new Promise((resolve, reject) => {
        exec(ffmpegCommand, { shell: true }, (error, stdout, stderr) => {
            if (error) {
                console.error(`ffmpeg stdout: ${stdout}`);
                console.error(`ffmpeg stderr: ${stderr}`);
                // Don't fail completely if audio extraction fails
                console.log('Audio extraction failed, continuing without audio transcription');
                fs.writeFileSync(TRANSCRIPT_PATH, '[Audio extraction failed]');
                resolve();
                return;
            }
            console.log(`ffmpeg stdout: ${stdout}`);
            console.log(`ffmpeg stderr: ${stderr}`);
            resolve();
        });
    });

    // Check if audio file was created and has content
    if (!fs.existsSync(AUDIO_PATH) || fs.statSync(AUDIO_PATH).size === 0) {
        console.log('No audio extracted or audio file is empty. Skipping transcription.');
        fs.writeFileSync(TRANSCRIPT_PATH, '[No audio content found]');
        return;
    }

    const audioStats = fs.statSync(AUDIO_PATH);
    console.log(`Audio extracted to ${AUDIO_PATH}, size: ${audioStats.size} bytes`);
    
    // Validate audio content has actual sound (not just silence)
    const isAudioSilent = await checkAudioSilence(AUDIO_PATH);
    if (isAudioSilent) {
        console.log('Audio file appears to be silent. Skipping transcription.');
        fs.writeFileSync(TRANSCRIPT_PATH, '[Audio is silent - no sound detected]');
        return;
    }
    
    console.log('Audio appears to have content, proceeding with transcription...');

    try {
        // 2. Transcribe using Gemini API with retry logic
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = "Please transcribe the speech in this audio recording. If there is no speech or the audio is silent, respond with '[No speech detected]'.";
        const audioFile = fileToGenerativePart(AUDIO_PATH, "audio/wav");
        
        let result;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                result = await model.generateContent([prompt, audioFile]);
                const response = await result.response;
                const text = response.text();
                
                // 3. Save transcript to file
                fs.writeFileSync(TRANSCRIPT_PATH, text);
                console.log('Audio transcription successful');
                break;
            } catch (apiError) {
                attempts++;
                console.error(`Transcription attempt ${attempts} failed:`, apiError.message);
                
                if (attempts >= maxAttempts) {
                    throw apiError;
                }
                
                // Wait before retrying (exponential backoff)
                const waitTime = Math.pow(2, attempts) * 1000;
                console.log(`Retrying in ${waitTime/1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    } catch (error) {
        console.error('Error during audio transcription after all retries:', error);
        fs.writeFileSync(TRANSCRIPT_PATH, '[Audio transcription failed - API unavailable]');
    } finally {
        // 4. Clean up temporary audio file
        if (fs.existsSync(AUDIO_PATH)) {
            fs.unlinkSync(AUDIO_PATH);
        }
    }
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

        // For the actual context, use the full base64, but truncate for logging
        frames.push(`${i}. [${formattedTimestamp}] ${base64Image}`); // Include full base64 for context
    }

    // Placeholder for Context Summary - this would ideally be generated by another AI call
    const contextSummary = "User demonstrating an application workflow.";

    const now = new Date();
    const timestamp = now.toISOString().replace(/T/, ' ').replace(/\..+/, ''); // YYYY-MM-DD HH:MM:SS

    const contextMarkdown = `## Video Context Captured\n\n**Recording Details:**\n- Duration: ${Math.floor(videoDuration)} seconds\n- Capture Type: Unknown (Assumed Chrome Tab/Window/Screen)\n- Audio: Enabled\n- Timestamp: ${timestamp}\n\n**Visual Frames (10 samples):**\n${frames.join('\n')}\n\n**Audio Transcript:**\n"${transcript}"\n\n**Context Summary:**\n${contextSummary}\n`;

    // Log a truncated version for debugging
    const truncatedFrames = frames.map(frame => {
        const parts = frame.split('] ');
        if (parts.length > 1) {
            return parts[0] + '] ' + parts[1].substring(0, 50) + '...';
        }
        return frame.substring(0, 100) + '...';
    });
    
    console.log('Context generated with frames:', truncatedFrames.length);
    console.log('Sample frame data:', truncatedFrames[0]);
    console.log('Transcript length:', transcript.length);

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
        console.log("Generated Context length:", context ? context.length : 0, "characters");
        console.log("Context preview:", context ? context.substring(0, 500) + "..." : "No context generated");
    }).catch(err => {
        console.error("Error during video capture process:", err);
    });
}