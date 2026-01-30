
```tsx
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { preview } from 'remotion-md';

const Title: React.FC = ({children}) => {
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
			{children}
		</div>
	);
};
```

## Scene 1

```tsx
preview(
	<Title>Hello Remotion</Title>
)
```

## Shot 2

```tsx
preview(
	<Title>Another Title</Title>
)
```