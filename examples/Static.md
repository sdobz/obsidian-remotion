```tsx
import React from 'react'
import {AbsoluteFill, staticFile} from 'remotion';
import {Video} from '@remotion/media';
 
export const StaticVideo = preview(() => {
  return (
    <AbsoluteFill>
      <Video src={staticFile('Render.md.mp4')} />
    </AbsoluteFill>
  );
});
```
