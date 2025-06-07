window.speechSynthesis.cancel();

const video = document.getElementById("video");

let userinteraction = 0;
var eyesFirstClosedTime = -1;
var eyesLastOpenedTime = new Date();
var SHUT_EYE_THRESHOLD = 0.285;
var calibration_mode = true;
var calibrationExplained = false;
var readyToListen = false;
var soundOn = true;
let detections = [];
var eyesClosedStartTime = 0;
var eyesClosedTime = 0;
var bothEyesClosed = false;
var minEAR = Infinity;
var maxEAR = 0;
var synth = new SpeechSynthesisUtterance();
let startTime = 0;
let currentPosition = 0;
let lastCloseYourEyesTime = 0;
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

// Initialize Web Audio API
async function initAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Disable audio worklets to prevent recording
    if (audioContext.audioWorklet) {
        audioContext.audioWorklet.addModule = () => Promise.reject('Audio worklets disabled');
    }
    
    // Load audio files
    const [meditationResponse] = await Promise.all([
        fetch('./music/Calmfulness - Sprite - Beck Bennett.m4a')
    ]);
    
    const [meditationArrayBuffer] = await Promise.all([
        meditationResponse.arrayBuffer()
    ]);
    
    meditationBuffer = await audioContext.decodeAudioData(meditationArrayBuffer);
}

// Play audio using Web Audio API
function playAudio(buffer, volume = 0.5) {
    if (!audioContext || !buffer) return;
    
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
  
// Initialize audio with blob URLs
async function initializeAudio() {
    const meditationBlobURL = await createAudioBlobURL('./music/Calmfulness - Sprite - Beck Bennett.m4a');
    meditation_audio.src = meditationBlobURL;
}

//initializeAudio();

  
// Initialize audio when user interacts with the page
document.addEventListener('click', async () => {
    if (!audioContext) {
        await initAudio();
    }
}, { once: true });

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
  
    synth.rate = 1.2;
    synth.pitch = 1;
    synth.volume = 0.4;
    synth.text = text;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(synth);
  }

  function startWebcam() {
    navigator.mediaDevices
      .getUserMedia({
        video: true,
        audio: false,
      })
      .then((stream) => {
        video.srcObject = stream;
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
]).then(startWebcam);

allVoicesObtained.then((voices) =>
  say(
    "Please wait a few seconds for models to load." +
    " When you see your facial features detected, blink slowly for 5 seconds" +
    " to help the camera calibrate to your eye shape." +
    " Then, click or tap any key to toggle calibration mode off."
  )
);

video.addEventListener("play", async () => {
  const canvas = faceapi.createCanvasFromMedia(video);
  document.body.append(canvas);
  faceapi.matchDimensions(canvas, { height: video.height, width: video.width });

  setInterval(async () => {
    detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withFaceExpressions();

    const resizedDetections = faceapi.resizeResults(detections, {
      height: video.height,
      width: video.width,
    });

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

        // console.log("minEAR", minEAR);
        // console.log("maxEAR", maxEAR);e

        // let bothEyesClosed = isEyeClosed(detections[0].landmarks.getLeftEye()) && isEyeClosed(detections[0].landmarks.getRightEye());
        // if (!synth.speaking && bothEyesClosed) {
        //     say("closed");
        // }

        // Update SHUT_EYE_THRESHOLD
        SHUT_EYE_THRESHOLD = Math.max(0.285, minEAR + 0.015);

        "click touchstart keydown".split(" ").forEach(function (e) {
          document.addEventListener(e, () => {
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

          
          let bothEyesClosed = isEyeClosed(detections[0].landmarks.getLeftEye()) && isEyeClosed(detections[0].landmarks.getRightEye());      
          let relaxedThreshold = bothEyesClosed;

          // When eyes are (really) closed, play meditation and display color.
          // When eyes are open, stop meditation and display grayscale.
          if (bothEyesClosed) {
            if (!meditationSource) {
              meditationSource = playAudio(meditationBuffer, 0.5);
            }

            if (eyesClosedStartTime == 0) {
              eyesClosedStartTime = audioContext.currentTime;
            }
            eyesClosedTime = audioContext.currentTime - eyesClosedStartTime;
          } else {
            if (eyesClosedStartTime != 0) {
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

});






