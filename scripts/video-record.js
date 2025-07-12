#!/usr/bin/env node

// Standalone video recording script for Gemini CLI
// This script runs on-demand, records video, processes it, and exits

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Import the video processing functionality
const extensionPath = path.join(__dirname, '..');
const { startVideoCapture } = require(path.join(extensionPath, 'lib', 'index.js'));

class VideoRecordingCommand {
    constructor() {
        this.tempDir = path.join(extensionPath, 'temp');
        this.ensureTempDir();
    }

    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async execute() {
        console.log('🎥 Starting Gemini CLI Video Recording...');
        console.log('📺 A browser window will open for screen recording');
        console.log('⏱️ Record your issue (max 30 seconds)');
        console.log('🔒 All processing happens locally on your machine');
        console.log('');

        try {
            // Start the video capture process
            console.log('🚀 Launching recording interface...');
            console.log('📱 Browser will open and recording will start automatically');
            console.log('🔔 If browser doesn\'t open, manually visit: http://localhost:8765?autostart=true');
            
            // Give a moment for the server to start, then force open browser
            setTimeout(() => {
                this.forceOpenBrowser();
            }, 2000);
            
            const context = await startVideoCapture();
            
            // Output the context for Gemini CLI to include
            console.log('\n✅ Video recording completed successfully!');
            console.log(`📊 Generated context: ${Math.floor(context.length / 1024)}KB with ${(context.match(/Base64 Image Data/g) || []).length} frames`);
            console.log('📋 Full context with images has been added to your conversation');
            
            // Clean up temp files
            this.cleanup();
            
            console.log('\n🧹 Temporary files cleaned up');
            console.log('💬 Video context is ready for analysis');
            
            // Output the actual context for Gemini CLI (without truncation)
            console.log('\n' + context);
            
            process.exit(0);
            
        } catch (error) {
            console.error('❌ Video recording failed:', error.message);
            console.error('');
            console.error('🔧 Troubleshooting:');
            console.error('- Ensure GEMINI_API_KEY environment variable is set');
            console.error('- Grant microphone and screen recording permissions');
            console.error('- Check that a browser is available');
            
            this.cleanup();
            process.exit(1);
        }
    }

    forceOpenBrowser() {
        const url = 'http://localhost:8765?autostart=true';
        const platform = process.platform;
        
        // Try multiple methods for better compatibility
        const commands = this.getBrowserCommands(url, platform);
        
        this.tryOpenBrowser(commands, 0);
    }

    getBrowserCommands(url, platform) {
        const commands = [];
        
        if (platform === 'darwin') {
            commands.push(`open "${url}"`);
        } else if (platform === 'win32') {
            commands.push(`start "" "${url}"`);
            commands.push(`cmd /c start "${url}"`);
        } else {
            // Linux/WSL - try multiple methods
            commands.push(`xdg-open "${url}"`);
            commands.push(`sensible-browser "${url}"`);
            commands.push(`firefox "${url}"`);
            commands.push(`google-chrome "${url}"`);
            commands.push(`chromium-browser "${url}"`);
            
            // WSL-specific: try Windows commands if in WSL
            if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
                commands.unshift(`cmd.exe /c start "${url}"`);
                commands.unshift(`powershell.exe -c "Start-Process '${url}'"`);
            }
        }
        
        return commands;
    }

    tryOpenBrowser(commands, index) {
        if (index >= commands.length) {
            console.log('⚠️  Could not auto-open browser. Please visit: http://localhost:8765?autostart=true');
            return;
        }

        const command = commands[index];
        exec(command, (error) => {
            if (error) {
                // Try next command
                this.tryOpenBrowser(commands, index + 1);
            } else {
                console.log('🌐 Browser opened successfully');
            }
        });
    }

    cleanup() {
        // Clean up any temporary files
        const extensionPath = path.join(__dirname, '..');
        const uploadsDir = path.join(extensionPath, 'uploads');
        if (fs.existsSync(uploadsDir)) {
            try {
                fs.rmSync(uploadsDir, { recursive: true, force: true });
            } catch (error) {
                console.warn('Warning: Could not clean up uploads directory:', error.message);
            }
        }
    }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
    console.log('\n🛑 Recording cancelled by user');
    process.exit(1);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Recording terminated');
    process.exit(1);
});

// Run the video recording command
if (require.main === module) {
    const recorder = new VideoRecordingCommand();
    recorder.execute();
}

module.exports = { VideoRecordingCommand };