
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

const First= preview(
	() => <Sequence durationInFrames={30}>
	<Title>Hello Remotion</Title>
	</Sequence>
)

const Second = preview(
	() => <Title>Another Title</Title>
)


preview(() => <Series>
	<Series.Sequence durationInFrames={30}>
		<First />
	</Series.Sequence>
	<Series.Sequence durationInFrames={30}>
		<Second />
	</Series.Sequence>
</Series>)
```
