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

// FFmpeg paths loaded

if (effectiveFfmpegPath) {
    ffmpeg.setFfmpegPath(effectiveFfmpegPath);
    ffmpeg.setFfprobePath(effectiveFfprobePath);
} else {
    console.error("FFmpeg executable not found. Please ensure ffmpeg-static is correctly installed or install FFmpeg manually.");
}
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = 8765; // Using port 8765 to avoid common development port conflicts

// Configuration - easy to adjust
const CONFIG = {
    MAX_FRAMES_LIMIT: 6, // Safety limit to prevent API overload
    MAX_RECORDING_DURATION: 30, // Max recording duration in seconds
    FRAME_TIMESTAMPS: [2, 7, 12, 17, 22, 27], // Extract frames at these specific seconds
    // Multi-model support: configurable directory name
    AI_MODEL_DIR: process.env.AI_VIDEO_EXT_DIR || 'gemini', // Can be 'gemini', 'claude', etc.
    SESSION_ID: Date.now().toString() // Unique session ID for file isolation
};

// Check for Gemini API key
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY environment variable is not set.");
    process.exit(1);
}

// Initialize the GoogleGenerativeAI with your API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Use configurable hidden directory to avoid committing personal data
const AI_BASE_DIR = path.join(process.cwd(), `.${CONFIG.AI_MODEL_DIR}`);
const SESSION_DIR = path.join(AI_BASE_DIR, 'video-ext', CONFIG.SESSION_ID);
const UPLOADS_DIR = path.join(SESSION_DIR, 'uploads');
const FRAMES_DIR = path.join(SESSION_DIR, 'frames');
const AUDIO_PATH = path.join(SESSION_DIR, 'audio.wav');
const TRANSCRIPT_PATH = path.join(SESSION_DIR, 'transcript.txt');

// Create necessary directories
[SESSION_DIR, UPLOADS_DIR, FRAMES_DIR].forEach(dir => {
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

  res.json({ message: 'Upload successful. Processing started in the background.' });

  try {
    const context = await processVideo(videoPath); // processVideo will now return the context
    videoProcessedResolve(context); // Resolve the promise with the context
  } catch (error) {
    videoProcessedReject(error); // Reject the promise on error
  }
  // Note: Server stays alive for MCP usage - don't close it
  // Reset promise handlers for next recording
  videoProcessedResolve = null;
  videoProcessedReject = null;
});

async function processVideo(videoPath) {
    const sanitizedVideoPath = path.join(UPLOADS_DIR, 'recording-fixed.webm');

    try {
        // 1. Sanitize video to fix potential header issues
        await sanitizeVideo(videoPath, sanitizedVideoPath);

        // 2. Get video duration
        const videoDuration = await getVideoDuration(sanitizedVideoPath);

        // 3. Extract frames from the sanitized video
        await extractFrames(sanitizedVideoPath, videoDuration);

        // 4. Extract and transcribe audio from the sanitized video
        await transcribeAudio(sanitizedVideoPath);

        // 5. Generate and return the context
        const context = await generateGeminiContext(videoDuration);

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
        exec(ffmpegCommand, { shell: true }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`Error sanitizing video: ${error.message}`));
            }
            resolve();
        });
    });
}

function getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
        const ffprobeCommand = `"${effectiveFfprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
        exec(ffprobeCommand, { shell: true }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`Error getting video duration: ${error.message}`));
            }
            const duration = parseFloat(stdout.trim());
            if (isNaN(duration)) {
                // Fallback: try to get duration from video stream
                const fallbackCommand = `"${effectiveFfprobePath}" -v error -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
                exec(fallbackCommand, { shell: true }, (fallbackError, fallbackStdout, fallbackStderr) => {
                    const fallbackDuration = parseFloat(fallbackStdout.trim());
                    if (!fallbackError && !isNaN(fallbackDuration)) {
                        resolve(fallbackDuration);
                    } else {
                        resolve(5.0); // Default fallback duration
                    }
                });
            } else {
                resolve(duration);
            }
        });
    });
}

