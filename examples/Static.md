```tsx
import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { Video } from "@remotion/media";
import { render } from "obsidian-remotion-runtime";
import { Player } from "./Player.md";

const StaticVideoRoot = () => {
  return (
    <AbsoluteFill>
      <Video src={staticFile("Render.md.mp4")} />
    </AbsoluteFill>
  );
};

export const StaticVideo = render(() => <Player component={StaticVideoRoot} />);
```
