# CLI Integration Guide

## New Simplified Architecture

```javascript
// In Gemini CLI:
const videoExt = require('./extensions/gemini-video-ext');

// 1. Capture video and extract audio
const { audioPath, frames, videoDuration } = await videoExt.captureVideoWithAudio();

// 2. CLI transcribes audio using its existing API connection
const transcript = await geminiCLI.transcribeAudio(audioPath, {
    format: 'timestamped',
    prompt: `Transcribe with [MM:SS] timestamps. Example:
[00:03] This login button is broken
[00:08] The search isn't working`
});

// 3. Extension correlates frames with transcript
const context = videoExt.generateContextWithTranscript(frames, transcript, videoDuration);

// 4. Use context for analysis
console.log(context);
```

## Benefits

- ✅ No API key management needed
- ✅ No separate process spawning  
- ✅ Uses CLI's existing authentication
- ✅ Simple function calls
- ✅ Direct integration

## API Reference

### `captureVideoWithAudio()`
Returns:
```javascript
{
    audioPath: '/path/to/audio.wav' || null,
    frames: [
        { file: 'frame-2.png', timestamp: 2, path: '.gemini/video-ext/123/frames/frame-2.png' }
    ],
    videoDuration: 6.5,
    sessionDir: '/path/to/session'
}
```

### `generateContextWithTranscript(frames, transcript, videoDuration)`
Parameters:
- `frames`: Array from captureVideoWithAudio()
- `transcript`: Timestamped transcript from CLI
- `videoDuration`: Duration in seconds

Returns: Markdown context string

## Migration from Old API

```javascript
// Old (complex):
await startVideoCapture({ apiKey: '...' });

// New (simple):
const data = await captureVideoWithAudio();
const transcript = await cli.transcribeAudio(data.audioPath);
const context = generateContextWithTranscript(data.frames, transcript, data.videoDuration);
```