function extractFrames(videoPath, videoDuration) {
    return new Promise(async (resolve, reject) => {
        try {
            // Use predefined timestamps: 2, 7, 12, 17, 22, 27 seconds
            const timestamps = CONFIG.FRAME_TIMESTAMPS.filter(timestamp => timestamp < videoDuration);
            
            // Apply safety limit
            if (timestamps.length > CONFIG.MAX_FRAMES_LIMIT) {
                console.log(`⚠️  Limiting frames from ${timestamps.length} to ${CONFIG.MAX_FRAMES_LIMIT} for API safety`);
                timestamps.splice(CONFIG.MAX_FRAMES_LIMIT);
            }
            
            // Extract frames at specified timestamps
            
            // Extract frames one by one to avoid filter conflicts
            for (let i = 0; i < timestamps.length; i++) {
                const timestamp = timestamps[i];
                await extractSingleFrame(videoPath, timestamp, i);
            }
            
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

function extractSingleFrame(videoPath, timestamp, index) {
    return new Promise((resolve, reject) => {
        const outputFilename = `frame-${timestamp}.png`;
        const outputPath = path.join(FRAMES_DIR, outputFilename);
        
        ffmpeg(videoPath)
            .seekInput(timestamp)
            .frames(1)
            .output(outputPath)
            .on('end', () => {
                resolve();
            })
            .on('error', (err) => {
                reject(new Error(`Error extracting frame at ${timestamp}s: ${err.message}`));
            })
            .run();
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
                            } catch (e) {
                }
            }
            
            // Use FFmpeg's silencedetect filter to check if audio is mostly silent
            const ffmpegCommand = `"${effectiveFfmpegPath}" -i "${audioPath}" -af silencedetect=noise=-30dB:d=0.5 -f null - 2>&1`;
            exec(ffmpegCommand, { shell: true }, (error, stdout, stderr) => {
                const output = stdout + stderr;
                
                // Count silence periods - if there are many, audio is likely silent
                const silenceMatches = output.match(/silence_start/g);
                const silenceCount = silenceMatches ? silenceMatches.length : 0;
                
                // Also check for volume levels
                const volumeCommand = `"${effectiveFfmpegPath}" -i "${audioPath}" -af "volumedetect" -f null - 2>&1`;
                exec(volumeCommand, { shell: true }, (volError, volStdout, volStderr) => {
                    const volOutput = volStdout + volStderr;
                    
                    // Extract max volume
                    const maxVolMatch = volOutput.match(/max_volume:\s*([-\d.]+)\s*dB/);
                    const maxVolume = maxVolMatch ? parseFloat(maxVolMatch[1]) : -100;
                    
                    // Consider silent if max volume is very low (less than -60dB) or many silence periods
                    const isSilent = maxVolume < -60 || silenceCount > 3;
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

    // Extract audio with volume amplification
    const ffmpegCommand = `"${effectiveFfmpegPath}" -i "${videoPath}" -y -af "volume=10" -acodec pcm_s16le -ar 16000 -ac 1 -vn -f wav "${AUDIO_PATH}"`;

    await new Promise((resolve, reject) => {
        exec(ffmpegCommand, { shell: true }, (error, stdout, stderr) => {
            if (error) {
                fs.writeFileSync(TRANSCRIPT_PATH, '[Audio extraction failed]');
                resolve();
                return;
            }
            resolve();
        });
    });

    // Check if audio file was created and has content
    if (!fs.existsSync(AUDIO_PATH) || fs.statSync(AUDIO_PATH).size === 0) {
        console.log('No audio extracted or audio file is empty. Skipping transcription.');
        fs.writeFileSync(TRANSCRIPT_PATH, '[No audio content found]');
        return;
    }

    // Validate audio content has actual sound (not just silence)
    const isAudioSilent = await checkAudioSilence(AUDIO_PATH);
    if (isAudioSilent) {
        fs.writeFileSync(TRANSCRIPT_PATH, '[Audio is silent - no sound detected]');
        return;
    }

    try {
        // 2. Transcribe using Gemini API with retry logic
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Please transcribe this audio recording with timestamps. Format your response as:

[MM:SS] Transcript text here
[MM:SS] Next segment of speech

For example:
[00:03] This login button is broken when I click it
[00:08] The search feature isn't working properly  
[00:15] Can you add a dark mode option please

Include timestamps for each distinct topic or issue mentioned. If there is no speech or the audio is silent, respond with '[No speech detected]'.`;
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
                break;
            } catch (apiError) {
                attempts++;
                
                if (attempts >= maxAttempts) {
                    throw apiError;
                }
                
                // Wait before retrying (exponential backoff)
                const waitTime = Math.pow(2, attempts) * 1000;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    } catch (error) {
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
    
    // Parse timestamped transcript
    const transcriptSegments = parseTimestampedTranscript(transcript);
    
    // Get all frame files and sort by timestamp
    let frameFiles = [];
    if (fs.existsSync(FRAMES_DIR)) {
        try {
            const allFiles = fs.readdirSync(FRAMES_DIR);
            
            frameFiles = allFiles
                .filter(file => file.startsWith('frame-') && file.endsWith('.png'))
                .map(file => {
                    const timestampMatch = file.match(/frame-(\d+\.?\d*)/);
                    const timestamp = timestampMatch ? parseFloat(timestampMatch[1]) : 0;
                    return { file, timestamp };
                })
                .sort((a, b) => a.timestamp - b.timestamp);
        } catch (error) {
            console.error(`Error reading frames directory: ${error.message}`);
            frameFiles = [];
        }
    } else {
        console.error(`Frames directory does not exist: ${FRAMES_DIR}`);
    }


    // Correlate frames with transcript segments
    const correlatedData = [];
    
    for (const frameData of frameFiles) {
        const framePath = path.join(FRAMES_DIR, frameData.file);
        const frameTimestamp = frameData.timestamp;
        
        // Find the closest transcript segment to this frame
        const relevantSegment = findClosestTranscriptSegment(transcriptSegments, frameTimestamp);
        
        // Use relative path from project root instead of base64
        const relativeFramePath = path.relative(process.cwd(), framePath);
        
        const minutes = Math.floor(frameTimestamp / 60);
        const seconds = Math.floor(frameTimestamp % 60);
        const formattedTimestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        
        correlatedData.push({
            frameTimestamp: formattedTimestamp,
            frameSeconds: frameTimestamp,
            transcriptText: relevantSegment ? relevantSegment.text : '[No speech at this time]',
            transcriptTimestamp: relevantSegment ? relevantSegment.timestamp : null,
            framePath: relativeFramePath
        });
    }

    let contextMarkdown = `Video Context

Recording: ${Math.floor(videoDuration)} seconds with ${correlatedData.length} frame(s)

`;

    correlatedData.forEach((item, index) => {
        contextMarkdown += `Issue ${index + 1} - Frame at ${item.frameTimestamp}
Visual Context: Please analyze this image file from the recording:
@${item.framePath}

Developer's request during recording: "${item.transcriptText}"

---
`;
    });

    contextMarkdown += `
Full audio transcript from recording:
${transcript}

Please analyze the image file(s) above to fulfill the developer's request.
`;

    return contextMarkdown;
}

function parseTimestampedTranscript(transcript) {
    // Parse transcript in format: [MM:SS] Text here
    const segments = [];
    const lines = transcript.split('\n');
    
    for (const line of lines) {
        const timestampMatch = line.match(/\[(\d{2}):(\d{2})\]\s*(.+)/);
        if (timestampMatch) {
            const minutes = parseInt(timestampMatch[1]);
            const seconds = parseInt(timestampMatch[2]);
            const totalSeconds = minutes * 60 + seconds;
            const text = timestampMatch[3].trim();
            
            segments.push({
                timestamp: totalSeconds,
                text: text
            });
        }
    }
    
    return segments;
}

function findClosestTranscriptSegment(segments, frameTimestamp) {
    if (segments.length === 0) return null;
    
    // Find the segment that is closest in time to the frame
    let closest = segments[0];
    let minDistance = Math.abs(segments[0].timestamp - frameTimestamp);
    
    for (const segment of segments) {
        const distance = Math.abs(segment.timestamp - frameTimestamp);
        if (distance < minDistance) {
            minDistance = distance;
            closest = segment;
        }
    }
    
    // Only return if the closest segment is within 5 seconds of the frame
    return minDistance <= 5 ? closest : null;
}

// This is the function that the Gemini CLI will call
async function startVideoCapture() {
    return new Promise((resolve, reject) => {
        videoProcessedResolve = resolve;
        videoProcessedReject = reject;

        serverInstance = app.listen(port, () => {
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

// Export functions for Gemini CLI integration
module.exports = {
    // Main entry point for /video command
    startVideoCapture,
    
    // Extension metadata for CLI
    name: 'gemini-video-ext',
    version: '1.0.0',
    description: 'Privacy-first video recording for Gemini CLI',
    
    // Command definitions for CLI
    commands: {
        video: {
            description: 'Record screen video with audio for context',
            action: startVideoCapture
        }
    },
    
    // Extension configuration
    config: {
        privacy: {
            dataRetention: 'none',
            cloudSync: false,
            analytics: false
        },
        permissions: [
            'screen-capture',
            'audio-recording', 
            'local-file-system'
        ]
    }
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