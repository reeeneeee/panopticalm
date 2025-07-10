# Panopticalm 😌

A web-based meditation application that uses facial recognition to control audio playback based on eye state.

## How It Works

- **Calibration**: personalizes eye closure detection to your unique eye shape
- **Audio Control via Eye Tracking**: monitors eye closure status to play guided meditations when your eyes are closed, pausing whenever they open

## Tech Stack

- **Frontend**: JavaScript, face-api.js, Web Audio API
- **Backend**: Express.js, AWS S3
- **Computer Vision**: Face landmark detection, eye aspect ratio calculation

## Usage

1. Select a guided meditation track
2. Blink slowly during calibration
3. Close your eyes to begin playing the meditation
4. Open eyes to pause, close to resume
