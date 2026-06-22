import type { FaceLandmarker, HandLandmarker } from "@mediapipe/tasks-vision";

export interface DetectionResult {
  blinkCount: number;
  isBlinking: boolean;
  isThumbsUp: boolean;
  isTwoFingersRaised: boolean;
  ears: { left: number; right: number };
}

let visionInstance: any = null;
let faceLandmarkerInstance: FaceLandmarker | null = null;
let handLandmarkerInstance: HandLandmarker | null = null;

// Load MediaPipe libraries and models dynamically (client-side only)
export async function initMediaPipe() {
  if (typeof window === "undefined") return null;

  try {
    const { FilesetResolver, FaceLandmarker, HandLandmarker } = await import(
      "@mediapipe/tasks-vision"
    );

    if (!visionInstance) {
      // Use version 0.10.35 to match installed package
      visionInstance = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
      );
    }

    if (!faceLandmarkerInstance) {
      faceLandmarkerInstance = await FaceLandmarker.createFromOptions(visionInstance, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    }

    if (!handLandmarkerInstance) {
      handLandmarkerInstance = await HandLandmarker.createFromOptions(visionInstance, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });
    }

    return { faceLandmarker: faceLandmarkerInstance, handLandmarker: handLandmarkerInstance };
  } catch (error) {
    console.error("Failed to initialize MediaPipe models:", error);
    throw error;
  }
}

// Distance between two 3D landmarks
function calculateDistance(
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number }
): number {
  return Math.sqrt(
    Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2)
  );
}

// Calculate Eye Aspect Ratio (EAR)
// EAR = (dist(top, bottom)) / (dist(left, right))
export function calculateEAR(
  landmarks: { x: number; y: number; z: number }[],
  eyeIndices: { top: number; bottom: number; left: number; right: number }
): number {
  const topPt = landmarks[eyeIndices.top];
  const bottomPt = landmarks[eyeIndices.bottom];
  const leftPt = landmarks[eyeIndices.left];
  const rightPt = landmarks[eyeIndices.right];

  if (!topPt || !bottomPt || !leftPt || !rightPt) return 0.5;

  const verticalDist = calculateDistance(topPt, bottomPt);
  const horizontalDist = calculateDistance(leftPt, rightPt);

  return horizontalDist === 0 ? 0 : verticalDist / horizontalDist;
}

// MediaPipe landmarks indices:
// Left Eye: Top = 159, Bottom = 145, Left = 33, Right = 133
// Right Eye: Top = 386, Bottom = 374, Left = 362, Right = 263
const LEFT_EYE_INDICES = { top: 159, bottom: 145, left: 33, right: 133 };
const RIGHT_EYE_INDICES = { top: 386, bottom: 374, left: 362, right: 263 };

export function analyzeFace(faceLandmarks: { x: number; y: number; z: number }[]): {
  leftEAR: number;
  rightEAR: number;
  isClosed: boolean;
} {
  const leftEAR = calculateEAR(faceLandmarks, LEFT_EYE_INDICES);
  const rightEAR = calculateEAR(faceLandmarks, RIGHT_EYE_INDICES);

  // If BOTH eyes are closed, we count eye closure.
  // Blinking threshold is typically around 0.14 - 0.17 for closed, and > 0.22 for open.
  const isClosed = leftEAR < 0.15 && rightEAR < 0.15;

  return { leftEAR, rightEAR, isClosed };
}

export function analyzeHand(handLandmarks: { x: number; y: number; z: number }[]): {
  isThumbsUp: boolean;
  isTwoFingersRaised: boolean;
} {
  if (handLandmarks.length < 21) {
    return { isThumbsUp: false, isTwoFingersRaised: false };
  }

  // 0: Wrist
  // 1-4: Thumb (4: Tip, 3: IP, 2: MCP, 1: CMC)
  // 5-8: Index (8: Tip, 7: DIP, 6: PIP, 5: MCP)
  // 9-12: Middle (12: Tip, 11: DIP, 10: PIP, 9: MCP)
  // 13-16: Ring (16: Tip, 15: DIP, 14: PIP, 13: MCP)
  // 17-20: Pinky (20: Tip, 19: DIP, 18: PIP, 17: MCP)

  const wrist = handLandmarks[0];
  const thumbTip = handLandmarks[4];
  const thumbIP = handLandmarks[3];
  const thumbMCP = handLandmarks[2];

  const indexTip = handLandmarks[8];
  const indexPIP = handLandmarks[6];
  const indexMCP = handLandmarks[5];

  const middleTip = handLandmarks[12];
  const middlePIP = handLandmarks[10];
  const middleMCP = handLandmarks[9];

  const ringTip = handLandmarks[16];
  const ringPIP = handLandmarks[14];
  const ringMCP = handLandmarks[13];

  const pinkyTip = handLandmarks[20];
  const pinkyPIP = handLandmarks[18];
  const pinkyMCP = handLandmarks[17];

  // Helper: check if a finger is curled (tip is closer to wrist/MCP than its PIP joint or MCP)
  const isIndexCurled = indexTip.y > indexPIP.y || indexTip.y > indexMCP.y;
  const isMiddleCurled = middleTip.y > middlePIP.y || middleTip.y > middleMCP.y;
  const isRingCurled = ringTip.y > ringPIP.y || ringTip.y > ringMCP.y;
  const isPinkyCurled = pinkyTip.y > pinkyPIP.y || pinkyTip.y > pinkyMCP.y;

  // Helper: check if a finger is extended
  const isIndexExtended = indexTip.y < indexPIP.y && indexPIP.y < indexMCP.y;
  const isMiddleExtended = middleTip.y < middlePIP.y && middlePIP.y < middleMCP.y;

  // 1. Check Thumbs Up
  // - Hand orientation: Wrist is lower than knuckles (y is larger down screen)
  const handUpright = wrist.y > indexMCP.y && wrist.y > middleMCP.y;
  
  // - Thumb is pointing up (tip Y is smaller than IP and MCP) and extended (tip X is outwards)
  const thumbUp = thumbTip.y < thumbIP.y && thumbIP.y < thumbMCP.y;
  
  // - Other four fingers are curled
  const othersCurledForThumbsUp = isIndexCurled && isMiddleCurled && isRingCurled && isPinkyCurled;
  
  const isThumbsUp = handUpright && thumbUp && othersCurledForThumbsUp;

  // 2. Check Raise Two Fingers (Peace sign/Index+Middle extended)
  // - Index and Middle fingers extended
  const indexAndMiddleExtended = isIndexExtended && isMiddleExtended;
  
  // - Ring and Pinky curled
  const ringAndPinkyCurled = isRingCurled && isPinkyCurled;
  
  // - Thumb is folded or pointing down/neutral (not pointing straight up high like index/middle)
  const thumbFolded = thumbTip.y > indexMCP.y || Math.abs(thumbTip.x - indexMCP.x) < 0.1;

  const isTwoFingersRaised = handUpright && indexAndMiddleExtended && ringAndPinkyCurled && thumbFolded;

  return { isThumbsUp, isTwoFingersRaised };
}

