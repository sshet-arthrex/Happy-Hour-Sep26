// ============================================================
// RHYTHM MATCH
// A single-button rhythm memory game
// ============================================================

const actionButton = document.getElementById("actionButton");
const beatCircle = document.getElementById("beatCircle");
const beatMarkers = document.getElementById("beatMarkers");
const playhead = document.getElementById("playhead");
const nextRoundButton = document.getElementById("nextRoundButton");

const roundDisplay = document.getElementById("round");
const scoreDisplay = document.getElementById("score");
const scoreTableBody = document.getElementById("scoreTableBody");

// ------------------------------------------------------------
// Game configuration
// ------------------------------------------------------------

const sequencesListHC = [

  // Easy Difficulty
  "1000 1000 1000 1000",
  "1000 1000 1010 1000",
  "1000 1010 1000 1010",
  "1010 1000 1010 1000",
  "1010 0100 1010 0100",
  "1010 1010 1000 1000",
  "101010 0010101010",
  "10010010 10010010",
  
  // Medium Difficulty
  
  "1010 0110 1010 0110",
  "1001 1010 1001 1010",
  "1011 0101 0110 1000",
  "1101 0100 1101 0100",
  "11011010 1101101",
  "110 110 110 1010",
  "110 110 10 1010 1010",
  "1010 1110 1010 1110",
  
  // Hard Difficulty
  "1011 1011 1011 1010",
  "1100 1100 1100 1100",
  "1100 1000 1100 1000",
  "1000 1100 1010 1100",
  "1001 0100 1100 1010",
  "1000 1010 1100 1010",
  "1001 1001 0101 1000",
  "1000 0000 1000 0000 1000",
  "1000 0000 0000 0000 1000",

];


const CONFIG = {
  startingBeats: 4,
  beatDuration: 450,
  minGap: 450,
  maxGap: 1000,
  leadIn: 1000,
  // Tolerances are fractions of the expected gap, so faster rhythms
  // (smaller gaps) demand tighter timing than slower ones.
  perfectToleranceRatio: 0.35,
  timingToleranceRatio: 0.75,
  roundsToWin: sequencesListHC.length,
};

// Point value awarded per beat, keyed by its scored rating.
const BEAT_POINTS = { missed: 0, good: 1, perfect: 2 };

// ------------------------------------------------------------
// Game state
// ------------------------------------------------------------

let audioContext = null;

let gameState = "idle";
// idle -> showing -> ready -> input -> result -> showing...

let round = 1;
let score = 0;

let rhythm = [];
let playerRhythm = [];

// The base interval (tempo) the current rhythm's gaps are multiples of.
let rhythmInterval = 0;

let sequenceStartTime = 0;
let turnStartTime = 0;
let showingTimer = null;
let inputTimer = null;

// Timeline animation
let beatTimes = [];
let timelineDuration = 1;
let markerElements = [];
let playheadFrame = null;

// Padding after the last beat so it is not flush with the edge.
const TIMELINE_TAIL = 400;

// ------------------------------------------------------------
// Audio
// ------------------------------------------------------------

function initAudio() {
  if (!audioContext) {
    audioContext = new (
      window.AudioContext ||
      window.webkitAudioContext
    )();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
}

function playBeat(strong = false) {
  if (!audioContext) return;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = "sine";

  // Higher pitch for the first beat.
  oscillator.frequency.value = strong ? 880 : 600;

  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.35,
    audioContext.currentTime + 0.01
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    audioContext.currentTime + 0.12
  );

  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.15);
}

// ------------------------------------------------------------
// Visual feedback
// ------------------------------------------------------------

function flashBeat(type = "active") {
  beatCircle.classList.remove("active", "player");

  // Force a reflow so the animation can restart.
  void beatCircle.offsetWidth;

  beatCircle.classList.add(type);

  setTimeout(() => {
    beatCircle.classList.remove(type);
  }, 150);
}

// ------------------------------------------------------------
// Timeline
// ------------------------------------------------------------

// [ lead_in, lead_in+g1, lead_in+g1+g2, ...]
function computeBeatTimes(sequence) {
  const times = [];

  // The sequence starts with silence so the first beat is anticipated.
  let elapsed = CONFIG.leadIn;

  sequence.forEach((gap, index) => {
    times.push(elapsed);

    // The gap at index i is the wait before the next beat.
    if (index < sequence.length - 1) {
      elapsed += gap;
    }
  });

  return times;
}

function clearTimeline() {
  beatMarkers.innerHTML = "";
  beatMarkers.classList.remove("markers-hidden");
  markerElements = [];
}

