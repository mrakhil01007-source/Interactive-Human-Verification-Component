"use client";

import React, { useEffect, useRef, useState } from "react";
import { 
  ShieldCheck, 
  Camera, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Eye, 
  ThumbsUp, 
  Hand,
  Clock
} from "lucide-react";
import { initMediaPipe, analyzeFace, analyzeHand } from "@/utils/mediapipe-helper";

// Type definitions for MediaPipe results
type ChallengeType = "BLINK_TWICE" | "THUMBS_UP" | "RAISE_TWO_FINGERS";

interface Challenge {
  type: ChallengeType;
  label: string;
  instruction: string;
  icon: React.ReactNode;
}

const CHALLENGES: Challenge[] = [
  {
    type: "BLINK_TWICE",
    label: "Blink twice",
    instruction: "Look at the camera and blink your eyes twice clearly.",
    icon: <Eye className="w-8 h-8 text-cyan-400" />,
  },
  {
    type: "THUMBS_UP",
    label: "Show thumbs up",
    instruction: "Raise your hand and make a clear thumbs-up gesture.",
    icon: <ThumbsUp className="w-8 h-8 text-cyan-400" />,
  },
  {
    type: "RAISE_TWO_FINGERS",
    label: "Raise two fingers",
    instruction: "Hold up your index and middle fingers (peace sign/V gesture).",
    icon: <Hand className="w-8 h-8 text-cyan-400" />,
  },
];

type Step = "idle" | "requesting_camera" | "loading_models" | "active" | "success" | "failed";

