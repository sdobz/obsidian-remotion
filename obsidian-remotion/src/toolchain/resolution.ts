import fs from "fs";
import path from "path";

// Re-export shared resolution utilities from remotion-md
export {
  getResolutionDirectory,
  createModuleResolver,
  findNodeModulesPaths,
} from "remotion-md";
