# Gemini Video Extension - Project Context

## Project Overview
AI-powered developer tool for recording screen + voice to report bugs and enhancements. The extension captures video, transcribes audio, extracts frames, and generates context for Gemini CLI to perform automated code fixes.

## Current Status: ✅ WORKING
- **Screen Recording**: ✅ Captures application UI
- **Voice Audio**: ✅ Records developer narration via microphone
- **Audio Transcription**: ✅ Gemini API transcription working
- **Frame Extraction**: ✅ 10 samples per video
- **Context Generation**: ✅ Markdown format with frames + transcript

## Architecture

### Frontend (Browser Extension)
- **File**: `public/script.js`, `public/index.html`
- **Audio Strategy**: Combines `getDisplayMedia` (video) + `getUserMedia` (microphone)
- **Recording**: MediaRecorder with video + audio tracks
- **Format**: WebM video files

### Backend (Node.js Server)
- **File**: `lib/index.js`
- **Processing Pipeline**:
  1. Video sanitization (FFmpeg)
  2. Duration detection (FFprobe)
  3. Frame extraction (10 samples)
  4. Audio extraction + transcription (Gemini API)
  5. Context generation (Markdown)

### Dependencies
- `@ffmpeg-installer/ffmpeg` - Cross-platform FFmpeg
- `ffprobe-static` - Video analysis
- `@google/generative-ai` - Audio transcription
- `fluent-ffmpeg` - Frame extraction
- `express` + `multer` - File upload handling

## Developer Workflow
1. **Record**: Developer shows bug + explains via voice
2. **Process**: Auto-extract frames + transcribe speech
3. **Context**: Generate structured data for Gemini CLI
4. **Fix**: Gemini CLI uses context to modify code

## Key Configuration

### Windows Audio Setup
- **Microphone Array**: Default recording device (for voice)
- **Browser Permissions**: Microphone access required
- **Audio Processing**: 10x volume boost, silence detection

### FFmpeg Processing
- **Video**: VP9 codec, 1920x1080
- **Audio**: PCM 16kHz mono, volume amplified
- **Frames**: PNG samples at 10%, 20%, ..., 90% timestamps

## ✅ ENHANCED: Timestamped Transcription & Frame Correlation

### Smart Frame Extraction
- **Dynamic frames**: 1 frame per 3 seconds (not fixed 10)
- **Timestamped filenames**: `frame-1.5.png`, `frame-4.5.png`, etc.
- **Examples**: 
  - 6s video → 2 frames (at 1.5s, 4.5s)
  - 15s video → 5 frames (at 1.5s, 4.5s, 7.5s, 10.5s, 13.5s)
  - 30s video → 10 frames (at 1.5s, 4.5s, ... 28.5s)

### Gemini Timestamped Transcription
**Prompt Format**: Requests transcript as:
```
[00:03] This login button is broken when I click it
[00:08] The search feature isn't working properly  
[00:15] Can you add a dark mode option please
```

### Intelligent Frame-Transcript Correlation
- **Auto-matching**: Finds closest transcript segment to each frame (within 5 seconds)
- **Multi-issue support**: Handles 1-5+ issues in single recording
- **Context generation**: Structured per-issue format

### Enhanced Context Format
```markdown
### Issue 1 - Frame at 00:01
**Visual Context:** [Base64 Image Data]
**Developer Explanation:** "This login button is broken"
**Speech Timestamp:** 3

### Issue 2 - Frame at 00:04  
**Visual Context:** [Base64 Image Data]
**Developer Explanation:** "The search isn't working"
**Speech Timestamp:** 8
```

## Technical Achievements
- ✅ Fixed FFmpeg Windows/WSL compatibility
- ✅ Resolved browser audio capture (system vs microphone)
- ✅ Implemented robust error handling and retries
- ✅ Added comprehensive audio validation
- ✅ Created working end-to-end pipeline

## Environment Notes
- **Development**: WSL2 (Linux) + Windows 11
- **FFmpeg**: Linux binaries via @ffmpeg-installer
- **Browser**: Chrome/Edge with microphone permissions
- **API**: Gemini 1.5 Flash for audio transcription

## Commands
- **Start**: `node lib/index.js`
- **Test**: Navigate to `http://localhost:3000`
- **Dependencies**: `npm install` (includes FFmpeg binaries)

---
*Last Updated: 2025-07-12*
*Author: Manoj Uikey <manojkumar.cse@gmail.com>*