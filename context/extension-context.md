# Gemini CLI Video Extension Context

This extension provides screen recording capabilities to the Google Gemini CLI, allowing developers to record short video demonstrations and integrate the visual and audio context directly into their Gemini CLI conversations.

## Usage

To start a video recording, type the following command in the Gemini CLI:

`/video`

This will open a recording interface where you can select the capture source (Chrome Tab, Application Window, or Entire Screen) and control audio recording. Recordings are limited to a maximum of 30 seconds.

## Privacy

**CRITICAL PRIVACY GUARANTEES:**
- **Zero Data Transfer**: No video, audio, or extracted data ever leaves your machine.
- **No Cloud Storage**: All processing happens locally on your device.
- **No Tracking**: No user behavior, data, or metadata is collected or transmitted.
- **No API Keys Shared**: The extension uses your existing Gemini CLI configuration.
- **Automatic Cleanup**: Original video files are automatically deleted after processing.
- **Local Processing Only**: Frame extraction and audio transcription happen entirely offline.

## Features

- **Seamless Integration**: Adds video recording as a natural extension to the existing Gemini CLI workflow.
- **Privacy-First Design**: Ensures complete data locality and user privacy protection.
- **Developer-Friendly UX**: Minimal friction for capturing and using video context.
- **Lightweight Processing**: Efficient frame sampling and audio processing.
- **Cross-Platform Support**: Works on Windows, macOS, and Linux.

## Output

After recording and processing, the extracted visual frames and audio transcript will be automatically included in your next Gemini CLI prompt, providing rich context for your conversations.