
```tsx
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

const Title: React.FC = () => {
	const frame = useCurrentFrame();
	const opacity = interpolate(frame, [0, 30], [0, 1]);

	return (
		<div
			style={{
				fontSize: 80,
				fontWeight: 700,
				color: '#fff',
				background: '#111',
				width: '100%',
				height: '100%',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				opacity,
			}}
		>
			Hello Remotion
		</div>
	);
};
```

```tsx
import { preview } from 'remotion-md';

preview(
	<Title />
)
```
