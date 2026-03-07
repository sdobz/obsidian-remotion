```tsx
import React from "react";
import { Player as RemotionPlayer, type PlayerProps } from "@remotion/player";

const DEFAULT_PLAYER_OPTIONS: Partial<PlayerProps> = {
  durationInFrames: 150,
  fps: 30,
  compositionWidth: 1280,
  compositionHeight: 720,
  controls: true,
  loop: false,
  autoPlay: false,
  acknowledgeRemotionLicense: true,
};

export const Player = (props: PlayerProps) => {
  const mergedProps = { ...DEFAULT_PLAYER_OPTIONS, ...props };
  // Calculate aspect ratio from composition dimensions
  const aspectRatio = mergedProps.compositionWidth! / mergedProps.compositionHeight!;
  
  return (
    <div style={{ width: "100%", aspectRatio }}>
      <RemotionPlayer {...mergedProps} />
    </div>
  );
};
```
