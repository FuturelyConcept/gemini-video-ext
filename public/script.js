const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const videoPreview = document.getElementById('videoPreview');
const statusDiv = document.getElementById('status');
const audioToggle = document.getElementById('audioToggle');
const testMicBtn = document.getElementById('testMicBtn');
const micStatus = document.getElementById('micStatus');

let mediaRecorder;
let recordedChunks = [];
let stream;

// --- Main Functions ---

async function startRecording() {
    try {
        statusDiv.textContent = `Starting screen recording${audioToggle.checked ? ' with microphone' : ''}...`;

        // Get screen video
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: false  // We'll get audio from microphone instead
        });

        let combinedStream = displayStream;

        // Add microphone audio if enabled
        if (audioToggle.checked) {
            try {
                const micStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: { 
                        echoCancellation: true, 
                        noiseSuppression: true,
                        autoGainControl: true,
                        sampleRate: 48000
                    } 
                });
                
                // Combine video from display and audio from microphone
                const videoTrack = displayStream.getVideoTracks()[0];
                const audioTrack = micStream.getAudioTracks()[0];
                
                combinedStream = new MediaStream([videoTrack, audioTrack]);
                
                console.log('Combined stream created with video + microphone audio');
            } catch (micError) {
                console.error('Microphone access failed:', micError);
                statusDiv.textContent = 'Microphone access denied. Recording video only.';
                combinedStream = displayStream; // Fallback to video-only
            }
        }

        stream = combinedStream;

        console.log(`Audio tracks captured: ${stream.getAudioTracks().length}`);
        
        // Debug audio track details
        stream.getAudioTracks().forEach((track, index) => {
            console.log(`Audio track ${index}:`, {
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState,
                settings: track.getSettings(),
                constraints: track.getConstraints()
            });
        });

        if (audioToggle.checked && stream.getAudioTracks().length === 0) {
            statusDiv.textContent = `Warning: Audio was requested but no audio track was captured. Please ensure "Share system audio" or "Share tab audio" was selected.`;
            console.warn(`Audio was requested but no audio track was captured.`);
        } else if (audioToggle.checked) {
            statusDiv.textContent = `Recording with audio...`;
            // Add audio level monitoring
            monitorAudioLevel(stream);
        } else {
            statusDiv.textContent = `Recording without audio...`;
        }

        videoPreview.srcObject = stream;
        updateUIForRecording(true);

        // Handle user stopping recording via browser UI
        stream.getVideoTracks()[0].onended = () => {
            stopRecording();
        };

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            recordedChunks = [];
            uploadVideo(blob);
            stream.getTracks().forEach(track => track.stop());
            videoPreview.srcObject = null;
            updateUIForRecording(false);
        };

        mediaRecorder.start();
        
        // Automatically stop recording after 30 seconds
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                stopRecording();
            }
        }, 30000);

    } catch (err) {
        console.error("Error starting recording:", err);
        statusDiv.textContent = 'Error: Could not start recording. Please allow screen sharing.';
        updateUIForRecording(false);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}

function uploadVideo(blob) {
    statusDiv.textContent = 'Uploading and processing...';
    const formData = new FormData();
    formData.append('video', blob, 'recording.webm');

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Upload successful:', data);
        statusDiv.textContent = 'Processing complete! You can close this window.';
    })
    .catch(err => {
        console.error('Error uploading video:', err);
        statusDiv.textContent = `Error: ${err.message}. Please check the console.`;
    });
}

// --- UI and Event Listeners ---

function updateUIForRecording(isRecording) {
    if (isRecording) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusDiv.textContent = 'Recording...';
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        statusDiv.textContent = 'Stopped. Waiting for processing...';
    }
}

function monitorAudioLevel(stream) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    microphone.connect(analyser);
    analyser.fftSize = 256;

    function checkAudioLevel() {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        
        if (average > 0) {
            console.log(`Audio level detected: ${average.toFixed(2)}`);
        } else {
            console.log('No audio signal detected');
        }
        
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            setTimeout(checkAudioLevel, 1000); // Check every second
        }
    }
    
    setTimeout(checkAudioLevel, 1000); // Start checking after 1 second
}

async function testMicrophone() {
    try {
        micStatus.textContent = 'Testing microphone access...';
        
        // List available audio devices first
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        console.log('Available audio input devices:', audioInputs);
        
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Test actual microphone audio levels
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(micStream);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        microphone.connect(analyser);
        analyser.fftSize = 256;

        let maxLevel = 0;
        let testCount = 0;
        
        function checkLevel() {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            maxLevel = Math.max(maxLevel, average);
            testCount++;
            
            if (testCount < 30) { // Test for 3 seconds
                setTimeout(checkLevel, 100);
            } else {
                micStream.getTracks().forEach(track => track.stop());
                audioContext.close();
                
                if (maxLevel > 5) {
                    micStatus.textContent = `✅ Microphone working! Max level: ${maxLevel.toFixed(1)}`;
                    micStatus.style.color = 'green';
                } else {
                    micStatus.textContent = `❌ Microphone silent. Max level: ${maxLevel.toFixed(1)}`;
                    micStatus.style.color = 'red';
                }
            }
        }
        
        micStatus.textContent = '🎤 Speak now to test microphone (3 seconds)...';
        micStatus.style.color = 'blue';
        setTimeout(checkLevel, 100);
        
    } catch (error) {
        micStatus.textContent = `❌ Microphone access denied: ${error.message}`;
        micStatus.style.color = 'red';
    }
}

startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
testMicBtn.addEventListener('click', testMicrophone);
