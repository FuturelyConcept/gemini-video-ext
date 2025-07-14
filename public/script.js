const videoPreview = document.getElementById('videoPreview');
const statusDiv = document.getElementById('status');
const audioToggle = document.getElementById('audioToggle');
const micStatus = document.getElementById('micStatus');

let mediaRecorder;
let recordedChunks = [];
let stream;
let recordingStartTime;
let timerInterval;

// Auto-start if URL parameter is present
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('autostart') === 'true') {
    // Show recording interface and auto-start
    showRecordingInterface();
    setTimeout(() => {
        startRecording();
    }, 1000);
}

function showRecordingInterface() {
    document.getElementById('main-content').querySelector('.popup-message').style.display = 'none';
    document.getElementById('recording-status').style.display = 'block';
}

function updateTimer() {
    if (recordingStartTime) {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const timerDisplay = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        const timerElement = document.getElementById('timer');
        if (timerElement) {
            timerElement.textContent = timerDisplay;
        }
        
        // Update page title with timer
        document.title = `Recording ${timerDisplay} - Gemini Video Recorder`;
    }
}

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
        
        // Start timer
        recordingStartTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
        updateTimer(); // Initial update
        
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
    
    // Clear timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    recordingStartTime = null;
    document.title = 'Gemini Video Recorder';
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
        statusDiv.textContent = 'Recording in progress...';
    } else {
        statusDiv.textContent = 'Recording stopped. Processing...';
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

// testMicrophone function removed - no longer needed without test button

// Event listeners removed - recording is controlled automatically by popup
