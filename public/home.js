// Cancel any existing speech synthesis
window.speechSynthesis.cancel();

// Get video element for webcam feed
const video = document.getElementById("video");

// Application state variables
var calibration_mode = true;
let detections = [];

// Eye tracking variables
var eyesLastOpenedTime = new Date();
var SHUT_EYE_THRESHOLD = 0.285;
var minEAR = Infinity;
var maxEAR = 0;
var eyesClosedStartTime = 0;
var eyesClosedTime = 0;
var bothEyesClosed = false;
let lastCloseYourEyesTime = 0;
let relaxedThreshold = false;

// Audio playback variables
let startTime = 0;
let currentPosition = 0;
let lastAudioStartTime = 0; // Track when we last started playing audio

// Speech synthesis setup
var synth = new SpeechSynthesisUtterance();

// Web Audio API setup
let audioContext = null;
let meditationSource = null;
let meditationBuffer = null;

// Wait for speech synthesis voices to be available (required for mobile)
const allVoicesObtained = new Promise(function (resolve, reject) {
  let voices = window.speechSynthesis.getVoices();
  if (voices.length !== 0) {
    resolve(voices);
  } else {
    window.speechSynthesis.addEventListener("voiceschanged", function () {
      voices = window.speechSynthesis.getVoices();
      resolve(voices);
    });
  }
});

// Set the first available voice for speech synthesis
allVoicesObtained.then((voices) => (synth.voice = voices[0]));

// Prevent right-click and keyboard shortcuts
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 's' || e.key === 'u' || e.key === 'c') {
            e.preventDefault();
        }
    }
});

// Function to list music files
async function listMusicFiles() {
  try {
      const response = await fetch('/api/music');
      if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('Server error response:', errorData);
          throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
      }
      const musicFiles = await response.json();
      return musicFiles;
  } catch (error) {
      console.error('Error listing music files:', error);
      // Show error to user
      const errorMessage = error.message || 'Failed to load music files';
      document.getElementById('meditation-buttons').innerHTML = `
        <div style="color: #ff6b6b; text-align: center; padding: 20px; background: rgba(255, 107, 107, 0.1); border-radius: 8px;">
          <h3>⚠️ Error Loading Music</h3>
          <p>${errorMessage}</p>
          <p><small>Please check your S3 configuration and try refreshing the page.</small></p>
        </div>
      `;
      return [];
  }
}

// Function to get signed URL for a music file
async function getSignedUrl(filename) {
  try {
      const response = await fetch(`/api/music/${filename}`);
      if (!response.ok) {
          throw new Error('Failed to get signed URL');
      }
      const data = await response.json();
      return data.url;
  } catch (error) {
      console.error('Error getting signed URL:', error);
      return null;
  }
}

// Selected meditation audio file from S3
let meditationFile = null;

// Initialize face detection and start the main application loop
async function startFaceDetection() {
  // Wait for video to be ready
  if (video.readyState < 2) {
    await new Promise((resolve) => {
      video.onloadeddata = () => {
        resolve();
      };
    });
  }

  // Create canvas overlay for drawing face detection results
  const canvas = faceapi.createCanvasFromMedia(video);
  document.body.append(canvas);
  
  // Scale canvas to match video dimensions for accurate overlay
  const displaySize = { width: video.videoWidth, height: video.videoHeight };
  faceapi.matchDimensions(canvas, displaySize);

  // Main face detection loop - runs every 100ms
  setInterval(async () => {
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withFaceExpressions();

    const resizedDetections = faceapi.resizeResults(detections, displaySize);

    // Clear previous frame's drawings and apply video blur
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    video.style.filter = 'blur(3px)';
    
    // Process face detection results
    if (detections.length > 0) {
      // CALIBRATION MODE
      if (calibration_mode) {
        document.getElementById("title").innerHTML = "blink! blink!";

        faceapi.draw.drawDetections(canvas, resizedDetections);
        faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);

        document.getElementById("bottomNote").innerHTML =
          "<i>TAP or CLICK</i><p>to listen</p> ";
        
        // Track min/max Eye Aspect Ratio during calibration
        minEAR = Math.min(
          minEAR,
          ear(detections[0].landmarks.getLeftEye()),
          ear(detections[0].landmarks.getRightEye())
        );
        maxEAR = Math.max(
          maxEAR,
          ear(detections[0].landmarks.getLeftEye()),
          ear(detections[0].landmarks.getRightEye())
        );

        // Update SHUT_EYE_THRESHOLD based on user's eye shape
        SHUT_EYE_THRESHOLD = Math.max(0.285, minEAR + 0.015);

        // Listen for user interaction to exit calibration mode
        ['click', 'touchstart', 'keydown'].forEach(eventType => {
          document.addEventListener(eventType, () => {
            calibration_mode = false; // Switch to listening mode

            var element = document.body;
            element.classList.remove("dark-mode");
            document.getElementById("title").innerHTML = "close your eyes";
          });
        });
      } 
      // LISTENING MODE
      else {
          window.speechSynthesis.cancel();
          document.getElementById("bottomNote").innerHTML = "";
          document.getElementById("title").innerHTML = "close your eyes";

          // Check if both eyes are closed
          let bothEyesClosed = isEyeClosed(detections[0].landmarks.getLeftEye(), relaxedThreshold) && isEyeClosed(detections[0].landmarks.getRightEye(), relaxedThreshold);      
          relaxedThreshold = bothEyesClosed; // Allow slightly relaxed threshold after first closure

          // When eyes are closed, play meditation and display color.
          // When eyes are open, stop meditation and display grayscale.
          if ((bothEyesClosed && currentPosition < meditationBuffer.duration) || currentPosition > 5*60*1000) {
            console.log("both eyes closed, playing meditation from " + currentPosition);
            video.style.filter = 'grayscale(0%) blur(3px)';
            document.getElementById("title").style.visibility = "hidden";
            
            if (!meditationSource && audioContext && meditationBuffer) {
                //console.log("Creating new audio source, audioContext state:", audioContext.state);
                meditationSource = playAudio(meditationBuffer, currentPosition, 0.5);
                lastAudioStartTime = audioContext.currentTime; // Record when we started playing
            } else if (!audioContext) {
                console.log("Audio context not initialized");
            } else if (!meditationBuffer) {
                console.log("Meditation buffer not loaded");
            } else if (meditationSource) {
                // Audio is already playing, no need to do anything
            }

            if (eyesClosedStartTime === 0 && audioContext) {
                eyesClosedStartTime = audioContext.currentTime;
            }

            if (audioContext) {
                eyesClosedTime = audioContext.currentTime - eyesClosedStartTime;
            }
          } else {
              if (meditationSource) {
                  // Calculate the current position in the audio buffer
                  const elapsedTime = audioContext.currentTime - lastAudioStartTime;
                  currentPosition = Math.min(currentPosition + elapsedTime, meditationBuffer.duration);
                  console.log("eyes open, stopping meditation at " + currentPosition);
                  
                  stopAudio(meditationSource);
                  meditationSource = null;
              }
              video.style.filter = 'grayscale(100%) blur(3px)';
              document.getElementById("title").style.visibility = "visible";
              eyesLastOpenedTime = new Date();
          }
      }
    }
  }, 100);
}

