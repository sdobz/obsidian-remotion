I want to be able to write tsx that renders a widget that can edit the markdown.
I notice that obsidian-remotion has no remotion specific code except a small chunk of runtime

The goal of this project includes literate programming: Defining the program in itself

I want remotion to purely be a concern of the 'examples' package, and `obsidian-remotion` has the responsibility to render the react component passed to `render`

In addition the way this is provided needs to be more clear than string construction. Since we will need a way to communicate more bi-directionally I want to build a package with our bundler as the "runtime" - this will be included in the dependency bundle

`examples/Player.md`

```tsx
import { Player, PlayerProps } from `@remotion/player`
export const Player = (...props: PlayerProps) => <Player playerOptions=... {...props} />
```

`examples/Basic.md`

```tsx
import { render } from `obsidian-remotion-runtime`
import { Player } from './Player.md'

export const BasicTitle = render(
	() => <Player component={Title} />
)
```

- [x] Provide `render` through a runtime package (`obsidian-remotion-runtime`)
- [x] Move remotion out of the obsidian-remotion plugin and into `examples/Player.md`
- [x] Replace **REMOTION_DEPS** lookups with `require` calls
- [x] Update detection to treat `render()` as the entry point
- [x] Update examples to use `render()` + the `Player` wrapper
- [ ] Define how widgets will edit markdown (scope + API shape)
