
```tsx
import React from 'react';
import { useCurrentFrame, interpolate, Series, Composition, Sequence } from 'remotion';
import { preview } from 'remotion-md';

const Title: React.FC<React.PropsWithChildren> = ({children}) => {
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



```tsx

const First= preview(
	() => <Title>Hello Remotion</Title>
)

const Second = preview(
	() => <Title>Another Title</Title>
)

export default preview(() => <Series>
	<Series.Sequence durationInFrames={30}>
		<First />
	</Series.Sequence>
	<Series.Sequence durationInFrames={30}>
		<Second />
	</Series.Sequence>
</Series>, {durationInFrames: 60})
```