// ----------------------------------------------------
// FACE AUTHENTICATION & EMBEDDING UTILITIES
// ----------------------------------------------------

export interface FaceEmbeddingPoint {
  x: number;
  y: number;
  z: number;
}

// Extract a normalized 3D landmark mesh
// Centered on the nose tip (4) and scaled by face width (temple-to-temple: 127 to 356)
export function extractFaceEmbedding(landmarks: FaceEmbeddingPoint[]): FaceEmbeddingPoint[] {
  const nose = landmarks[4];
  const leftTemple = landmarks[127];
  const rightTemple = landmarks[356];

  if (!nose || !leftTemple || !rightTemple) {
    return [];
  }

  const faceWidth = Math.sqrt(
    Math.pow(leftTemple.x - rightTemple.x, 2) +
    Math.pow(leftTemple.y - rightTemple.y, 2) +
    Math.pow(leftTemple.z - rightTemple.z, 2)
  );
  if (faceWidth === 0) return [];

  // Normalize all landmarks relative to the nose tip and face width scale
  return landmarks.map((pt) => ({
    x: (pt.x - nose.x) / faceWidth,
    y: (pt.y - nose.y) / faceWidth,
    z: (pt.z - nose.z) / faceWidth,
  }));
}

// Compare two face embeddings and return average Euclidean distance (lower is more similar)
export function compareFaceEmbeddings(
  embeddingA: FaceEmbeddingPoint[],
  embeddingB: FaceEmbeddingPoint[]
): number {
  if (embeddingA.length === 0 || embeddingB.length === 0 || embeddingA.length !== embeddingB.length) {
    return 1.0; // Max difference
  }

  let totalDist = 0;
  for (let i = 0; i < embeddingA.length; i++) {
    const pt1 = embeddingA[i];
    const pt2 = embeddingB[i];
    if (pt1 && pt2) {
      totalDist += Math.sqrt(
        Math.pow(pt1.x - pt2.x, 2) +
        Math.pow(pt1.y - pt2.y, 2) +
        Math.pow(pt1.z - pt2.z, 2)
      );
    }
  }

  return totalDist / embeddingA.length;
}

// Detect if user has turned head left or right (direction-aware based on mirrored camera coordinates)
export function detectHeadTurn(
  landmarks: FaceEmbeddingPoint[]
): "LEFT" | "RIGHT" | "STRAIGHT" {
  const leftTemple = landmarks[127];
  const rightTemple = landmarks[356];
  const noseTip = landmarks[4];

  if (!leftTemple || !rightTemple || !noseTip) return "STRAIGHT";

  const minX = Math.min(leftTemple.x, rightTemple.x);
  const maxX = Math.max(leftTemple.x, rightTemple.x);

  const distLeftBound = Math.abs(noseTip.x - minX);
  const distRightBound = Math.abs(maxX - noseTip.x);

  if (distLeftBound === 0 || distRightBound === 0) return "STRAIGHT";

  const ratio = distLeftBound / distRightBound;

  if (ratio < 0.45) {
    // If leftTemple.x is smaller, the image left side represents screen-left
    return leftTemple.x < rightTemple.x ? "LEFT" : "RIGHT";
  } else if (ratio > 2.2) {
    return leftTemple.x < rightTemple.x ? "RIGHT" : "LEFT";
  }

  return "STRAIGHT";
}

// Detect if user is smiling (mouth width is significantly wider than standard proportions)
export function detectSmile(landmarks: FaceEmbeddingPoint[]): boolean {
  const leftMouth = landmarks[61];
  const rightMouth = landmarks[291];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];

  if (!leftMouth || !rightMouth || !leftEye || !rightEye) return false;

  const mouthWidth = Math.sqrt(
    Math.pow(leftMouth.x - rightMouth.x, 2) +
    Math.pow(leftMouth.y - rightMouth.y, 2) +
    Math.pow(leftMouth.z - rightMouth.z, 2)
  );
  
  const eyeDist = Math.sqrt(
    Math.pow(leftEye.x - rightEye.x, 2) +
    Math.pow(leftEye.y - rightEye.y, 2) +
    Math.pow(leftEye.z - rightEye.z, 2)
  );

  if (eyeDist === 0) return false;

  const ratio = mouthWidth / eyeDist;
  
  // Normal mouth-to-eye width ratio is ~0.72. A smile stretches it to >0.83.
  return ratio > 0.83;
}