function addMarker(time, type) {
  const marker = document.createElement("div");
  marker.className = `beat-marker ${type}`;

  const position = Math.min(time / timelineDuration, 1) * 100;
  marker.style.left = `${position}%`;

  beatMarkers.appendChild(marker);

  return marker;
}

function buildSourceTimeline() {
  clearTimeline();

  markerElements = beatTimes.map((time) => addMarker(time, ""));
}

function startPlayhead() {
  stopPlayhead();

  const start = performance.now();

  playhead.classList.add("running");

  const step = (now) => {
    const progress = Math.min((now - start) / timelineDuration, 1);

    playhead.style.left = `calc(12px + ${progress} * (100% - 24px))`;

    if (progress < 1) {
      playheadFrame = requestAnimationFrame(step);
    } else {
      playheadFrame = null;
    }
  };

  playheadFrame = requestAnimationFrame(step);
}

function stopPlayhead() {
  if (playheadFrame !== null) {
    cancelAnimationFrame(playheadFrame);
    playheadFrame = null;
  }

  playhead.classList.remove("running");
  playhead.style.left = "12px";
}

// ------------------------------------------------------------
// Generate a rhythm from a beat squence
// ------------------------------------------------------------

function decode_key(key) {
  const tokenList = key.split("s");
  const bitstrings = tokenList.map((token) => {
    const [lt, div] = token.split("_");
    return parseInt(div, 16).toString(2).padStart(Number(lt), "0");
  });
  return bitstrings.join(" ");
}

function generateRhythm() {
  const regex = '1'
  const pattern = sequencesListHC[round-1];
  // const pattern = decode_key(rhythm_key);
  const pattern_stripped = pattern.replaceAll(' ', '');
  const indices = Array.from(pattern_stripped.matchAll(regex), match => match.index);

  // Pick one base interval for the whole sequence; every hardcoded position
  // is a whole number multiple of it, so the rhythm feels musically consistent.
  const interval = 225;

  rhythmInterval = interval;

  // Gap after each beat is the distance to the next position in the pattern.
  return indices.map((position, index) => {
    const nextPosition = indices[index + 1] ?? position;
    return (nextPosition - position) * interval;
  });
}

// ------------------------------------------------------------
// Start game
// ------------------------------------------------------------

function startGame() {
  initAudio();

  round = 1;
  score = 0;

  updateScoreboard();

  scoreTableBody.innerHTML = "";

  actionButton.textContent = "Listening...";
  actionButton.classList.add("playing");

  startRound();
}

// ------------------------------------------------------------
// Start a round
// ------------------------------------------------------------

function startRound() {
  clearTimeout(showingTimer);
  clearTimeout(inputTimer);

  gameState = "showing";
  playerRhythm = [];
  rhythm = generateRhythm();

  actionButton.classList.remove("hidden");
  nextRoundButton.classList.add("hidden");

  actionButton.textContent = "Listening...";
  actionButton.classList.add("playing");

  beatTimes = computeBeatTimes(rhythm);
  timelineDuration = beatTimes[beatTimes.length - 1] + TIMELINE_TAIL;

  buildSourceTimeline();

  playSequence();
}

// ------------------------------------------------------------
// Play the generated rhythm
// ------------------------------------------------------------

function playSequence() {
  startPlayhead();

  beatTimes.forEach((time, index) => {
    showingTimer = setTimeout(() => {
      playBeat(index === 0);
      flashBeat("active");

      markerElements[index].classList.add("hit");
    }, time);
  });

  // Give the player a tiny pause before offering the attempt.
  showingTimer = setTimeout(() => {
    readyForAttempt();
  }, timelineDuration + 250);
}

// ------------------------------------------------------------
// Wait for the player to start their attempt
// ------------------------------------------------------------

function readyForAttempt() {
  gameState = "ready";
  stopPlayhead();

  actionButton.textContent = "Attempt";
  actionButton.classList.remove("playing");
}

// ------------------------------------------------------------
// Start player's turn
// ------------------------------------------------------------

function beginPlayerInput() {
  gameState = "input";
  sequenceStartTime = performance.now();
  playerRhythm = [];

  turnStartTime = sequenceStartTime;

  clearTimeline();

  // Shows where every beat is expected, based on the rhythm being replayed.
  markerElements = beatTimes.map((time) => addMarker(time, "ghost"));

  // Only the leading marker is shown; the rest stay hidden until revealed.
  beatMarkers.classList.add("markers-hidden");

  startPlayhead();

  actionButton.textContent = "Press SPACE";
  actionButton.classList.add("playing");
}

// ------------------------------------------------------------
// Handle player beat
// ------------------------------------------------------------

