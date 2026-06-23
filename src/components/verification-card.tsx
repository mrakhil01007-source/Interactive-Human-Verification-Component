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
  Smile, 
  ArrowLeft, 
  ArrowRight,
  Clock,
  UserCheck,
  UserPlus,
  Trash2
} from "lucide-react";
import { 
  initMediaPipe, 
  analyzeFace, 
  extractFaceEmbedding, 
  compareFaceEmbeddings, 
  detectHeadTurn, 
  detectSmile,
  FaceEmbeddingPoint
} from "@/utils/mediapipe-helper";

type Step = "idle" | "requesting_camera" | "loading_models" | "active" | "success" | "failed";
type Mode = "enroll" | "verify";
type ChallengeType = "BLINK_TWICE" | "TURN_LEFT" | "TURN_RIGHT" | "SMILE";

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
    instruction: "Look at the camera and blink twice clearly.",
    icon: <Eye className="w-8 h-8 text-cyan-400" />,
  },
  {
    type: "TURN_LEFT",
    label: "Turn head left",
    instruction: "Turn your head slowly to your left (camera's right).",
    icon: <ArrowLeft className="w-8 h-8 text-cyan-400" />,
  },
  {
    type: "TURN_RIGHT",
    label: "Turn head right",
    instruction: "Turn your head slowly to your right (camera's left).",
    icon: <ArrowRight className="w-8 h-8 text-cyan-400" />,
  },
  {
    type: "SMILE",
    label: "Smile",
    instruction: "Give a clear, happy smile to the camera.",
    icon: <Smile className="w-8 h-8 text-cyan-400" />,
  },
];

