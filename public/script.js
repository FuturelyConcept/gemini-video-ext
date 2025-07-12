const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const videoPreview = document.getElementById('videoPreview');
const statusDiv = document.getElementById('status');
const audioToggle = document.getElementById('audioToggle');

let mediaRecorder;
let recordedChunks = [];
let stream;

// --- Main Functions ---

async function startRecording() {
    try {
        const audioConstraints = audioToggle.checked ? { echoCancellation: true, noiseSuppression: true } : false;

        stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: audioConstraints
        });

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

startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