function playerBeat() {
  if (gameState !== "input") return;

  const now = performance.now();

  const elapsed = now - sequenceStartTime;

  const beatIndex = playerRhythm.length;

  playerRhythm.push(elapsed);

  // sequenceStartTime = now;

  playBeat(false);
  flashBeat("player");
  
  const playerMarker = addMarker(now - turnStartTime, "player");
  
  playerMarker.classList.add("revealed");

  // Reveal the matching expected marker now that the player has responded to it.
  if (markerElements[beatIndex]) {
    markerElements[beatIndex].classList.add("revealed");
  }

  // The player has entered enough beats.
  if (playerRhythm.length >= rhythm.length) {
    finishPlayerTurn();
  }
}

// ------------------------------------------------------------
// Compare rhythms
// ------------------------------------------------------------

// Rates each beat as "missed", "good", or "perfect" based on how close the
// player's press was to the expected gap. Tolerances scale with the
// sequence's tempo (rhythmInterval), not with any single beat's gap length,
// since a beat's gap can be several multiples of the tempo.
function scoreBeats() {
  const perfectTolerance = rhythmInterval * CONFIG.perfectToleranceRatio;
  const timingTolerance = rhythmInterval * CONFIG.timingToleranceRatio;

  // return rhythm.map((expected, index) => {
  return beatTimes.map((expected, index) => {
    const actual = playerRhythm[index];
    const difference = Math.abs(expected - actual);

    // console.log("Expected: " + expected);
    // console.log("Actual: " + actual);
    // console.log("Difference: " + difference);
    // console.log("Perfect Tolerance: " + perfectTolerance);
    // console.log("Timing Tolerance: " + timingTolerance);
    // console.log("Rhythm Interval: " + rhythmInterval);

    if (difference <= perfectTolerance) {
      return "perfect";
    } else if (difference <= timingTolerance) {
      return "good";
    }

    return "missed";
  });
}

function compareRhythms() {
  if (playerRhythm.length !== rhythm.length) {
    return false;
  }

  return scoreBeats().every((rating) => rating !== "missed");
}

// ------------------------------------------------------------
// Finish player's turn
// ------------------------------------------------------------

function finishPlayerTurn() {
  gameState = "result";

  stopPlayhead();

  const beatResults = scoreBeats();
  const missed = beatResults.filter((rating) => rating === "missed").length;
  const good = beatResults.filter((rating) => rating === "good").length;
  const perfect = beatResults.filter((rating) => rating === "perfect").length;
  const tally = good * BEAT_POINTS.good + perfect * BEAT_POINTS.perfect;

  addScoreRow(round, missed, good, perfect, tally);
  
  score = score + tally;
    
  updateScoreboard();
    
  if (round >= CONFIG.roundsToWin) {
    finishGame();
    return;
  }
    
  updateScoreboard();
  
  actionButton.classList.add("hidden");
  nextRoundButton.classList.remove("hidden");
    
  round++;
}

// ------------------------------------------------------------
// Finish the entire game
// ------------------------------------------------------------

function finishGame() {
  gameState = "idle";

  updateScoreboard();

  actionButton.textContent = "Play Again";
  actionButton.classList.remove("playing");

  stopPlayhead();
}

// ------------------------------------------------------------
// Scoreboard
// ------------------------------------------------------------

function updateScoreboard() {
  roundDisplay.textContent = round;
  scoreDisplay.textContent = score;
}

function addScoreRow(roundNumber, missed, good, perfect, tally) {
  const row = document.createElement("tr");

  [roundNumber, missed, good, perfect, tally].forEach((value) => {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.appendChild(cell);
  });

  scoreTableBody.appendChild(row);
}

// ------------------------------------------------------------
// Keyboard input
// ------------------------------------------------------------

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;

  // Prevent the page from scrolling.
  event.preventDefault();

  // Ignore repeated keydown events while Space is held.
  if (event.repeat) return;

  if (gameState === "idle") {
    startGame();
    return;
  }

  if (gameState === "ready") {
    beginPlayerInput();
    return;
  }

  if (gameState === "input") {
    playerBeat();
  }
});

// ------------------------------------------------------------
// Mouse/touch input
// ------------------------------------------------------------

actionButton.addEventListener("click", () => {
  if (gameState === "idle") {
    startGame();
  } else if (gameState === "ready") {
    beginPlayerInput();
  } else if (gameState === "input") {
    playerBeat();
  }
});

nextRoundButton.addEventListener("click", () => {
  if (gameState !== "result") return;

  startRound();
});

// ------------------------------------------------------------
// Initial UI state
// ------------------------------------------------------------

updateScoreboard();