export default function VerificationCard() {
  const [mode, setMode] = useState<Mode>("verify");
  const [step, setStep] = useState<Step>("idle");
  const [isEnrolled, setIsEnrolled] = useState<boolean>(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(25); // 25-second limit for face auth
  
  // Tracking states
  const [faceTracked, setFaceTracked] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(0);
  
  // Camera stream state
  const [stream, setStream] = useState<MediaStream | null>(null);
  
  // Verification progress
  const [livenessPassed, setLivenessPassed] = useState<boolean>(false);
  const [blinkCount, setBlinkCount] = useState<number>(0);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  
  // Enrollment progress
  const [enrollProgress, setEnrollProgress] = useState<number>(0); // 0 to 5 captured frames

  // Debug HUD states
  const [debugPose, setDebugPose] = useState<string>("STRAIGHT");
  const [debugSmileVal, setDebugSmileVal] = useState<string>("No");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameId = useRef<number | null>(null);
  
  // Refs to avoid state closure capture in requestAnimationFrame loop
  const modeRef = useRef<Mode>("verify");
  const stepRef = useRef<Step>("idle");
  const livenessPassedRef = useRef<boolean>(false);
  const enrollProgressRef = useRef<number>(0);
  const challengeRef = useRef<Challenge | null>(null);

  const blinkStateRef = useRef<{ count: number; wasClosed: boolean; lastBlinkTime: number }>({
    count: 0,
    wasClosed: false,
    lastBlinkTime: 0,
  });

  const enrolledEmbeddingRef = useRef<FaceEmbeddingPoint[] | null>(null);
  const capturedEmbeddingsRef = useRef<FaceEmbeddingPoint[][]>([]);

  // Check enrollment on mount and when step changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("aegis_face_embedding");
      setIsEnrolled(stored !== null);
      if (stored) {
        try {
          enrolledEmbeddingRef.current = JSON.parse(stored);
        } catch (e) {
          console.error("Failed to parse enrolled embedding", e);
        }
      }
    }
  }, [step]);

  // Sync state variables to refs so loops get updated values
  useEffect(() => {
    modeRef.current = mode;
    stepRef.current = step;
    livenessPassedRef.current = livenessPassed;
    enrollProgressRef.current = enrollProgress;
    challengeRef.current = challenge;
  }, [mode, step, livenessPassed, enrollProgress, challenge]);

  // Bind the camera stream to the video element whenever it is mounted and the stream is available
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
    }
  }, [stream, step]);

  // Handle countdown timer for active step
  useEffect(() => {
    if (step !== "active") return;
    
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleFailure("Verification timed out. Please try again.");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step]);

  // Clean up stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const deleteEnrollment = () => {
    if (confirm("Are you sure you want to delete your enrolled face template? You will not be able to verify until you enroll again.")) {
      localStorage.removeItem("aegis_face_embedding");
      enrolledEmbeddingRef.current = null;
      setIsEnrolled(false);
      setMode("enroll");
      resetVerification();
    }
  };

  const startVerification = async () => {
    // Reset tracker states
    setStep("requesting_camera");
    setStatusMessage("Requesting camera access...");
    setBlinkCount(0);
    setLivenessPassed(false);
    setMatchScore(null);
    setEnrollProgress(0);
    setTimeLeft(25);
    setFaceTracked(false);
    setDebugPose("STRAIGHT");
    setDebugSmileVal("No");
    
    blinkStateRef.current = { count: 0, wasClosed: false, lastBlinkTime: 0 };
    capturedEmbeddingsRef.current = [];

    // Load enrolled embedding if in verify mode
    if (mode === "verify") {
      const stored = localStorage.getItem("aegis_face_embedding");
      if (!stored) {
        handleFailure("No face enrolled. Please enroll your face first.");
        return;
      }
      enrolledEmbeddingRef.current = JSON.parse(stored);
      
      // Select random challenge
      const randomChallenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
      setChallenge(randomChallenge);
    } else {
      setChallenge(null);
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: false,
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setStep("loading_models");
    } catch (error: any) {
      console.error("Camera access failed:", error);
      handleFailure(
        error.name === "NotAllowedError"
          ? "Camera permission denied. Please grant permission in your browser address bar."
          : `Camera access error: ${error.message || error}`
      );
    }
  };

  const handleVideoMetadataLoaded = () => {
    if (stepRef.current === "loading_models") {
      loadModelsAndStartTracking();
    }
  };

  const loadModelsAndStartTracking = async () => {
    setStatusMessage("Initializing Face Landmarker engines...");

    try {
      const models = await initMediaPipe();
      if (!models) {
        throw new Error("Could not initialize MediaPipe");
      }

      setStep("active");
      setStatusMessage(mode === "enroll" ? "Keep head straight to capture." : "Perform the challenge!");

      if (videoRef.current) {
        videoRef.current.play().catch(e => console.error("Error playing video:", e));
      }
      startDetectionLoop(models.faceLandmarker);
    } catch (err) {
      console.error(err);
      handleFailure("Failed to load AI verification engines.");
    }
  };

  const startDetectionLoop = (faceLandmarker: any) => {
    let lastVideoTime = -1;
    let frameCount = 0;
    let lastFpsUpdateTime = performance.now();
    let lastCaptureTime = 0;

    const renderLoop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas || stepRef.current !== "active") {
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Update FPS
      const now = performance.now();
      frameCount++;
      if (now - lastFpsUpdateTime >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastFpsUpdateTime)));
        frameCount = 0;
        lastFpsUpdateTime = now;
      }

      // Sync canvas dimensions
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // Draw mirrored preview
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (
        video.currentTime !== lastVideoTime && 
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        lastVideoTime = video.currentTime;
        const timestamp = performance.now();

        // Run Face mesh detection
        let faceResult = null;
        try {
          faceResult = faceLandmarker.detectForVideo(video, timestamp);
        } catch (error: any) {
          console.error("In-loop face detection error:", error);
          handleFailure(`Face tracking engine error: ${error.message || error}`);
          return;
        }

        if (faceResult && faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
          setFaceTracked(true);
          const landmarks = faceResult.faceLandmarks[0];

          // 1. Analyze head pose and facial features
          const headTurn = detectHeadTurn(landmarks);
          const isSmiling = detectSmile(landmarks);
          const { isClosed } = analyzeFace(landmarks);

          // Update debug state
          setDebugPose(headTurn);
          setDebugSmileVal(isSmiling ? "Yes" : "No");

          // 2. Perform live similarity match locally inside loop to prevent UI rendering lag
          let isMatchedThisFrame = false;
          let currentScore = 0;

          if (modeRef.current === "verify" && livenessPassedRef.current && enrolledEmbeddingRef.current) {
            const liveEmbedding = extractFaceEmbedding(landmarks);
            const avgDistance = compareFaceEmbeddings(liveEmbedding, enrolledEmbeddingRef.current);
            currentScore = Math.max(0, Math.min(100, Math.round((1 - avgDistance / 0.12) * 100)));
            isMatchedThisFrame = avgDistance <= 0.06;
          }

          // 3. Determine wireframe color for premium aesthetics
          // Emerald Green if matched, Crimson Red if head turned, Cyan during challenge, Yellow when searching
          let wireframeColor = "rgba(6, 182, 212, 0.35)"; // default cyan
          
          if (modeRef.current === "verify") {
            if (livenessPassedRef.current) {
              wireframeColor = isMatchedThisFrame ? "rgba(34, 197, 94, 0.45)" : "rgba(234, 179, 8, 0.45)"; // green / yellow
            } else if (headTurn !== "STRAIGHT") {
              wireframeColor = "rgba(168, 85, 247, 0.45)"; // purple
            }
          } else {
            // Enroll mode
            wireframeColor = "rgba(34, 197, 94, 0.45)"; // green during capture
          }

          // Draw Face Mesh outline
          ctx.fillStyle = wireframeColor;
          landmarks.forEach((pt: any) => {
            ctx.beginPath();
            ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 1.2, 0, 2 * Math.PI);
            ctx.fill();
          });

          // Draw Eye points (emerald highlights)
          const leftEyeIndices = [159, 145, 33, 133];
          const rightEyeIndices = [386, 374, 362, 263];
          ctx.fillStyle = "#10b981"; // Emerald
          [...leftEyeIndices, ...rightEyeIndices].forEach((idx) => {
            const pt = landmarks[idx];
            if (pt) {
              ctx.beginPath();
              ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 2.5, 0, 2 * Math.PI);
              ctx.fill();
            }
          });

          // Draw Mouth points (highlight when smiling)
          const mouthIndices = [61, 291, 13, 14];
          ctx.fillStyle = isSmiling ? "#22c55e" : "#ec4899"; // green / pink
          mouthIndices.forEach((idx) => {
            const pt = landmarks[idx];
            if (pt) {
              ctx.beginPath();
              ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 3, 0, 2 * Math.PI);
              ctx.fill();
            }
          });

          // 4. Process flow states
          if (modeRef.current === "enroll") {
            // ENROLLMENT CAPTURE (Auto capture 5 frames spaced 250ms apart)
            const nowTime = performance.now();
            if (nowTime - lastCaptureTime > 250) {
              const embedding = extractFaceEmbedding(landmarks);
              if (embedding.length > 0) {
                capturedEmbeddingsRef.current.push(embedding);
                const newProgress = capturedEmbeddingsRef.current.length;
                setEnrollProgress(newProgress);
                lastCaptureTime = nowTime;

                if (newProgress >= 5) {
                  // Compute average embedding
                  const avgEmbedding: FaceEmbeddingPoint[] = [];
                  const samplesCount = capturedEmbeddingsRef.current.length;
                  const pointsCount = capturedEmbeddingsRef.current[0].length;

                  for (let i = 0; i < pointsCount; i++) {
                    let sumX = 0, sumY = 0, sumZ = 0;
                    for (let j = 0; j < samplesCount; j++) {
                      sumX += capturedEmbeddingsRef.current[j][i].x;
                      sumY += capturedEmbeddingsRef.current[j][i].y;
                      sumZ += capturedEmbeddingsRef.current[j][i].z;
                    }
                    avgEmbedding.push({
                      x: sumX / samplesCount,
                      y: sumY / samplesCount,
                      z: sumZ / samplesCount,
                    });
                  }

                  // Save to local storage
                  localStorage.setItem("aegis_face_embedding", JSON.stringify(avgEmbedding));
                  setTimeout(() => {
                    triggerSuccess();
                  }, 500);
                  return; // Stop animation loop
                }
              }
            }
          } else {
            // VERIFICATION PROCESSING
            const activeChallenge = challengeRef.current;
            
            if (!livenessPassedRef.current && activeChallenge) {
              // A. Evaluate Liveness Challenge
              if (activeChallenge.type === "BLINK_TWICE") {
                const state = blinkStateRef.current;
                const nowTime = performance.now();
                
                if (isClosed) {
                  state.wasClosed = true;
                } else if (state.wasClosed) {
                  state.wasClosed = false;
                  if (nowTime - state.lastBlinkTime > 250) {
                    state.count++;
                    state.lastBlinkTime = nowTime;
                    setBlinkCount(state.count);
                    if (state.count >= 2) {
                      setLivenessPassed(true);
                      setStatusMessage("Liveness verified. Now look straight at the camera.");
                    }
                  }
                }
              } else if (activeChallenge.type === "TURN_LEFT" && headTurn === "LEFT") {
                setLivenessPassed(true);
                setStatusMessage("Liveness verified. Now look straight at the camera.");
              } else if (activeChallenge.type === "TURN_RIGHT" && headTurn === "RIGHT") {
                setLivenessPassed(true);
                setStatusMessage("Liveness verified. Now look straight at the camera.");
              } else if (activeChallenge.type === "SMILE" && isSmiling) {
                setLivenessPassed(true);
                setStatusMessage("Liveness verified. Now look straight at the camera.");
              }
            } else if (livenessPassedRef.current && enrolledEmbeddingRef.current) {
              // B. Verify Face Identity (Continuous Check)
              setMatchScore(currentScore);

              if (isMatchedThisFrame) {
                setTimeout(() => {
                  triggerSuccess();
                }, 600);
                return; // Stop animation loop
              }
            }
          }
        } else {
          setFaceTracked(false);
        }
      }

      animationFrameId.current = requestAnimationFrame(renderLoop);
    };

    animationFrameId.current = requestAnimationFrame(renderLoop);
  };

  const triggerSuccess = async () => {
    setStep("success");
    setStatusMessage(mode === "enroll" ? "Face profile enrolled successfully!" : "Access Granted");
    stopCamera();

    // Trigger confetti
    try {
      const confetti = (await import("canvas-confetti")).default;
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#22c55e", "#06b6d4", "#a855f7"],
      });
    } catch (e) {
      console.warn(e);
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

    setStream(null);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const resetVerification = () => {
    setStep("idle");
    setChallenge(null);
    setBlinkCount(0);
    setLivenessPassed(false);
    setMatchScore(null);
    setEnrollProgress(0);
    setTimeLeft(25);
    setFps(0);
    setDebugPose("STRAIGHT");
    setDebugSmileVal("No");
  };

  const toggleTab = (newMode: Mode) => {
    if (step !== "idle" && step !== "success" && step !== "failed") {
      stopCamera();
    }
    setMode(newMode);
    setStep("idle");
    resetVerification();
  };

  return (
    <div className="w-full max-w-lg mx-auto bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden transition-all duration-500 hover:border-slate-700/80">
      {/* Ambient glows */}
      <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between mb-6 relative">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-tr from-cyan-500/20 to-purple-500/20 rounded-2xl border border-cyan-500/30">
            <ShieldCheck className="w-7 h-7 text-cyan-400 animate-pulse" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide">Biometric Auth</h2>
            <p className="text-xs text-slate-400">Security Gatekeeper</p>
          </div>
        </div>

        {/* Enrolled Status Badge */}
        <div className="flex items-center">
          {isEnrolled ? (
            <span className="px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold uppercase rounded-full tracking-wider">
              Enrolled
            </span>
          ) : (
            <span className="px-2.5 py-1 bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] font-bold uppercase rounded-full tracking-wider">
              No Face
            </span>
          )}
        </div>
      </div>

      {/* Segmented Control Tabs */}
      {step === "idle" && (
        <div className="flex bg-slate-950/80 border border-slate-800 rounded-xl p-1 mb-6 relative z-10">
          <button
            onClick={() => toggleTab("verify")}
            className={`flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
              mode === "verify" 
                ? "bg-slate-800 text-white shadow" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            Verify Identity
          </button>
          <button
            onClick={() => toggleTab("enroll")}
            className={`flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
              mode === "enroll" 
                ? "bg-slate-800 text-white shadow" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Enroll Face
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="min-h-[340px] flex flex-col justify-center relative">
        
        {/* Step: IDLE */}
        {step === "idle" && (
          <div className="text-center py-4 flex flex-col items-center">
            {mode === "enroll" ? (
              <>
                <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700/50 mb-6">
                  <UserPlus className="w-9 h-9 text-cyan-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Face Enrollment</h3>
                <p className="text-xs text-slate-400 leading-relaxed max-w-sm mb-6">
                  We will record a structural 3D model of your face by capturing 5 neutral look-straight snapshots. No raw images are stored.
                </p>
                <div className="w-full flex flex-col gap-3">
                  <button
                    onClick={startVerification}
                    className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-semibold rounded-2xl shadow-lg transition-all duration-300 active:scale-95 cursor-pointer"
                  >
                    Start Enrollment
                  </button>
                  {isEnrolled && (
                    <button
                      onClick={deleteEnrollment}
                      className="w-full py-3 bg-slate-950/40 hover:bg-rose-950/20 text-rose-400 hover:text-rose-300 text-xs font-semibold rounded-xl border border-slate-855 hover:border-rose-900/30 transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Enrollment
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700/50 mb-6">
                  <UserCheck className="w-9 h-9 text-purple-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Face Verification</h3>
                <p className="text-xs text-slate-400 leading-relaxed max-w-sm mb-8">
                  Verify your identity. This requires satisfying a random liveness check followed by matching your live face structure against the enrolled profile.
                </p>
                <button
                  onClick={startVerification}
                  disabled={!isEnrolled}
                  className={`w-full py-4 font-semibold rounded-2xl shadow-lg transition-all duration-300 ${
                    isEnrolled
                      ? "bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white active:scale-95 cursor-pointer"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-850"
                  }`}
                >
                  {isEnrolled ? "Start Verification" : "Enroll Face First"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Step: REQUESTING CAMERA, LOADING MODELS, or ACTIVE PROCESS */}
        {(step === "requesting_camera" || step === "loading_models" || step === "active") && (
          <div className="flex flex-col gap-5">
            {/* Live Camera Preview with canvas overlay */}
            <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden border border-slate-800 bg-black shadow-inner group">
              <video
                ref={videoRef}
                playsInline
                muted
                onLoadedMetadata={handleVideoMetadataLoaded}
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

              {/* Grid overlays */}
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
                  Face Tracker
                </div>
              </div>

              {/* FPS Indicator */}
              <div className="absolute top-4 right-4 bg-slate-900/80 backdrop-blur-md border border-slate-800 px-2 py-0.5 rounded text-[10px] text-slate-400 font-mono z-10">
                {fps} FPS
              </div>

              {/* Match Score Overlay (during verify tab when liveness passed) */}
              {mode === "verify" && livenessPassed && (
                <div className="absolute bottom-4 left-4 right-4 bg-slate-950/85 backdrop-blur-md border border-slate-850 rounded-xl p-3 flex flex-col gap-1 z-10 text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Face Structural Match
                  </div>
                  {matchScore !== null ? (
                    <div className="flex flex-col gap-1 mt-1">
                      <div className="flex justify-between items-center text-xs px-1">
                        <span className="font-semibold text-slate-300">Biometric Profile Fit:</span>
                        <span className={`font-bold ${matchScore >= 50 ? "text-emerald-400" : "text-yellow-500"}`}>
                          {matchScore}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-200 ${
                            matchScore >= 50 ? "bg-emerald-500" : "bg-yellow-500"
                          }`}
                          style={{ width: `${matchScore}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-yellow-500 font-semibold py-1 animate-pulse">
                      Align Face Straight to scan
                    </div>
                  )}
                </div>
              )}

              {/* Capture progress (during enrollment tab) */}
              {mode === "enroll" && (
                <div className="absolute bottom-4 left-4 right-4 bg-slate-950/85 backdrop-blur-md border border-slate-850 rounded-xl p-3.5 flex flex-col gap-2 z-10">
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-300">
                    <span>Capturing face profile...</span>
                    <span>{enrollProgress} / 5</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div 
                        key={i} 
                        className={`flex-1 h-full transition-all duration-300 ${
                          enrollProgress >= i 
                            ? "bg-gradient-to-r from-cyan-400 to-emerald-400" 
                            : "bg-slate-800"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Instruction Panel */}
            {mode === "verify" && challenge && (
              <div className="bg-slate-950/40 border border-slate-850 rounded-2xl p-5 flex flex-col sm:flex-row items-center gap-4 relative">
                <div className="flex items-center gap-4 flex-1">
                  <div className="p-3 bg-cyan-950/40 border border-cyan-800/30 rounded-xl shrink-0">
                    {livenessPassed ? <UserCheck className="w-8 h-8 text-emerald-400" /> : challenge.icon}
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold mb-1">
                      {livenessPassed ? "Liveness check passed" : "Liveness challenge"}
                    </div>
                    <h4 className="text-sm font-bold text-white mb-0.5">
                      {livenessPassed ? "Identity Scan" : challenge.label}
                    </h4>
                    <p className="text-xs text-slate-400 leading-normal">
                      {livenessPassed 
                        ? "Scan in progress... Keep looking directly at the camera." 
                        : challenge.instruction}
                    </p>
                    
                    {challenge.type === "BLINK_TWICE" && !livenessPassed && (
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400 font-medium">Blinks:</span>
                        <div className="flex gap-1">
                          {[1, 2].map((i) => (
                            <div
                              key={i}
                              className={`w-4 h-1.5 rounded-full border transition-all duration-300 ${
                                blinkCount >= i
                                  ? "bg-emerald-500 border-emerald-400"
                                  : "bg-slate-800 border-slate-700"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </div>
                
                {/* Visual debug HUD for gesture testing feedback */}
                <div className="flex sm:flex-col items-center justify-between gap-1 border-t sm:border-t-0 sm:border-l border-slate-800/80 pt-3.5 sm:pt-0 sm:pl-4 w-full sm:w-auto">
                  <div className="flex flex-col items-center justify-center gap-0.5 bg-slate-950/60 border border-slate-850 px-3 py-1.5 rounded-xl min-w-[56px] h-[48px]">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span className={`text-xs font-bold font-mono ${timeLeft <= 5 ? "text-rose-400 animate-pulse" : "text-white"}`}>
                      {timeLeft}s
                    </span>
                  </div>
                  <div className="flex gap-1.5 sm:flex-col sm:mt-2 text-[9px] font-mono text-slate-500">
                    <div>Pose: <span className="text-cyan-400 font-semibold">{debugPose}</span></div>
                    <div className="hidden sm:block">|</div>
                    <div>Smile: <span className="text-cyan-400 font-semibold">{debugSmileVal}</span></div>
                  </div>
                </div>
              </div>
            )}

            {mode === "enroll" && (
              <div className="bg-slate-950/40 border border-slate-850 rounded-2xl p-5 flex items-center gap-4">
                <div className="p-3 bg-cyan-950/40 border border-cyan-800/30 rounded-xl">
                  <UserPlus className="w-8 h-8 text-cyan-400" />
                </div>
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold mb-1">
                    Biometric Capture
                  </div>
                  <h4 className="text-sm font-bold text-white mb-0.5">
                    Recording Face Structure
                  </h4>
                  <p className="text-xs text-slate-400 leading-normal">
                    Keep your head still and look directly at the center of the camera. The scanner captures 5 snapshots automatically.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step: SUCCESS */}
        {step === "success" && (
          <div className="text-center py-8 flex flex-col items-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full bg-emerald-500/25 blur-xl animate-pulse" />
              <div className="w-20 h-20 rounded-full bg-emerald-950/50 flex items-center justify-center border border-emerald-500/40 relative">
                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">
              {mode === "enroll" ? "Enrollment Successful" : "Access Granted"}
            </h3>
            <p className="text-sm text-slate-400 max-w-xs leading-relaxed mb-8">
              {mode === "enroll" 
                ? "Your face profile embedding has been generated and stored securely in LocalStorage." 
                : "Biometric liveness check and face matching verified successfully."}
            </p>
            <div className="w-full flex gap-3">
              <button
                onClick={resetVerification}
                className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-2xl border border-slate-700/50 transition-all duration-200 active:scale-95 cursor-pointer"
              >
                Done
              </button>
              {mode === "verify" && (
                <div className="flex-[2] py-4 bg-emerald-600 text-white font-semibold rounded-2xl shadow-lg text-center cursor-default">
                  Access Allowed
                </div>
              )}
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
            <h3 className="text-xl font-bold text-white mb-2">
              {mode === "enroll" ? "Enrollment Failed" : "Access Denied"}
            </h3>
            <p className="text-sm text-slate-400 max-w-xs leading-relaxed mb-8">
              {statusMessage || "Verification failed. Please position your camera correctly and try again."}
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
                Retry
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
