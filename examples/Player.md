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
};

export const Player = (props: PlayerProps) => {
  return <RemotionPlayer {...DEFAULT_PLAYER_OPTIONS} {...props} />;
};
```