async function initializeMeditationFiles() {
    try {
        const files = await listMusicFiles();
        for (const file of files) {
            let name = file.replace(/.m4a|.wav/, '').replace(/.*Calmfulness - /, '').trim();

            let button = document.createElement('button');
            button.classList.add('meditation-button');
            button.innerText = name.replace(' no music', '').replace(' music', ' 🎵')
            button.addEventListener('click', async () => {
                meditationFile = file;

                // Hide the buttons after selection
                document.getElementById('meditation-buttons').style.display = 'none';
                // Show the title
                document.getElementById('title').style.display = 'flex';
                document.getElementById("title").style.visibility = "visible";
     
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                console.log("Mobile detection result:", isMobile);
                console.log("User agent:", navigator.userAgent);

                if (isMobile) {
                    console.log("isMobile");
                    console.log("User agent:", navigator.userAgent);
                    // Show mobile-specific message
                    document.getElementById('title').innerHTML = "<p><i>It looks like you're on a mobile device.</i></p><p>Pop in some headphones 🎧<br>then, TAP or CLICK to continue</p>";
                    document.getElementById('title').style.fontSize = '24px';
                    document.getElementById('title').classList.add('ready-message');
                    video.style.filter = 'grayscale(100%) blur(3px)';
                    
                    // Debug title element
                    const titleElement = document.getElementById('title');

                    // Wait for user interaction before proceeding
                    await new Promise((resolve) => {
                        const handleInteraction = async (event) => {
                            // Only proceed if the interaction is not on a meditation button
                            if (event.target && event.target.classList.contains('meditation-button')) {
                                console.log("Ignoring interaction on meditation button");
                                return;
                            }
                            
                            console.log("Valid user interaction detected, proceeding...");
                            
                            // Remove event listeners
                            ['click', 'touchstart', 'keydown'].forEach(eventType => {
                                document.removeEventListener(eventType, handleInteraction);
                            });
                            
                            allVoicesObtained.then((voices) =>
                              say(
                                "Please wait a few seconds for models to load." +
                                " When you see your facial features detected, blink slowly for 5 seconds" +
                                " to help the camera calibrate to your eye shape." +
                                " Then, click or tap any key to toggle calibration mode off."
                              )
                            );

                            // Change message to indicate loading
                            video.style.filter = 'grayscale(0%) blur(3px)';
                            titleElement.style.fontSize = isMobile ? '32px' : '60px';
                            titleElement.innerHTML = 'W A I T<p>for models to load</p>';
                            titleElement.classList.remove('ready-message');
                            titleElement.classList.add('pulse');
                            
                            // Initialize audio
                            if (!audioContext) {
                                console.log("Initializing audio...");
                                try {
                                    await initAudio();
                                    console.log("Audio initialization complete");
                                } catch (error) {
                                    console.error("Failed to initialize audio:", error);
                                }
                            }
                            
                            resolve();
                        };
                        
                        // Add event listeners for user interaction
                        ['click', 'touchstart', 'keydown'].forEach(eventType => {
                            document.addEventListener(eventType, handleInteraction, { once: false });
                        });
                    });
                } else {
                    // Desktop: proceed normally
                    document.getElementById('title').innerHTML = 'W A I T';
                    
                    allVoicesObtained.then((voices) =>
                      say(
                        "Please wait a few seconds for models to load." +
                        " When you see your facial features detected, blink slowly for 5 seconds" +
                        " to help the camera calibrate to your eye shape." +
                        " Then, click or tap any key to toggle calibration mode off."
                      )
                    );
                    
                    // Start listening for user interaction to initialize audio
                    ['click', 'touchstart', 'keydown'].forEach(eventType => {
                        document.addEventListener(eventType, async () => {
                            if (!audioContext) {
                                console.log("Initializing audio...");
                                try {
                                    await initAudio();
                                    console.log("Audio initialization complete");
                                } catch (error) {
                                    console.error("Failed to initialize audio:", error);
                                }
                            }
                        }, { once: true });
                    });
                }

                // Start face detection after file selection
                await startFaceDetection();
            });
            document.getElementById('meditation-buttons').appendChild(button);
        }
    } catch (error) {
        console.error("Error selecting meditation file:", error);
    }
}

