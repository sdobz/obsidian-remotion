This document describes how scroll syncing is done

### Document

In the left column there are spans of text. We locate the start and end vertical position, and represent them as `Band {center, height}`

We can take each span and create a preview. Previews are usually taller than the span.

### Viewport

The Editor is out of our control. It is a document that is `scrollHeight` tall, and it is seen through a `Viewport {scrollTop, height}`. The scrollPos is the position of the top of the viewport. It can be scrolled, we will be notified of its new scrollTop with a callback.

The Preview Iframe is in our control. It has the same Viewport height. It has the same representation, and can have a different scrollHeight.

## Association

Each span has a band has a preview in a 1:1 relationship. Some span bands can't be located, so they will be null in the array. In this case the preview band should be null too.

Since they have this relationship, we can establish an invariant.

> When a span band is centered vertically in the viewport, the preview band is also centered.

Other than that we will try to do our best to maintain horizontal association.

## Overlap

If two short spans are near each other and have tall previews then the naively placed preview bands will overlap.

One option is to place a preview band ideally, then check the previous band bottom and shift it down by the offset.

> Bands of the same type cannot overlap

## Scroll Bounds

> Bands lie entirely within the scrollable area

This rule comes into play with span bands near the top or bottom of the document.

A naively placed short span with a tall preview will have the top of the preview be outside the bounds. The preview must be shifted down. This should be handled in overlap

## Bonking

Imagine a span with nearly a viewport of whitespace at the bottom. When it is near the top the preview must also be near the top, implying a certain amount of whitespace below it.

> The editor and preview panes hit scroll bounds at the same time

## Sync Intuition

At any viewport scrollTop there exists a horizontal line across the center of the viewport.

This line has one span and preview centerline above it (or the top of the document), and one span and preview centerline below it (or the bottom of the document).

Scale the editors vertically such that these centerlines are the same distance apart. The bands scale as well, stretching taller or squishing shorter.

Sweep a line from the top centerlines to the bottom centerlines.

At the top centerlines there is a span and a preview under the sweep

Push it down until it reaches the first edge (usually but not necessarily the span)

This is the "exact" band, where the scroll will be equal and the centerlines will be aligned

If no preview slipping has happened then the scaling will be 1:1 and both views continue in sync

If preview slipping HAS happened then this is the lerp region. The other viewport will move faster or slower, such that they arrive at the next exact band at the same time.

### Implementation proposal

After reflow perform `slipBands` to create the list of preview bands

During scroll check for a previous `Interpolator {aTop, aBottom, bTop, bBottm, interpolate: (from, pos, to) => number}`

If the viewports are within the range then reuse it, otherwise discard it

If we have to create a new one perform the intuition to create a new interpolator.

The exact interpolation (not necessarily linear) and number of bands will be iterated on

## Questions:

1. How can we use this bidirectionally? We have two callbacks, one for spans and one for previews, and we can set the scrollTop of the other. Is the Interpolator representation able to pass in the right parameter for from and to based on the callback?
2. Frame: I am describing top, bottom, height, center, etc. We start with scrollTop, viewportHeight, and scrollLength. These algorithms will play nice with a certain representation, and fight others. DOM realities should be transformed into and out of the right representation to simplify understanding
3. Terminology: Span, band, preview, etc. Make sure that the same semantic shares the same name.