export default function VerificationCard() {
  const [step, setStep] = useState<Step>("idle");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(20); // 20-second challenge limit
  const [blinkCount, setBlinkCount] = useState<number>(0);
  const [gestureProgress, setGestureProgress] = useState<number>(0); // 0 to 100 for holding gesture
  const [faceTracked, setFaceTracked] = useState<boolean>(false);
  const [handTracked, setHandTracked] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const activeChallengeRef = useRef<Challenge | null>(null);

  // References for tracking variables in loop to avoid closure capture issues
  const blinkStateRef = useRef<{ count: number; wasClosed: boolean; lastBlinkTime: number }>({
    count: 0,
    wasClosed: false,
    lastBlinkTime: 0,
  });
  
  const holdingRef = useRef<{ active: boolean; startTime: number }>({
    active: false,
    startTime: 0,
  });

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Update refs when state changes
  useEffect(() => {
    activeChallengeRef.current = challenge;
  }, [challenge]);

  // Handle countdown timer for active step
  useEffect(() => {
    if (step !== "active") return;
    
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleFailure("Challenge timed out. Please try again.");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step]);

  // Start the verification flow
  const startVerification = async () => {
    setStep("requesting_camera");
    setStatusMessage("Requesting camera access...");
    setBlinkCount(0);
    setGestureProgress(0);
    setTimeLeft(20);
    setFaceTracked(false);
    setHandTracked(false);
    
    // Reset internal trackers
    blinkStateRef.current = { count: 0, wasClosed: false, lastBlinkTime: 0 };
    holdingRef.current = { active: false, startTime: 0 };

    // Select random challenge
    const randomChallenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    setChallenge(randomChallenge);

    // Wait a tick for the video element to render in the DOM
    setTimeout(async () => {
      try {
        // 1. Get webcam stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          },
          audio: false,
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            // After getting camera stream, load models
            loadModelsAndStartTracking();
          };
        } else {
          throw new Error("Video player element not found in DOM");
        }
      } catch (error: any) {
        console.error("Camera access failed:", error);
        handleFailure(
          error.name === "NotAllowedError"
            ? "Camera permission denied. Please grant permission in your browser address bar."
            : `Camera error: ${error.message || error}`
        );
      }
    }, 100);
  };

  const loadModelsAndStartTracking = async () => {
    setStep("loading_models");
    setStatusMessage("Initializing AI models (this may take a few seconds)...");

    try {
      // Initialize MediaPipe models dynamically
      const models = await initMediaPipe();
      if (!models) {
        throw new Error("Could not initialize MediaPipe");
      }

      setStep("active");
      setStatusMessage("Models loaded. Follow the challenge!");

      // Start detection frame loop
      startDetectionLoop(models.faceLandmarker, models.handLandmarker);
    } catch (err) {
      console.error(err);
      handleFailure("Failed to load AI verification engines.");
    }
  };

  const startDetectionLoop = (faceLandmarker: any, handLandmarker: any) => {
    let lastVideoTime = -1;
    let frameCount = 0;
    let lastFpsUpdateTime = performance.now();

    const renderLoop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas || step === "success" || step === "failed") {
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Update FPS counter
      const now = performance.now();
      frameCount++;
      if (now - lastFpsUpdateTime >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastFpsUpdateTime)));
        frameCount = 0;
        lastFpsUpdateTime = now;
      }

      // Sync canvas dimensions with video
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // Check if video has loaded frames and has valid dimensions
      if (
        video.currentTime !== lastVideoTime &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        lastVideoTime = video.currentTime;
        const timestamp = performance.now();

        // Run MediaPipe detection
        let faceResult = null;
        let handResult = null;

        try {
          faceResult = faceLandmarker.detectForVideo(video, timestamp);
          handResult = handLandmarker.detectForVideo(video, timestamp);
        } catch (error) {
          console.error("In-loop detection error:", error);
        }

        // Draw and analyze
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Analyze Face (for blinking)
        let isEyesClosedThisFrame = false;
        if (faceResult && faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
          setFaceTracked(true);
          const landmarks = faceResult.faceLandmarks[0];

          // Draw face mesh outline landmarks in cyan
          ctx.fillStyle = "rgba(6, 182, 212, 0.4)"; // Cyan-500
          landmarks.forEach((pt: any) => {
            ctx.beginPath();
            ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 1.5, 0, 2 * Math.PI);
            ctx.fill();
          });

          // Highlight eyes with different color (emerald)
          const leftEyeIndices = [159, 145, 33, 133];
          const rightEyeIndices = [386, 374, 362, 263];
          ctx.fillStyle = "#10b981"; // Emerald-500
          [...leftEyeIndices, ...rightEyeIndices].forEach((idx) => {
            const pt = landmarks[idx];
            if (pt) {
              ctx.beginPath();
              ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 3, 0, 2 * Math.PI);
              ctx.fill();
            }
          });

          // Perform blink analysis
          const { isClosed } = analyzeFace(landmarks);
          isEyesClosedThisFrame = isClosed;
        } else {
          setFaceTracked(false);
        }

        // Analyze Hand (for gestures)
        let isThumbsUpThisFrame = false;
        let isTwoFingersThisFrame = false;

        if (handResult && handResult.landmarks && handResult.landmarks.length > 0) {
          setHandTracked(true);
          const landmarks = handResult.landmarks[0];

          // Draw skeleton lines connecting joints
          ctx.strokeStyle = "#a855f7"; // Purple-500
          ctx.lineWidth = 3;
          
          const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8], // Index
            [9, 10], [10, 11], [11, 12],    // Middle
            [13, 14], [14, 15], [15, 16],   // Ring
            [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
            [5, 9], [9, 13], [13, 17] // Knuckle line
          ];

          connections.forEach(([i1, i2]) => {
            const pt1 = landmarks[i1];
            const pt2 = landmarks[i2];
            if (pt1 && pt2) {
              ctx.beginPath();
              ctx.moveTo(pt1.x * canvas.width, pt1.y * canvas.height);
              ctx.lineTo(pt2.x * canvas.width, pt2.y * canvas.height);
              ctx.stroke();
            }
          });

          // Draw joint points in bright purple
          ctx.fillStyle = "#d8b4fe"; // Purple-300
          landmarks.forEach((pt: any) => {
            ctx.beginPath();
            ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 5, 0, 2 * Math.PI);
            ctx.fill();
          });

          // Analyze gestures
          const { isThumbsUp, isTwoFingersRaised } = analyzeHand(landmarks);
          isThumbsUpThisFrame = isThumbsUp;
          isTwoFingersThisFrame = isTwoFingersRaised;
        } else {
          setHandTracked(false);
        }

        // Challenge Evaluation Logic
        const curChallenge = activeChallengeRef.current;
        if (curChallenge) {
          if (curChallenge.type === "BLINK_TWICE") {
            const state = blinkStateRef.current;
            const nowTime = performance.now();

            if (isEyesClosedThisFrame) {
              state.wasClosed = true;
            } else if (state.wasClosed) {
              // Open state detected after being closed
              state.wasClosed = false;
              
              // Prevent counting double blinks too close to each other (debounce 250ms)
              if (nowTime - state.lastBlinkTime > 250) {
                state.count++;
                state.lastBlinkTime = nowTime;
                setBlinkCount(state.count);

                if (state.count >= 2) {
                  triggerSuccess();
                  return; // Stop animation loop
                }
              }
            }
          } else if (curChallenge.type === "THUMBS_UP") {
            handleGestureHolding(isThumbsUpThisFrame);
          } else if (curChallenge.type === "RAISE_TWO_FINGERS") {
            handleGestureHolding(isTwoFingersThisFrame);
          }
        }
      }

      animationFrameId.current = requestAnimationFrame(renderLoop);
    };

    animationFrameId.current = requestAnimationFrame(renderLoop);
  };

  const handleGestureHolding = (isDetected: boolean) => {
    const hold = holdingRef.current;
    const now = performance.now();

    if (isDetected) {
      if (!hold.active) {
        hold.active = true;
        hold.startTime = now;
      } else {
        const elapsed = now - hold.startTime;
        const durationNeeded = 1500; // Hold gesture for 1.5 seconds
        const progress = Math.min(100, Math.round((elapsed / durationNeeded) * 100));
        setGestureProgress(progress);

        if (elapsed >= durationNeeded) {
          triggerSuccess();
        }
      }
    } else {
      if (hold.active) {
        hold.active = false;
        setGestureProgress(0);
      }
    }
  };

  const triggerSuccess = async () => {
    setStep("success");
    setStatusMessage("Identity verified successfully!");
    stopCamera();

    // Trigger confetti dynamically
    try {
      const confetti = (await import("canvas-confetti")).default;
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#22c55e", "#06b6d4", "#a855f7"],
      });
    } catch (e) {
      console.warn("Confetti failed to launch", e);
    }
  };

  const handleFailure = (msg: string) => {
    setStep("failed");
    setStatusMessage(msg);
    stopCamera();
  };

  const stopCamera = () => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const resetVerification = () => {
    setStep("idle");
    setChallenge(null);
    setBlinkCount(0);
    setGestureProgress(0);
    setTimeLeft(20);
    setFps(0);
  };

  return (
    <div className="w-full max-w-lg mx-auto bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden transition-all duration-500 hover:border-slate-700/80">
      {/* Decorative ambient background glows */}
      <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6 relative">
        <div className="p-3 bg-gradient-to-tr from-cyan-500/20 to-purple-500/20 rounded-2xl border border-cyan-500/30">
          <ShieldCheck className="w-7 h-7 text-cyan-400 animate-pulse" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Liveness Check</h2>
          <p className="text-xs text-slate-400">Powered by browser-side AI</p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="min-h-[340px] flex flex-col justify-center relative">
        
        {/* Step: IDLE */}
        {step === "idle" && (
          <div className="text-center py-6 flex flex-col items-center">
            <div className="w-24 h-24 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700/50 mb-6 group-hover:scale-105 transition-transform duration-300">
              <Camera className="w-10 h-10 text-slate-400 group-hover:text-cyan-400 transition-colors" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Verify You Are Human</h3>
            <p className="text-sm text-slate-400 leading-relaxed max-w-sm mb-8">
              We will prompt you with a random gesture challenge. Video processing is completed locally in the browser and is never stored or uploaded.
            </p>
            <button
              onClick={startVerification}
              className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-semibold rounded-2xl shadow-lg hover:shadow-cyan-500/10 transition-all duration-300 active:scale-95 cursor-pointer"
            >
              Start Verification
            </button>
          </div>
        )}

        {/* Step: REQUESTING CAMERA, LOADING MODELS, or ACTIVE CHALLENGE */}
        {(step === "requesting_camera" || step === "loading_models" || step === "active") && (
          <div className="flex flex-col gap-5">
            {/* Live Camera Preview with canvas overlay */}
            <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden border border-slate-800 bg-black shadow-inner group">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none"
              />

              {/* Loader Overlay when requesting camera or loading models */}
              {step !== "active" && (
                <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-20">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping" />
                    <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center border border-cyan-500/40 relative">
                      <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                    </div>
                  </div>
                  <h3 className="text-sm font-bold text-white mb-2">
                    {step === "requesting_camera" ? "Camera Access" : "Initializing AI Models"}
                  </h3>
                  <p className="text-xs text-slate-400 max-w-[240px] leading-relaxed">
                    {statusMessage}
                  </p>
                </div>
              )}

              {/* Grid overlay for digital aesthetic */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(15,23,42,0.6))] pointer-events-none" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(18,24,38,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(18,24,38,0.05)_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

              {/* Status Pills */}
              <div className="absolute top-4 left-4 flex gap-2 z-10">
                <div className={`px-2.5 py-1 rounded-full text-[10px] font-semibold flex items-center gap-1.5 backdrop-blur-md border ${
                  faceTracked 
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
                    : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${faceTracked ? "bg-emerald-400" : "bg-rose-400"}`} />
                  Face
                </div>
                <div className={`px-2.5 py-1 rounded-full text-[10px] font-semibold flex items-center gap-1.5 backdrop-blur-md border ${
                  handTracked 
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
                    : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${handTracked ? "bg-emerald-400" : "bg-rose-400"}`} />
                  Hand
                </div>
              </div>

              {/* FPS Indicator */}
              <div className="absolute top-4 right-4 bg-slate-900/80 backdrop-blur-md border border-slate-800 px-2 py-0.5 rounded text-[10px] text-slate-400 font-mono z-10">
                {fps} FPS
              </div>

              {/* Gesture Progress Overlay for holding gestures */}
              {step === "active" && gestureProgress > 0 && (
                <div className="absolute bottom-4 left-4 right-4 bg-slate-950/80 backdrop-blur-md border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5 z-10">
                  <div className="flex justify-between text-[11px] font-semibold text-slate-300">
                    <span>Hold Gesture...</span>
                    <span>{gestureProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-cyan-500 to-purple-500 h-full transition-all duration-100 ease-out"
                      style={{ width: `${gestureProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Instruction and timer */}
            {challenge && (
              <div className="bg-slate-950/40 border border-slate-800/80 rounded-2xl p-5 flex items-center gap-4">
                <div className="p-3 bg-cyan-950/40 border border-cyan-800/30 rounded-xl">
                  {challenge.icon}
                </div>
                <div className="flex-1">
                  <div className="text-[11px] uppercase tracking-wider text-cyan-400 font-bold mb-1">
                    Active Challenge
                  </div>
                  <h4 className="text-base font-bold text-white mb-0.5">
                    {challenge.label}
                  </h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    {challenge.instruction}
                  </p>
                  {challenge.type === "BLINK_TWICE" && (
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <span className="text-xs text-slate-400 font-medium">Blinks detected:</span>
                      <div className="flex gap-1">
                        {[1, 2].map((i) => (
                          <div
                            key={i}
                            className={`w-5 h-2 rounded-full border transition-all duration-300 ${
                              blinkCount >= i
                                ? "bg-emerald-500 border-emerald-400 shadow-sm shadow-emerald-500/50"
                                : "bg-slate-800 border-slate-700"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-center gap-1 bg-slate-950/60 border border-slate-800 px-3.5 py-2.5 rounded-xl min-w-[64px]">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span className={`text-sm font-bold font-mono ${timeLeft <= 5 ? "text-rose-400 animate-pulse" : "text-white"}`}>
                    {timeLeft}s
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step: SUCCESS */}
        {step === "success" && (
          <div className="text-center py-8 flex flex-col items-center">
            <div className="relative mb-6">
              {/* Glowing halo */}
              <div className="absolute inset-0 rounded-full bg-emerald-500/25 blur-xl animate-pulse" />
              <div className="w-20 h-20 rounded-full bg-emerald-950/50 flex items-center justify-center border border-emerald-500/40 relative">
                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Verification Successful</h3>
            <p className="text-sm text-slate-400 max-w-xs leading-relaxed mb-8">
              Your biometric liveness test succeeded. We verified that you are a live human.
            </p>
            <div className="w-full flex gap-3">
              <button
                onClick={resetVerification}
                className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-2xl border border-slate-700/50 transition-all duration-200 active:scale-95 cursor-pointer"
              >
                Reset
              </button>
              <div className="flex-[2] py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-2xl shadow-lg shadow-emerald-950/20 text-center transition-all duration-200 cursor-default">
                Verified
              </div>
            </div>
          </div>
        )}

        {/* Step: FAILED */}
        {step === "failed" && (
          <div className="text-center py-8 flex flex-col items-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full bg-rose-500/25 blur-xl animate-pulse" />
              <div className="w-20 h-20 rounded-full bg-rose-950/50 flex items-center justify-center border border-rose-500/40 relative">
                <AlertCircle className="w-10 h-10 text-rose-400" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Verification Failed</h3>
            <p className="text-sm text-slate-400 max-w-xs leading-relaxed mb-8">
              {statusMessage || "Liveness check failed. Please ensure your camera is positioned correctly and try again."}
            </p>
            <div className="w-full flex gap-3">
              <button
                onClick={resetVerification}
                className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-2xl border border-slate-700/50 transition-all duration-200 active:scale-95 cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={startVerification}
                className="flex-[2] py-4 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-semibold rounded-2xl shadow-lg transition-all duration-200 active:scale-95 cursor-pointer flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