// Initialize Web Audio API
async function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Resume audio context (required for mobile browsers)
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        // Disable audio worklets to prevent recording
        if (audioContext.audioWorklet) {
            audioContext.audioWorklet.addModule = () => Promise.reject('Audio worklets disabled');
        }
        
        // Use proxy endpoint to avoid CORS issues
        const encodedFilename = encodeURIComponent(meditationFile);
        console.log("Loading audio file from S3 via proxy:", meditationFile);
        
        const [meditationResponse] = await Promise.all([
          fetch(`/music/${encodedFilename}`)
        ]);
        
        if (!meditationResponse.ok) {
            throw new Error(`Failed to load audio file from S3: ${meditationResponse.status} ${meditationResponse.statusText}`);
        }
        
        const [meditationArrayBuffer] = await Promise.all([
            meditationResponse.arrayBuffer()
        ]);
        meditationBuffer = await audioContext.decodeAudioData(meditationArrayBuffer);
        console.log("Audio initialized successfully, buffer duration:", meditationBuffer.duration);
    } catch (error) {
        console.error("Error initializing audio:", error);
        audioContext = null;
        meditationBuffer = null;
    }
}

// Play audio using Web Audio API
function playAudio(buffer, position = 0, volume = 0.5) {
    if (!audioContext || !buffer) {
        console.log("Cannot play audio: audioContext or buffer not initialized");
        return null;
    }
    
    // Ensure audio context is running (required for mobile)
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log("Audio context resumed");
        }).catch(error => {
            console.error("Failed to resume audio context:", error);
        });
    }
    
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    source.buffer = buffer;
    gainNode.gain.value = volume;
    
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Start from current position
    console.log("Starting audio from position:",  position, "buffer duration:", buffer.duration);
    try {
        source.start(0, position);
        // console.log("Audio started successfully");
    } catch (error) {
        console.error("Failed to start audio:", error);
        return null;
    }
    
    return { source, gainNode };
}

// Stop audio
function stopAudio(source) {
    if (source) {
        source.source.stop();
    }
}

// Eye Aspect Ratio calculation
function ear(eyeLandmarks) {
    const A = Math.hypot(
      eyeLandmarks[5]._x - eyeLandmarks[1]._x,
      eyeLandmarks[5]._y - eyeLandmarks[1]._y,
      2
    );
  
    const B = Math.sqrt(
      Math.pow(eyeLandmarks[4]._x - eyeLandmarks[2]._x, 2) +
        Math.pow(eyeLandmarks[4]._y - eyeLandmarks[2]._y, 2)
    );
  
    const C = Math.sqrt(
      Math.pow(eyeLandmarks[0]._x - eyeLandmarks[3]._x, 2) +
        Math.pow(eyeLandmarks[0]._y - eyeLandmarks[3]._y, 2)
    );
  
    return (A + B) / (2.0 * C);
  }
  
  function isEyeClosed(eyeLandmarks, relaxed = false) {
    return ear(eyeLandmarks) < SHUT_EYE_THRESHOLD + relaxed * 0.015;
  }

  function say(text) {
    console.log("saying " + text);
  
    synth.rate = 1.5;
    synth.pitch = 1;
    synth.volume = 0.4;
    synth.text = text;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(synth);
  }

  function startWebcam() {
    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        },
        audio: false,
      })
      .then((stream) => {
        video.srcObject = stream;
        // Wait for video to be ready
        return new Promise((resolve) => {
          video.onloadedmetadata = () => {
            resolve();
          };
        });
      })
      .catch((error) => {
        console.error(error);
      });
  }
  
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

// Once models are loaded, start webcam and load meditation files 
Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri("models"),
    faceapi.nets.tinyFaceDetector.loadFromUri("models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("models"),
    faceapi.nets.faceExpressionNet.loadFromUri("models"),
]).then(() => {
    startWebcam();
    initializeMeditationFiles();
});



