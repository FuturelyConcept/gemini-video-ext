# Gemini Video Extension

This project is a proof-of-concept for a Gemini CLI extension that allows users to record a video of their screen and use it as input for the Gemini API.

## How it works

1.  The user types `/video` in the Gemini CLI (this part is not yet implemented).
2.  This extension starts a local web server and opens a browser window with a recording UI.
3.  The user can record their screen (a specific tab, window, or the entire screen) for up to 30 seconds.
4.  The recorded video is uploaded to the local server.
5.  The server processes the video to extract 10 image frames and transcribe the audio using the Gemini API.
6.  The extracted data (images and text) is saved in the `uploads/` directory.
7.  This data can then be used as input for the Gemini API.

## Requirements

- **Node.js**
- **ffmpeg**: You must have the `ffmpeg` command-line tool installed.
  - On Debian/Ubuntu: `sudo apt update && sudo apt install ffmpeg`
  - On Fedora/CentOS: `sudo dnf install ffmpeg`
  - On macOS (using Homebrew): `brew install ffmpeg`
- **Gemini API Key**: For audio transcription. You can get one from [Google AI Studio](https://ai.google.dev/aistudio).

## How to run

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Set your Gemini API key as an environment variable.
    
    On Linux/macOS:
    ```bash
    export GEMINI_API_KEY='your-api-key-here'
    ```
    On Windows (Command Prompt):
    ```bash
    set GEMINI_API_KEY=your-api-key-here
    ```
    On Windows (PowerShell):
    ```bash
    $env:GEMINI_API_KEY="your-api-key-here"
    ```

3.  Run the server:
    ```bash
    node src/index.js
    ```
4.  This will automatically open a browser window to `http://localhost:3000`. Record your video, and check the console where you ran the command for the output.

## TODO

- [X] Use `ffmpeg` to sample images from the video.
- [X] Use an audio-to-text service to transcribe the audio.
- [ ] Integrate with Gemini CLI as a custom command.
- [ ] Pass the image and text data to the Gemini API.
- [ ] Clean up and package as an `npm` module.
