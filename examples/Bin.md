```tsx
import React from "react";
import { render } from "obsidian-remotion-runtime";

const Bin = () => {
  return <div>test?</div>;
};

render(Bin);
```

A "Bin" is a list of filesystem locations with selection criteria and filters. It is used to create a workflow for file ingest.

An example workflow is: Map all files to named slices

This requires two capabilities:

- [ ] An `obsidian-remotion-runtime` capability to "list files"
- [ ] A way to use the `.md` file as UI state
