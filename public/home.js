window.speechSynthesis.cancel();

const video = document.getElementById("video");

var calibration_mode = true;
let detections = [];

// eyes
var eyesLastOpenedTime = new Date();
var SHUT_EYE_THRESHOLD = 0.285;
var minEAR = Infinity;
var maxEAR = 0;
var eyesClosedStartTime = 0;
var eyesClosedTime = 0;
var bothEyesClosed = false;
let lastCloseYourEyesTime = 0;
let relaxedThreshold = false;

// music
let startTime = 0;
let currentPosition = 0;
var synth = new SpeechSynthesisUtterance();
synth.rate = 1.5;
synth.pitch = 1;

// music setup
let audioContext = null;
let meditationSource = null;
let meditationBuffer = null;

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
          throw new Error('Failed to fetch music files');
      }
      const musicFiles = await response.json();
      return musicFiles;
  } catch (error) {
      console.error('Error listing music files:', error);
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

// Choose a random meditation file
let meditationFile = null; // Default file

// Function to start face detection
async function startFaceDetection() {
  // Wait for video to be ready
  if (video.readyState < 2) {
    await new Promise((resolve) => {
      video.onloadeddata = () => {
        resolve();
      };
    });
  }

  const canvas = faceapi.createCanvasFromMedia(video);
  document.body.append(canvas);
  
  // Set canvas size to match video dimensions
  const displaySize = { width: video.videoWidth, height: video.videoHeight };
  faceapi.matchDimensions(canvas, displaySize);

  // Main detection loop
  setInterval(async () => {
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withFaceExpressions();

    const resizedDetections = faceapi.resizeResults(detections, displaySize);

    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    video.style.filter = 'blur(3px)';
    
    // If faces detected
    if (detections.length > 0) {
      // CALIBRATION MODE
      if (calibration_mode) {
        document.getElementById("title").innerHTML = "blink! blink!";

        faceapi.draw.drawDetections(canvas, resizedDetections);
        faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);

        document.getElementById("bottomNote").innerHTML =
          "<i>TAP or CLICK</i><p>to listen</p> ";
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

        // Update SHUT_EYE_THRESHOLD
        SHUT_EYE_THRESHOLD = Math.max(0.285, minEAR + 0.015);

        ['click', 'touchstart', 'keydown'].forEach(eventType => {
          document.addEventListener(eventType, () => {
            calibration_mode = false;

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

          let bothEyesClosed = isEyeClosed(detections[0].landmarks.getLeftEye(), relaxedThreshold) && isEyeClosed(detections[0].landmarks.getRightEye(), relaxedThreshold);      
          relaxedThreshold = bothEyesClosed;

          // When eyes are closed, play meditation and display color.
          // When eyes are open, stop meditation and display grayscale.
          if (bothEyesClosed) {
            console.log("both eyes closed, playing meditation");

            if (!meditationSource && audioContext && meditationBuffer) {
              meditationSource = playAudio(meditationBuffer, 0.5);
            }

            if (eyesClosedStartTime === 0 && audioContext) {
              eyesClosedStartTime = audioContext.currentTime;
            }
            if (audioContext) {
              eyesClosedTime = audioContext.currentTime - eyesClosedStartTime;
            }
          } else {
            if (eyesClosedStartTime !== 0) {
              currentPosition += eyesClosedTime;
              eyesClosedStartTime = 0;
            }
            console.log("both eyes open, stopping meditation");
            eyesLastOpenedTime = new Date();
            if (meditationSource) {
              stopAudio(meditationSource);
              meditationSource = null;
            }
          }
      }
    }
  }, 100);
}

async function initializeMeditationFile() {
    try {
        const files = await listMusicFiles();
        for (const file of files) {
            let name = file.replace(/.m4a|.wav/, '').replace(/.*Calmfulness - /, '').trim();

            let button = document.createElement('button');
            button.classList.add('meditation-button');
            button.innerText = name;
            button.addEventListener('click', async () => {
                meditationFile = file;

                allVoicesObtained.then((voices) =>
                  say(
                    "Please wait a few seconds for models to load." +
                    " When you see your facial features detected, blink slowly for 5 seconds" +
                    " to help the camera calibrate to your eye shape." +
                    " Then, click or tap any key to toggle calibration mode off."
                  )
                );

                // Hide the buttons after selection
                document.getElementById('meditation-buttons').style.display = 'none';
                // Show the title
                document.getElementById('title').style.display = 'flex';

                // Start face detection after file selection
                await startFaceDetection();

                // Start listening for user interaction only after file is selected
                ['click', 'touchstart', 'keydown'].forEach(eventType => {
                    document.addEventListener(eventType, async () => {
                        if (!audioContext) {
                            console.log("Initializing audio...");
                            await initAudio();
                            console.log("Audio initialization complete");
                        }
                    }, { once: true });
                });
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
        await initializeMeditationFile(); // Wait for file selection
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Disable audio worklets to prevent recording
        if (audioContext.audioWorklet) {
            audioContext.audioWorklet.addModule = () => Promise.reject('Audio worklets disabled');
        }
        
        // Get signed URL for the selected meditation file
        const signedUrl = await getSignedUrl(meditationFile);
        if (!signedUrl) {
            throw new Error('Failed to get signed URL for meditation file');
        }
        
        // Load audio file using signed URL
        const response = await fetch(signedUrl);
        const arrayBuffer = await response.arrayBuffer();
        meditationBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log("Audio initialized successfully");
    } catch (error) {
        console.error("Error initializing audio:", error);
        audioContext = null;
        meditationBuffer = null;
    }
}

// Play audio using Web Audio API
function playAudio(buffer, volume = 0.5) {
    if (!audioContext || !buffer) {
        console.log("Cannot play audio: audioContext or buffer not initialized");
        return null;
    }
    
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    source.buffer = buffer;
    gainNode.gain.value = volume;
    
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Start from current position
    console.log("Starting audio from position:", currentPosition);
    source.start(0, currentPosition);
    
    return { source, gainNode };
}

// Stop audio
function stopAudio(source) {
    if (source) {
        source.source.stop();
    }
}

// Create blob URLs for audio files
async function createAudioBlobURL(audioPath) {
    const response = await fetch(audioPath);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
}
  
// Facial recognition helper functions
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
  
  function likeliestExpression(expressions) {
    // filtering false positive
    const maxValue = Math.max(
      ...Object.values(expressions).filter((value) => value <= 1)
    );
    const expressionsKeys = Object.keys(expressions);
    const mostLikely = expressionsKeys.filter(
      (expression) => expressions[expression] === maxValue
    );
    return mostLikely;
  }

  function say(text) {
    console.log("saying " + text);
  
    synth.rate = 1.3;
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
  // Load models
Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri("models"),
    faceapi.nets.tinyFaceDetector.loadFromUri("models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("models"),
    faceapi.nets.faceExpressionNet.loadFromUri("models"),
]).then(() => {
    startWebcam();
    initializeMeditationFile();
});




