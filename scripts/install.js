#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

class ExtensionInstaller {
    constructor() {
        this.homeDir = os.homedir();
        this.workspaceDir = process.cwd();
        this.extensionName = 'gemini-video-ext';
        this.sourceDir = path.resolve(__dirname, '..');
    }

    getInstallDirectory() {
        // Always use home directory for Gemini CLI extensions
        const homeExtensionsDir = path.join(this.homeDir, '.gemini', 'extensions');
        return path.join(homeExtensionsDir, this.extensionName);
    }

    ensureDirectoryExists(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Created directory: ${dir}`);
        }
    }

    copyExtensionFiles(targetDir) {
        console.log(`Installing extension to: ${targetDir}`);
        
        // Remove existing installation
        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
            console.log('Removed existing installation');
        }
        
        this.ensureDirectoryExists(targetDir);
        
        // Copy essential files
        const filesToCopy = [
            'package.json',
            'gemini-extension.json',
            'lib/',
            'public/',
            'context/',
            'scripts/',
            'README.md'
        ];
        
        for (const file of filesToCopy) {
            const sourcePath = path.join(this.sourceDir, file);
            const targetPath = path.join(targetDir, file);
            
            if (fs.existsSync(sourcePath)) {
                const stat = fs.statSync(sourcePath);
                if (stat.isDirectory()) {
                    this.copyDirectory(sourcePath, targetPath);
                } else {
                    fs.copyFileSync(sourcePath, targetPath);
                }
                console.log(`Copied: ${file}`);
            }
        }
        
        // Update gemini-extension.json with absolute paths
        this.updateExtensionConfig(targetDir);
    }

    updateExtensionConfig(targetDir) {
        const configPath = path.join(targetDir, 'gemini-extension.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            
            // Update MCP server command with absolute path
            if (config.mcpServers && config.mcpServers['video-server']) {
                config.mcpServers['video-server'] = {
                    command: `node ${path.join(targetDir, 'lib/mcp-server.js')}`,
                    cwd: targetDir
                };
            }
            
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            console.log('Updated extension configuration with absolute paths');
        }
    }

    copyDirectory(source, target) {
        this.ensureDirectoryExists(target);
        const files = fs.readdirSync(source);
        
        for (const file of files) {
            const sourcePath = path.join(source, file);
            const targetPath = path.join(target, file);
            const stat = fs.statSync(sourcePath);
            
            if (stat.isDirectory()) {
                this.copyDirectory(sourcePath, targetPath);
            } else {
                fs.copyFileSync(sourcePath, targetPath);
                // Make scripts executable
                if (file.endsWith('.js') && target.includes('scripts')) {
                    fs.chmodSync(targetPath, 0o755);
                }
                console.log(`  Copied file: ${file}`);
            }
        }
    }

    installDependencies(targetDir) {
        console.log('Installing dependencies...');
        try {
            process.chdir(targetDir);
            execSync('npm install --production', { stdio: 'inherit' });
            console.log('Dependencies installed successfully');
        } catch (error) {
            console.error('Failed to install dependencies:', error.message);
            throw error;
        }
    }

    validateInstallation(targetDir) {
        const requiredFiles = [
            'package.json',
            'gemini-extension.json',
            'lib/index.js',
            'lib/mcp-server.js',
            'context/extension-context.md'
        ];
        
        for (const file of requiredFiles) {
            const filePath = path.join(targetDir, file);
            if (!fs.existsSync(filePath)) {
                throw new Error(`Required file missing: ${file}`);
            }
        }
        
        console.log('Installation validation passed');
    }

    installInstructions(targetDir) {
        // Install GEMINI.md instructions for /video command
        const geminiDir = path.join(this.homeDir, '.gemini');
        const instructionsPath = path.join(geminiDir, 'GEMINI.md');
        
        this.ensureDirectoryExists(geminiDir);
        
        const instructions = `# Gemini CLI Video Extension

## Custom Commands

### /video Command
When the user types "/video", execute the following workflow:

1. **Start Video Recording**: Use the shell command \`node ${targetDir}/scripts/video-record.js\` to begin screen recording
2. **Process Recording**: The script will automatically:
   - Open browser recording interface
   - Record screen + audio (max 30 seconds)
   - Extract frames and transcribe audio
   - Generate structured context
3. **Return Context**: Include the processed video context in the conversation
4. **Clean Up**: Automatically delete temporary files for privacy

## Video Recording Capabilities

This extension provides privacy-first screen recording for development assistance:
- **Screen + Audio Capture**: Records screen activity with voice narration  
- **Smart Frame Extraction**: Extracts key frames at 3-second intervals
- **Timestamped Transcription**: Correlates audio with visual frames
- **Local Processing**: All data stays on your machine
- **Automatic Cleanup**: Original files deleted after processing

## Usage Examples

\`\`\`
User: /video
Assistant: I'll start the video recording for you.
[Executes recording workflow]
[Returns with visual context and transcribed explanation]
\`\`\`

## Privacy Guarantees

- No data leaves your machine except for audio transcription via Gemini API
- Original video files are automatically deleted
- Processing happens entirely locally
- No persistent servers or background processes
`;

        fs.writeFileSync(instructionsPath, instructions);
        console.log('📋 Installed GEMINI.md instructions for /video command');
    }

    async install() {
        try {
            console.log('🎥 Installing Gemini Video Extension...');
            
            const targetDir = this.getInstallDirectory();
            
            // Copy extension files
            this.copyExtensionFiles(targetDir);
            
            // Install dependencies
            this.installDependencies(targetDir);
            
            // Validate installation
            this.validateInstallation(targetDir);
            
            console.log('✅ Extension installed successfully!');
            console.log(`📂 Installation directory: ${targetDir}`);
            console.log('');
            console.log('🚀 Usage:');
            console.log('1. Set your GEMINI_API_KEY environment variable');
            console.log('2. Start Gemini CLI');
            console.log('3. Type "/video" to start recording');
            console.log('4. Record your screen and voice (max 30 seconds)');
            console.log('5. Context will be automatically added to your conversation');
            console.log('');
            console.log('🔒 Privacy: All processing happens locally on your machine');
            
            // Install GEMINI.md instructions
            this.installInstructions(targetDir);
            
        } catch (error) {
            console.error('❌ Installation failed:', error.message);
            process.exit(1);
        }
    }
}

// Run the installer
if (require.main === module) {
    const installer = new ExtensionInstaller();
    installer.install();
}

module.exports = { ExtensionInstaller };